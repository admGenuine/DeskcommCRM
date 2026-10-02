/**
 * O gosto do dono, aprendido pelo que ele avalia.
 *
 * Duas fontes de sinal:
 *   - a AVALIAÇÃO de uma empresa ("gostei" / "não gostei", com motivo), gravada
 *     em `prospecting_candidates.data.avaliacao`;
 *   - a CAMPANHA DE REFERÊNCIA (`prospecting_campaigns.referencia_em`): as
 *     empresas dela que passaram pela régua de perfil contam como "gostei".
 *
 * Por que a avaliação mora no `data` do candidato, e não numa tabela: é ali
 * que a casa já guarda o que se sabe da empresa (o veredito `aceite` inclusive),
 * e a anonimização da LGPD reescreve o `data` inteiro. Uma tabela à parte
 * guardaria um motivo escrito à mão fora do alcance da anonimização.
 *
 * O que o sistema faz com o gosto, hoje (o score da Fase 4 vai usar mais):
 *   - categoria com {@link LIMIAR_DE_RECUSA} ou mais "não gostei" e nenhum
 *     "gostei" passa a ser recusada NA ENTRADA das buscas seguintes, com o
 *     motivo dizendo de onde veio;
 *   - o "gostei" desfaz recusa de PERFIL (segmento, região, a aprendida e o
 *     próprio "não gostei"), nunca recusa de FATO (telefone, país, CRM, WhatsApp).
 *
 * Puro de propósito: a tela e o servidor usam as mesmas regras.
 */
import { normalizarTexto } from "./aceite/segmento";

export const NOTAS = ["gostei", "nao_gostei"] as const;
export type Nota = (typeof NOTAS)[number];

export interface Avaliacao {
  nota: Nota;
  motivo: string | null;
  /** ISO-8601 UTC. */
  em: string;
  /** Quem avaliou (`auth.users.id`). */
  por: string | null;
}

export interface SinalDeGosto {
  categoria: string | null;
  nota: Nota;
  origem: "avaliacao" | "referencia";
}

/** Quantos "não gostei" numa categoria, sem nenhum "gostei", recusam as próximas. */
export const LIMIAR_DE_RECUSA = 2;

export interface CategoriaAprendida {
  categoria: string;
  gostei: number;
  nao_gostei: number;
  /** As próximas empresas desta categoria ficam de fora na entrada. */
  recusa: boolean;
}

export interface PerfilAprendido {
  categorias: CategoriaAprendida[];
  /** Empresas avaliadas pelo dono. */
  avaliadas: number;
  /** Empresas que vieram de campanhas de referência. */
  de_referencia: number;
}

export const PERFIL_VAZIO: PerfilAprendido = { categorias: [], avaliadas: 0, de_referencia: 0 };

export function perfilAprendido(sinais: readonly SinalDeGosto[]): PerfilAprendido {
  const porChave = new Map<string, CategoriaAprendida>();
  let avaliadas = 0;
  let deReferencia = 0;
  for (const s of sinais) {
    if (s.origem === "avaliacao") avaliadas += 1;
    else deReferencia += 1;
    const nome = s.categoria?.trim();
    if (!nome) continue;
    const chave = normalizarTexto(nome);
    const atual = porChave.get(chave) ?? {
      categoria: nome,
      gostei: 0,
      nao_gostei: 0,
      recusa: false,
    };
    if (s.nota === "gostei") atual.gostei += 1;
    else atual.nao_gostei += 1;
    porChave.set(chave, atual);
  }
  const categorias = [...porChave.values()]
    .map((c) => ({ ...c, recusa: c.nao_gostei >= LIMIAR_DE_RECUSA && c.gostei === 0 }))
    .sort(
      (a, b) =>
        b.gostei + b.nao_gostei - (a.gostei + a.nao_gostei) ||
        a.categoria.localeCompare(b.categoria),
    );
  return { categorias, avaliadas, de_referencia: deReferencia };
}

/** Por que o perfil aprendido recusa esta categoria, ou `null`. */
export function recusaAprendida(
  perfil: PerfilAprendido,
  categoria: string | null | undefined,
): string | null {
  if (!categoria?.trim()) return null;
  const chave = normalizarTexto(categoria);
  const achada = perfil.categorias.find((c) => c.recusa && normalizarTexto(c.categoria) === chave);
  return achada
    ? `Categoria que você marcou como não gostei ${achada.nao_gostei} vezes: ${achada.categoria}.`
    : null;
}

const NAO_GOSTEI = "Você marcou como não gostei";

export function motivoDoNaoGostei(motivo: string | null): string {
  return motivo ? `${NAO_GOSTEI}: ${motivo}` : `${NAO_GOSTEI}.`;
}

/**
 * Começos dos motivos de recusa de PERFIL. Cada um sai de um lugar
 * (`aceite/segmento.ts`, `aceite/index.ts`, este arquivo); o teste
 * `aprendizado.test.ts` gera os motivos pelas funções reais, para esta lista
 * não envelhecer quando um texto mudar.
 */
const RECUSAS_DE_PERFIL = [
  "Categoria fora do perfil:",
  "Nome indica varejo ou alimentação ao público:",
  "Fora do estado pedido",
  "Categoria que você marcou como não gostei",
  NAO_GOSTEI,
];

/** A recusa é de perfil (o dono pode desfazer com "gostei")? */
export function recusaDePerfil(motivo: string | null | undefined): boolean {
  return !!motivo && RECUSAS_DE_PERFIL.some((inicio) => motivo.startsWith(inicio));
}

/**
 * O que a avaliação muda na fila. O "não gostei" tira da fila quem ainda não
 * foi abordado; o "gostei" devolve à fila quem saiu por perfil, enquanto a
 * campanha é rascunho (depois de iniciada, a fila já foi montada).
 */
export function efeitoDaAvaliacao(r: {
  nota: Nota;
  motivo: string | null;
  status: string;
  error: string | null;
  phone: string | null;
  campanhaEmRascunho: boolean;
}): { status: string; error: string | null } {
  if (r.nota === "nao_gostei") {
    if (r.status === "new" || r.status === "queued")
      return { status: "skipped", error: motivoDoNaoGostei(r.motivo) };
    if (r.status === "skipped" && r.error?.startsWith(NAO_GOSTEI))
      return { status: "skipped", error: motivoDoNaoGostei(r.motivo) };
    return { status: r.status, error: r.error };
  }
  if (r.status === "skipped" && r.campanhaEmRascunho && r.phone && recusaDePerfil(r.error))
    return { status: "new", error: null };
  return { status: r.status, error: r.error };
}

/**
 * Uma linha do banco vira sinal: a avaliação explícita vence; sem ela, empresa
 * de campanha de referência que não saiu por perfil conta como "gostei".
 */
export function sinalDaLinha(linha: {
  categoria: string | null;
  nota: string | null;
  referencia: boolean;
  error: string | null;
}): SinalDeGosto | null {
  if (linha.nota === "gostei" || linha.nota === "nao_gostei")
    return { categoria: linha.categoria, nota: linha.nota, origem: "avaliacao" };
  if (linha.referencia && !recusaDePerfil(linha.error))
    return { categoria: linha.categoria, nota: "gostei", origem: "referencia" };
  return null;
}
