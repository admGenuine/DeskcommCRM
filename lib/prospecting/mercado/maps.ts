/**
 * Procurar no Maps as empresas do Mercado que ficaram sem site (Fase 3b do
 * fork da Genuine, paga pelo saldo da Apify da organização, teto por campanha).
 *
 * A empresa do Mercado vem da Receita: tem CNPJ, porte e telefone, mas quase
 * nunca site (o e-mail da Receita costuma ser do contador). A análise grátis
 * tenta o domínio do e-mail; o que fica `sem_site` ou `fora_do_ar` pode ser
 * procurado no Maps pelo nome, cidade e UF. O Maps traz o site, a nota e o
 * número de avaliações, e o site achado volta para a análise grátis.
 *
 * ═══ O QUE O MAPS DEVOLVE PODE NÃO SER A EMPRESA ═══
 *
 * A busca pega o primeiro lugar de cada termo, e o primeiro lugar pode ser a
 * padaria do lado. Só vale quando uma palavra própria do nome da empresa
 * (`palavrasDoNome`) aparece no nome do lugar e a cidade é a mesma; o resto
 * fica como "no Maps aparece outra empresa", com o nome dela, sem tocar em nada.
 *
 * ═══ O TETO ═══
 *
 * Ao começar, a execução recebe o teto que sobra na campanha
 * (`maxTotalChargeUsd`), e esse valor é RESERVADO em
 * `prospecting_campaigns.gasto_maps_usd` (migration 9004). Quando ela termina,
 * a reserva vira o custo que a Apify informou. O tamanho do lote sai do custo
 * estimado por empresa, para o teto não cortar a busca no meio.
 */
import type pg from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

import { provedorDaOrganizacao, type ProvedorDeBusca } from "../provedor";
import { ProspectingError } from "../provider";
import { normalizeProspect, type Prospect } from "../schema";
import { credential, withProspectingLock } from "../store";
import { municipioComparavel } from "../sinais/receita";
import { palavrasDoNome } from "../sinais/site";
import { analisePendente } from "../sinais/tipos";
import {
  buscaNoMapsSchema,
  MINIMO_PARA_BUSCAR_USD,
  TETO_DO_MAPS_POR_CAMPANHA_USD,
  type BuscaNoMaps,
} from "./busca-no-maps";

export { TETO_DO_MAPS_POR_CAMPANHA_USD };

/** Custo estimado de procurar uma empresa (o lugar e a parte da partida da execução). */
export const CUSTO_ESTIMADO_POR_EMPRESA_USD = 0.007;
/** Quantas empresas por execução, no máximo. */
export const MAX_POR_BUSCA = 120;
/** Execução que não terminou neste prazo é dada como falha (e a reserva fica, por prudência). */
const PRAZO_DA_EXECUCAO_MIN = 60;

const TERMINAIS = ["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"];

const SUFIXOS = /\b(ltda|me|epp|eireli|s\/?a|s\.a\.?|ss|limitada|mei)\b\.?/gi;

/** O termo de busca: nome sem a forma jurídica, cidade e UF. */
export function termoDeBusca(p: Pick<Prospect, "name" | "city" | "state_code">): string | null {
  const nome = p.name.replace(SUFIXOS, " ").replace(/\s+/g, " ").trim();
  if (!nome || !p.city || !p.state_code) return null;
  return `${nome} ${p.city} ${p.state_code}`.slice(0, 200);
}

/** O lugar do Maps é esta empresa? Palavra própria do nome no lugar, e a mesma cidade. */
export function confereComAEmpresa(
  empresa: Pick<Prospect, "name" | "razao_social" | "city">,
  lugar: Pick<Prospect, "name" | "city">,
): boolean {
  const palavras = palavrasDoNome(empresa.name, empresa.razao_social);
  if (!palavras.length) return false;
  const doLugar = new Set(palavrasDoNome(lugar.name));
  if (!palavras.some((w) => doLugar.has(w))) return false;
  if (!lugar.city || !empresa.city) return true;
  return municipioComparavel(lugar.city) === municipioComparavel(empresa.city);
}

/**
 * O que muda no candidato com o lugar do Maps (o `||` do jsonb faz a junção).
 * O telefone da Receita fica: ele já passou pela régua de entrada.
 */
export function mudancaDoLugar(
  empresa: Prospect & { analise?: { site?: unknown } | null },
  busca: BuscaNoMaps,
  item: Record<string, unknown> | null,
  agora: Date,
): Record<string, unknown> {
  const fim = { ...busca, concluida_em: agora.toISOString() };
  const lugar = item ? normalizeProspect(item) : null;
  if (!lugar)
    return {
      maps_busca: {
        ...fim,
        status: "nao_achada",
        observacao: "O Maps não trouxe nenhum lugar aberto para esta empresa.",
      },
    };
  if (!confereComAEmpresa(empresa, lugar))
    return {
      maps_busca: {
        ...fim,
        status: "nao_confere",
        titulo: lugar.name.slice(0, 200),
        observacao:
          "No Maps aparece outra empresa com esse nome ou noutra cidade. Nada foi trocado.",
      },
    };
  const site = empresa.website ?? lugar.website;
  return {
    ...(site && !empresa.website ? { website: site } : {}),
    maps_url: lugar.maps_url,
    rating: lugar.rating,
    reviews: lugar.reviews,
    // O site achado volta para a análise grátis, que o lê na próxima rodada.
    ...(lugar.website && !empresa.website ? { analise: analisePendente(agora) } : {}),
    maps_busca: {
      ...fim,
      status: "achada",
      titulo: lugar.name.slice(0, 200),
      observacao: lugar.website ? null : "Achada no Maps, mas sem site cadastrado lá.",
    },
  };
}

/** O termo de cada item do Maps (a Apify devolve a busca que achou o lugar). */
function termoDoItem(item: Record<string, unknown>): string | null {
  return typeof item.searchString === "string" ? item.searchString.trim() : null;
}

type Banco = Pick<pg.PoolClient, "query">;

/** Para teste: o provedor e a chave no lugar dos da organização (sem rede, sem crédito). */
export interface DependenciasDoMaps {
  provedor?: ProvedorDeBusca;
  chave?: string;
}

const ELEGIVEIS = `organization_id = $1 and campaign_id = $2
  and status <> 'skipped'
  and data->>'fonte' = 'mercado'
  and coalesce(data->>'website', '') = ''
  and data->'analise'->>'status' in ('sem_site', 'fora_do_ar')
  and (data->'maps_busca' is null or data->'maps_busca'->>'status' = 'falhou')`;

export async function contarElegiveisParaOMaps(db: Banco, org: string, campaignId: string) {
  const { rows } = await db.query<{ n: string }>(
    `select count(*)::text as n from prospecting_candidates where ${ELEGIVEIS}`,
    [org, campaignId],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * O dono clicou "Procurar no Maps". Sob o lock da prospecção da organização
 * (`withProspectingLock`, advisory lock de sessão): dois cliques seguidos não
 * abrem duas execuções para as mesmas empresas, e o segundo já vê a reserva
 * do primeiro no gasto da campanha.
 */
export async function pedirBuscaNoMaps(
  pool: pg.Pool,
  admin: SupabaseClient,
  org: string,
  campaignId: string,
  agora = new Date(),
  deps: DependenciasDoMaps = {},
): Promise<{ pedidas: number; teto_usd: number }> {
  return withProspectingLock(pool, org, async (db) => {
    const campanha = (
      await db.query<{ gasto_maps_usd: string }>(
        "select gasto_maps_usd from prospecting_campaigns where organization_id=$1 and id=$2",
        [org, campaignId],
      )
    ).rows[0];
    if (!campanha) throw new ProspectingError("Campanha não encontrada.", 404);
    const restante = TETO_DO_MAPS_POR_CAMPANHA_USD - Number(campanha.gasto_maps_usd);
    if (restante < MINIMO_PARA_BUSCAR_USD)
      throw new ProspectingError(
        `O teto de US$ ${TETO_DO_MAPS_POR_CAMPANHA_USD.toFixed(2)} de busca no Maps desta campanha foi atingido.`,
        409,
      );
    const cabem = Math.min(MAX_POR_BUSCA, Math.floor(restante / CUSTO_ESTIMADO_POR_EMPRESA_USD));
    const { rows } = await db.query<{ id: string; data: Prospect }>(
      `select id, data from prospecting_candidates where ${ELEGIVEIS} order by created_at limit $3`,
      [org, campaignId, cabem],
    );
    const comTermo = rows
      .map((r) => ({ id: r.id, termo: termoDeBusca(r.data) }))
      .filter((r): r is { id: string; termo: string } => !!r.termo);
    if (!comTermo.length)
      throw new ProspectingError(
        "Nenhuma empresa do Mercado sem site para procurar. Rode antes a análise grátis dos sites.",
        409,
      );
    const provedor = deps.provedor ?? (await provedorDaOrganizacao(db, org));
    if (!provedor.startLookup)
      throw new ProspectingError("O provedor de busca desta organização não faz esta busca.", 422);
    const teto = Math.min(
      restante,
      Math.max(
        MINIMO_PARA_BUSCAR_USD,
        Math.ceil(comTermo.length * CUSTO_ESTIMADO_POR_EMPRESA_USD * 100) / 100,
      ),
    );
    const key = deps.chave ?? (await credential(db, admin, org));
    const termos = [...new Set(comTermo.map((c) => c.termo))];
    const run = await provedor.startLookup(key, termos, teto);
    // A execução já começou (e é paga): daqui em diante, gravar é obrigatório.
    await db.query(
      "update prospecting_campaigns set gasto_maps_usd = gasto_maps_usd + $3::numeric, updated_at = now() where organization_id=$1 and id=$2",
      [org, campaignId, teto],
    );
    for (const c of comTermo) {
      const busca: BuscaNoMaps = {
        status: "buscando",
        run_id: run.id,
        termo: c.termo,
        teto_usd: teto,
        pedida_em: agora.toISOString(),
        concluida_em: null,
        titulo: null,
        observacao: null,
      };
      await db.query(
        `update prospecting_candidates set data = jsonb_set(data, '{maps_busca}', $3::jsonb), updated_at = now()
          where organization_id = $1 and id = $2`,
        [org, c.id, JSON.stringify(buscaNoMapsSchema.parse(busca))],
      );
    }
    return { pedidas: comTermo.length, teto_usd: teto };
  });
}

interface ExecucaoAberta {
  organization_id: string;
  campaign_id: string;
  run_id: string;
  pedida_em: string;
  teto_usd: string;
}

/**
 * A rodada do worker: lê as execuções abertas e grava o que o Maps achou. Uma
 * execução por vez, numa transação: o custo entra no gasto da campanha junto
 * com os candidatos que ela resolveu, e só uma vez.
 */
export async function sincronizarBuscasNoMaps(
  pool: pg.Pool,
  admin: SupabaseClient,
  ate: number,
  agora: () => Date = () => new Date(),
  deps: DependenciasDoMaps = {},
): Promise<number> {
  const { rows: abertas } = await pool.query<ExecucaoAberta>(
    `select organization_id, campaign_id, data->'maps_busca'->>'run_id' as run_id,
            min(data->'maps_busca'->>'pedida_em') as pedida_em,
            max(data->'maps_busca'->>'teto_usd') as teto_usd
       from prospecting_candidates
      where data->'maps_busca'->>'status' = 'buscando'
        and public.fn_org_operante(organization_id)
      group by 1, 2, 3
      limit 5`,
  );
  let resolvidas = 0;
  for (const e of abertas) {
    if (Date.now() + 20_000 > ate) break;
    try {
      const provedor = deps.provedor ?? (await provedorDaOrganizacao(pool, e.organization_id));
      const key = deps.chave ?? (await credential(pool, admin, e.organization_id));
      const run = await provedor.readSearch(key, e.run_id);
      const venceu = Date.now() - new Date(e.pedida_em).getTime() > PRAZO_DA_EXECUCAO_MIN * 60_000;
      if (!TERMINAIS.includes(run.status) && !venceu) continue;
      const itens =
        TERMINAIS.includes(run.status) && run.defaultDatasetId
          ? await provedor.readResults(key, run.defaultDatasetId, MAX_POR_BUSCA * 2)
          : [];
      const falhou = !TERMINAIS.includes(run.status) || (run.status === "FAILED" && !itens.length);
      resolvidas += await gravarExecucao(pool, e, itens, {
        falhou,
        custoUsd: falhou ? null : (run.usageTotalUsd ?? null),
        agora: agora(),
      });
    } catch (error) {
      logger.warn("[prospecting] busca no Maps do Mercado não sincronizou", {
        organization_id: e.organization_id,
        run_id: e.run_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return resolvidas;
}

async function gravarExecucao(
  pool: pg.Pool,
  e: ExecucaoAberta,
  itens: Record<string, unknown>[],
  o: { falhou: boolean; custoUsd: number | null; agora: Date },
): Promise<number> {
  const db = await pool.connect();
  let erro: Error | undefined;
  try {
    await db.query("begin");
    const { rows } = await db.query<{ id: string; data: Prospect & { maps_busca: BuscaNoMaps } }>(
      `select id, data from prospecting_candidates
        where organization_id = $1 and data->'maps_busca'->>'run_id' = $2
          and data->'maps_busca'->>'status' = 'buscando'
        for update`,
      [e.organization_id, e.run_id],
    );
    const porTermo = new Map<string, Record<string, unknown>>();
    const semTermo: Record<string, unknown>[] = [];
    for (const item of itens) {
      const termo = termoDoItem(item);
      if (termo && !porTermo.has(termo)) porTermo.set(termo, item);
      else if (!termo) semTermo.push(item);
    }
    for (const c of rows) {
      const busca = c.data.maps_busca;
      let mudanca: Record<string, unknown>;
      if (o.falhou)
        mudanca = {
          maps_busca: {
            ...busca,
            status: "falhou",
            concluida_em: o.agora.toISOString(),
            observacao: "A busca no Maps não terminou. Pode pedir de novo.",
          },
        };
      else {
        // Sem o termo no item (formato antigo da Apify), vale o primeiro lugar que confere.
        const item =
          porTermo.get(busca.termo) ??
          semTermo.find((i) => {
            const l = normalizeProspect(i);
            return !!l && confereComAEmpresa(c.data, l);
          }) ??
          null;
        mudanca = mudancaDoLugar(c.data, busca, item, o.agora);
      }
      await db.query(
        `update prospecting_candidates set data = data || $3::jsonb, updated_at = now()
          where organization_id = $1 and id = $2`,
        [e.organization_id, c.id, JSON.stringify(mudanca)],
      );
    }
    // A reserva vira o custo informado; sem custo informado (falha), a reserva fica.
    if (rows.length && o.custoUsd !== null)
      await db.query(
        `update prospecting_campaigns
            set gasto_maps_usd = greatest(0, gasto_maps_usd - $3::numeric + $4::numeric), updated_at = now()
          where organization_id = $1 and id = $2`,
        [e.organization_id, e.campaign_id, Number(e.teto_usd), o.custoUsd],
      );
    await db.query("commit");
    return rows.length;
  } catch (error) {
    erro = error instanceof Error ? error : new Error(String(error));
    await db.query("rollback").catch(() => undefined);
    throw erro;
  } finally {
    db.release(erro);
  }
}
