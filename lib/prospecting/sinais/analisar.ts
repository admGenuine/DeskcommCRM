/**
 * A análise de UMA empresa: achar o site, conferir que é dela, ler a home e até
 * três páginas internas, e extrair os sinais com prova.
 *
 * Sem IA e sem fonte paga. O custo é tempo de rede: a leitura inteira de uma
 * empresa fica abaixo de `PRAZO_POR_EMPRESA_MS`.
 */
import type { Prospect } from "../schema";
import { extrairSinais, paginasParaLer, textoDoHtml, type Pagina } from "./extrair";
import { lerPagina, type Leitura, type MotivoDaFalha, type OpcoesDeLeitura } from "./leitor";
import {
  classificarEnderecoDoMaps,
  palavrasDoNome,
  rotuloDoDominio,
  siteConfere,
  siteDoCandidato,
} from "./site";
import { PERFIL_VAZIO, VERSAO_DA_ANALISE, type Analise, type Sinal } from "./tipos";

export const PRAZO_POR_EMPRESA_MS = 25_000;
const PAGINAS_INTERNAS = 3;

const MOTIVO_EM_PORTUGUES: Record<MotivoDaFalha, string> = {
  url_invalida: "o endereço do site é inválido",
  destino_bloqueado: "o endereço aponta para uma rede interna e não foi lido",
  dns: "o domínio não existe ou não responde",
  tempo: "o site demorou demais para responder",
  conexao: "o site recusou a conexão",
  status_http: "o site respondeu com erro",
  nao_html: "o endereço não é uma página",
  grande_demais: "a página é grande demais para ler",
  redirecionamentos: "o site redireciona demais",
};

const NOME_DA_REDE = { instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn" };

/**
 * Página que abre mas diz que o site não está lá: hospedagem suspensa, domínio
 * à venda, "em construção". Só em página curta: num site de verdade, "produto
 * indisponível" é conteúdo, não aviso.
 */
const PAGINA_INDISPONIVEL =
  /(site|loja|pagina|dominio|servico|conta|hospedagem)\s+(esta\s+)?(temporariamente\s+)?(indisponivel|fora do ar|suspens[ao]|expirad[oa]|em construcao|em manutencao|desativad[oa])|account (has been )?suspended|domain (is|may be) for sale|this domain (has )?expired|(coming soon|under construction)|pagina nao encontrada/;
const TEXTO_CURTO = 800;

export interface DependenciasDaAnalise {
  ler?: (url: string, opcoes?: OpcoesDeLeitura) => Promise<Leitura>;
  agora?: () => Date;
}

type ProspectParaAnalise = Pick<Prospect, "name" | "website" | "emails"> & {
  razao_social?: string | null;
};

function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Lê com cadeado primeiro. O endereço do Maps costuma vir com `http://` mesmo
 * quando o site tem https (medido em 17/10/2026: um site com cadeado saiu como
 * "sem cadeado"). Só quando o https não abre o http é lido, e aí o "sem
 * cadeado" é verdade.
 */
async function lerComCadeado(
  ler: NonNullable<DependenciasDaAnalise["ler"]>,
  url: string,
): Promise<Leitura> {
  const https = url.replace(/^http:/i, "https:");
  const http = url.replace(/^https:/i, "http:");
  const primeira = await ler(https);
  if (primeira.ok) return primeira;
  const segunda = await ler(http);
  return segunda.ok ? segunda : primeira;
}

export async function analisarEmpresa(
  p: ProspectParaAnalise,
  pedidaEm: string,
  deps: DependenciasDaAnalise = {},
): Promise<Analise> {
  const ler = deps.ler ?? lerPagina;
  const agora = deps.agora ?? (() => new Date());
  const inicio = Date.now();
  const doMaps = p.website ? classificarEnderecoDoMaps(p.website) : null;
  const perfilDoMaps: Analise["perfil"] =
    doMaps?.tipo === "rede" ? { ...PERFIL_VAZIO, [doMaps.rede]: doMaps.url } : PERFIL_VAZIO;
  const base = {
    pedida_em: pedidaEm,
    iniciada_em: null,
    analisada_em: agora().toISOString(),
    perfil: perfilDoMaps,
    paginas: [] as string[],
    versao: VERSAO_DA_ANALISE,
  };
  const semSite = (sinal: Sinal | null, observacao: string | null): Analise => ({
    ...base,
    status: "sem_site",
    site: null,
    sinais: sinal ? [sinal] : [],
    observacao,
  });
  // Sem site próprio, o que o Maps tinha no lugar dele é a prova.
  const provaDeSemSite = (): Sinal =>
    doMaps?.tipo === "rede"
      ? {
          tipo: "sem_site",
          evidencia: `O endereço no Maps é o ${NOME_DA_REDE[doMaps.rede]} da empresa, não um site.`,
          link: doMaps.url,
        }
      : doMaps?.tipo === "plataforma"
        ? {
            tipo: "sem_site",
            evidencia: `O endereço no Maps é uma página em ${doMaps.host}, não um site próprio.`,
            link: doMaps.url,
          }
        : {
            tipo: "sem_site",
            evidencia: "Nenhum site no Maps nem e-mail com domínio próprio.",
            link: null,
          };

  const achado = siteDoCandidato(p);
  if (!achado) return semSite(provaDeSemSite(), null);

  const home = await lerComCadeado(ler, achado.url);
  if (!home.ok) {
    // Do e-mail, um domínio que não abre é só um domínio de e-mail: não é prova
    // de site fora do ar. Do Maps, é: a empresa divulga um site que não abre.
    if (achado.origem === "email")
      return semSite(
        doMaps
          ? provaDeSemSite()
          : {
              tipo: "sem_site",
              evidencia: "O domínio do e-mail não tem site que abra.",
              link: null,
            },
        `O domínio do e-mail não abriu: ${MOTIVO_EM_PORTUGUES[home.motivo]}.`,
      );
    return {
      ...base,
      status: "fora_do_ar",
      site: achado,
      sinais: [
        {
          tipo: "site_fora_do_ar",
          evidencia: `O site divulgado no Maps não abriu: ${MOTIVO_EM_PORTUGUES[home.motivo]}.`,
          link: achado.url,
        },
      ],
      observacao: null,
    };
  }

  const textoDaHome = textoDoHtml(home.html);
  if (
    achado.origem === "email" &&
    !siteConfere({ url: home.url, texto: textoDaHome, nomes: [p.name, p.razao_social] })
  )
    return semSite(
      doMaps ? provaDeSemSite() : null,
      "O domínio do e-mail abre um site que não cita o nome da empresa (pode ser do contador). Não foi usado.",
    );

  const aviso =
    textoDaHome.length < TEXTO_CURTO ? PAGINA_INDISPONIVEL.exec(semAcento(textoDaHome)) : null;
  if (aviso)
    return {
      ...base,
      status: "fora_do_ar",
      site: { url: home.url, origem: achado.origem },
      sinais: [
        {
          tipo: "site_fora_do_ar",
          evidencia: `O site abre, mas mostra só um aviso: "${textoDaHome.slice(0, 160)}".`,
          link: home.url,
        },
      ],
      observacao: null,
    };

  const paginas: Pagina[] = [{ url: home.url, html: home.html }];
  for (const url of paginasParaLer(paginas[0]!, PAGINAS_INTERNAS)) {
    if (Date.now() - inicio > PRAZO_POR_EMPRESA_MS - 8000) break;
    const r = await ler(url);
    if (r.ok) paginas.push({ url: r.url, html: r.html });
  }
  const rotulo = rotuloDoDominio(home.url);
  const identidade = [...palavrasDoNome(p.name, p.razao_social), ...(rotulo ? [rotulo] : [])];
  const { sinais, perfil } = extrairSinais(paginas, agora().getFullYear(), identidade);
  return {
    ...base,
    status: "ok",
    site: { url: home.url, origem: achado.origem },
    // O perfil que o próprio Maps deu vale mais que o achado no site.
    perfil: {
      instagram: perfilDoMaps.instagram ?? perfil.instagram,
      facebook: perfilDoMaps.facebook ?? perfil.facebook,
      linkedin: perfilDoMaps.linkedin ?? perfil.linkedin,
    },
    sinais,
    paginas: paginas.map((pg) => pg.url),
    observacao: null,
  };
}
