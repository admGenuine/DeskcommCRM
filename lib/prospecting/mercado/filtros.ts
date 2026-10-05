/**
 * Os filtros da aba Mercado e a consulta que eles viram.
 *
 * Fonte: `prospecting_market_companies` (migration 9002), a base pública da
 * Receita já no recorte do dono (estados, CNAE da divisão 10, sem MEI). Os
 * filtros daqui estreitam esse recorte; não alargam.
 *
 * A consulta é montada aqui, num lugar só, com parâmetros posicionais: a tela de
 * prévia e a criação da campanha leem exatamente o mesmo conjunto.
 */
import { z } from "zod";

import { PORTES_DO_MERCADO } from "./porte";

/** Os grupos da divisão 10 do CNAE 2.0: o "tipo de alimento" da tela. */
export const GRUPOS_DE_ALIMENTO = [
  { id: "101", rotulo: "Carnes e derivados" },
  { id: "102", rotulo: "Pescados" },
  { id: "103", rotulo: "Conservas de frutas, legumes e vegetais" },
  { id: "104", rotulo: "Óleos e gorduras" },
  { id: "105", rotulo: "Laticínios" },
  { id: "106", rotulo: "Moagem, amiláceos e rações" },
  { id: "107", rotulo: "Açúcar" },
  { id: "108", rotulo: "Café" },
  {
    id: "109",
    rotulo: "Outros alimentos (massas, doces, panificação industrial, temperos, prontos)",
  },
] as const;

const IDS_DE_GRUPO = GRUPOS_DE_ALIMENTO.map((g) => g.id) as [string, ...string[]];

export const filtrosDoMercadoSchema = z
  .object({
    uf: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullish(),
    municipio: z.string().trim().min(1).max(80).nullish(),
    grupo: z.enum(IDS_DE_GRUPO).nullish(),
    portes: z
      .array(z.enum(PORTES_DO_MERCADO))
      .min(1)
      .max(4)
      .default([...PORTES_DO_MERCADO]),
    idade_minima_anos: z.number().int().min(0).max(100).default(0),
    com_telefone: z.boolean().default(true),
    so_principal: z.boolean().default(true),
    so_matriz: z.boolean().default(false),
  })
  .strict();
export type FiltrosDoMercado = z.infer<typeof filtrosDoMercadoSchema>;

/**
 * O WHERE da consulta, sobre o alias `m`. Os parâmetros começam em `$2` por
 * padrão: o `$1` é a organização, porque a pergunta "já está numa campanha
 * desta organização?" faz parte da maioria das consultas do mercado. Consulta
 * que não pergunta isso passa `inicio = 1` (o Postgres recusa parâmetro que
 * a consulta não usa).
 */
export function ondeDoMercado(
  f: FiltrosDoMercado,
  inicio = 2,
): { onde: string; params: unknown[] } {
  const partes: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length + inicio - 1}`;
  };
  if (f.uf) partes.push(`m.uf = ${p(f.uf)}`);
  if (f.municipio) partes.push(`upper(m.municipio) = upper(${p(f.municipio)})`);
  if (f.grupo) {
    const prefixo = p(`${f.grupo}%`);
    partes.push(
      f.so_principal
        ? `m.cnae_principal like ${prefixo}`
        : `(m.cnae_principal like ${prefixo} or exists (select 1 from unnest(m.cnaes_secundarios) s where s like ${prefixo}))`,
    );
  } else if (f.so_principal) {
    partes.push("m.recorte_pela_principal");
  }
  partes.push(`m.porte = any(${p(f.portes)}::text[])`);
  if (f.idade_minima_anos > 0)
    partes.push(
      `m.data_inicio <= current_date - make_interval(years => ${p(f.idade_minima_anos)}::int)`,
    );
  if (f.com_telefone) partes.push("(m.telefone1 is not null or m.telefone2 is not null)");
  if (f.so_matriz) partes.push("m.matriz");
  return { onde: partes.join(" and "), params };
}

/**
 * A empresa do mercado já entrou numa campanha desta organização (`$1`)? Pelo
 * CNPJ, ou pelo telefone: o banco não aceita o mesmo telefone duas vezes na
 * organização, então uma filial com o telefone da matriz (ou uma empresa cujo
 * telefone já veio do Maps) não entraria, e contá-la como "nova" faria a
 * prévia prometer o que a campanha não entrega. O telefone da Receita vem só
 * com dígitos (DDD + número), e o do candidato em E.164.
 */
export const JA_EM_CAMPANHA = `exists (
  select 1 from prospecting_candidates c
   where c.organization_id = $1
     and (c.place_id = 'cnpj:' || m.cnpj
          or c.phone = '+55' || m.telefone1
          or c.phone = '+55' || m.telefone2))`;

/**
 * A ordem em que as empresas são levadas para a campanha: maiores primeiro,
 * pelos sinais que a Receita dá (matriz, porte declarado, capital, idade). O
 * score de verdade é a Fase 4; esta ordem só evita levar as menores antes.
 */
export const ORDEM_DO_MERCADO = `
  m.matriz desc,
  case m.porte when 'DEMAIS' then 0 when 'EPP' then 1 when 'ME' then 2 else 3 end,
  m.capital_social_centavos desc nulls last,
  m.data_inicio asc nulls last,
  m.cnpj`;
