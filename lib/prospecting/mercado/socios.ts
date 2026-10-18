/**
 * O decisor de cada empresa pelo quadro de sócios da Receita (Fase 5 do fork
 * da Genuine; decisão do dono em 18/10/2026).
 *
 * ═══ SÓ COM A CHAVE LIGADA ═══
 *
 * Nome de sócio é dado de pessoa. A organização só vê sócios depois de LIGAR o
 * uso e registrar a referência da avaliação de legítimo interesse B2B que o
 * fundamenta (`organizations.settings.prospecting.socios`). Quem liga, quando e
 * com qual referência fica gravado ali e no histórico de auditoria. Desligada,
 * nenhum sócio é lido.
 *
 * ═══ CALCULADO NA HORA, NUNCA COPIADO ═══
 *
 * O decisor não é gravado no candidato: a tela pede, o servidor lê
 * `prospecting_market_socios` (migration 9005) pela raiz do CNPJ e devolve.
 * Desligar a chave apaga tudo da tela no mesmo instante, a rotina mensal que
 * troca a tabela tira quem saiu do quadro, e a anonimização da LGPD do
 * candidato (que reescreve o `data`, com o CNPJ junto) corta o vínculo.
 *
 * O CNPJ vem do candidato do Mercado (`data.cnpj`) ou do achado na Receita
 * para a empresa do Maps (`data.analise.receita.cnpj`, Fase 3b).
 */
import type pg from "pg";
import { z } from "zod";

import type { Prospect } from "../schema";

export const usoDeSociosSchema = z.object({
  ativo: z.boolean(),
  /** A referência da avaliação de legítimo interesse (onde ela está registrada). */
  base_legal_ref: z.string().max(500).nullable(),
  alterado_em: z.string().nullable(),
  alterado_por: z.string().nullable(),
});
export type UsoDeSocios = z.infer<typeof usoDeSociosSchema>;

export const USO_DESLIGADO: UsoDeSocios = {
  ativo: false,
  base_legal_ref: null,
  alterado_em: null,
  alterado_por: null,
};

type Banco = Pick<pg.PoolClient, "query">;

/** Leitura defensiva: `settings` é jsonb livre; forma errada é desligado. */
export async function lerUsoDeSocios(db: Banco, org: string): Promise<UsoDeSocios> {
  const { rows } = await db.query<{ socios: unknown }>(
    "select settings->'prospecting'->'socios' as socios from organizations where id=$1",
    [org],
  );
  const lido = usoDeSociosSchema.safeParse(rows[0]?.socios);
  if (!lido.success) return USO_DESLIGADO;
  // Ligado sem referência não vale: é a referência que fundamenta o uso.
  return lido.data.ativo && !lido.data.base_legal_ref?.trim() ? USO_DESLIGADO : lido.data;
}

export async function gravarUsoDeSocios(
  db: Banco,
  org: string,
  ator: string,
  pedido: { ativo: boolean; base_legal_ref?: string | null },
  agora = new Date(),
): Promise<UsoDeSocios> {
  const atual = await lerUsoDeSocios(db, org);
  const uso: UsoDeSocios = {
    ativo: pedido.ativo,
    // Desligar guarda a referência que valia, para o histórico.
    base_legal_ref: pedido.base_legal_ref?.trim() || atual.base_legal_ref,
    alterado_em: agora.toISOString(),
    alterado_por: ator,
  };
  if (uso.ativo && !uso.base_legal_ref)
    throw new Error("Informe a referência da avaliação de legítimo interesse para ligar.");
  await db.query(
    `update organizations
        set settings = coalesce(settings, '{}'::jsonb)
          || jsonb_build_object('prospecting',
               coalesce(settings->'prospecting', '{}'::jsonb) || jsonb_build_object('socios', $2::jsonb))
      where id = $1`,
    [org, JSON.stringify(uso)],
  );
  return uso;
}

export interface Decisor {
  /** Nome legível ("Joao da Silva"); a Receita publica em maiúsculas, sem acento. */
  nome: string;
  cargo: string;
  /** Ano de entrada no quadro, quando a Receita informa. */
  desde: number | null;
}

/**
 * Ordem de quem decide, pelo código de qualificação da Receita. Fora da lista
 * vem depois, na ordem de entrada.
 */
export const ORDEM_DE_DECISOR = [
  "49", // Sócio-Administrador
  "05", // Administrador
  "65", // Titular pessoa física residente no Brasil
  "50", // Empresário
  "16", // Presidente
  "10", // Diretor
  "54", // Fundador
  "22", // Sócio
  "66", // Titular pessoa física residente no exterior
  "38", // Sócio pessoa física residente no exterior
];

/** Quantos sócios aparecem por empresa (o decisor e até dois a mais). */
export const DECISORES_POR_EMPRESA = 3;

const PARTICULAS = new Set(["da", "de", "do", "das", "dos", "e"]);

export function nomeLegivel(nome: string): string {
  return nome
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((p, i) => (i > 0 && PARTICULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(" ");
}

export interface LinhaDeSocio {
  cnpj_basico: string;
  nome: string;
  qualificacao_codigo: string;
  qualificacao: string | null;
  data_entrada: string | Date | null;
}

function ano(data: string | Date | null): number | null {
  if (!data) return null;
  const a = new Date(data).getUTCFullYear();
  return Number.isFinite(a) ? a : null;
}

/** Os sócios de UMA empresa, na ordem de quem decide, sem repetir a pessoa. */
export function escolherDecisores(linhas: readonly LinhaDeSocio[]): Decisor[] {
  const posicao = (c: string) => {
    const i = ORDEM_DE_DECISOR.indexOf(c.padStart(2, "0"));
    return i === -1 ? ORDEM_DE_DECISOR.length : i;
  };
  const ordenadas = [...linhas].sort(
    (a, b) =>
      posicao(a.qualificacao_codigo) - posicao(b.qualificacao_codigo) ||
      (ano(a.data_entrada) ?? 9999) - (ano(b.data_entrada) ?? 9999),
  );
  const vistos = new Set<string>();
  const saida: Decisor[] = [];
  for (const l of ordenadas) {
    if (vistos.has(l.nome)) continue;
    vistos.add(l.nome);
    saida.push({
      nome: nomeLegivel(l.nome),
      cargo: l.qualificacao || `Qualificação ${l.qualificacao_codigo}`,
      desde: ano(l.data_entrada),
    });
    if (saida.length === DECISORES_POR_EMPRESA) break;
  }
  return saida;
}

/** A raiz do CNPJ da empresa: do Mercado, ou achada na Receita pela análise. */
export function raizDoCnpj(p: Pick<Prospect, "cnpj" | "analise">): string | null {
  const cnpj = p.cnpj ?? p.analise?.receita?.cnpj ?? null;
  return cnpj && /^\d{14}$/.test(cnpj) ? cnpj.slice(0, 8) : null;
}

/** Os decisores de várias empresas de uma vez, pela raiz do CNPJ. */
export async function decisoresPorRaiz(
  db: Banco,
  raizes: readonly string[],
): Promise<Map<string, Decisor[]>> {
  const unicas = [...new Set(raizes)].filter((r) => /^\d{8}$/.test(r));
  const porRaiz = new Map<string, Decisor[]>();
  if (!unicas.length) return porRaiz;
  const { rows } = await db.query<LinhaDeSocio>(
    `select cnpj_basico, nome, qualificacao_codigo, qualificacao, data_entrada
       from public.prospecting_market_socios
      where cnpj_basico = any($1::text[])`,
    [unicas],
  );
  const agrupadas = new Map<string, LinhaDeSocio[]>();
  for (const r of rows) agrupadas.set(r.cnpj_basico, [...(agrupadas.get(r.cnpj_basico) ?? []), r]);
  for (const [raiz, linhas] of agrupadas) porRaiz.set(raiz, escolherDecisores(linhas));
  return porRaiz;
}
