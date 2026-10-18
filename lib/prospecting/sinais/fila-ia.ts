/**
 * A fila da leitura de sites por IA (Fase 3b), guardada no próprio candidato
 * (`data.analise.ia`), como a fila da análise grátis (`fila.ts`).
 *
 * - `pedirLeituraIaDaCampanha`: o dono clica "Ler com IA". Entram as empresas da
 *   campanha com site lido pela análise grátis atual e sem leitura por IA feita
 *   (a que falhou ou parou no teto pode ser pedida de novo).
 * - `lerSitesComIaPendentes`: a rodada do worker de prospecção.
 *
 * ═══ O TETO POR CAMPANHA ═══
 *
 * Antes de cada leitura, o worker RESERVA `RESERVA_POR_LEITURA_CENTAVOS` no
 * gasto da campanha, num único UPDATE que só passa se o gasto com a reserva
 * couber no teto. Duas leituras em paralelo não estouram o teto: a segunda
 * reserva vê a primeira. Depois da leitura, a reserva é trocada pelo custo real
 * (ou devolvida, se o modelo nem foi chamado). Quem não consegue reservar fica
 * com a leitura `teto`, e a tela diz por quê.
 *
 * Gravar só vale se a leitura ainda estiver `lendo`: se a LGPD anonimizou o
 * candidato no meio, o resultado é descartado (mesma regra de `fila.ts`).
 */
import type pg from "pg";

import { logger } from "@/lib/logger";

import { ProspectingError } from "../provider";
import type { Prospect } from "../schema";
import {
  lerComIa,
  leituraIaPendente,
  RESERVA_POR_LEITURA_CENTAVOS,
  TETO_DA_IA_POR_CAMPANHA_CENTAVOS,
  type ChamarModelo,
  type DependenciasDaLeituraIa,
} from "./ia";
import {
  leituraIaSchema,
  sinalSchema,
  VERSAO_DA_ANALISE,
  type Analise,
  type LeituraIa,
} from "./tipos";

/** Quantas leituras a rodada faz em paralelo. */
const LOTE_IA = 3;
/** Leitura presa em `lendo` por mais que isto (worker caiu) volta à fila. */
const TRAVADA_MINUTOS = 10;

export function textoDoTeto(): string {
  return `O teto de US$ ${(TETO_DA_IA_POR_CAMPANHA_CENTAVOS / 100).toFixed(2)} de leitura por IA desta campanha foi atingido.`;
}

export async function pedirLeituraIaDaCampanha(
  pool: pg.Pool,
  org: string,
  campaignId: string,
  agora = new Date(),
): Promise<{ pedidas: number }> {
  const campanha = (
    await pool.query<{ gasto_ia_centavos: string }>(
      "select gasto_ia_centavos from prospecting_campaigns where organization_id=$1 and id=$2",
      [org, campaignId],
    )
  ).rows[0];
  if (!campanha) throw new ProspectingError("Campanha não encontrada.", 404);
  if (
    Number(campanha.gasto_ia_centavos) + RESERVA_POR_LEITURA_CENTAVOS >
    TETO_DA_IA_POR_CAMPANHA_CENTAVOS
  )
    throw new ProspectingError(textoDoTeto(), 409);
  const { rowCount } = await pool.query(
    `update prospecting_candidates
        set data = jsonb_set(data, '{analise,ia}', $3::jsonb), updated_at = now()
      where organization_id = $1 and campaign_id = $2
        and status <> 'skipped'
        and data->'analise'->>'status' = 'ok'
        and coalesce((data->'analise'->>'versao')::int, 1) = $4::int
        and (data->'analise'->'ia' is null
             or data->'analise'->'ia'->>'status' in ('falhou', 'teto'))`,
    [org, campaignId, JSON.stringify(leituraIaPendente(agora)), VERSAO_DA_ANALISE],
  );
  return { pedidas: rowCount ?? 0 };
}

interface Reivindicada {
  organization_id: string;
  id: string;
  campaign_id: string;
  data: Prospect & { analise: Analise & { ia: LeituraIa } };
}

export async function reivindicarLeiturasIa(pool: pg.Pool, n: number): Promise<Reivindicada[]> {
  const { rows } = await pool.query<Reivindicada>(
    `update prospecting_candidates c
        set data = jsonb_set(jsonb_set(c.data, '{analise,ia,status}', '"lendo"'),
                             '{analise,ia,iniciada_em}', to_jsonb(now())),
            updated_at = now()
      where c.id in (
        select p.id from prospecting_candidates p
         where (p.data->'analise'->'ia'->>'status' = 'pendente'
                or (p.data->'analise'->'ia'->>'status' = 'lendo'
                    and (p.data->'analise'->'ia'->>'iniciada_em')::timestamptz
                        < now() - make_interval(mins => $2::int)))
           and public.fn_org_operante(p.organization_id)
         order by p.updated_at
         limit $1
         for update skip locked)
      returning c.organization_id, c.id, c.campaign_id, c.data`,
    [n, TRAVADA_MINUTOS],
  );
  return rows;
}

/** Reserva no gasto da campanha, só se couber no teto. */
export async function reservarGastoIa(
  pool: pg.Pool,
  org: string,
  campaignId: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `update prospecting_campaigns
        set gasto_ia_centavos = gasto_ia_centavos + $3::numeric
      where organization_id = $1 and id = $2
        and gasto_ia_centavos + $3::numeric <= $4::numeric`,
    [org, campaignId, RESERVA_POR_LEITURA_CENTAVOS, TETO_DA_IA_POR_CAMPANHA_CENTAVOS],
  );
  return (rowCount ?? 0) > 0;
}

/** Troca a reserva pelo custo real (zero quando o modelo não foi chamado). */
export async function acertarGastoIa(
  pool: pg.Pool,
  org: string,
  campaignId: string,
  custoReal: number,
): Promise<void> {
  await pool.query(
    `update prospecting_campaigns
        set gasto_ia_centavos = greatest(0, gasto_ia_centavos - $3::numeric + $4::numeric)
      where organization_id = $1 and id = $2`,
    [org, campaignId, RESERVA_POR_LEITURA_CENTAVOS, Math.max(0, custoReal)],
  );
}

export async function gravarLeituraIa(
  pool: pg.Pool,
  org: string,
  id: string,
  leitura: unknown,
  sinaisNovos: unknown[] = [],
): Promise<boolean> {
  const valida = leituraIaSchema.parse(leitura);
  const sinais = sinaisNovos.map((s) => sinalSchema.parse(s));
  const { rowCount } = await pool.query(
    `update prospecting_candidates
        set data = jsonb_set(
              jsonb_set(data, '{analise,ia}', $3::jsonb),
              '{analise,sinais}', coalesce(data->'analise'->'sinais', '[]'::jsonb) || $4::jsonb),
            updated_at = now()
      where organization_id = $1 and id = $2 and data->'analise'->'ia'->>'status' = 'lendo'`,
    [org, id, JSON.stringify(valida), JSON.stringify(sinais)],
  );
  return (rowCount ?? 0) > 0;
}

/** O que dizer na tela quando a leitura falha, sem jargão nem mensagem crua do provedor. */
export function motivoDaFalhaDaIa(error: unknown): string {
  const nome = error instanceof Error ? error.name : "";
  if (nome === "llm_not_configured")
    return "Nenhum provedor de IA configurado. Configure em IA › Provedores e peça de novo.";
  if (nome === "llm_budget_exceeded")
    return "O teto de gasto de IA da organização foi atingido. Nada foi lido.";
  return "A IA não respondeu. Pode pedir de novo.";
}

/**
 * A rodada: lotes de `LOTE_IA` até `ate` (epoch ms). Devolve quantas leituras
 * foram gravadas (qualquer desfecho).
 */
export async function lerSitesComIaPendentes(
  pool: pg.Pool,
  ate: number,
  deps: DependenciasDaLeituraIa & { chamarModelo: ChamarModelo },
): Promise<number> {
  let gravadas = 0;
  while (Date.now() + 45_000 < ate) {
    const lote = await reivindicarLeiturasIa(pool, LOTE_IA);
    if (!lote.length) break;
    const antes = gravadas;
    await Promise.all(
      lote.map(async (c) => {
        const org = c.organization_id;
        try {
          const ia = { ...c.data.analise.ia, status: "lendo" as const };
          if (!(await reservarGastoIa(pool, org, c.campaign_id))) {
            const parou = { ...ia, status: "teto" as const, observacao: textoDoTeto() };
            if (await gravarLeituraIa(pool, org, c.id, parou)) gravadas++;
            return;
          }
          let custo = 0;
          try {
            const r = await lerComIa(org, c.data, c.data.analise, ia, deps);
            custo = r.custoCentavos;
            if (await gravarLeituraIa(pool, org, c.id, r.leitura, r.sinaisNovos)) gravadas++;
          } catch (error) {
            const falhou = {
              ...ia,
              status: "falhou" as const,
              observacao: motivoDaFalhaDaIa(error),
            };
            if (await gravarLeituraIa(pool, org, c.id, falhou)) gravadas++;
            logger.warn("[prospecting] leitura por IA falhou", {
              organization_id: org,
              candidate_id: c.id,
              error: error instanceof Error ? error.name : String(error),
            });
          } finally {
            await acertarGastoIa(pool, org, c.campaign_id, custo);
          }
        } catch (error) {
          // Falha de banco: a leitura volta à fila pelo prazo de travada.
          logger.warn("[prospecting] leitura por IA não gravou; volta à fila", {
            organization_id: org,
            candidate_id: c.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }),
    );
    if (gravadas === antes) break;
  }
  return gravadas;
}
