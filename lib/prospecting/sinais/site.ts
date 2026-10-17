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

/** Rede social no lugar do site: o endereço vira perfil, não site. */
const REDES: { rede: "instagram" | "facebook" | "linkedin"; host: RegExp }[] = [
  { rede: "instagram", host: /(^|\.)instagram\.com$/ },
  { rede: "facebook", host: /(^|\.)(facebook|fb)\.com$/ },
  { rede: "linkedin", host: /(^|\.)linkedin\.com$/ },
];

/**
 * Páginas que não são o site da empresa: cardápio e pedido on-line, link na bio,
 * WhatsApp. Medido em 17/10/2026 na campanha de Londrina: uma fábrica tinha no
 * Maps a loja dela numa plataforma de pedidos, fora do ar, e outra o Instagram;
 * as duas saíram como "site", e uma como "site fora do ar".
 */
const PLATAFORMAS =
  /(^|\.)(pedidoon\.net|anota\.ai|ifood\.com\.br|goomer\.app|cardapioweb\.com|menudino\.com|aiqfome\.com|deliverydireto\.com\.br|linktr\.ee|bio\.link|beacons\.ai|taplink\.cc|wa\.me|whatsapp\.com)$/;

export type EnderecoDoMaps =
  | { tipo: "site"; url: string }
  | { tipo: "rede"; rede: "instagram" | "facebook" | "linkedin"; url: string }
  | { tipo: "plataforma"; host: string; url: string };

/** O que é o endereço que o Maps deu como site da empresa. */
export function classificarEnderecoDoMaps(bruto: string): EnderecoDoMaps | null {
  const url = urlPublica(bruto);
  if (!url) return null;
  const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  const rede = REDES.find((r) => r.host.test(host));
  if (rede) return { tipo: "rede", rede: rede.rede, url };
  if (PLATAFORMAS.test(host)) return { tipo: "plataforma", host, url };
  return { tipo: "site", url };
}

export function siteDoCandidato(p: Pick<Prospect, "website" | "emails">): SiteAchado | null {
  const doMaps = p.website ? classificarEnderecoDoMaps(p.website) : null;
  if (doMaps?.tipo === "site") return { url: doMaps.url, origem: "maps" };
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
/** A palavra que o domínio carrega: "sweetsabor" em www.sweetsabor.com.br. */
export function rotuloDoDominio(url: string): string | null {
  try {
    const rotulo = new URL(url).hostname.replace(/^www\./, "").split(".")[0] ?? "";
    return rotulo.length >= 4 ? rotulo.toLowerCase().replace(/[^a-z0-9]/g, "") : null;
  } catch {
    return null;
  }
}

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
