/**
 * O BAIRRO DE CADA EMPRESA, LIDO DO ENDEREÇO (fork, 2026-11-03).
 *
 * A prospecção guarda endereço, cidade e UF de cada empresa, mas não
 * coordenadas. O mapa por bairro da campanha aberta (`_empresas-da-campanha.tsx`)
 * precisa, então, de duas coisas que este arquivo dá:
 *
 *   1. `bairroDoEndereco`: o bairro escrito no endereço, nos dois formatos que
 *      entram no sistema. O do Maps ("R. Exemplo, 100 - Centro, Curitiba - PR,
 *      80000-000, Brasil") traz o bairro depois do " - " do primeiro trecho; o do
 *      Mercado ("RUA DAS FLORES 100, CENTRO, PALHOCA - SC, 88130000") traz o
 *      bairro como o trecho anterior ao da cidade. Nos dois, a cidade é a âncora.
 *
 *   2. `mapaDaCidade`: o desenho dos bairros, quando existe. Hoje só Curitiba
 *      (`curitiba.ts`, o traçado do Radar). Outra cidade mostra só o ranking.
 *
 * Nada aqui lança: endereço que não se entende devolve `null`, e a empresa
 * entra no grupo "Sem bairro".
 */
import { CURITIBA } from "./curitiba";
import type { MapaDeBairros } from "./tipos";

export const SEM_BAIRRO = "Sem bairro";

/** Nomes que o Maps usa e que não são bairro oficial. */
const APELIDOS: Record<string, string> = {
  barigui: "Mossunguê",
  ecoville: "Mossunguê",
  cic: "Cidade Industrial de Curitiba",
  "cidade industrial": "Cidade Industrial de Curitiba",
  "sitio cercado": "Sítio Cercado",
};

export const MAPAS: readonly MapaDeBairros[] = [CURITIBA];

/** Sem acento, minúsculo e com um espaço só: é a chave de toda comparação daqui. */
export function normalizarNome(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function mapaDaCidade(cidade: string | null | undefined): MapaDeBairros | null {
  if (!cidade) return null;
  const chave = normalizarNome(cidade);
  return MAPAS.find((m) => normalizarNome(m.cidade) === chave) ?? null;
}

function pareceCep(trecho: string): boolean {
  return /^\d{5}-?\d{3}$/.test(trecho.replace(/\s/g, ""));
}

function titulo(texto: string): string {
  // O Mercado vem em maiúsculas ("CENTRO"); o Maps já vem como se escreve.
  if (texto !== texto.toUpperCase()) return texto;
  return texto
    .toLowerCase()
    .split(" ")
    .map((p) => (p.length > 2 ? p[0]!.toUpperCase() + p.slice(1) : p))
    .join(" ");
}

/**
 * O bairro escrito no endereço, ou `null`.
 *
 * `cidade` é a âncora preferida; sem ela, vale o trecho "Cidade - UF".
 * O nome devolvido é o oficial quando o desenho da cidade o conhece
 * (acento e maiúsculas certos), senão o que estava escrito.
 */
export function bairroDoEndereco(
  endereco: string | null | undefined,
  cidade?: string | null,
): string | null {
  if (!endereco) return null;
  const trechos = endereco
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (trechos.length < 2) return null;
  const chaveDaCidade = cidade ? normalizarNome(cidade) : null;
  const comUf = (t: string) => /\s-\s[A-Za-z]{2}$/.test(t);
  // A cidade é a âncora: o trecho igual a ela (sem a UF). Sem cidade conhecida, ou
  // escrita de outro jeito, vale o ÚLTIMO trecho que termina em " - UF" — o último,
  // porque um bairro pode conter o nome da cidade ("Cidade Industrial de Curitiba").
  let indiceDaCidade = chaveDaCidade
    ? trechos.findIndex(
        (t) => normalizarNome(t.replace(/\s*-\s*[A-Za-z]{2}$/, "")) === chaveDaCidade,
      )
    : -1;
  if (indiceDaCidade < 1) {
    indiceDaCidade = trechos.length - 1 - [...trechos].reverse().findIndex(comUf);
    if (indiceDaCidade < 1 || indiceDaCidade >= trechos.length) return null;
  }
  const anterior = trechos[indiceDaCidade - 1]!;
  const partes = anterior.split(/\s-\s/);
  const bruto = (partes.length > 1 ? partes[partes.length - 1]! : anterior).trim();
  if (!bruto || pareceCep(bruto) || /^\d+[a-z]?$/i.test(bruto)) return null;
  // Endereço do Maps sem bairro ("R. B, 2 - Joinville - SC"): o trecho anterior é a rua.
  if (
    partes.length === 1 &&
    /^(r\.|rua|av\.|avenida|al\.|alameda|rod\.|rodovia|estr\.|estrada|trav\.|travessa|pç\.|praça)(\s|$)/i.test(
      bruto,
    )
  )
    return null;
  return nomeOficial(bruto, cidade);
}

/** O nome como o desenho da cidade o escreve; sem desenho, o que veio, em caixa normal. */
export function nomeOficial(bairro: string, cidade?: string | null): string {
  const chave = normalizarNome(bairro);
  const apelido = APELIDOS[chave];
  const procurado = apelido ? normalizarNome(apelido) : chave;
  const mapa = mapaDaCidade(cidade) ?? null;
  const desenhado = (mapa ? mapa.bairros : MAPAS.flatMap((m) => m.bairros)).find(
    (b) => normalizarNome(b.nome) === procurado,
  );
  if (desenhado) return desenhado.nome;
  return apelido ?? titulo(bairro);
}

/** Quantas empresas há em cada bairro, do maior para o menor; `SEM_BAIRRO` por último. */
export function contarPorBairro<T>(
  itens: readonly T[],
  bairroDe: (item: T) => string | null,
): { bairro: string; total: number }[] {
  const contagem = new Map<string, number>();
  for (const item of itens) {
    const bairro = bairroDe(item) ?? SEM_BAIRRO;
    contagem.set(bairro, (contagem.get(bairro) ?? 0) + 1);
  }
  return [...contagem.entries()]
    .map(([bairro, total]) => ({ bairro, total }))
    .sort((a, b) => {
      if (a.bairro === SEM_BAIRRO) return 1;
      if (b.bairro === SEM_BAIRRO) return -1;
      return b.total - a.total || a.bairro.localeCompare(b.bairro, "pt");
    });
}

/**
 * A faixa de cor de um bairro pela quantidade: 0, 1, 2–3, 4–5, 6 ou mais.
 * Cinco faixas, como no Radar, mas numa escala de campanha (dezenas, não centenas).
 */
export function faixaDaContagem(total: number): 0 | 1 | 2 | 3 | 4 {
  if (total <= 0) return 0;
  if (total === 1) return 1;
  if (total <= 3) return 2;
  if (total <= 5) return 3;
  return 4;
}

export const ROTULOS_DAS_FAIXAS = ["0", "1", "2–3", "4–5", "6+"] as const;
