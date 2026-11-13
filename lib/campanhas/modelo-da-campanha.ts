/**
 * CAMPANHA COM MODELO APROVADO (fork da Genuine, 2026-11-12; vários modelos
 * em rodízio, com proporção, em 2026-11-13).
 *
 * Na API oficial do WhatsApp, e nos parceiros que a intermediam, a plataforma
 * só entrega texto livre a quem escreveu nas últimas 24 horas; para todo o
 * resto, só modelo aprovado. A campanha do original sabia mandar só texto. Este
 * módulo deixa a campanha mandar um modelo, mudando o mínimo no código do
 * original (que este repositório acompanha como fork).
 *
 * ═══ A escolha mora numa tabela do fork; o texto da campanha leva uma cópia ═══
 *
 * A fonte da verdade é `campaign_message_templates` (migrations 9006 e 9007):
 * a lista de modelos, de onde sai cada variável de cada um, o peso de cada um
 * na proporção e quantos envios a rodada faz por vez. Qual modelo saiu para
 * cada pessoa fica em `campaign_recipient_templates` (9007). A campanha
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
import { logger } from "@/lib/logger";
import {
  conexaoExigeModelo,
  modeloDaConexao,
  textoDoModelo,
  type ModeloDaConexao,
  type VagaDoModelo,
} from "@/lib/channels/modelos-da-conexao";
import { avisarSobreModelo, modeloEnviavel } from "@/lib/channels/avisos-de-modelo";

import {
  ENVIOS_POR_RODADA_MAXIMO,
  ENVIOS_POR_RODADA_PADRAO,
  MENSAGEM_CATEGORIAS_MISTURADAS,
  ROTULO_DA_CATEGORIA,
  categoriasMisturadas,
  conferirMapa,
  ehCorpoDeModelo,
  modeloDaCampanhaSchema,
  serializarModelo,
  valoresDoModelo,
  type ItemDoModelo,
  type ModeloDaCampanha,
} from "./corpo-do-modelo";
import { escolherModelo } from "./rodizio-de-modelos";

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
 * extras do rodízio e a lista de modelos pedida (ou nenhuma).
 *
 *  - Número que exige modelo, sem modelo: recusa, com a mensagem que explica.
 *  - Modelo num número que manda texto livre: recusa (o envio não teria como sair).
 *  - Modelo que não está aprovado neste número, ou em algum número do rodízio:
 *    recusa, nomeando qual.
 *  - Lista que mistura categorias: recusa.
 *  - Vaga sem valor ou link inválido: recusa, nomeando o modelo e as vagas.
 *
 * Devolve a lista limpa e a cópia para `message_body`, ou `null` quando a
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

  const extras = entrada.extras.filter((e) => e !== entrada.canalPrincipal);
  for (const extra of extras) {
    if (!(await conexaoExigeModelo(admin, entrada.organizationId, extra))) {
      return recusa(
        "Um dos números do rodízio manda texto livre e não usa modelos aprovados. Tire esse número da campanha.",
      );
    }
  }

  const itens: ItemDoModelo[] = [];
  const ordens: string[][] = [];
  const categorias: (string | null)[] = [];
  for (const pedido of entrada.modelo.itens) {
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
    if (!modeloEnviavel(definicao.status)) {
      return recusa(
        `O modelo "${pedido.template_name}" está com o status ${definicao.status} na plataforma. Só modelo aprovado pode ir para a campanha.`,
      );
    }

    // Cada número do rodízio fala com a pessoa pela própria conta: o modelo tem
    // de estar aprovado em todos, senão a parte da lista que cair nele falha.
    for (const extra of extras) {
      const noExtra = await modeloDaConexao(admin, {
        organizationId: entrada.organizationId,
        channelSessionId: extra,
        name: pedido.template_name,
        language: pedido.template_language,
      });
      if (!noExtra || !modeloEnviavel(noExtra.status)) {
        return recusa(
          `Um dos números do rodízio não tem o modelo "${pedido.template_name}" aprovado. Tire esse número da campanha ou aprove o modelo na conta dele.`,
        );
      }
    }

    const conferencia = conferirMapa(definicao.vagas, pedido.variable_map, definicao.valoresSalvos);
    if (!conferencia.ok) {
      const partes: string[] = [];
      if (conferencia.faltando.length > 0) {
        partes.push(
          `No modelo "${pedido.template_name}", falta dizer de onde sai: ${listaDeVagas(conferencia.faltando)}.`,
        );
      }
      if (conferencia.linkInvalido.length > 0) {
        partes.push(
          `No modelo "${pedido.template_name}", estas vagas de mídia precisam de um link que comece com https://: ${listaDeVagas(conferencia.linkInvalido)}.`,
        );
      }
      return recusa(partes.join(" "));
    }

    itens.push({
      template_name: definicao.name,
      template_language: definicao.language,
      variable_map: conferencia.mapa,
      peso: pedido.peso ?? 1,
    });
    ordens.push(definicao.vagas.map((v) => v.chave));
    categorias.push(definicao.category);
  }

  const misturadas = categoriasMisturadas(categorias);
  if (misturadas) {
    const nomes = misturadas.map((c) => ROTULO_DA_CATEGORIA[c] ?? c).join(" e ");
    return recusa(`${MENSAGEM_CATEGORIAS_MISTURADAS} Hoje a lista mistura ${nomes}.`);
  }

  const modelo: ModeloDaCampanha = {
    itens,
    envios_por_rodada: entrada.modelo.envios_por_rodada ?? null,
  };
  return { ok: true, modelo, corpo: serializarModelo(modelo, ordens) };
}

// ─── Persistência ────────────────────────────────────────────────────────────

/**
 * Uma linha por modelo da lista (migration 9007), na ordem de `posicao`.
 * `envios_por_rodada` é da campanha inteira: grava-se igual em todas as linhas
 * e lê-se o da primeira.
 */
const TABELA = "campaign_message_templates";
const COLUNAS =
  "campaign_id, posicao, peso, template_name, template_language, variable_map, envios_por_rodada";

interface LinhaDoModelo {
  campaign_id: string;
  posicao: number | null;
  peso: number | null;
  template_name: string;
  template_language: string;
  variable_map: unknown;
  envios_por_rodada: number | null;
}

function mapaDaLinha(valor: unknown): Record<string, string> {
  return valor && typeof valor === "object" && !Array.isArray(valor)
    ? Object.fromEntries(
        Object.entries(valor as Record<string, unknown>).filter(
          (e): e is [string, string] => typeof e[1] === "string",
        ),
      )
    : {};
}

function paraModelo(linhas: readonly LinhaDoModelo[]): ModeloDaCampanha | null {
  if (linhas.length === 0) return null;
  const ordenadas = [...linhas].sort((a, b) => (a.posicao ?? 0) - (b.posicao ?? 0));
  return {
    itens: ordenadas.map((l) => ({
      template_name: l.template_name,
      template_language: l.template_language,
      variable_map: mapaDaLinha(l.variable_map),
      peso: l.peso ?? 1,
    })),
    envios_por_rodada: ordenadas[0]!.envios_por_rodada,
  };
}

/** A lista de modelos desta campanha, ou `null` (campanha de texto). Lança se a leitura falhar. */
export async function lerModeloDaCampanha(
  admin: SupabaseClient,
  organizationId: string,
  campanhaId: string,
): Promise<ModeloDaCampanha | null> {
  const { data, error } = await admin
    .from(TABELA)
    .select(COLUNAS)
    .eq("organization_id", organizationId)
    .eq("campaign_id", campanhaId);
  if (error) throw new Error(`modelo da campanha: leitura — ${error.message}`);
  return paraModelo((data ?? []) as unknown as LinhaDoModelo[]);
}

/** As listas de várias campanhas, numa consulta (a rodada lê as que estão rodando). */
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
  const porCampanha = new Map<string, LinhaDoModelo[]>();
  for (const l of (data ?? []) as unknown as LinhaDoModelo[]) {
    porCampanha.set(l.campaign_id, [...(porCampanha.get(l.campaign_id) ?? []), l]);
  }
  const resultado = new Map<string, ModeloDaCampanha>();
  for (const [id, linhas] of porCampanha) {
    const modelo = paraModelo(linhas);
    if (modelo) resultado.set(id, modelo);
  }
  return resultado;
}

export async function gravarModeloDaCampanha(
  admin: SupabaseClient,
  entrada: { organizationId: string; campanhaId: string; modelo: ModeloDaCampanha },
): Promise<void> {
  const agora = new Date().toISOString();
  const { error } = await admin.from(TABELA).upsert(
    entrada.modelo.itens.map((item, posicao) => ({
      campaign_id: entrada.campanhaId,
      organization_id: entrada.organizationId,
      posicao,
      peso: item.peso ?? 1,
      template_name: item.template_name,
      template_language: item.template_language,
      variable_map: item.variable_map,
      envios_por_rodada: entrada.modelo.envios_por_rodada ?? null,
      updated_at: agora,
    })),
    { onConflict: "campaign_id,posicao" },
  );
  if (error) throw new Error(`modelo da campanha: gravação — ${error.message}`);
  // A lista encolheu: as posições que sobraram saem.
  const { error: erroDaSobra } = await admin
    .from(TABELA)
    .delete()
    .eq("organization_id", entrada.organizationId)
    .eq("campaign_id", entrada.campanhaId)
    .gte("posicao", entrada.modelo.itens.length);
  if (erroDaSobra) throw new Error(`modelo da campanha: gravação — ${erroDaSobra.message}`);
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

/** Onde o envio acontece: a conexão escolhida e, no envio real, a campanha e a pessoa. */
export interface ConexaoDoEnvio {
  organizationId: string;
  channelSessionId: string;
  /** No envio real: o modelo usado fica registrado para o relatório e o rodízio. */
  campanhaId?: string;
  destinatarioId?: string;
}

/** Cada modelo da lista, como está na plataforma para este número agora. */
export async function situacaoDosModelos(
  admin: SupabaseClient,
  conexao: { organizationId: string; channelSessionId: string },
  modelo: ModeloDaCampanha,
): Promise<(ModeloDaConexao | null)[]> {
  const definicoes: (ModeloDaConexao | null)[] = [];
  for (const item of modelo.itens) {
    definicoes.push(
      await modeloDaConexao(admin, {
        organizationId: conexao.organizationId,
        channelSessionId: conexao.channelSessionId,
        name: item.template_name,
        language: item.template_language,
      }),
    );
  }
  return definicoes;
}

/** Quantos envios desta campanha já usaram cada modelo da lista, na ordem da lista. */
async function enviosPorModelo(
  admin: SupabaseClient,
  organizationId: string,
  campanhaId: string,
  modelo: ModeloDaCampanha,
): Promise<number[]> {
  const contagens: number[] = [];
  for (const item of modelo.itens) {
    const { count, error } = await admin
      .from(TABELA_DO_REGISTRO)
      .select("recipient_id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("campaign_id", campanhaId)
      .eq("template_name", item.template_name)
      .eq("template_language", item.template_language);
    if (error) throw new Error(`modelo da campanha: contagem — ${error.message}`);
    contagens.push(count ?? 0);
  }
  return contagens;
}

/** Onde fica registrado qual modelo saiu para cada pessoa (migration 9007). */
const TABELA_DO_REGISTRO = "campaign_recipient_templates";

/**
 * O conteúdo do envio de uma pessoa. Sem modelo, é o texto de sempre. Com
 * modelo, o rodízio (`rodizio-de-modelos.ts`) escolhe qual sai, os valores
 * daquele modelo saem da cópia já renderizada, e o `body` é o texto do modelo
 * com eles aplicados: é o que a conversa mostra, e o envio de modelo exige um
 * `body`. No envio real, o modelo usado fica registrado ANTES de sair: uma
 * falha depois também conta para ele no relatório.
 *
 * `posicaoFixa` é para o envio de teste, que manda um modelo escolhido.
 *
 * Lança quando nenhum modelo da lista está aprovado neste número, ou quando o
 * escolhido saiu do espelho: o chamador já trata exceção de envio como falha
 * do destinatário.
 */
export async function conteudoDoEnvio(
  admin: SupabaseClient,
  conexao: ConexaoDoEnvio,
  corpoRenderizado: string,
  modelo: ModeloDaCampanha | null,
  posicaoFixa?: number,
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

  const definicoes = await situacaoDosModelos(admin, conexao, modelo);
  let posicao: number | null;
  if (posicaoFixa !== undefined) {
    posicao = posicaoFixa;
  } else if (modelo.itens.length === 1) {
    // Um modelo só: sem rodízio nem contagem, como na etapa anterior.
    posicao = modeloEnviavel(definicoes[0]?.status) ? 0 : null;
  } else {
    const enviados =
      conexao.campanhaId !== undefined
        ? await enviosPorModelo(admin, conexao.organizationId, conexao.campanhaId, modelo)
        : modelo.itens.map(() => 0);
    posicao = escolherModelo(
      modelo.itens.map((item, i) => ({
        posicao: i,
        peso: item.peso ?? 1,
        enviados: enviados[i] ?? 0,
        aprovado: modeloEnviavel(definicoes[i]?.status),
      })),
    );
  }
  const item = posicao === null ? undefined : modelo.itens[posicao];
  const definicao = posicao === null ? null : definicoes[posicao];
  if (posicao === null || !item) {
    throw new Error("modelos_nao_aprovados: nenhum modelo da lista está aprovado neste número");
  }
  if (!definicao) {
    throw new Error(
      `template_missing: ${item.template_name} (${item.template_language}) não está no espelho desta conexão`,
    );
  }

  if (conexao.campanhaId && conexao.destinatarioId) {
    const { error } = await admin.from(TABELA_DO_REGISTRO).upsert(
      {
        recipient_id: conexao.destinatarioId,
        campaign_id: conexao.campanhaId,
        organization_id: conexao.organizationId,
        template_name: item.template_name,
        template_language: item.template_language,
      },
      { onConflict: "recipient_id" },
    );
    // Sem o registro o relatório e a proporção perdem um envio, mas a mensagem
    // não deixa de ser certa: o aviso fica no log e o envio segue.
    if (error) {
      logger.warn("[campanha] registro do modelo usado falhou", {
        campanha: conexao.campanhaId,
        motivo: error.message,
      });
    }
  }

  const valores = valoresDoModelo(corpoRenderizado, posicao);
  return {
    type: "template",
    body: textoDoModelo(definicao, valores) || `${item.template_name}`,
    template_name: item.template_name,
    template_language: item.template_language,
    template_values: valores,
  };
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
 * Antes de enviar: algum modelo da lista ainda está aprovado no número
 * principal? Modelo pausado ou desativado pela plataforma (o webhook de status
 * grava no espelho) é pulado pelo rodízio, e o disparo segue com os outros. Só
 * quando NENHUM está aprovado a campanha PAUSA, com o motivo, em vez de marcar
 * como falha cada pessoa que restava. Quem opera troca o modelo ou espera a
 * plataforma liberar, e retoma.
 *
 * Devolve o detalhe da rodada quando pausou, `null` quando pode seguir.
 */
export async function pausarSeOModeloSaiu(
  admin: SupabaseClient,
  campanha: { id: string; organization_id: string; channel_session_id: string; name?: string },
  modelo: ModeloDaCampanha,
  agora: Date,
): Promise<string | null> {
  const definicoes = await situacaoDosModelos(
    admin,
    { organizationId: campanha.organization_id, channelSessionId: campanha.channel_session_id },
    modelo,
  );
  if (definicoes.some((d) => modeloEnviavel(d?.status))) return null;

  const um = modelo.itens.length === 1;
  const situacao = definicoes[0]?.status ?? "fora da lista";
  const primeiro = modelo.itens[0]!;
  const volta =
    "A campanha volta sozinha quando um modelo da lista voltar a ficar aprovado, ou você pode trocar os modelos e retomar.";
  const detalhe = um
    ? `O modelo "${primeiro.template_name}" (${primeiro.template_language}) está ${situacao} na plataforma. ${volta}`
    : `Nenhum dos ${modelo.itens.length} modelos da campanha está aprovado na plataforma agora. ${volta}`;
  const { data: pausada } = await admin
    .from("campaigns")
    .update({
      status: "paused",
      paused_at: agora.toISOString(),
      failure_code: (um ? `${PAUSA_POR_MODELO}:${situacao}` : PAUSA_POR_MODELOS).slice(0, 120),
      failure_detail: detalhe,
    })
    .eq("id", campanha.id)
    .eq("organization_id", campanha.organization_id)
    .eq("status", "running")
    .select("id");
  // Quem pausou avisa, uma vez: a próxima rodada já não pega a campanha pausada.
  if ((pausada ?? []).length > 0) {
    await avisarSobreModelo(admin, campanha.organization_id, {
      severity: "critical",
      title: `Campanha "${campanha.name ?? campanha.id.slice(0, 8)}" pausada: nenhum modelo aprovado`,
      body: detalhe,
    });
  }
  return um ? `pausada:modelo_${situacao}` : "pausada:modelos_nao_aprovados";
}

/** O código de pausa que o sistema grava; só a campanha pausada com ele volta sozinha. */
export const PAUSA_POR_MODELO = "modelo_nao_aprovado";
export const PAUSA_POR_MODELOS = "modelos_nao_aprovados";

/** A campanha foi pausada pelo sistema por falta de modelo (e não por uma pessoa)? */
export function pausadaPorFaltaDeModelo(failureCode: string | null | undefined): boolean {
  const c = failureCode ?? "";
  return c === PAUSA_POR_MODELOS || c.startsWith(`${PAUSA_POR_MODELO}:`);
}

// ─── O teste e a cópia da campanha ───────────────────────────────────────────

/**
 * Os conteúdos do envio de TESTE: um por modelo da lista, para quem opera ver
 * cada um como a pessoa vai receber. Todos precisam estar aprovados; sem esta
 * conferência, um modelo pausado viraria "o envio de teste falhou no canal",
 * sem dizer que o problema é o modelo. Campanha de texto: um conteúdo, o texto.
 */
export async function conteudoDoTeste(
  admin: SupabaseClient,
  campanha: { id: string; organization_id: string; channel_session_id: string },
  textoRenderizado: string,
): Promise<{ ok: true; conteudos: ConteudoDoEnvio[] } | Recusa> {
  const modelo = await lerModeloDaCampanha(admin, campanha.organization_id, campanha.id);
  const conexao = {
    organizationId: campanha.organization_id,
    channelSessionId: campanha.channel_session_id,
  };
  try {
    if (!modelo) {
      return {
        ok: true,
        conteudos: [await conteudoDoEnvio(admin, conexao, textoRenderizado, null)],
      };
    }
    const definicoes = await situacaoDosModelos(admin, conexao, modelo);
    const fora = modelo.itens.findIndex((_, i) => !modeloEnviavel(definicoes[i]?.status));
    if (fora >= 0) {
      return recusa(
        `O modelo "${modelo.itens[fora]!.template_name}" está ${definicoes[fora]?.status ?? "fora da lista desta conexão"} na plataforma. Troque o modelo antes de testar.`,
      );
    }
    const conteudos: ConteudoDoEnvio[] = [];
    for (let i = 0; i < modelo.itens.length; i++) {
      conteudos.push(await conteudoDoEnvio(admin, conexao, textoRenderizado, modelo, i));
    }
    return { ok: true, conteudos };
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
