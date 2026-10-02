/**
 * Categoria do Google Maps que nunca é o público desta prospecção.
 *
 * A prospecção da Genuine procura INDÚSTRIA (e distribuidora) de alimentos. Uma
 * busca por "indústria de alimentos" no Maps traz junto padaria, restaurante e
 * mercado, porque o Maps casa o TEXTO e não o tipo de negócio. Antes, nada
 * conferia a categoria, e esses lugares entravam na fila de abordagem.
 *
 * A regra é deliberadamente estreita:
 *   - recusa só categorias que são varejo ou serviço de alimentação ao público;
 *   - se QUALQUER categoria do lugar indica produção ("fábrica", "indústria"…),
 *     ele fica, porque padaria que também é fábrica de pães é público;
 *   - categoria desconhecida PASSA. Quem resolve o resto é o CNAE (Fase 2).
 *
 * Distribuidora e atacadista ficam: decisão do dono em 01/10/2026.
 */

/** Minúsculas, sem acento, espaços simples. */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Começos de categoria (já normalizados) que recusam. Casa a categoria inteira
 * ou o começo seguido de espaço: "bar" recusa "Bar" e "Bar e restaurante", mas
 * não "Barbearia".
 */
const FORA_DO_PERFIL = [
  "padaria",
  "confeitaria",
  "doceria",
  "restaurante",
  "lanchonete",
  "lancheria",
  "pizzaria",
  "hamburgueria",
  "churrascaria",
  "pastelaria",
  "sorveteria",
  "cafeteria",
  "cafe",
  "bar",
  "boteco",
  "pub",
  "choperia",
  "self-service",
  "buffet",
  "food truck",
  "delivery",
  "supermercado",
  "hipermercado",
  "mercado",
  "minimercado",
  "mercearia",
  "acougue",
  "hortifruti",
  "hortifrutigranjeiro",
  "sacolao",
  "quitanda",
  "emporio",
  "loja de conveniencia",
  "loja de produtos naturais",
];

/** Trechos que, em qualquer categoria do lugar, indicam produção. */
const INDICA_PRODUCAO = ["fabrica", "fabricante", "industria", "industrial", "produtor", "frigorifico", "laticinio", "torrefacao", "beneficiamento"];

function recusa(categoria: string): boolean {
  const c = normalizarTexto(categoria);
  return FORA_DO_PERFIL.some((t) => c === t || c.startsWith(`${t} `));
}

/**
 * Devolve a categoria que tira o lugar do perfil, ou `null` quando ele fica.
 * A categoria principal decide; as demais só servem para salvar (produção).
 */
export function categoriaForaDoPerfil(
  principal: string | null | undefined,
  outras: readonly string[] = [],
): string | null {
  const todas = [principal, ...outras].filter((c): c is string => !!c && !!c.trim());
  if (!todas.length) return null;
  if (todas.some((c) => INDICA_PRODUCAO.some((t) => normalizarTexto(c).includes(t)))) return null;
  const decisiva = principal?.trim() ? principal : todas[0]!;
  return recusa(decisiva) ? decisiva.trim() : null;
}
