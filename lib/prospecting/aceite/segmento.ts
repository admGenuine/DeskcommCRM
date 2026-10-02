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

/**
 * No NOME, além dos trechos acima: abreviações de razão social ("Fabr de Prod
 * Alimentícios", "Ind. e Com.") e a palavra "alimentos", que em nome de empresa
 * indica quem produz ou distribui, não quem serve ao público.
 */
const NOME_INDICA_PRODUCAO = /(^|[^a-z])(fabr|ind|alimentos|alimenticios|alimenticia)([^a-z]|$)/;

/**
 * Começos de NOME que indicam varejo ou serviço de alimentação. Medido no teste
 * da Genuine em 01/10/2026: "Mercado Paineiras" e "Frutaria Silvana" vinham do
 * Maps com a categoria "Fornecedor de produtos alimentícios" e passavam.
 */
const NOME_DE_VAREJO = [
  "padaria",
  "panificadora",
  "confeitaria",
  "doceria",
  "restaurante",
  "lanchonete",
  "pizzaria",
  "hamburgueria",
  "churrascaria",
  "pastelaria",
  "sorveteria",
  "cafeteria",
  "bar",
  "boteco",
  "supermercado",
  "hipermercado",
  "mercado",
  "minimercado",
  "mercearia",
  "acougue",
  "casa de carnes",
  "hortifruti",
  "sacolao",
  "quitanda",
  "frutaria",
  "emporio",
];

const comecaCom = (texto: string, termos: readonly string[]) => {
  const t = normalizarTexto(texto);
  return termos.some((termo) => t === termo || t.startsWith(`${termo} `));
};

const indicaProducao = (texto: string) =>
  INDICA_PRODUCAO.some((t) => normalizarTexto(texto).includes(t));

/**
 * Por que o lugar está fora do perfil, ou `null` quando ele fica.
 *
 * Ordem, e por que nesta ordem:
 *   1. produção no nome OU em qualquer categoria SALVA ("Essenza Comércio e
 *      Indústria", que o Maps chama de "Loja de produtos naturais");
 *   2. a categoria principal de varejo/serviço recusa;
 *   3. o começo do nome de varejo recusa ("Mercado Paineiras", que o Maps chama
 *      de "Fornecedor de produtos alimentícios").
 */
export function segmentoForaDoPerfil(lugar: {
  nome: string;
  principal?: string | null;
  outras?: readonly string[];
}): string | null {
  const categorias = [lugar.principal, ...(lugar.outras ?? [])].filter(
    (c): c is string => !!c && !!c.trim(),
  );
  if (NOME_INDICA_PRODUCAO.test(normalizarTexto(lugar.nome)) || indicaProducao(lugar.nome)) return null;
  if (categorias.some(indicaProducao)) return null;
  const decisiva = lugar.principal?.trim() ? lugar.principal : categorias[0];
  if (decisiva && comecaCom(decisiva, FORA_DO_PERFIL))
    return `Categoria fora do perfil: ${decisiva.trim()}.`;
  if (comecaCom(lugar.nome, NOME_DE_VAREJO))
    return `Nome indica varejo ou alimentação ao público: ${lugar.nome.trim()}.`;
  return null;
}
