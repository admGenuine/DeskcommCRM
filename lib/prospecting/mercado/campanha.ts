/**
 * A aba Mercado: a prévia do filtro e a campanha criada a partir dele.
 *
 * A campanha do mercado é uma campanha comum de prospecção, com uma diferença:
 * as empresas não vêm de uma busca paga no Maps, e sim de
 * `prospecting_market_companies`. Ela nasce com a busca já concluída, e daí em
 * diante tudo é igual: avaliar, marcar referência, preparar a abordagem,
 * iniciar. Por isso os candidatos passam pela MESMA régua de entrada
 * (`../entrada.ts`): telefone, contato que já está no CRM, gosto aprendido.
 */
import type pg from "pg";

import { inserirCandidato, reguaDaEntrada } from "../entrada";
import { ProspectingError } from "../provider";
import { withProspectingLock, type BuscaGravada, type Campaign } from "../store";
import {
  GRUPOS_DE_ALIMENTO,
  JA_EM_CAMPANHA,
  ORDEM_DO_MERCADO,
  ondeDoMercado,
  type FiltrosDoMercado,
} from "./filtros";
import { prospectDoMercado, vereditoDoMercado, type LinhaDoMercado } from "./prospect";

export const LIMITE_DA_CAMPANHA_DO_MERCADO = 200;

export interface PreviaDoMercado {
  /** Mês da base importada; null = a base ainda não foi importada. */
  referencia: string | null;
  total: number;
  novas: number;
  municipios: { municipio: string; uf: string; empresas: number }[];
  amostra: {
    cnpj: string;
    nome: string;
    municipio: string | null;
    uf: string;
    porte: string;
    atividade: string | null;
  }[];
}

export async function previaDoMercado(
  db: pg.Pool | pg.PoolClient,
  org: string,
  filtros: FiltrosDoMercado,
): Promise<PreviaDoMercado> {
  const base = (
    await db.query<{ referencia: string | null }>(
      "select max(referencia) as referencia from prospecting_market_companies",
    )
  ).rows[0];
  if (!base?.referencia)
    return { referencia: null, total: 0, novas: 0, municipios: [], amostra: [] };

  const { onde, params } = ondeDoMercado(filtros);
  // A lista de cidades ignora o filtro de cidade: ela é o que se pode escolher.
  const semCidade = ondeDoMercado({ ...filtros, municipio: null }, 1);
  const [contagem, municipios, amostra] = await Promise.all([
    db.query<{ total: string; novas: string }>(
      `select count(*) as total, count(*) filter (where not ${JA_EM_CAMPANHA}) as novas
         from prospecting_market_companies m where ${onde}`,
      [org, ...params],
    ),
    db.query<{ municipio: string; uf: string; empresas: string }>(
      `select m.municipio, m.uf, count(*) as empresas
         from prospecting_market_companies m
        where ${semCidade.onde} and m.municipio is not null
        group by m.municipio, m.uf order by count(*) desc, m.municipio limit 60`,
      semCidade.params,
    ),
    db.query<PreviaDoMercado["amostra"][number]>(
      `select m.cnpj, coalesce(m.nome_fantasia, m.razao_social) as nome, m.municipio, m.uf, m.porte,
              m.cnae_principal_descricao as atividade
         from prospecting_market_companies m
        where ${onde} and not ${JA_EM_CAMPANHA}
        order by ${ORDEM_DO_MERCADO} limit 8`,
      [org, ...params],
    ),
  ]);
  return {
    referencia: base.referencia,
    total: Number(contagem.rows[0]?.total ?? 0),
    novas: Number(contagem.rows[0]?.novas ?? 0),
    municipios: municipios.rows.map((r) => ({ ...r, empresas: Number(r.empresas) })),
    amostra: amostra.rows,
  };
}

/** "Laticínios · Londrina, PR": o nome e o resumo do filtro, para a lista de campanhas. */
export function descreverFiltros(f: FiltrosDoMercado): { segmento: string; local: string } {
  const grupo = GRUPOS_DE_ALIMENTO.find((g) => g.id === f.grupo);
  return {
    segmento: grupo ? grupo.rotulo : "Indústrias de alimentos",
    local: f.municipio ? `${f.municipio}${f.uf ? `, ${f.uf}` : ""}` : (f.uf ?? "PR e SC"),
  };
}

export async function criarCampanhaDoMercado(
  pool: pg.Pool,
  org: string,
  requestId: string,
  input: { filtros: FiltrosDoMercado; limite: number },
) {
  return withProspectingLock(pool, org, async (db) => {
    const anterior = (
      await db.query<Campaign>(
        "select * from prospecting_campaigns where organization_id=$1 and request_id=$2",
        [org, requestId],
      )
    ).rows[0];
    if (anterior) return anterior;

    const { onde, params } = ondeDoMercado(input.filtros);
    const linhas = (
      await db.query<LinhaDoMercado>(
        `select m.* from prospecting_market_companies m
          where ${onde} and not ${JA_EM_CAMPANHA}
          order by ${ORDEM_DO_MERCADO} limit $${params.length + 2}`,
        [org, ...params, input.limite],
      )
    ).rows;
    if (!linhas.length)
      throw new ProspectingError(
        "Nenhuma empresa nova neste filtro: ou ele está vazio, ou todas já estão em campanhas.",
      );

    const prospects = linhas.map(prospectDoMercado);
    const { segmento, local } = descreverFiltros(input.filtros);
    const nome = `Mercado: ${segmento} · ${local}`.slice(0, 120);
    const search: BuscaGravada = {
      name: nome,
      niche: segmento,
      location: local,
      limit: input.limite,
      budget_usd: 0,
      enrich: false,
      fonte: "mercado",
      filtros: input.filtros,
    };
    const motivoDaEntrada = await reguaDaEntrada(db, org, prospects);
    await db.query("begin");
    try {
      const campanha = (
        await db.query<Campaign>(
          "insert into prospecting_campaigns(organization_id,request_id,name,search,search_status,cost_usd) values($1,$2,$3,$4,'succeeded',0) returning *",
          [org, requestId, nome, search],
        )
      ).rows[0]!;
      let inseridas = 0;
      for (const p of prospects)
        inseridas += await inserirCandidato(
          db,
          org,
          campanha.id,
          p,
          motivoDaEntrada(p, vereditoDoMercado(p)),
        );
      // O banco recusa o mesmo telefone duas vezes na organização: filial com o
      // telefone da matriz, ou empresa cujo telefone já está noutra campanha.
      const repetidas = prospects.length - inseridas;
      if (!inseridas)
        throw new ProspectingError(
          "Nenhuma empresa nova neste filtro: os telefones delas já estão noutras campanhas.",
        );
      const final = (
        await db.query<Campaign>(
          "update prospecting_campaigns set result_count=$3,skipped_count=$4,error=$5,updated_at=now() where organization_id=$1 and id=$2 returning *",
          [
            org,
            campanha.id,
            inseridas,
            repetidas,
            repetidas
              ? `${repetidas} ${repetidas === 1 ? "empresa ficou de fora porque o telefone dela já está" : "empresas ficaram de fora porque o telefone delas já está"} noutra empresa ou campanha.`
              : null,
          ],
        )
      ).rows[0]!;
      await db.query("commit");
      return final;
    } catch (error) {
      await db.query("rollback");
      throw error;
    }
  });
}
