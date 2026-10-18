/**
 * A fila da análise de sites, guardada no próprio candidato
 * (`prospecting_candidates.data.analise`).
 *
 * - `pedirAnaliseDaCampanha`: o dono pede, a tela chama; marca como pendente as
 *   empresas da campanha que ainda não foram analisadas (ou cuja análise venceu,
 *   ou foi feita por uma versão anterior das réguas) e que não foram recusadas.
 * - `analisarSitesPendentes`: a rodada do worker de prospecção. Pega poucas por
 *   vez (`for update skip locked`, sem o lock da organização: a leitura de sites
 *   demora e não pode travar os comandos da tela), lê, grava.
 *
 * A gravação só vale se a análise ainda estiver `analisando`: se a LGPD
 * anonimizou o candidato no meio (a cascata reescreve o `data` inteiro), o
 * resultado é descartado em vez de recriar dado de quem pediu para sair.
 */
import type pg from "pg";

import { logger } from "@/lib/logger";

import type { Prospect } from "../schema";
import { analisarEmpresa, type DependenciasDaAnalise } from "./analisar";
import { buscarNaReceita } from "./receita";
import {
  analisePendente,
  analiseSchema,
  VALIDADE_DA_ANALISE_DIAS,
  VERSAO_DA_ANALISE,
} from "./tipos";

/** Quantas empresas a rodada pega de uma vez (lidas em paralelo). */
const LOTE = 4;
/** Análise presa em `analisando` por mais que isto (worker caiu) volta à fila. */
const TRAVADA_MINUTOS = 10;

export async function pedirAnaliseDaCampanha(
  pool: pg.Pool,
  org: string,
  campaignId: string,
  agora = new Date(),
): Promise<{ pedidas: number }> {
  const { rowCount } = await pool.query(
    `update prospecting_candidates
        set data = jsonb_set(data, '{analise}', $3::jsonb), updated_at = now()
      where organization_id = $1 and campaign_id = $2
        and status <> 'skipped'
        and (
          data->'analise' is null
          or (data->'analise'->>'status' in ('ok','sem_site','fora_do_ar')
              and ((data->'analise'->>'analisada_em')::timestamptz < now() - make_interval(days => $4::int)
                   or coalesce((data->'analise'->>'versao')::int, 1) < $5::int))
        )`,
    [
      org,
      campaignId,
      JSON.stringify(analisePendente(agora)),
      VALIDADE_DA_ANALISE_DIAS,
      VERSAO_DA_ANALISE,
    ],
  );
  return { pedidas: rowCount ?? 0 };
}

interface Reivindicado {
  organization_id: string;
  id: string;
  data: Prospect & { analise?: { pedida_em?: string } };
}

/** Pega até `n` empresas pendentes (ou travadas) de organizações operantes. */
export async function reivindicarPendentes(pool: pg.Pool, n: number): Promise<Reivindicado[]> {
  const { rows } = await pool.query<Reivindicado>(
    `update prospecting_candidates c
        set data = jsonb_set(jsonb_set(c.data, '{analise,status}', '"analisando"'),
                             '{analise,iniciada_em}', to_jsonb(now())),
            updated_at = now()
      where c.id in (
        select p.id from prospecting_candidates p
         where (p.data->'analise'->>'status' = 'pendente'
                or (p.data->'analise'->>'status' = 'analisando'
                    and (p.data->'analise'->>'iniciada_em')::timestamptz
                        < now() - make_interval(mins => $2::int)))
           and public.fn_org_operante(p.organization_id)
         order by p.updated_at
         limit $1
         for update skip locked)
      returning c.organization_id, c.id, c.data`,
    [n, TRAVADA_MINUTOS],
  );
  return rows;
}

export async function gravarAnalise(
  pool: pg.Pool,
  org: string,
  id: string,
  analise: unknown,
): Promise<boolean> {
  const valida = analiseSchema.parse(analise);
  const { rowCount } = await pool.query(
    `update prospecting_candidates
        set data = jsonb_set(data, '{analise}', $3::jsonb), updated_at = now()
      where organization_id = $1 and id = $2 and data->'analise'->>'status' = 'analisando'`,
    [org, id, JSON.stringify(valida)],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * A busca na Receita não pode derrubar a análise do site: se a consulta falha,
 * a análise grava sem ela (e a nota fica sem o porte, como antes).
 */
async function procurarNaReceita(pool: pg.Pool, c: Reivindicado) {
  try {
    return await buscarNaReceita(pool, c.data);
  } catch (error) {
    logger.warn("[prospecting] busca na Receita falhou; a análise segue sem ela", {
      organization_id: c.organization_id,
      candidate_id: c.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

/**
 * A rodada: lotes de `LOTE` empresas até `ate` (epoch ms). Devolve quantas foram
 * analisadas. Erro de uma empresa não derruba as outras: ela volta à fila pelo
 * prazo de travada, e o motivo fica no log.
 */
export async function analisarSitesPendentes(
  pool: pg.Pool,
  ate: number,
  deps: DependenciasDaAnalise = {},
): Promise<number> {
  let analisadas = 0;
  // Cada lote leva no máximo o prazo de uma empresa; só começa se couber.
  while (Date.now() + 30_000 < ate) {
    const lote = await reivindicarPendentes(pool, LOTE);
    if (!lote.length) break;
    const antes = analisadas;
    await Promise.all(
      lote.map(async (c) => {
        try {
          const analise = await analisarEmpresa(
            c.data,
            c.data.analise?.pedida_em ?? new Date().toISOString(),
            deps,
          );
          const receita = await procurarNaReceita(pool, c);
          if (receita !== undefined) analise.receita = receita;
          if (await gravarAnalise(pool, c.organization_id, c.id, analise)) analisadas++;
        } catch (error) {
          logger.warn("[prospecting] análise de site falhou; volta à fila", {
            organization_id: c.organization_id,
            candidate_id: c.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }),
    );
    // Um lote inteiro sem nenhuma gravação é falha sistemática (banco, rede do
    // servidor): parar aqui em vez de girar até o fim do prazo. As empresas
    // voltam à fila pelo prazo de travada.
    if (analisadas === antes) break;
  }
  return analisadas;
}
