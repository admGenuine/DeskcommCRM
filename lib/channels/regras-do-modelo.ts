/**
 * AS REGRAS DA META PARA UM MODELO, conferidas antes de enviar (fork da
 * Genuine, 2026-11-13).
 *
 * A mesma função roda na tela (para travar o botão e dizer o que corrigir) e
 * no servidor (para não mandar à Meta o que ela vai recusar). Recebe o pedido
 * no formato da própria Meta (`components`), que é o que as três rotas de
 * modelo já trafegam, então serve ao canal oficial e aos intermediários.
 *
 * ═══ De onde vêm os números ═══
 *
 * Documentação oficial da Cloud API, lida em 2026-11-13:
 *   - `message-templates/components`: cabeçalho 60 caracteres e 1 variável;
 *     corpo 1.024; rodapé 60, só texto; botões até 10 no total, link até 2,
 *     ligação 1, resposta rápida até 10; texto do botão 25; link 2.000 com uma
 *     variável no final; telefone 20; respostas rápidas agrupadas, antes ou
 *     depois dos outros botões; exemplo obrigatório para toda variável.
 *   - `template-management`: nome só com minúsculas, números e `_`, até 512.
 *   - `authentication-templates`: texto fixo, aviso de segurança opcional,
 *     validade de 1 a 90 minutos, botão de copiar código.
 *
 * A regra de "variável no começo ou no fim do texto" NÃO está nessas páginas:
 * é recusa frequente na revisão, por isso entra como AVISO, que não trava.
 *
 * Puro e sem import: a tela importa este arquivo, e ele vai para o navegador.
 */

export const LIMITES_DO_MODELO = {
  nome: 512,
  cabecalho: 60,
  corpo: 1024,
  rodape: 60,
  botoes: 10,
  botoesDeLink: 2,
  botoesDeLigacao: 1,
  botoesDeResposta: 10,
  textoDoBotao: 25,
  link: 2000,
  telefone: 20,
  validadeMinima: 1,
  validadeMaxima: 90,
} as const;

export const CATEGORIAS_DO_MODELO = ["MARKETING", "UTILITY", "AUTHENTICATION"] as const;

export type CodigoDoProblema =
  | "nome_vazio"
  | "nome_formato"
  | "nome_longo"
  | "idioma_vazio"
  | "categoria_invalida"
  | "corpo_vazio"
  | "corpo_longo"
  | "variavel_formato"
  | "variavel_fora_de_ordem"
  | "exemplo_vazio"
  | "variavel_nas_pontas"
  | "cabecalho_longo"
  | "cabecalho_variaveis"
  | "cabecalho_exemplo_vazio"
  | "cabecalho_sem_imagem"
  | "rodape_longo"
  | "rodape_variavel"
  | "botoes_demais"
  | "botoes_link_demais"
  | "botoes_ligacao_demais"
  | "botoes_resposta_demais"
  | "botoes_misturados"
  | "botao_texto_vazio"
  | "botao_texto_longo"
  | "botao_link_invalido"
  | "botao_link_variavel"
  | "botao_link_exemplo_vazio"
  | "botao_telefone_invalido"
  | "autenticacao_formato"
  | "autenticacao_validade";

/** A frase de cada problema, em português (a tela traduz pela tabela). */
export const TEXTO_DO_PROBLEMA: Record<CodigoDoProblema, string> = {
  nome_vazio: "Dê um nome ao modelo.",
  nome_formato: "O nome aceita só letras minúsculas, números e _ (sem espaço, acento ou hífen).",
  nome_longo: "O nome passa de 512 caracteres.",
  idioma_vazio: "Escolha o idioma do modelo.",
  categoria_invalida: "Escolha a categoria: Marketing, Utilidade ou Autenticação.",
  corpo_vazio: "Escreva o texto da mensagem.",
  corpo_longo: "O texto da mensagem passa de 1.024 caracteres.",
  variavel_formato: "Use variáveis numeradas, como {{1}} e {{2}}.",
  variavel_fora_de_ordem: "As variáveis começam em {{1}} e seguem em ordem, sem pular número.",
  exemplo_vazio:
    "Preencha o exemplo de cada variável do texto. A Meta exige o exemplo para aprovar.",
  variavel_nas_pontas:
    "O texto começa ou termina com uma variável. A revisão costuma recusar: ponha uma palavra antes e depois.",
  cabecalho_longo: "O cabeçalho passa de 60 caracteres.",
  cabecalho_variaveis: "O cabeçalho aceita só uma variável, a {{1}}.",
  cabecalho_exemplo_vazio: "Preencha o exemplo da variável do cabeçalho.",
  cabecalho_sem_imagem: "Suba a imagem do cabeçalho.",
  rodape_longo: "O rodapé passa de 60 caracteres.",
  rodape_variavel: "O rodapé não aceita variável.",
  botoes_demais: "São no máximo 10 botões.",
  botoes_link_demais: "São no máximo 2 botões de link.",
  botoes_ligacao_demais: "É no máximo 1 botão de ligação.",
  botoes_resposta_demais: "São no máximo 10 botões de resposta rápida.",
  botoes_misturados:
    "Os botões de resposta rápida precisam ficar juntos, todos antes ou todos depois dos botões de link e de ligação.",
  botao_texto_vazio: "Escreva o texto de cada botão.",
  botao_texto_longo: "O texto de um botão passa de 25 caracteres.",
  botao_link_invalido:
    "O link de um botão precisa ser um endereço completo (https://…) de até 2.000 caracteres.",
  botao_link_variavel: "O link aceita só uma variável, a {{1}}, no final do endereço.",
  botao_link_exemplo_vazio: "Preencha o exemplo da variável do link.",
  botao_telefone_invalido:
    "O telefone de um botão precisa ter o código do país, como +5541999999999, com até 20 caracteres.",
  autenticacao_formato:
    "O modelo de autenticação tem o texto fixo da Meta e só o botão de copiar código: sem cabeçalho, texto próprio ou outros botões.",
  autenticacao_validade: "A validade do código vai de 1 a 90 minutos.",
};

/** Problemas que não travam o envio: regra que a documentação não confirma. */
const SO_AVISO = new Set<CodigoDoProblema>(["variavel_nas_pontas"]);

export interface ProblemaDoModelo {
  codigo: CodigoDoProblema;
  /** `true` = só aviso; o envio segue. */
  aviso: boolean;
}

export interface PedidoDeModelo {
  name: string;
  language: string;
  category: string;
  components: unknown[];
}

type Bruto = Record<string, unknown>;
const obj = (v: unknown): Bruto | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Bruto) : null;
const txt = (v: unknown): string => (typeof v === "string" ? v : "");

const VARIAVEL = /\{\{\s*([^}]*?)\s*\}\}/g;

/** Os nomes das variáveis do texto, na ordem em que aparecem. */
function variaveis(texto: string): string[] {
  return [...texto.matchAll(VARIAVEL)].map((m) => m[1] ?? "");
}

/** `true` quando as variáveis são `{{1}}..{{n}}`, sem buraco (repetir vale). */
function emOrdem(nomes: string[]): boolean {
  const numeros = new Set(nomes.map(Number));
  for (let i = 1; i <= numeros.size; i++) if (!numeros.has(i)) return false;
  return true;
}

/** As amostras de um `example`: array simples ou o primeiro de um array de arrays. */
function amostras(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const primeira = Array.isArray(v[0]) ? (v[0] as unknown[]) : v;
  return primeira.map((x) => txt(x));
}

function linkValido(url: string): boolean {
  if (!url || url.length > LIMITES_DO_MODELO.link) return false;
  try {
    const u = new URL(url.replace(VARIAVEL, "x"));
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function telefoneValido(numero: string): boolean {
  if (!numero || numero.length > LIMITES_DO_MODELO.telefone) return false;
  return /^\+\d{8,19}$/.test(numero.replace(/[\s().-]/g, ""));
}

/**
 * Tudo o que a Meta recusaria neste pedido, mais os avisos. Lista vazia =
 * pode enviar. A ordem segue a da tela, de cima para baixo.
 */
export function validarModelo(pedido: PedidoDeModelo): ProblemaDoModelo[] {
  const achados = new Set<CodigoDoProblema>();
  const nome = pedido.name.trim();
  if (!nome) achados.add("nome_vazio");
  else if (!/^[a-z0-9_]+$/.test(nome)) achados.add("nome_formato");
  if (nome.length > LIMITES_DO_MODELO.nome) achados.add("nome_longo");
  if (!pedido.language.trim()) achados.add("idioma_vazio");
  if (!(CATEGORIAS_DO_MODELO as readonly string[]).includes(pedido.category))
    achados.add("categoria_invalida");

  const partes = (pedido.components ?? []).map(obj).filter((c): c is Bruto => c !== null);
  const parte = (tipo: string) => partes.find((c) => txt(c.type).toUpperCase() === tipo) ?? null;
  const cabecalho = parte("HEADER");
  const corpo = parte("BODY");
  const rodape = parte("FOOTER");
  const botoes = (
    Array.isArray(parte("BUTTONS")?.buttons) ? (parte("BUTTONS")!.buttons as unknown[]) : []
  )
    .map(obj)
    .filter((b): b is Bruto => b !== null);

  if (pedido.category === "AUTHENTICATION") {
    validarAutenticacao({ cabecalho, corpo, rodape, botoes }, achados);
    return lista(achados);
  }

  // ─── Corpo ───
  const texto = txt(corpo?.text);
  if (!texto.trim()) achados.add("corpo_vazio");
  if (texto.length > LIMITES_DO_MODELO.corpo) achados.add("corpo_longo");
  const doCorpo = variaveis(texto);
  if (doCorpo.some((v) => !/^\d+$/.test(v))) achados.add("variavel_formato");
  else if (doCorpo.length > 0) {
    if (!emOrdem(doCorpo)) achados.add("variavel_fora_de_ordem");
    const n = new Set(doCorpo).size;
    const exemplos = amostras(obj(corpo?.example)?.body_text);
    if (exemplos.length < n || exemplos.slice(0, n).some((e) => !e.trim()))
      achados.add("exemplo_vazio");
    const limpo = texto.trim();
    if (/^\{\{[^}]*\}\}/.test(limpo) || /\{\{[^}]*\}\}[.!?…]?$/.test(limpo))
      achados.add("variavel_nas_pontas");
  }

  // ─── Cabeçalho ───
  if (cabecalho) {
    const formato = txt(cabecalho.format).toUpperCase() || "TEXT";
    if (formato === "TEXT") {
      const titulo = txt(cabecalho.text);
      if (titulo.length > LIMITES_DO_MODELO.cabecalho) achados.add("cabecalho_longo");
      const doTitulo = variaveis(titulo);
      if (doTitulo.length > 1 || doTitulo.some((v) => v !== "1"))
        achados.add("cabecalho_variaveis");
      else if (doTitulo.length === 1 && !amostras(obj(cabecalho.example)?.header_text)[0]?.trim()) {
        achados.add("cabecalho_exemplo_vazio");
      }
    } else if (!amostras(obj(cabecalho.example)?.header_handle)[0]?.trim()) {
      achados.add("cabecalho_sem_imagem");
    }
  }

  // ─── Rodapé ───
  const textoDoRodape = txt(rodape?.text);
  if (textoDoRodape.length > LIMITES_DO_MODELO.rodape) achados.add("rodape_longo");
  if (variaveis(textoDoRodape).length > 0) achados.add("rodape_variavel");

  // ─── Botões ───
  const tipos = botoes.map((b) => txt(b.type).toUpperCase());
  const conta = (t: string) => tipos.filter((x) => x === t).length;
  if (botoes.length > LIMITES_DO_MODELO.botoes) achados.add("botoes_demais");
  if (conta("URL") > LIMITES_DO_MODELO.botoesDeLink) achados.add("botoes_link_demais");
  if (conta("PHONE_NUMBER") > LIMITES_DO_MODELO.botoesDeLigacao)
    achados.add("botoes_ligacao_demais");
  if (conta("QUICK_REPLY") > LIMITES_DO_MODELO.botoesDeResposta)
    achados.add("botoes_resposta_demais");
  // Agrupamento: a sequência de "é resposta rápida?" muda de valor no máximo uma vez.
  const trocas = tipos
    .slice(1)
    .filter((t, i) => (t === "QUICK_REPLY") !== (tipos[i] === "QUICK_REPLY")).length;
  if (trocas > 1) achados.add("botoes_misturados");
  for (const b of botoes) {
    const rotulo = txt(b.text);
    if (!rotulo.trim()) achados.add("botao_texto_vazio");
    if (rotulo.length > LIMITES_DO_MODELO.textoDoBotao) achados.add("botao_texto_longo");
    const tipo = txt(b.type).toUpperCase();
    if (tipo === "URL") {
      const url = txt(b.url).trim();
      if (!linkValido(url)) achados.add("botao_link_invalido");
      const doLink = variaveis(url);
      if (
        doLink.length > 1 ||
        doLink.some((v) => v !== "1") ||
        (doLink.length === 1 && !/\{\{\s*1\s*\}\}$/.test(url))
      ) {
        achados.add("botao_link_variavel");
      } else if (doLink.length === 1 && !amostras(b.example)[0]?.trim()) {
        achados.add("botao_link_exemplo_vazio");
      }
    }
    if (tipo === "PHONE_NUMBER" && !telefoneValido(txt(b.phone_number).trim())) {
      achados.add("botao_telefone_invalido");
    }
  }
  return lista(achados);
}

function validarAutenticacao(
  p: { cabecalho: Bruto | null; corpo: Bruto | null; rodape: Bruto | null; botoes: Bruto[] },
  achados: Set<CodigoDoProblema>,
): void {
  const soCopiar =
    p.botoes.length === 1 &&
    txt(p.botoes[0]!.type).toUpperCase() === "OTP" &&
    txt(p.botoes[0]!.otp_type).toUpperCase() === "COPY_CODE";
  if (p.cabecalho || txt(p.corpo?.text) || !soCopiar) achados.add("autenticacao_formato");
  const rotulo = txt(p.botoes[0]?.text);
  if (rotulo.length > LIMITES_DO_MODELO.textoDoBotao) achados.add("botao_texto_longo");
  const validade = p.rodape?.code_expiration_minutes;
  if (
    validade !== undefined &&
    (typeof validade !== "number" ||
      !Number.isInteger(validade) ||
      validade < LIMITES_DO_MODELO.validadeMinima ||
      validade > LIMITES_DO_MODELO.validadeMaxima)
  ) {
    achados.add("autenticacao_validade");
  }
}

function lista(achados: Set<CodigoDoProblema>): ProblemaDoModelo[] {
  return [...achados].map((codigo) => ({ codigo, aviso: SO_AVISO.has(codigo) }));
}

/** `true` quando algum problema trava o envio (aviso não trava). */
export function travaOEnvio(problemas: readonly ProblemaDoModelo[]): boolean {
  return problemas.some((p) => !p.aviso);
}

// ─── Autenticação: o formato fixo da Meta ───────────────────────────────────

export interface OpcoesDeAutenticacao {
  /** A linha "Para sua segurança, não compartilhe este código." */
  avisoDeSeguranca: boolean;
  /** Minutos de validade mostrados no rodapé; `null` = sem rodapé. */
  validadeMinutos: number | null;
  /** O texto do botão de copiar; vazio = o padrão da Meta. */
  textoDoBotao: string;
}

/** Os `components` de um modelo de autenticação: texto fixo, rodapé de validade, botão de copiar. */
export function montarAutenticacao(o: OpcoesDeAutenticacao): unknown[] {
  const components: unknown[] = [{ type: "BODY", add_security_recommendation: o.avisoDeSeguranca }];
  if (o.validadeMinutos !== null)
    components.push({ type: "FOOTER", code_expiration_minutes: o.validadeMinutos });
  const botao: Bruto = { type: "OTP", otp_type: "COPY_CODE" };
  if (o.textoDoBotao.trim()) botao.text = o.textoDoBotao.trim();
  components.push({ type: "BUTTONS", buttons: [botao] });
  return components;
}

/** O caminho de volta, para editar partindo do que a Meta aprovou. */
export function lerAutenticacao(components: unknown): OpcoesDeAutenticacao {
  const partes = (Array.isArray(components) ? components : [])
    .map(obj)
    .filter((c): c is Bruto => c !== null);
  const parte = (tipo: string) => partes.find((c) => txt(c.type).toUpperCase() === tipo) ?? null;
  const validade = parte("FOOTER")?.code_expiration_minutes;
  const botao = obj((parte("BUTTONS")?.buttons as unknown[] | undefined)?.[0]);
  return {
    avisoDeSeguranca: parte("BODY")?.add_security_recommendation === true,
    validadeMinutos: typeof validade === "number" ? validade : null,
    textoDoBotao: txt(botao?.text),
  };
}

/** O texto que o cliente vê num modelo de autenticação, para a prévia (a Meta traduz por idioma). */
export function textoDaAutenticacao(o: OpcoesDeAutenticacao): { corpo: string; rodape: string } {
  return {
    corpo: `{{1}} é seu código de verificação.${o.avisoDeSeguranca ? " Para sua segurança, não o compartilhe." : ""}`,
    rodape: o.validadeMinutos !== null ? `Este código expira em ${o.validadeMinutos} minutos.` : "",
  };
}

// ─── O que a Meta deixa fazer com um modelo existente ───────────────────────

/**
 * Editar: só aprovado, recusado ou pausado (página `template-management`).
 * A outra página da Meta diz "aprovado ou recusado"; vale a mais detalhada, e
 * se a Meta recusar a de um pausado, a resposta dela chega à tela.
 */
export function podeEditar(status: string | null | undefined): boolean {
  return ["APPROVED", "REJECTED", "PAUSED"].includes((status ?? "").toUpperCase());
}

/** Apagar: a Meta não apaga modelo desativado, e o que já está sendo apagado não volta. */
export function podeApagar(status: string | null | undefined): boolean {
  return !["DISABLED", "PENDING_DELETION", "DELETED"].includes((status ?? "").toUpperCase());
}

/** A categoria de um modelo aprovado não muda; a de um recusado, sim. */
export function podeTrocarCategoria(status: string | null | undefined): boolean {
  return (status ?? "").toUpperCase() === "REJECTED";
}

/** O status da Meta em português, para a lista. */
export const ROTULO_DO_STATUS: Record<string, string> = {
  APPROVED: "Aprovado",
  PENDING: "Pendente",
  REJECTED: "Recusado",
  PAUSED: "Pausado",
  DISABLED: "Desativado",
  IN_APPEAL: "Em recurso",
  PENDING_DELETION: "Sendo apagado",
  DELETED: "Apagado",
  ARCHIVED: "Arquivado",
  LIMIT_EXCEEDED: "Limite excedido",
  REINSTATED: "Reativado",
};

/** O nome da categoria em português. */
export const ROTULO_DA_CATEGORIA_DO_MODELO: Record<string, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utilidade",
  AUTHENTICATION: "Autenticação",
};

/**
 * Os `components` com os botões COMO A PESSOA OS DIGITOU. O montador da tela
 * (`montarComponents`) descarta botão sem texto ou sem endereço, para não
 * mandar à Meta o que ela recusa; para conferir, o botão descartado precisa
 * aparecer, senão ele some sem aviso.
 */
export function comBotoesDoFormulario(
  components: unknown[],
  botoes: readonly {
    tipo: string;
    texto: string;
    url?: string;
    telefone?: string;
    exemplo?: string;
  }[],
): unknown[] {
  const semBotoes = components.filter((c) => txt(obj(c)?.type).toUpperCase() !== "BUTTONS");
  if (botoes.length === 0) return semBotoes;
  const brutos = botoes.map((b) => {
    const base: Bruto = { type: b.tipo.toUpperCase(), text: b.texto };
    if (b.tipo === "url") {
      base.url = (b.url ?? "").trim();
      if (variaveis(base.url as string).length > 0) base.example = [(b.exemplo ?? "").trim()];
    }
    if (b.tipo === "phone_number") base.phone_number = (b.telefone ?? "").trim();
    return base;
  });
  return [...semBotoes, { type: "BUTTONS", buttons: brutos }];
}
