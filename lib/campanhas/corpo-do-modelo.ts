/**
 * A PARTE PURA da campanha com modelo aprovado (fork da Genuine, 2026-11-12):
 * o pedido, a cópia que vai para o texto da campanha, a leitura dos valores de
 * volta e a conferência do mapa contra as vagas do modelo. Sem banco e sem
 * rede, para a tela e o servidor usarem a MESMA regra. O porquê do desenho está
 * no cabeçalho de `modelo-da-campanha.ts`.
 */
import { z } from "zod";

import type { VagaDoModelo } from "@/lib/channels/modelos-da-conexao";

/** Envios por rodada de um minuto, quando a campanha não escolheu. */
export const ENVIOS_POR_RODADA_PADRAO = 10;
/** O teto: a rodada tem um prazo, e 60 envios em sequência já o ocupam. */
export const ENVIOS_POR_RODADA_MAXIMO = 60;

/** A chave de uma vaga (`slotKey`): "1", "nome_cliente", "header:1", "button0:1", "card0:1". */
const CHAVE_DA_VAGA = /^[A-Za-z0-9_:]{1,80}$/;

export const modeloDaCampanhaSchema = z.object({
  template_name: z.string().trim().min(1).max(512),
  template_language: z.string().trim().min(2).max(16),
  variable_map: z
    .record(z.string().regex(CHAVE_DA_VAGA), z.string().max(1000))
    .refine((m) => Object.keys(m).length <= 50, { message: "Modelo com vagas demais." }),
  envios_por_rodada: z.number().int().min(1).max(ENVIOS_POR_RODADA_MAXIMO).nullable().optional(),
});

export type ModeloDaCampanha = z.infer<typeof modeloDaCampanhaSchema>;

// ─── A cópia no texto da campanha ────────────────────────────────────────────

/** A primeira linha da cópia. Só informa quem lê o texto; não é lida de volta. */
export const CABECALHO_DO_CORPO = "Modelo aprovado:";
/**
 * Abre cada vaga. O INVISIBLE SEPARATOR (U+2063) antes do colchete é o que
 * separa a marca de um texto que alguém tenha cadastrado com colchetes: um
 * campo do contato não traz esse caractere por acaso.
 */
const ABRE = "\u2063\u27e6";
const FECHA = "\u27e7";
const MARCA_DA_VAGA = new RegExp(`${ABRE}([A-Za-z0-9_:]{1,80})${FECHA}`);

/** A cópia derivada do mapa, que vai para `campaigns.message_body`. */
export function serializarModelo(
  m: Pick<ModeloDaCampanha, "template_name" | "template_language" | "variable_map">,
  ordem?: readonly string[],
): string {
  const chaves = Object.keys(m.variable_map);
  const ordenadas = ordem
    ? [...ordem.filter((c) => chaves.includes(c)), ...chaves.filter((c) => !ordem.includes(c))]
    : [...chaves].sort();
  const linhas = [`${CABECALHO_DO_CORPO} ${m.template_name} (${m.template_language})`];
  for (const chave of ordenadas) {
    // Quebra de linha no valor fixo viraria espaço no envio de qualquer jeito
    // (a plataforma recusa parâmetro com quebra); tirar aqui deixa a cópia legível.
    const valor = (m.variable_map[chave] ?? "").replace(/[\r\n]+/g, " ");
    linhas.push(`${ABRE}${chave}${FECHA}${valor}`);
  }
  return linhas.join("\n");
}

/** O texto da campanha é a cópia de um modelo? */
export function ehCorpoDeModelo(corpo: string | null | undefined): boolean {
  const texto = corpo ?? "";
  return texto.startsWith(CABECALHO_DO_CORPO) || MARCA_DA_VAGA.test(texto);
}

/**
 * Parâmetro de texto que a plataforma aceita: sem quebra de linha nem tabulação,
 * e sem mais de quatro espaços seguidos (a Meta recusa os dois com erro 100).
 */
export function normalizarParametro(valor: string): string {
  return valor
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {4,}/g, "   ")
    .trim();
}

/** Os valores de cada vaga, lidos da cópia já renderizada para uma pessoa. */
export function valoresDoCorpo(corpoRenderizado: string): Record<string, string> {
  const partes = corpoRenderizado.split(new RegExp(MARCA_DA_VAGA.source, "g"));
  const valores: Record<string, string> = {};
  // `split` com grupo devolve [antes, chave1, valor1, chave2, valor2, …].
  for (let i = 1; i < partes.length; i += 2) {
    const chave = partes[i];
    if (chave) valores[chave] = normalizarParametro(partes[i + 1] ?? "");
  }
  return valores;
}

// ─── Conferir o mapa contra o modelo ─────────────────────────────────────────

const MIDIA = new Set(["image", "video", "document"]);

function ehLinkPublico(valor: string): boolean {
  try {
    const u = new URL(valor);
    return u.protocol === "https:" && u.hostname.length > 0;
  } catch {
    return false;
  }
}

export type ConferenciaDoMapa =
  | { ok: true; mapa: Record<string, string> }
  | { ok: false; faltando: VagaDoModelo[]; linkInvalido: VagaDoModelo[] };

/**
 * Toda vaga do modelo precisa de valor. Vaga de mídia sem valor usa o link
 * salvo no modelo. Chave que o modelo não tem é descartada: ela não teria para
 * onde ir no envio.
 */
export function conferirMapa(
  vagas: readonly VagaDoModelo[],
  mapa: Record<string, string>,
  salvos: Record<string, string>,
): ConferenciaDoMapa {
  const limpo: Record<string, string> = {};
  const faltando: VagaDoModelo[] = [];
  const linkInvalido: VagaDoModelo[] = [];
  for (const vaga of vagas) {
    const midia = MIDIA.has(vaga.espera);
    const valor =
      (mapa[vaga.chave] ?? "").trim() || (midia ? (salvos[vaga.chave] ?? "").trim() : "");
    if (valor === "") {
      faltando.push(vaga);
      continue;
    }
    // Mídia fixa precisa ser um link que a plataforma baixe. Com variável, o
    // link vem do cadastro e só se sabe na preparação.
    if (midia && !valor.includes("{{") && !ehLinkPublico(valor)) {
      linkInvalido.push(vaga);
      continue;
    }
    limpo[vaga.chave] = valor;
  }
  if (faltando.length > 0 || linkInvalido.length > 0) return { ok: false, faltando, linkInvalido };
  return { ok: true, mapa: limpo };
}

// ─── A escolha na tela ───────────────────────────────────────────────────────

/** De onde sai o valor de uma vaga, como a tela pergunta. */
export const FONTES_DA_VAGA = [
  "primeiro_nome",
  "nome",
  "saudacao",
  "contato",
  "lead",
  "fixo",
] as const;
export type FonteDaVaga = (typeof FONTES_DA_VAGA)[number];

export interface OrigemDaVaga {
  fonte: FonteDaVaga;
  /** Nome do campo personalizado, para `contato` e `lead`. */
  campo: string;
  /** O texto (ou link) fixo, para `fixo`. */
  fixo: string;
}

/** O que a tela mostra ao lado de cada fonte. */
export const DESCRICAO_DA_FONTE: Record<FonteDaVaga, string> = {
  primeiro_nome: "Primeiro nome do contato",
  nome: "Nome completo do contato",
  saudacao: "Bom dia / Boa tarde / Boa noite, na hora do envio",
  contato: "Campo personalizado do contato",
  lead: "Campo personalizado do negócio",
  fixo: "Valor fixo, igual para todos",
};

const NOME_DE_CAMPO = /^[a-zA-Z0-9_]{1,60}$/;

/** A origem vira o texto da vaga, com as variáveis da campanha. */
export function valorDaOrigem(o: OrigemDaVaga): string {
  switch (o.fonte) {
    case "primeiro_nome":
    case "nome":
    case "saudacao":
      return `{{${o.fonte}}}`;
    case "contato":
    case "lead":
      return NOME_DE_CAMPO.test(o.campo.trim()) ? `{{${o.fonte}.${o.campo.trim()}}}` : "";
    case "fixo":
      return o.fixo;
  }
}

/** O texto gravado de uma vaga, lido de volta como origem (a tela de editar). */
export function origemDoValor(valor: string): OrigemDaVaga {
  const v = valor.trim();
  const simples = /^\{\{\s*(primeiro_nome|nome|saudacao)\s*\}\}$/i.exec(v);
  if (simples) {
    return { fonte: simples[1]!.toLowerCase() as FonteDaVaga, campo: "", fixo: "" };
  }
  const campo = /^\{\{\s*(contato|lead)\.([a-zA-Z0-9_]{1,60})\s*\}\}$/i.exec(v);
  if (campo) {
    return { fonte: campo[1]!.toLowerCase() as FonteDaVaga, campo: campo[2]!, fixo: "" };
  }
  return { fonte: "fixo", campo: "", fixo: valor };
}

/** O que a tela precisa de cada modelo da conexão (a resposta de `/campaigns/modelos`). */
export interface ModeloParaEscolha {
  name: string;
  language: string;
  category: string | null;
  previa: string;
  vagas: VagaDoModelo[];
  valores_salvos: Record<string, string>;
}

export interface EscolhaDeModelo {
  /** `nome|idioma` do modelo escolhido; vazio = nenhum. */
  chave: string;
  origens: Record<string, OrigemDaVaga>;
  /** O campo de envios por rodada, como digitado. Vazio = o padrão. */
  envios: string;
}

export const ESCOLHA_VAZIA: EscolhaDeModelo = { chave: "", origens: {}, envios: "" };

export function chaveDoModelo(m: { name: string; language: string }): string {
  return `${m.name}|${m.language}`;
}

/** A origem inicial de uma vaga: mídia começa no link salvo; texto, no primeiro nome. */
export function origemInicial(vaga: VagaDoModelo, salvos: Record<string, string>): OrigemDaVaga {
  if (MIDIA.has(vaga.espera)) return { fonte: "fixo", campo: "", fixo: salvos[vaga.chave] ?? "" };
  if (vaga.espera === "url_suffix" || vaga.espera === "coupon_code") {
    return { fonte: "fixo", campo: "", fixo: "" };
  }
  return { fonte: "primeiro_nome", campo: "", fixo: "" };
}

/** A escolha salva de uma campanha, para a tela de editar. */
export function escolhaDoModelo(m: ModeloDaCampanha | null | undefined): EscolhaDeModelo {
  if (!m) return ESCOLHA_VAZIA;
  return {
    chave: chaveDoModelo({ name: m.template_name, language: m.template_language }),
    origens: Object.fromEntries(
      Object.entries(m.variable_map).map(([chave, valor]) => [chave, origemDoValor(valor)]),
    ),
    envios: m.envios_por_rodada ? String(m.envios_por_rodada) : "",
  };
}

/**
 * O pedido que a tela manda, e a cópia para a prévia contar quem fica de fora.
 * `null` enquanto falta escolher o modelo, uma vaga ou um número válido.
 */
export function pedidoDaEscolha(
  escolha: EscolhaDeModelo,
  modelos: readonly ModeloParaEscolha[],
): { modelo: ModeloDaCampanha; corpo: string } | null {
  const definicao = modelos.find((m) => chaveDoModelo(m) === escolha.chave);
  if (!definicao) return null;
  const mapa: Record<string, string> = {};
  for (const vaga of definicao.vagas) {
    const origem = escolha.origens[vaga.chave] ?? origemInicial(vaga, definicao.valores_salvos);
    mapa[vaga.chave] = valorDaOrigem(origem);
  }
  const conferencia = conferirMapa(definicao.vagas, mapa, definicao.valores_salvos);
  if (!conferencia.ok) return null;
  const envios = escolha.envios.trim() === "" ? null : Number(escolha.envios);
  if (
    envios !== null &&
    (!Number.isInteger(envios) || envios < 1 || envios > ENVIOS_POR_RODADA_MAXIMO)
  ) {
    return null;
  }
  const modelo: ModeloDaCampanha = {
    template_name: definicao.name,
    template_language: definicao.language,
    variable_map: conferencia.mapa,
    envios_por_rodada: envios,
  };
  return {
    modelo,
    corpo: serializarModelo(
      modelo,
      definicao.vagas.map((v) => v.chave),
    ),
  };
}
