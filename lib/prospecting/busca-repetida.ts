/**
 * Busca repetida traz empresas NOVAS.
 *
 * O provedor de busca não aceita uma lista de lugares a excluir: ele devolve o
 * Maps na ordem do Maps, e a mesma busca devolve as mesmas empresas do topo.
 * Antes, refazer "fábrica de alimentos · Londrina" com limite 10 pedia os mesmos
 * 10 lugares, todos já em outra campanha, e a campanha nova nascia com zero.
 *
 * A saída é pedir MAIS FUNDO: se a organização já tem N empresas de buscas com
 * o mesmo termo e o mesmo local, a busca nova pede até `limite + N` lugares, e
 * a entrada (`store.ts`) descarta quem já está em outra campanha e fica com as
 * primeiras `limite` novas. O teto de gasto da busca continua valendo: é ele, e
 * não esta conta, que limita o custo.
 *
 * Puro de propósito: a tela usa a mesma conta para avisar antes de buscar.
 */
import { normalizarTexto } from "./aceite/segmento";

/** O máximo de lugares que uma busca pede, por mais repetida que seja. */
export const ALCANCE_MAXIMO = 300;

/** Fração do teto de gasto a partir da qual a busca é dada como parada pelo teto. */
export const TETO_ATINGIDO = 0.9;

/** Termo e local normalizados: "Fábrica de Alimentos" e "fabrica de alimentos" são a mesma busca. */
export function chaveDaBusca(busca: { niche?: unknown; location?: unknown }): string | null {
  if (typeof busca.niche !== "string" || typeof busca.location !== "string") return null;
  return `${normalizarTexto(busca.niche)}|${normalizarTexto(busca.location)}`;
}

export function mesmaBusca(
  a: { niche?: unknown; location?: unknown },
  b: { niche?: unknown; location?: unknown },
): boolean {
  const ka = chaveDaBusca(a);
  return ka !== null && ka === chaveDaBusca(b);
}

/** Quantos lugares pedir ao provedor: o limite pedido mais os que já são conhecidos. */
export function alcanceDaBusca(limite: number, conhecidos: number): number {
  return Math.min(limite + Math.max(0, conhecidos), Math.max(limite, ALCANCE_MAXIMO));
}

/**
 * Por que vieram menos empresas novas do que o limite, quando dá para dizer.
 * `null` quando vieram todas, ou quando a busca foi interrompida (esse aviso já
 * existe e diz mais).
 */
export function motivoDeFaltarem(r: {
  limite: number;
  novos: number;
  pedidos: number;
  devolvidos: number;
  custoUsd: number | null;
  tetoUsd: number;
  interrompida: boolean;
}): string | null {
  if (r.interrompida || r.novos >= r.limite) return null;
  if (r.custoUsd !== null && r.custoUsd >= r.tetoUsd * TETO_ATINGIDO)
    return `O teto de gasto (US$ ${r.tetoUsd.toFixed(2)}) acabou antes de a busca achar ${r.limite} empresas novas. Aumente o teto para ir mais fundo.`;
  if (r.devolvidos < r.pedidos)
    return "O Maps não mostrou mais empresas para este termo e local. Para achar outras, mude o termo ou a cidade.";
  return null;
}
