/**
 * Os sinais que se leem do HTML sem IA. Funções puras: recebem as páginas já
 * baixadas e devolvem sinais com prova (trecho e link).
 *
 * Cada régua procura o que a empresa PUBLICOU: um link "Seja um distribuidor",
 * uma vaga de vendedor, o número do SIF, o código do pixel de anúncio. Palavra
 * solta não basta onde ela é ambígua: "SIM" é "sim" em português, então o
 * serviço municipal só conta por extenso ou como "S.I.M.".
 */
import type { Analise, Sinal } from "./tipos";

export interface Pagina {
  url: string;
  html: string;
}

export interface Link {
  href: string;
  texto: string;
  /** O texto logo antes do link ("Desenvolvido por"), para saber em que papel ele aparece. */
  contexto: string;
}

const ENTIDADES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ccedil: "ç",
  atilde: "ã",
  otilde: "õ",
  aacute: "á",
  eacute: "é",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  acirc: "â",
  ecirc: "ê",
  ocirc: "ô",
  agrave: "à",
  ordm: "º",
  ordf: "ª",
  copy: "©",
};

function decodificarEntidades(texto: string): string {
  return texto.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (inteira, nome: string) => {
    if (nome[0] === "#") {
      const n =
        nome[1]?.toLowerCase() === "x" ? parseInt(nome.slice(2), 16) : parseInt(nome.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : inteira;
    }
    return ENTIDADES[nome.toLowerCase()] ?? inteira;
  });
}

/** O texto visível da página, numa linha só. */
export function textoDoHtml(html: string): string {
  return decodificarEntidades(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|header|footer)>/gi, " . ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** Os links da página, com o endereço absoluto e o texto (ou o title/alt). */
export function linksDoHtml(html: string, base: string): Link[] {
  const links: Link[] = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && links.length < 800) {
    const atributos = m[1] ?? "";
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(atributos);
    const bruto = (href?.[1] ?? href?.[2] ?? href?.[3] ?? "").trim();
    if (!bruto || /^(javascript|mailto|tel|data):/i.test(bruto) || bruto.startsWith("#")) continue;
    let absoluto: string;
    try {
      absoluto = new URL(decodificarEntidades(bruto), base).toString();
    } catch {
      continue;
    }
    const titulo = /\b(?:title|aria-label)\s*=\s*"([^"]*)"/i.exec(atributos)?.[1] ?? "";
    const alt = /\balt\s*=\s*"([^"]*)"/i.exec(m[2] ?? "")?.[1] ?? "";
    const texto = textoDoHtml(m[2] ?? "") || titulo || alt;
    const contexto = textoDoHtml(html.slice(Math.max(0, m.index - 400), m.index)).slice(-120);
    links.push({ href: absoluto, texto: texto.slice(0, 160), contexto });
  }
  return links;
}

function hostDe(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** O trecho em volta de um achado, para servir de prova. */
function trecho(texto: string, indice: number, tamanho: number): string {
  const inicio = Math.max(0, indice - 60);
  const fim = Math.min(texto.length, indice + tamanho + 100);
  return `${inicio > 0 ? "…" : ""}${texto.slice(inicio, fim).trim()}${fim < texto.length ? "…" : ""}`.slice(
    0,
    240,
  );
}

const CHAMADA_DE_DISTRIBUIDOR =
  /\b(seja|torne[- ]se|quero ser|venha ser|cadastre[- ]se como|procuramos|buscamos)\s+(um |uma |nosso |nossa )?(distribuidor|distribuidora|representante|revendedor|revendedora|parceiro comercial|franqueado)/;
/** Caminho de página de CADASTRO de parceiro, não de lista ("/distribuidores" é onde comprar). */
const CAMINHO_DE_DISTRIBUIDOR =
  /\/(seja|quero-ser|torne-se|venha-ser)[-_]?(um[-_]|uma[-_]|nosso[-_])?(distribuidor|distribuidora|representante|revendedor|revendedora|parceiro|franqueado)|\/(revenda|seja-revendedor|cadastro-de-(distribuidor|representante|revendedor))(\/|$)/;
const VAGA_COMERCIAL =
  /\b(vaga|vagas|contrata|contratamos|contratando|oportunidade|trabalhe conosco)\b[^.]{0,120}\b(vendedor|vendedora|vendedores|representante comercial|representantes comerciais|promotor de vendas|promotora de vendas|promotores|trade marketing|executivo de vendas|executiva de vendas|consultor comercial|consultora comercial|supervisor de vendas|assistente comercial)/;
const SIF = /\b(s\.?\s?i\.?\s?f\.?)\s*(n[º°o.]*\s*)?(\d{1,5})\b|servico de inspecao federal/;
const SIE_SIM =
  /\b(s\.i\.e\.|s\.i\.m\.|sisbi(?:-poa)?)\b|\bsie\s*(n[º°o.]*\s*)?\d{1,5}\b|servico de inspecao (estadual|municipal)/;
const VAREJO_HOSTS =
  /(^|\.)(mercadolivre\.com\.br|mercadolibre\.com|amazon\.com\.br|shopee\.com\.br|magazineluiza\.com\.br|magalu\.com|americanas\.com\.br|carrefour\.com\.br|paodeacucar\.com|extramercado\.com\.br|atacadao\.com\.br|assai\.com\.br|savegnago\.com\.br|condor\.com\.br|angeloni\.com\.br|superkoch\.com\.br|giassi\.com\.br)$/;
const ONDE_COMPRAR =
  /\b(onde (comprar|encontrar)|pontos? de venda|encontre (nossos produtos|perto de voce))\b/;
const PIXEL_META = /fbq\(\s*['"]init['"]|connect\.facebook\.net\/[^"']*\/fbevents\.js/;
const TAG_GOOGLE_ADS = /\bAW-\d{6,}\b|googleadservices\.com\/pagead\/conversion/;
const COPYRIGHT = /(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi;

function primeiroAchado(re: RegExp, texto: string): { indice: number; tamanho: number } | null {
  const m = re.exec(texto);
  return m ? { indice: m.index, tamanho: m[0].length } : null;
}

export interface Extracao {
  sinais: Sinal[];
  perfil: Analise["perfil"];
}

function redeDoLink(l: Link, host: string): keyof Analise["perfil"] | null {
  if (/(^|\.)instagram\.com$/.test(host) && /instagram\.com\/[a-z0-9_.]+/i.test(l.href))
    return "instagram";
  if (/(^|\.)facebook\.com$/.test(host) && !/sharer|share\.php|\/dialog\//.test(l.href))
    return "facebook";
  if (/(^|\.)linkedin\.com$/.test(host) && !/shareArticle|\/share/i.test(l.href)) return "linkedin";
  return null;
}

/** O nome do perfil no endereço: "terrabrancomidia" em instagram.com/terrabrancomidia. */
function nomeDoPerfil(href: string): string {
  try {
    const partes = new URL(href).pathname.split("/").filter(Boolean);
    const nome = partes[0] === "company" || partes[0] === "in" ? partes[1] : partes[0];
    return semAcento(nome ?? "").replace(/[^a-z0-9]/g, "");
  } catch {
    return "";
  }
}

/** Link que credita quem fez o site: "Desenvolvido por", "Criado por", "Agência". */
const CREDITO =
  /(desenvolvid[oa]|criad[oa]|produzid[oa]|feit[oa]|projetad[oa]|criacao|desenvolvimento|agencia|design|powered|made)\s*(por|pela|pelo|by|com)?\s*:?\s*$/;

/**
 * O perfil que é DA EMPRESA, entre os que o site linka. Vale o que tem no nome
 * uma palavra da empresa ou do domínio. Medido em 17/10/2026: o site de uma
 * fábrica linkava só o Instagram da agência que o fez, no rodapé, e ele saía
 * como o Instagram da fábrica. Sem palavra nenhuma para conferir (nome todo
 * genérico e domínio curto), vale o único perfil linkado, se não for crédito.
 */
function perfilDaEmpresa(links: Link[], identidade: string[]): string | null {
  const distintos = new Map<string, Link>();
  for (const l of links) {
    const nome = nomeDoPerfil(l.href);
    if (nome && !distintos.has(nome)) distintos.set(nome, l);
  }
  for (const [nome, l] of distintos)
    if (identidade.some((p) => nome.includes(p) || (nome.length >= 5 && p.includes(nome))))
      return l.href;
  if (identidade.length) return null;
  const unicos = [...distintos.values()];
  const unico = unicos.length === 1 ? unicos[0] : undefined;
  return unico && !CREDITO.test(semAcento(unico.contexto)) ? unico.href : null;
}

/**
 * Os sinais de um conjunto de páginas do MESMO site. `anoAtual` entra de fora
 * para o teste não depender do relógio. `identidade`: as palavras do nome da
 * empresa e do domínio, que decidem qual perfil de rede social é dela.
 */
export function extrairSinais(
  paginas: Pagina[],
  anoAtual: number,
  identidade: string[] = [],
): Extracao {
  const sinais: Sinal[] = [];
  const ja = new Set<string>();
  const add = (s: Sinal) => {
    if (ja.has(s.tipo)) return;
    ja.add(s.tipo);
    sinais.push(s);
  };
  const perfis: Record<keyof Analise["perfil"], Link[]> = {
    instagram: [],
    facebook: [],
    linkedin: [],
  };
  let temPixel = false;
  let anoMaisRecente = 0;

  for (const pagina of paginas) {
    const texto = textoDoHtml(pagina.html);
    const textoNormal = semAcento(texto);
    const links = linksDoHtml(pagina.html, pagina.url);

    for (const l of links) {
      const alvo = `${semAcento(l.texto)} ${semAcento(l.href)}`;
      const host = hostDe(l.href);
      if (CHAMADA_DE_DISTRIBUIDOR.test(semAcento(l.texto)) || CAMINHO_DE_DISTRIBUIDOR.test(alvo))
        add({
          tipo: "procura_distribuidor",
          evidencia: `Link "${l.texto || l.href}" no site.`.slice(0, 240),
          link: l.href,
        });
      if (VAREJO_HOSTS.test(host))
        add({ tipo: "vende_em_varejo", evidencia: `Link para ${host}.`, link: l.href });
      else if (ONDE_COMPRAR.test(semAcento(l.texto)))
        add({
          tipo: "vende_em_varejo",
          evidencia: `Link "${l.texto}" no site.`.slice(0, 240),
          link: l.href,
        });
      const rede = redeDoLink(l, host);
      if (rede) perfis[rede].push(l);
    }

    const chamada = primeiroAchado(CHAMADA_DE_DISTRIBUIDOR, textoNormal);
    if (chamada)
      add({
        tipo: "procura_distribuidor",
        evidencia: trecho(texto, chamada.indice, chamada.tamanho),
        link: pagina.url,
      });
    const vaga = primeiroAchado(VAGA_COMERCIAL, textoNormal);
    if (vaga)
      add({
        tipo: "vagas_comerciais",
        evidencia: trecho(texto, vaga.indice, vaga.tamanho),
        link: pagina.url,
      });
    const sif = primeiroAchado(SIF, textoNormal);
    if (sif)
      add({
        tipo: "registro_sif",
        evidencia: trecho(texto, sif.indice, sif.tamanho),
        link: pagina.url,
      });
    const sie = primeiroAchado(SIE_SIM, textoNormal);
    if (sie)
      add({
        tipo: "registro_estadual_municipal",
        evidencia: trecho(texto, sie.indice, sie.tamanho),
        link: pagina.url,
      });
    const onde = primeiroAchado(ONDE_COMPRAR, textoNormal);
    if (onde)
      add({
        tipo: "vende_em_varejo",
        evidencia: trecho(texto, onde.indice, onde.tamanho),
        link: pagina.url,
      });

    if (PIXEL_META.test(pagina.html)) {
      temPixel = true;
      add({
        tipo: "anuncia_meta",
        evidencia: "Pixel da Meta no código da página.",
        link: pagina.url,
      });
    }
    const google = TAG_GOOGLE_ADS.exec(pagina.html);
    if (google) {
      temPixel = true;
      add({
        tipo: "anuncia_google",
        evidencia: `Tag de conversão do Google Ads no código da página (${google[0].slice(0, 40)}).`,
        link: pagina.url,
      });
    }
    for (const c of pagina.html.matchAll(COPYRIGHT)) {
      const ano = Number(c[1]);
      if (ano >= 1990 && ano <= anoAtual) anoMaisRecente = Math.max(anoMaisRecente, ano);
    }
  }

  const home = paginas[0];
  if (home) {
    // Com o Gerenciador de Tags do Google, o pixel pode estar DENTRO do contêiner,
    // fora do HTML: aí não dá para afirmar que não há pixel.
    const temGerenciadorDeTags = paginas.some((pg) =>
      /googletagmanager\.com\/gtm\.js|\bGTM-[A-Z0-9]{4,}\b/.test(pg.html),
    );
    if (!temPixel && !temGerenciadorDeTags)
      add({
        tipo: "sem_pixel_de_anuncio",
        evidencia: "Nenhum pixel da Meta nem tag do Google Ads nas páginas lidas.",
        link: home.url,
      });
    if (home.url.startsWith("http:"))
      add({ tipo: "site_sem_https", evidencia: "O site abre sem cadeado (http).", link: home.url });
    if (anoMaisRecente && anoMaisRecente <= anoAtual - 3)
      add({
        tipo: "site_desatualizado",
        evidencia: `O rodapé diz © ${anoMaisRecente}.`,
        link: home.url,
      });
  }
  const perfil: Analise["perfil"] = {
    instagram: perfilDaEmpresa(perfis.instagram, identidade),
    facebook: perfilDaEmpresa(perfis.facebook, identidade),
    linkedin: perfilDaEmpresa(perfis.linkedin, identidade),
  };
  return { sinais, perfil };
}

/** Prioridade de leitura: parceria e vagas primeiro, depois onde comprar, depois "sobre". */
const INTERESSE: RegExp[] = [
  /(distribuid|representa|revend|seja|parceir|franquia|trabalhe|carreira|vaga)/,
  /(onde[- ]?(comprar|encontrar)|pontos?[- ]de[- ]venda)/,
  /(sobre|quem[- ]somos|institucional|nossa[- ]historia|a[- ]empresa)/,
];

/**
 * Até `max` páginas internas que valem a leitura: as do mesmo site cujo
 * endereço ou texto fala de parceria, vagas, onde comprar ou "sobre", nessa
 * ordem de prioridade.
 */
export function paginasParaLer(home: Pagina, max: number): string[] {
  const hostDaHome = hostDe(home.url);
  const candidatas: { url: string; prioridade: number }[] = [];
  for (const l of linksDoHtml(home.html, home.url)) {
    if (hostDe(l.href) !== hostDaHome) continue;
    const semAncora = l.href.split("#")[0]!;
    if (semAncora === home.url || candidatas.some((c) => c.url === semAncora)) continue;
    if (/\.(pdf|jpe?g|png|gif|webp|zip|docx?|xlsx?)(\?|$)/i.test(semAncora)) continue;
    const alvo = `${semAcento(new URL(semAncora).pathname)} ${semAcento(l.texto)}`;
    const prioridade = INTERESSE.findIndex((re) => re.test(alvo));
    if (prioridade >= 0) candidatas.push({ url: semAncora, prioridade });
  }
  return candidatas
    .sort((a, b) => a.prioridade - b.prioridade)
    .slice(0, max)
    .map((c) => c.url);
}
