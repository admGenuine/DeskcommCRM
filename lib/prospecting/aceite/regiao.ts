/**
 * Estado (UF) do que foi pedido e do que o Google Maps devolveu.
 *
 * O Maps amplia a área da busca e traz cidades vizinhas. Decisão do dono em
 * 01/10/2026: vizinha do MESMO estado entra; outro estado sai, com o motivo.
 *
 * Nos dois lados a regra é a mesma: se não dá para saber o estado, não recusa.
 * Recusar por falta de informação jogaria fora empresa boa em silêncio.
 */
import { normalizarTexto } from "./segmento";

const UFS: Record<string, string> = {
  AC: "acre",
  AL: "alagoas",
  AP: "amapa",
  AM: "amazonas",
  BA: "bahia",
  CE: "ceara",
  DF: "distrito federal",
  ES: "espirito santo",
  GO: "goias",
  MA: "maranhao",
  MT: "mato grosso",
  MS: "mato grosso do sul",
  MG: "minas gerais",
  PA: "para",
  PB: "paraiba",
  PR: "parana",
  PE: "pernambuco",
  PI: "piaui",
  RJ: "rio de janeiro",
  RN: "rio grande do norte",
  RS: "rio grande do sul",
  RO: "rondonia",
  RR: "roraima",
  SC: "santa catarina",
  SP: "sao paulo",
  SE: "sergipe",
  TO: "tocantins",
};

/** Capitais, para quem digita só "Curitiba". */
const CAPITAIS: Record<string, string> = {
  "rio branco": "AC",
  maceio: "AL",
  macapa: "AP",
  manaus: "AM",
  salvador: "BA",
  fortaleza: "CE",
  brasilia: "DF",
  vitoria: "ES",
  goiania: "GO",
  "sao luis": "MA",
  cuiaba: "MT",
  "campo grande": "MS",
  "belo horizonte": "MG",
  belem: "PA",
  "joao pessoa": "PB",
  curitiba: "PR",
  recife: "PE",
  teresina: "PI",
  natal: "RN",
  "porto alegre": "RS",
  "porto velho": "RO",
  "boa vista": "RR",
  florianopolis: "SC",
  aracaju: "SE",
  palmas: "TO",
};

const NOMES = Object.entries(UFS).sort((a, b) => b[1].length - a[1].length);

function ufPorNome(normalizado: string): string | null {
  // Nome mais longo primeiro: "mato grosso do sul" antes de "mato grosso",
  // "paraiba" antes de "para". Casa palavra inteira.
  for (const [uf, nome] of NOMES) {
    if (new RegExp(`(^|[^a-z])${nome}([^a-z]|$)`).test(normalizado)) return uf;
  }
  return null;
}

/** UF de um texto livre de busca: "Curitiba, PR", "Paraná", "SP", "Curitiba". */
export function ufDaBusca(local: string | null | undefined): string | null {
  const texto = (local ?? "").trim();
  if (!texto) return null;
  // Sigla escrita em MAIÚSCULAS, como palavra solta ("Curitiba, PR", "SP").
  for (const sigla of texto.match(/\b[A-Z]{2}\b/g) ?? []) if (UFS[sigla]) return sigla;
  // Sigla minúscula só quando é o texto inteiro ou o último pedaço ("curitiba, pr").
  const ultimo = normalizarTexto(texto.split(/[,\-–/]/).pop() ?? "").toUpperCase();
  if (ultimo.length === 2 && UFS[ultimo]) return ultimo;
  const normalizado = normalizarTexto(texto);
  return ufPorNome(normalizado) ?? CAPITAIS[normalizado] ?? CAPITAIS[normalizarTexto(texto.split(",")[0] ?? "")] ?? null;
}

/** UF de um lugar do Maps: pelo endereço ("…, Curitiba - PR, 80000-000") ou pelo campo `state`. */
export function ufDoLugar(endereco: string | null | undefined, estado: string | null | undefined): string | null {
  const e = endereco ?? "";
  const peloCep = e.match(/-\s*([A-Z]{2})\s*,\s*\d{5}-?\d{3}/);
  if (peloCep && UFS[peloCep[1]!]) return peloCep[1]!;
  const peloFim = e.match(/\s-\s([A-Z]{2})(?:\s*,|\s*$)/);
  if (peloFim && UFS[peloFim[1]!]) return peloFim[1]!;
  if (estado?.trim()) {
    const sigla = estado.trim().toUpperCase();
    if (UFS[sigla]) return sigla;
    return ufPorNome(normalizarTexto(estado).replace(/^(state of|estado d[eoa]) /, ""));
  }
  return null;
}
