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
import { siteConfere, siteDoCandidato } from "./site";
import { PERFIL_VAZIO, type Analise } from "./tipos";

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

export interface DependenciasDaAnalise {
  ler?: (url: string, opcoes?: OpcoesDeLeitura) => Promise<Leitura>;
  agora?: () => Date;
}

type ProspectParaAnalise = Pick<Prospect, "name" | "website" | "emails"> & {
  razao_social?: string | null;
};

export async function analisarEmpresa(
  p: ProspectParaAnalise,
  pedidaEm: string,
  deps: DependenciasDaAnalise = {},
): Promise<Analise> {
  const ler = deps.ler ?? lerPagina;
  const agora = deps.agora ?? (() => new Date());
  const inicio = Date.now();
  const base = {
    pedida_em: pedidaEm,
    iniciada_em: null,
    analisada_em: agora().toISOString(),
    perfil: PERFIL_VAZIO,
    paginas: [] as string[],
    versao: 1 as const,
  };

  const achado = siteDoCandidato(p);
  if (!achado)
    return {
      ...base,
      status: "sem_site",
      site: null,
      sinais: [
        {
          tipo: "sem_site",
          evidencia: "Nenhum site no Maps nem e-mail com domínio próprio.",
          link: null,
        },
      ],
      observacao: null,
    };

  const home = await ler(achado.url);
  if (!home.ok) {
    // Do e-mail, um domínio que não abre é só um domínio de e-mail: não é prova
    // de site fora do ar. Do Maps, é: a empresa divulga um site que não abre.
    if (achado.origem === "email")
      return {
        ...base,
        status: "sem_site",
        site: null,
        sinais: [
          {
            tipo: "sem_site",
            evidencia: "O domínio do e-mail não tem site que abra.",
            link: null,
          },
        ],
        observacao: `O domínio do e-mail não abriu: ${MOTIVO_EM_PORTUGUES[home.motivo]}.`,
      };
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

  if (
    achado.origem === "email" &&
    !siteConfere({ url: home.url, texto: textoDoHtml(home.html), nomes: [p.name, p.razao_social] })
  )
    return {
      ...base,
      status: "sem_site",
      site: null,
      sinais: [],
      observacao:
        "O domínio do e-mail abre um site que não cita o nome da empresa (pode ser do contador). Não foi usado.",
    };

  const paginas: Pagina[] = [{ url: home.url, html: home.html }];
  for (const url of paginasParaLer(paginas[0]!, PAGINAS_INTERNAS)) {
    if (Date.now() - inicio > PRAZO_POR_EMPRESA_MS - 8000) break;
    const r = await ler(url);
    if (r.ok) paginas.push({ url: r.url, html: r.html });
  }
  const { sinais, perfil } = extrairSinais(paginas, agora().getFullYear());
  return {
    ...base,
    status: "ok",
    site: { url: home.url, origem: achado.origem },
    perfil,
    sinais,
    paginas: paginas.map((pg) => pg.url),
    observacao: null,
  };
}
