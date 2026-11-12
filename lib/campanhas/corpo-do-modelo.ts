/**
 * A PARTE PURA da campanha com modelo aprovado (fork da Genuine, 2026-11-12;
 * lista de modelos em rodízio em 2026-11-13): o pedido, a cópia que vai para o
 * texto da campanha, a leitura dos valores de volta e a conferência do mapa
 * contra as vagas de cada modelo. Sem banco e sem rede, para a tela e o servidor
 * usarem a MESMA regra. O porquê do desenho está no cabeçalho de
 * `modelo-da-campanha.ts`; a escolha de qual modelo sai em cada envio, em
 * `rodizio-de-modelos.ts`.
 */
import { z } from "zod";

import type { VagaDoModelo } from "@/lib/channels/modelos-da-conexao";

/** Envios por rodada de um minuto, quando a campanha não escolheu. */
export const ENVIOS_POR_RODADA_PADRAO = 10;
/** O teto: a rodada tem um prazo, e 60 envios em sequência já o ocupam. */
export const ENVIOS_POR_RODADA_MAXIMO = 60;
/** Quantos modelos uma campanha alterna. */
export const MODELOS_POR_CAMPANHA_MAXIMO = 5;
/** O peso de cada modelo na proporção: 2 no A e 1 no B = dois do A para cada um do B. */
export const PESO_MAXIMO = 10;

/** A chave de uma vaga (`slotKey`): "1", "nome_cliente", "header:1", "button0:1", "card0:1". */
const CHAVE_DA_VAGA = /^[A-Za-z0-9_:]{1,80}$/;

export const itemDoModeloSchema = z.object({
  template_name: z.string().trim().min(1).max(512),
  template_language: z.string().trim().min(2).max(16),
  variable_map: z
    .record(z.string().regex(CHAVE_DA_VAGA), z.string().max(1000))
    .refine((m) => Object.keys(m).length <= 50, { message: "Modelo com vagas demais." }),
  peso: z.number().int().min(1).max(PESO_MAXIMO).default(1),
});

export type ItemDoModelo = z.infer<typeof itemDoModeloSchema>;

export const modeloDaCampanhaSchema = z.object({
  itens: z
    .array(itemDoModeloSchema)
    .min(1)
    .max(MODELOS_POR_CAMPANHA_MAXIMO)
    .refine(
      (itens) =>
        new Set(
          itens.map((i) => chaveDoModelo({ name: i.template_name, language: i.template_language })),
        ).size === itens.length,
      { message: "O mesmo modelo aparece duas vezes na lista." },
    ),
  envios_por_rodada: z.number().int().min(1).max(ENVIOS_POR_RODADA_MAXIMO).nullable().optional(),
});

/** Os modelos da campanha, na ordem da lista, e os envios por rodada da campanha inteira. */
export type ModeloDaCampanha = z.infer<typeof modeloDaCampanhaSchema>;

export function chaveDoModelo(m: { name: string; language: string }): string {
  return `${m.name}|${m.language}`;
}

// ─── A cópia no texto da campanha ────────────────────────────────────────────

/** A primeira linha da cópia. Só informa quem lê o texto; não é lida de volta. */
export const CABECALHO_DO_CORPO = "Modelo aprovado:";
/**
 * Abre cada vaga. O INVISIBLE SEPARATOR (U+2063) antes do colchete é o que
 * separa a marca de um texto que alguém tenha cadastrado com colchetes: um
 * campo do contato não traz esse caractere por acaso.
 */
const ABRE = "⁣⟦";
const FECHA = "⟧";
/**
 * A chave dentro da marca. O primeiro modelo da lista usa a chave da vaga pura
 * ("1", "header:1"), que é o formato da etapa de um modelo só: as campanhas já
 * preparadas com ele continuam sendo lidas. Do segundo em diante, a chave leva
 * a posição na frente ("m1.1", "m2.header:1"); o ponto não aparece em chave de
 * vaga, então não há colisão.
 */
const MARCA_DA_VAGA = new RegExp(`${ABRE}([A-Za-z0-9_:.]{1,90})${FECHA}`);
const PREFIXO_DA_POSICAO = /^m(\d+)\.(.+)$/;

export function chaveNoCorpo(posicao: number, chave: string): string {
  return posicao === 0 ? chave : `m${posicao}.${chave}`;
}

/**
 * A cópia derivada dos mapas, que vai para `campaigns.message_body`. `ordens`
 * traz, por posição, a ordem das vagas de cada modelo (só para a cópia ficar
 * legível na ordem do texto).
 */
export function serializarModelo(
  m: {
    itens: readonly Pick<ItemDoModelo, "template_name" | "template_language" | "variable_map">[];
  },
  ordens?: readonly (readonly string[] | undefined)[],
): string {
  const nomes = m.itens.map((i) => `${i.template_name} (${i.template_language})`).join(" · ");
  const linhas = [`${CABECALHO_DO_CORPO} ${nomes}`];
  m.itens.forEach((item, posicao) => {
    const chaves = Object.keys(item.variable_map);
    const ordem = ordens?.[posicao];
    const ordenadas = ordem
      ? [...ordem.filter((c) => chaves.includes(c)), ...chaves.filter((c) => !ordem.includes(c))]
      : [...chaves].sort();
    for (const chave of ordenadas) {
      // Quebra de linha no valor fixo viraria espaço no envio de qualquer jeito
      // (a plataforma recusa parâmetro com quebra); tirar aqui deixa a cópia legível.
      const valor = (item.variable_map[chave] ?? "").replace(/[\r\n]+/g, " ");
      linhas.push(`${ABRE}${chaveNoCorpo(posicao, chave)}${FECHA}${valor}`);
    }
  });
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

/** Todas as vagas da cópia já renderizada para uma pessoa, com a chave do corpo. */
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

/** Os valores de UM modelo da lista, com a chave da vaga que o envio usa. */
export function valoresDoModelo(corpoRenderizado: string, posicao: number): Record<string, string> {
  const valores: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(valoresDoCorpo(corpoRenderizado))) {
    const prefixo = PREFIXO_DA_POSICAO.exec(chave);
    const daPosicao = prefixo ? Number(prefixo[1]) : 0;
    if (daPosicao === posicao) valores[prefixo ? prefixo[2]! : chave] = valor;
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

// ─── Categoria ───────────────────────────────────────────────────────────────

/** O rótulo da categoria que a plataforma dá ao modelo, como a tela mostra. */
export const ROTULO_DA_CATEGORIA: Record<string, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utilidade",
  AUTHENTICATION: "Autenticação",
};

/**
 * A lista de uma campanha é de UMA categoria só. A plataforma cobra cada
 * categoria por um preço, e misturar categorias numa mesma lista de envio
 * abriria caminho para alternar mensagens de natureza diferente sob o mesmo
 * disparo. Devolve as categorias distintas quando há mais de uma.
 */
export function categoriasMisturadas(
  categorias: readonly (string | null | undefined)[],
): string[] | null {
  const distintas = [...new Set(categorias.map((c) => (c ?? "").toUpperCase()))];
  return distintas.length > 1 ? distintas : null;
}

export const MENSAGEM_CATEGORIAS_MISTURADAS =
  "Todos os modelos da lista precisam ser da mesma categoria.";

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

/** Um modelo da lista, como a tela o guarda enquanto a pessoa edita. */
export interface ItemDaEscolha {
  /** `nome|idioma` do modelo escolhido; vazio = nenhum ainda. */
  chave: string;
  origens: Record<string, OrigemDaVaga>;
  /** O peso como digitado. Vazio = 1. */
  peso: string;
}

export interface EscolhaDeModelo {
  itens: ItemDaEscolha[];
  /** O campo de envios por rodada, como digitado. Vazio = o padrão. */
  envios: string;
}

export const ITEM_VAZIO: ItemDaEscolha = { chave: "", origens: {}, peso: "" };
export const ESCOLHA_VAZIA: EscolhaDeModelo = { itens: [ITEM_VAZIO], envios: "" };

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
  if (!m || m.itens.length === 0) return ESCOLHA_VAZIA;
  return {
    itens: m.itens.map((item) => ({
      chave: chaveDoModelo({ name: item.template_name, language: item.template_language }),
      origens: Object.fromEntries(
        Object.entries(item.variable_map).map(([chave, valor]) => [chave, origemDoValor(valor)]),
      ),
      peso: item.peso > 1 ? String(item.peso) : "",
    })),
    envios: m.envios_por_rodada ? String(m.envios_por_rodada) : "",
  };
}

function numeroOuNulo(texto: string, minimo: number, maximo: number): number | null | false {
  if (texto.trim() === "") return null;
  const n = Number(texto);
  return Number.isInteger(n) && n >= minimo && n <= maximo ? n : false;
}

/** O que ainda impede salvar a lista. A tela escreve a frase de cada um. */
export type ProblemaDaEscolha = "sem_modelo" | "repetido" | "categorias" | "peso" | "envios";

/**
 * O que ainda impede salvar a lista, ou `null` quando ela está completa. Vaga
 * sem valor não entra aqui: a tela já mostra a vaga vazia.
 */
export function problemaDaEscolha(
  escolha: EscolhaDeModelo,
  modelos: readonly ModeloParaEscolha[],
): ProblemaDaEscolha | null {
  const definicoes = escolha.itens.map((i) => modelos.find((m) => chaveDoModelo(m) === i.chave));
  if (definicoes.some((d) => !d)) return "sem_modelo";
  const chaves = escolha.itens.map((i) => i.chave);
  if (new Set(chaves).size !== chaves.length) return "repetido";
  if (categoriasMisturadas(definicoes.map((d) => d!.category))) return "categorias";
  if (escolha.itens.some((i) => numeroOuNulo(i.peso, 1, PESO_MAXIMO) === false)) return "peso";
  if (numeroOuNulo(escolha.envios, 1, ENVIOS_POR_RODADA_MAXIMO) === false) return "envios";
  return null;
}

/**
 * O pedido que a tela manda, e a cópia para a prévia contar quem fica de fora.
 * `null` enquanto falta escolher um modelo, preencher uma vaga ou corrigir um
 * número, ou quando a lista mistura categorias.
 */
export function pedidoDaEscolha(
  escolha: EscolhaDeModelo,
  modelos: readonly ModeloParaEscolha[],
): { modelo: ModeloDaCampanha; corpo: string } | null {
  if (escolha.itens.length === 0 || problemaDaEscolha(escolha, modelos)) return null;
  const itens: ItemDoModelo[] = [];
  const ordens: string[][] = [];
  for (const item of escolha.itens) {
    const definicao = modelos.find((m) => chaveDoModelo(m) === item.chave)!;
    const mapa: Record<string, string> = {};
    for (const vaga of definicao.vagas) {
      const origem = item.origens[vaga.chave] ?? origemInicial(vaga, definicao.valores_salvos);
      mapa[vaga.chave] = valorDaOrigem(origem);
    }
    const conferencia = conferirMapa(definicao.vagas, mapa, definicao.valores_salvos);
    if (!conferencia.ok) return null;
    itens.push({
      template_name: definicao.name,
      template_language: definicao.language,
      variable_map: conferencia.mapa,
      peso: (numeroOuNulo(item.peso, 1, PESO_MAXIMO) as number | null) ?? 1,
    });
    ordens.push(definicao.vagas.map((v) => v.chave));
  }
  const envios = numeroOuNulo(escolha.envios, 1, ENVIOS_POR_RODADA_MAXIMO) as number | null;
  const modelo: ModeloDaCampanha = { itens, envios_por_rodada: envios };
  return { modelo, corpo: serializarModelo(modelo, ordens) };
}
