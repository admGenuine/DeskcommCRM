/**
 * CAMPANHA COM MODELO APROVADO (fork da Genuine, 2026-11-12).
 *
 * Na API oficial do WhatsApp, e nos parceiros que a intermediam, a plataforma
 * só entrega texto livre a quem escreveu nas últimas 24 horas; para todo o
 * resto, só modelo aprovado. A campanha do original sabia mandar só texto. Este
 * módulo deixa a campanha mandar um modelo, mudando o mínimo no código do
 * original (que este repositório acompanha como fork).
 *
 * ═══ A escolha mora numa tabela do fork; o texto da campanha leva uma cópia ═══
 *
 * A fonte da verdade é `campaign_message_templates` (migration 9006): o modelo,
 * de onde sai cada variável e quantos envios a rodada faz por vez. A campanha
 * do original congela o texto de cada pessoa na PREPARAÇÃO, confere ali quem
 * não tem o dado que a mensagem usa (motivo `variavel_ausente`) e resolve a
 * saudação no ENVIO. Para reusar tudo isso sem mexer na preparação, o texto da
 * campanha (`campaigns.message_body`) recebe uma cópia derivada do mapa
 * (`serializarModelo`): uma linha por vaga, com as mesmas variáveis da campanha.
 * A preparação renderiza a cópia como renderizaria um texto; o envio lê de volta
 * os valores de cada vaga (`valoresDoCorpo`). Quem grava a cópia é sempre o
 * servidor, na mesma requisição que grava a escolha.
 *
 * ═══ O que cada vaga aceita ═══
 *
 * O mesmo vocabulário da campanha de texto (`renderizador.ts`): `{{nome}}`,
 * `{{primeiro_nome}}`, `{{saudacao}}`, `{{lead.campo}}`, `{{contato.campo}}`, ou
 * um valor fixo. Vaga de mídia (imagem, vídeo, documento do cabeçalho) aceita o
 * link salvo no modelo pela tela de modelos, ou um link `https://` fixo.
 *
 * ═══ O que NÃO muda ═══
 *
 * Os vetos por pessoa (pedido de saída, recusa de marketing, anonimização,
 * contato pessoal, lista de exclusão) rodam antes de cada envio, no código do
 * original, com ou sem modelo. Campanha sem linha na tabela é campanha de texto,
 * exatamente como era.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { ApiErrorCode } from "@/lib/api/errors";
import {
  MODELO_APROVADO,
  conexaoExigeModelo,
  modeloDaConexao,
  textoDoModelo,
  type ModeloDaConexao,
  type VagaDoModelo,
} from "@/lib/channels/modelos-da-conexao";

import {
  ENVIOS_POR_RODADA_MAXIMO,
  ENVIOS_POR_RODADA_PADRAO,
  conferirMapa,
  ehCorpoDeModelo,
  modeloDaCampanhaSchema,
  serializarModelo,
  valoresDoCorpo,
  type ModeloDaCampanha,
} from "./corpo-do-modelo";

export * from "./corpo-do-modelo";

// ─── A decisão das rotas de criar e editar ───────────────────────────────────

export type Recusa = { ok: false; codigo: ApiErrorCode; mensagem: string; status: number };

export const MENSAGEM_EXIGE_MODELO =
  "Esta conexão é a API oficial do WhatsApp, que só entrega modelos aprovados a quem não escreveu nas últimas 24 horas. Escolha um modelo aprovado para a campanha.";

function recusa(mensagem: string, status = 422): Recusa {
  return { ok: false, codigo: "campanha_conteudo_invalido", mensagem, status };
}

function listaDeVagas(vagas: readonly VagaDoModelo[]): string {
  return vagas.map((v) => `${v.onde} {{${v.chave.split(":").pop()}}}`).join(", ");
}

/**
 * O conteúdo que a campanha pode gravar, dados o número principal, os números
 * extras do rodízio e o modelo pedido (ou nenhum).
 *
 *  - Número que exige modelo, sem modelo: recusa, com a mensagem que explica.
 *  - Modelo num número que manda texto livre: recusa (o envio não teria como sair).
 *  - Modelo que não está aprovado neste número, ou em algum número do rodízio:
 *    recusa, nomeando qual.
 *  - Vaga sem valor ou link inválido: recusa, nomeando as vagas.
 *
 * Devolve a escolha limpa e a cópia para `message_body`, ou `null` quando a
 * campanha é de texto e nada aqui se aplica.
 */
export async function decidirConteudo(
  admin: SupabaseClient,
  entrada: {
    organizationId: string;
    canalPrincipal: string;
    extras: readonly string[];
    modelo: ModeloDaCampanha | null;
  },
): Promise<
  { ok: true; modelo: ModeloDaCampanha; corpo: string } | { ok: true; modelo: null } | Recusa
> {
  const exige = await conexaoExigeModelo(admin, entrada.organizationId, entrada.canalPrincipal);
  if (exige === null) {
    return recusa("Escolha uma conexão de WhatsApp desta organização.", 409);
  }
  if (!entrada.modelo) {
    return exige ? recusa(MENSAGEM_EXIGE_MODELO) : { ok: true, modelo: null };
  }
  if (!exige) {
    return recusa(
      "Esta conexão manda texto livre e não usa modelos aprovados. Escreva a mensagem da campanha.",
    );
  }

  const pedido = entrada.modelo;
  const definicao = await modeloDaConexao(admin, {
    organizationId: entrada.organizationId,
    channelSessionId: entrada.canalPrincipal,
    name: pedido.template_name,
    language: pedido.template_language,
  });
  if (!definicao) {
    return recusa(
      `O modelo "${pedido.template_name}" (${pedido.template_language}) não está na lista desta conexão. Sincronize os modelos e tente de novo.`,
    );
  }
  if (definicao.status !== MODELO_APROVADO) {
    return recusa(
      `O modelo "${pedido.template_name}" está com o status ${definicao.status} na plataforma. Só modelo aprovado pode ir para a campanha.`,
    );
  }

  // Cada número do rodízio fala com a pessoa pela própria conta: o modelo tem de
  // estar aprovado em todos, senão a parte da lista que cair nele falha.
  for (const extra of entrada.extras) {
    if (extra === entrada.canalPrincipal) continue;
    const exigeNoExtra = await conexaoExigeModelo(admin, entrada.organizationId, extra);
    const noExtra = exigeNoExtra
      ? await modeloDaConexao(admin, {
          organizationId: entrada.organizationId,
          channelSessionId: extra,
          name: pedido.template_name,
          language: pedido.template_language,
        })
      : null;
    if (!noExtra || noExtra.status !== MODELO_APROVADO) {
      return recusa(
        `Um dos números do rodízio não tem o modelo "${pedido.template_name}" aprovado. Tire esse número da campanha ou aprove o modelo na conta dele.`,
      );
    }
  }

  const conferencia = conferirMapa(definicao.vagas, pedido.variable_map, definicao.valoresSalvos);
  if (!conferencia.ok) {
    const partes: string[] = [];
    if (conferencia.faltando.length > 0) {
      partes.push(`Falta dizer de onde sai: ${listaDeVagas(conferencia.faltando)}.`);
    }
    if (conferencia.linkInvalido.length > 0) {
      partes.push(
        `Estas vagas de mídia precisam de um link que comece com https://: ${listaDeVagas(conferencia.linkInvalido)}.`,
      );
    }
    return recusa(partes.join(" "));
  }

  const modelo: ModeloDaCampanha = {
    template_name: definicao.name,
    template_language: definicao.language,
    variable_map: conferencia.mapa,
    envios_por_rodada: pedido.envios_por_rodada ?? null,
  };
  return {
    ok: true,
    modelo,
    corpo: serializarModelo(
      modelo,
      definicao.vagas.map((v) => v.chave),
    ),
  };
}

// ─── Persistência ────────────────────────────────────────────────────────────

const TABELA = "campaign_message_templates";
const COLUNAS = "campaign_id, template_name, template_language, variable_map, envios_por_rodada";

interface LinhaDoModelo {
  campaign_id: string;
  template_name: string;
  template_language: string;
  variable_map: unknown;
  envios_por_rodada: number | null;
}

function paraModelo(l: LinhaDoModelo): ModeloDaCampanha {
  const mapa =
    l.variable_map && typeof l.variable_map === "object" && !Array.isArray(l.variable_map)
      ? Object.fromEntries(
          Object.entries(l.variable_map as Record<string, unknown>).filter(
            (e): e is [string, string] => typeof e[1] === "string",
          ),
        )
      : {};
  return {
    template_name: l.template_name,
    template_language: l.template_language,
    variable_map: mapa,
    envios_por_rodada: l.envios_por_rodada,
  };
}

/** O modelo desta campanha, ou `null` (campanha de texto). Lança se a leitura falhar. */
export async function lerModeloDaCampanha(
  admin: SupabaseClient,
  organizationId: string,
  campanhaId: string,
): Promise<ModeloDaCampanha | null> {
  const { data, error } = await admin
    .from(TABELA)
    .select(COLUNAS)
    .eq("organization_id", organizationId)
    .eq("campaign_id", campanhaId)
    .maybeSingle();
  if (error) throw new Error(`modelo da campanha: leitura — ${error.message}`);
  return data ? paraModelo(data as unknown as LinhaDoModelo) : null;
}

/** Os modelos de várias campanhas, numa consulta (a rodada lê as que estão rodando). */
export async function lerModelosDasCampanhas(
  admin: SupabaseClient,
  campanhaIds: readonly string[],
): Promise<Map<string, ModeloDaCampanha>> {
  if (campanhaIds.length === 0) return new Map();
  const { data, error } = await admin
    .from(TABELA)
    .select(COLUNAS)
    .in("campaign_id", [...campanhaIds]);
  if (error) throw new Error(`modelo da campanha: leitura — ${error.message}`);
  return new Map(
    ((data ?? []) as unknown as LinhaDoModelo[]).map((l) => [l.campaign_id, paraModelo(l)]),
  );
}

export async function gravarModeloDaCampanha(
  admin: SupabaseClient,
  entrada: { organizationId: string; campanhaId: string; modelo: ModeloDaCampanha },
): Promise<void> {
  const { error } = await admin.from(TABELA).upsert(
    {
      campaign_id: entrada.campanhaId,
      organization_id: entrada.organizationId,
      template_name: entrada.modelo.template_name,
      template_language: entrada.modelo.template_language,
      variable_map: entrada.modelo.variable_map,
      envios_por_rodada: entrada.modelo.envios_por_rodada ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "campaign_id" },
  );
  if (error) throw new Error(`modelo da campanha: gravação — ${error.message}`);
}

export async function apagarModeloDaCampanha(
  admin: SupabaseClient,
  organizationId: string,
  campanhaId: string,
): Promise<void> {
  const { error } = await admin
    .from(TABELA)
    .delete()
    .eq("organization_id", organizationId)
    .eq("campaign_id", campanhaId);
  if (error) throw new Error(`modelo da campanha: remoção — ${error.message}`);
}

// ─── O envio ─────────────────────────────────────────────────────────────────

/** O pedaço do corpo de `sendMessageHandler` que muda entre texto e modelo. */
export type ConteudoDoEnvio =
  | { type: "text"; body: string }
  | {
      type: "template";
      body: string;
      template_name: string;
      template_language: string;
      template_values: Record<string, string>;
    };

/**
 * O conteúdo do envio de uma pessoa. Sem modelo, é o texto de sempre. Com
 * modelo, os valores saem da cópia já renderizada, e o `body` é o texto do
 * modelo com eles aplicados: é o que a conversa mostra, e o envio de modelo
 * exige um `body`.
 *
 * Lança quando o modelo não está mais no espelho desta conexão: o chamador já
 * trata exceção de envio como falha do destinatário.
 */
export async function conteudoDoEnvio(
  admin: SupabaseClient,
  conexao: { organizationId: string; channelSessionId: string },
  corpoRenderizado: string,
  modelo: ModeloDaCampanha | null,
): Promise<ConteudoDoEnvio> {
  if (!modelo) {
    // Cópia de modelo sem a escolha ao lado (uma linha apagada à mão, uma
    // duplicação antiga): mandar a cópia como texto seria mandar as marcas
    // para a pessoa. Falha fechada, e o destinatário fica com o motivo.
    if (ehCorpoDeModelo(corpoRenderizado)) {
      throw new Error(
        "modelo_ausente: a campanha guarda um modelo, mas a escolha dele não foi encontrada",
      );
    }
    return { type: "text", body: corpoRenderizado };
  }
  const definicao = await modeloDaConexao(admin, {
    organizationId: conexao.organizationId,
    channelSessionId: conexao.channelSessionId,
    name: modelo.template_name,
    language: modelo.template_language,
  });
  if (!definicao) {
    throw new Error(
      `template_missing: ${modelo.template_name} (${modelo.template_language}) não está no espelho desta conexão`,
    );
  }
  const valores = valoresDoCorpo(corpoRenderizado);
  return {
    type: "template",
    body: textoDoModelo(definicao, valores) || `${modelo.template_name}`,
    template_name: modelo.template_name,
    template_language: modelo.template_language,
    template_values: valores,
  };
}

/**
 * O modelo ainda pode sair por este número? Lido do espelho, que o webhook de
 * status da plataforma atualiza quando ela pausa ou desativa o modelo.
 */
export async function statusDoModeloNaConexao(
  admin: SupabaseClient,
  conexao: { organizationId: string; channelSessionId: string },
  modelo: ModeloDaCampanha,
): Promise<{ aprovado: boolean; status: string | null }> {
  const definicao: ModeloDaConexao | null = await modeloDaConexao(admin, {
    organizationId: conexao.organizationId,
    channelSessionId: conexao.channelSessionId,
    name: modelo.template_name,
    language: modelo.template_language,
  });
  return { aprovado: definicao?.status === MODELO_APROVADO, status: definicao?.status ?? null };
}

/** Quantos envios esta campanha faz numa rodada. Campanha de texto: um, como sempre. */
export function enviosPorRodada(modelo: ModeloDaCampanha | null): number {
  if (!modelo) return 1;
  return Math.min(
    ENVIOS_POR_RODADA_MAXIMO,
    Math.max(1, modelo.envios_por_rodada ?? ENVIOS_POR_RODADA_PADRAO),
  );
}

// ─── A rodada ────────────────────────────────────────────────────────────────

/**
 * Quanto a rodada pode durar com envios repetidos. O agendador chama a rodada a
 * cada minuto com 45 segundos de limite (`docker/scheduler/entrypoint.sh`); parar
 * aos 30 deixa folga para a última chamada à plataforma terminar.
 */
export const PRAZO_DA_RODADA_MS = 30_000;

interface ResultadoDeUmaVez {
  enviadas: number;
  pulados: number;
  concluidas: number;
  detalhe: string;
}

/**
 * Repete `umaVez` até `vezes` envios. Para quando a vez não enviou nem pulou
 * ninguém (ritmo, teto, número ocupado, fila vazia), quando a campanha concluiu
 * ou quando o prazo da rodada acabou. Cada vez passa de novo por todos os vetos
 * da campanha e do número: repetir não pula checagem nenhuma.
 *
 * Pular alguém (pedido de saída, lista de exclusão) não gasta um envio, mas
 * gasta uma tentativa: o teto de tentativas é o dobro dos envios, para uma fila
 * cheia de excluídos não prender a rodada.
 */
export async function repetirNaRodada<R extends ResultadoDeUmaVez>(
  vezes: number,
  prazoEsgotado: () => boolean,
  umaVez: () => Promise<R>,
): Promise<ResultadoDeUmaVez> {
  const total: ResultadoDeUmaVez = { enviadas: 0, pulados: 0, concluidas: 0, detalhe: "" };
  let tentativas = 0;
  let ultimo = "";
  while (tentativas < vezes * 2) {
    tentativas++;
    const r = await umaVez();
    total.enviadas += r.enviadas;
    total.pulados += r.pulados;
    total.concluidas += r.concluidas;
    ultimo = r.detalhe;
    if (r.concluidas > 0 || (r.enviadas === 0 && r.pulados === 0)) break;
    if (total.enviadas >= vezes || prazoEsgotado()) break;
  }
  total.detalhe = tentativas > 1 ? `x${tentativas}:${ultimo}` : ultimo;
  return total;
}

/**
 * Antes de enviar: o modelo ainda está aprovado no número principal? Se a
 * plataforma o pausou ou desativou (o webhook de status grava no espelho), a
 * campanha PAUSA com o motivo, em vez de marcar como falha cada pessoa que
 * restava. Quem opera troca o modelo ou espera a plataforma liberar, e retoma.
 *
 * Devolve o detalhe da rodada quando pausou, `null` quando pode seguir.
 */
export async function pausarSeOModeloSaiu(
  admin: SupabaseClient,
  campanha: { id: string; organization_id: string; channel_session_id: string },
  modelo: ModeloDaCampanha,
  agora: Date,
): Promise<string | null> {
  const { aprovado, status } = await statusDoModeloNaConexao(
    admin,
    { organizationId: campanha.organization_id, channelSessionId: campanha.channel_session_id },
    modelo,
  );
  if (aprovado) return null;
  const situacao = status ?? "fora da lista";
  await admin
    .from("campaigns")
    .update({
      status: "paused",
      paused_at: agora.toISOString(),
      failure_code: `modelo_nao_aprovado:${situacao}`.slice(0, 120),
      failure_detail: `O modelo "${modelo.template_name}" (${modelo.template_language}) está ${situacao} na plataforma. Troque o modelo ou espere a liberação e retome a campanha.`,
    })
    .eq("id", campanha.id)
    .eq("organization_id", campanha.organization_id)
    .eq("status", "running");
  return `pausada:modelo_${situacao}`;
}

// ─── O teste e a cópia da campanha ───────────────────────────────────────────

/**
 * O conteúdo do envio de TESTE: o mesmo do envio real, com uma conferência a
 * mais na frente. Sem ela, um modelo pausado viraria "o envio de teste falhou
 * no canal", sem dizer que o problema é o modelo.
 */
export async function conteudoDoTeste(
  admin: SupabaseClient,
  campanha: { id: string; organization_id: string; channel_session_id: string },
  textoRenderizado: string,
): Promise<{ ok: true; conteudo: ConteudoDoEnvio } | Recusa> {
  const modelo = await lerModeloDaCampanha(admin, campanha.organization_id, campanha.id);
  const conexao = {
    organizationId: campanha.organization_id,
    channelSessionId: campanha.channel_session_id,
  };
  if (modelo) {
    const { aprovado, status } = await statusDoModeloNaConexao(admin, conexao, modelo);
    if (!aprovado) {
      return recusa(
        `O modelo "${modelo.template_name}" está ${status ?? "fora da lista desta conexão"} na plataforma. Troque o modelo antes de testar.`,
      );
    }
  }
  try {
    return { ok: true, conteudo: await conteudoDoEnvio(admin, conexao, textoRenderizado, modelo) };
  } catch (err) {
    return recusa(err instanceof Error ? err.message : String(err));
  }
}

/**
 * A cópia da campanha leva o modelo junto. Sem isso a cópia teria o texto
 * derivado sem a escolha, e o envio dela falharia fechado (`modelo_ausente`).
 * Devolve `false` quando a cópia do modelo falhou: quem chama desfaz a campanha.
 */
export async function copiarModeloDaCampanha(
  admin: SupabaseClient,
  organizationId: string,
  de: string,
  para: string,
): Promise<boolean> {
  try {
    const modelo = await lerModeloDaCampanha(admin, organizationId, de);
    if (modelo) await gravarModeloDaCampanha(admin, { organizationId, campanhaId: para, modelo });
    return true;
  } catch {
    return false;
  }
}

// ─── O pedido das rotas ──────────────────────────────────────────────────────

/**
 * O campo `modelo` do corpo do pedido. Fica fora de `criarCampanhaSchema` (do
 * original) de propósito: o schema descarta o que não conhece, e a rota lê este
 * campo à parte. `undefined` = o pedido não falou do modelo; `null` = tirar.
 */
export function lerModeloDoPedido(
  corpo: unknown,
): { ok: true; modelo: ModeloDaCampanha | null | undefined } | Recusa {
  if (!corpo || typeof corpo !== "object" || !("modelo" in corpo)) {
    return { ok: true, modelo: undefined };
  }
  const bruto = (corpo as { modelo: unknown }).modelo;
  if (bruto === null) return { ok: true, modelo: null };
  const r = modeloDaCampanhaSchema.safeParse(bruto);
  if (!r.success) {
    return recusa("O modelo escolhido veio incompleto: confira o modelo e as variáveis.");
  }
  return { ok: true, modelo: r.data };
}

export interface EfeitoDaEdicao {
  /** O novo `message_body`, quando a escolha do modelo o muda. */
  messageBody?: string;
  gravar?: ModeloDaCampanha;
  apagar?: boolean;
}

/**
 * A edição de uma campanha que pode ter (ou passar a ter) modelo. Só confere
 * quando o pedido mexe no número, nos números do rodízio, no texto ou no
 * modelo: ajuste só de ritmo passa direto, como no original.
 */
export async function decidirConteudoDaEdicao(
  admin: SupabaseClient,
  entrada: {
    organizationId: string;
    campanhaId: string;
    canalAtual: string;
    corpoAtual: string | null;
    canalPedido?: string;
    extrasPedidos?: readonly string[];
    corpoPedido?: string | null;
    modeloPedido: ModeloDaCampanha | null | undefined;
    lerExtras: () => Promise<string[]>;
  },
): Promise<{ ok: true; efeito: EfeitoDaEdicao } | Recusa> {
  const mexe =
    entrada.modeloPedido !== undefined ||
    entrada.canalPedido !== undefined ||
    entrada.extrasPedidos !== undefined ||
    entrada.corpoPedido !== undefined;
  if (!mexe) return { ok: true, efeito: {} };

  const atual = await lerModeloDaCampanha(admin, entrada.organizationId, entrada.campanhaId);
  const modelo = entrada.modeloPedido === undefined ? atual : entrada.modeloPedido;
  const decisao = await decidirConteudo(admin, {
    organizationId: entrada.organizationId,
    canalPrincipal: entrada.canalPedido ?? entrada.canalAtual,
    extras: entrada.extrasPedidos ?? (await entrada.lerExtras()),
    modelo,
  });
  if (!decisao.ok) return decisao;

  if (decisao.modelo) {
    return { ok: true, efeito: { messageBody: decisao.corpo, gravar: decisao.modelo } };
  }
  // Voltou a ser campanha de texto: o texto tem de ser texto, não a cópia do modelo.
  const corpo = entrada.corpoPedido === undefined ? entrada.corpoAtual : entrada.corpoPedido;
  // Rascunho de texto sem texto continua permitido, como no original; o que não
  // pode é sobrar a cópia do modelo, ou ficar vazio quem acabou de tirar o modelo.
  if (ehCorpoDeModelo(corpo) || (atual !== null && (corpo ?? "").trim() === "")) {
    return recusa("Escreva a mensagem da campanha: ela deixou de usar modelo aprovado.");
  }
  return { ok: true, efeito: atual ? { apagar: true } : {} };
}
