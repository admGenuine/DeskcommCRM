/**
 * Onde está o site da empresa, e se o site achado é mesmo dela.
 *
 * Duas origens, nesta ordem:
 *   1. o site que o Google Maps devolveu (campanha de busca no Maps);
 *   2. o domínio do e-mail cadastrado na Receita (campanha do Mercado), quando
 *      não é um provedor de e-mail gratuito.
 *
 * O e-mail da Receita é, com frequência, o do ESCRITÓRIO DE CONTABILIDADE que
 * abriu a empresa. Por isso o site vindo do e-mail só vale depois de conferido
 * (`siteConfere`): a página precisa citar o nome da empresa e não pode ser de
 * contabilidade. O site do Maps foi cadastrado pela própria empresa e não passa
 * por essa conferência.
 */
import type { Prospect } from "../schema";

/**
 * Provedores de e-mail gratuito ou de massa, pelo NOME (o primeiro rótulo do
 * domínio), para valer em qualquer terminação: gmail, hotmail.com.br, yahoo.com.ar.
 * O domínio desses e-mails não diz nada da empresa.
 */
const PROVEDORES_GRATUITOS = new Set([
  "gmail",
  "googlemail",
  "hotmail",
  "outlook",
  "live",
  "msn",
  "yahoo",
  "ymail",
  "icloud",
  "me",
  "bol",
  "uol",
  "terra",
  "ig",
  "globo",
  "globomail",
  "r7",
  "zipmail",
  "oi",
  "pop",
  "superig",
  "protonmail",
  "proton",
  "aol",
  "gmx",
  "zoho",
]);

export interface SiteAchado {
  url: string;
  origem: "maps" | "email";
}

function urlPublica(bruto: string): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(bruto) ? bruto : `https://${bruto}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.username || u.password) return null;
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** O domínio de um e-mail, ou null se for de provedor gratuito ou inválido. */
export function dominioDoEmail(email: string): string | null {
  const m = /^[^@\s]+@([a-z0-9.-]+\.[a-z]{2,})$/i.exec(email.trim());
  if (!m?.[1]) return null;
  const dominio = m[1].toLowerCase().replace(/\.$/, "");
  if (PROVEDORES_GRATUITOS.has(dominio.split(".")[0]!)) return null;
  return dominio;
}

export function siteDoCandidato(p: Pick<Prospect, "website" | "emails">): SiteAchado | null {
  if (p.website) {
    const url = urlPublica(p.website);
    if (url) return { url, origem: "maps" };
  }
  for (const email of p.emails ?? []) {
    const dominio = dominioDoEmail(email);
    if (dominio) return { url: `https://${dominio}/`, origem: "email" };
  }
  return null;
}

/** Palavras que não identificam empresa nenhuma. */
const PALAVRAS_GENERICAS = new Set([
  "ltda",
  "eireli",
  "epp",
  "industria",
  "industrias",
  "comercio",
  "comercial",
  "alimentos",
  "alimenticios",
  "alimenticia",
  "produtos",
  "fabrica",
  "fabricacao",
  "distribuidora",
  "brasil",
  "brasileira",
  "empresa",
  "grupo",
  "servicos",
  "importacao",
  "exportacao",
  "participacoes",
  "limitada",
  "sociedade",
]);

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** As palavras do nome que identificam a empresa (4 letras ou mais, não genéricas). */
export function palavrasDoNome(...nomes: (string | null | undefined)[]): string[] {
  const palavras = new Set<string>();
  for (const nome of nomes) {
    if (!nome) continue;
    for (const p of normalizar(nome).split(/[^a-z0-9]+/)) {
      if (p.length >= 4 && !PALAVRAS_GENERICAS.has(p) && !/^\d+$/.test(p)) palavras.add(p);
    }
  }
  return [...palavras];
}

const CONTABILIDADE = /contab|contador|escritorio de contabilidade|assessoria contabil/;

/**
 * O site é desta empresa? Vale quando o domínio ou o texto da página cita uma
 * palavra própria do nome, e a página não é de contabilidade. Sem palavra
 * própria no nome (nome todo genérico), não dá para conferir: não vale.
 */
export function siteConfere(input: {
  url: string;
  texto: string;
  nomes: (string | null | undefined)[];
}): boolean {
  const palavras = palavrasDoNome(...input.nomes);
  if (!palavras.length) return false;
  let host = "";
  try {
    host = normalizar(new URL(input.url).hostname);
  } catch {
    return false;
  }
  const texto = normalizar(input.texto.slice(0, 20000));
  if (CONTABILIDADE.test(host) || CONTABILIDADE.test(texto.slice(0, 3000))) return false;
  return palavras.some((p) => host.includes(p) || new RegExp(`\\b${p}\\b`).test(texto));
}
