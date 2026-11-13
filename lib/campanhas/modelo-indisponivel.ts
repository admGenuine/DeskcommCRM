/**
 * MODELO INDISPONÍVEL NO MEIO DO DISPARO (fork da Genuine, 2026-11-13).
 *
 * O rodízio (`rodizio-de-modelos.ts`) já só escolhe modelo aprovado no espelho.
 * Mas o espelho pode estar atrasado: a Meta pausa o modelo e o aviso de status
 * chega depois do envio, ou não chega. Aí ela RECUSA o envio:
 *
 *   - 132015: "Template is paused due to low quality so it cannot be sent";
 *   - 132016: pausado vezes demais, desativado de vez;
 *   - 132001: o modelo não existe no idioma pedido ou não está aprovado.
 *
 * (Textos da página oficial de códigos de erro da Cloud API, lida em
 * 2026-11-13. A Meta não diz se a recusa vem na resposta do envio ou depois,
 * pelo webhook; os dois caminhos são tratados.)
 *
 * Nesse caso a pessoa não recebeu nada (a Meta diz que envio recusado por pausa
 * não é entregue nem cobrado). Ela volta à fila, o modelo é marcado no espelho
 * e a próxima tentativa sai com outro modelo da lista.
 *
 * ═══ Nunca a mesma campanha duas vezes ═══
 *
 * Só volta quem: (1) está `failed`; (2) falhou com um desses três códigos; (3)
 * não tem NENHUM carimbo de entrega, leitura ou resposta. A volta é um
 * compare-and-set que repete as três condições no `where`, e a nova tentativa é
 * uma mensagem nova (a rodada gera outro id por envio), nunca a antiga
 * reenviada. A mensagem recusada deixa de apontar para a pessoa
 * (`message_id = null`), para um aviso atrasado sobre ela não mexer na pessoa
 * que já voltou à fila.
 *
 * ═══ Teto ═══
 *
 * Três voltas por pessoa (`TENTATIVAS_POR_INDISPONIBILIDADE`). Na quarta, ela
 * fica como falha, com o motivo: uma lista inteira de modelos recusados não
 * pode prender a pessoa em volta sem fim.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  avisarSobreModelo,
  marcarModeloIndisponivel,
  modeloEnviavel,
} from "@/lib/channels/avisos-de-modelo";

import {
  PAUSA_POR_MODELOS,
  lerModeloDaCampanha,
  pausadaPorFaltaDeModelo,
  pausarSeOModeloSaiu,
  situacaoDosModelos,
  type ModeloDaCampanha,
} from "./modelo-da-campanha";

export const TENTATIVAS_POR_INDISPONIBILIDADE = 3;

/** O código da Meta que diz que o MODELO não pode sair, e o status que ele ganha no espelho. */
const CODIGOS: Record<string, "PAUSED" | "DISABLED" | null> = {
  "132015": "PAUSED",
  "132016": "DISABLED",
  // Não existe no idioma (apagado na Meta) ou não está aprovado. Até
  // 2026-11-13 o espelho ficava como estava até a sincronização (10 min), e
  // nesse intervalo o rodízio mandava outras pessoas para o mesmo modelo, cada
  // recusa gastando uma das 3 voltas delas. Agora ele sai do rodízio na hora,
  // como o pausado; se o modelo existir e estiver aprovado, a sincronização
  // seguinte o devolve.
  "132001": "DISABLED",
};

const PADRAO = /(?:^|[^0-9])(132015|132016|132001)(?:[^0-9]|$)/;

/**
 * O código de modelo indisponível, se o erro for um deles. Olha o código e o
 * texto: no aviso posterior o número vem no código ("132015"); na resposta do
 * envio, vem no texto ("meta_132015: …"), e o código é genérico.
 */
export function codigoDeModeloIndisponivel(
  codigo: string | null | undefined,
  texto: string | null | undefined,
): string | null {
  return PADRAO.exec(codigo ?? "")?.[1] ?? PADRAO.exec(texto ?? "")?.[1] ?? null;
}

const ESGOTADO = "modelo_indisponivel_esgotado";
const DEVOLVIDO = "modelo_indisponivel";

/** Os códigos com que o contato chega aqui: o do aviso posterior, ou o genérico do envio. */
const CODIGOS_DE_ENTRADA = ["132015", "132016", "132001", "send_failed", "send_exception"];

interface Falha {
  id: string;
  message_id: string | null;
  channel_session_id: string | null;
  last_error_code: string | null;
  last_error_detail: string | null;
}

/**
 * Devolve à fila quem a Meta recusou por modelo indisponível nesta campanha.
 * Roda a cada rodada, antes de enviar.
 */
export async function devolverRecusadosPorModelo(
  admin: SupabaseClient,
  campanha: { id: string; organization_id: string; channel_session_id: string },
  agora: Date,
): Promise<{ devolvidos: number; esgotados: number }> {
  const resultado = { devolvidos: 0, esgotados: 0 };
  const { data, error } = await admin
    .from("campaign_recipients")
    .select("id, message_id, channel_session_id, last_error_code, last_error_detail")
    .eq("organization_id", campanha.organization_id)
    .eq("campaign_id", campanha.id)
    .eq("status", "failed")
    .is("delivered_at", null)
    .is("read_at", null)
    .is("replied_at", null)
    .in("last_error_code", CODIGOS_DE_ENTRADA)
    .limit(200);
  if (error || !data || data.length === 0) return resultado;
  const falhas = data as unknown as Falha[];

  // O texto do erro mora na mensagem (o envio grava lá; a pessoa só leva o código genérico).
  const idsDeMensagem = falhas.map((f) => f.message_id).filter((id): id is string => !!id);
  const erroDaMensagem = new Map<
    string,
    { error_code: string | null; error_message: string | null }
  >();
  if (idsDeMensagem.length > 0) {
    const { data: mensagens } = await admin
      .from("messages")
      .select("id, error_code, error_message")
      .eq("organization_id", campanha.organization_id)
      .in("id", idsDeMensagem);
    for (const m of (mensagens ?? []) as Array<{
      id: string;
      error_code: string | null;
      error_message: string | null;
    }>) {
      erroDaMensagem.set(m.id, m);
    }
  }

  // A lista inteira saiu entre a checagem da rodada e o envio (o modelo foi
  // conferido no número principal e o envio saiu por outro): a pessoa não
  // recebeu nada e não tem culpa. Volta à fila sem gastar tentativa; a rodada
  // seguinte pausa a campanha.
  for (const f of falhas) {
    if (
      f.last_error_code !== "send_exception" ||
      !(f.last_error_detail ?? "").startsWith(PAUSA_POR_MODELOS)
    )
      continue;
    const { data: voltou } = await admin
      .from("campaign_recipients")
      .update({
        status: "pending",
        sending_at: null,
        last_error_code: null,
        last_error_detail: null,
      })
      .eq("id", f.id)
      .eq("status", "failed")
      .eq("last_error_code", "send_exception")
      .is("message_id", null)
      .select("id");
    resultado.devolvidos += (voltou ?? []).length;
  }

  const recusadas = falhas
    .map((f) => {
      const m = f.message_id ? erroDaMensagem.get(f.message_id) : undefined;
      // A mensagem da tentativa ATUAL vem primeiro. O texto da pessoa só vale
      // quando a exceção acabou de gravá-lo: nos outros casos ele pode ser a
      // explicação de uma volta anterior, com o código do modelo ANTERIOR.
      const codigo =
        codigoDeModeloIndisponivel(m?.error_code, m?.error_message) ??
        codigoDeModeloIndisponivel(
          f.last_error_code,
          f.last_error_code === "send_exception" ? f.last_error_detail : null,
        );
      return codigo ? { ...f, codigo } : null;
    })
    .filter((f): f is Falha & { codigo: string } => f !== null);
  if (recusadas.length === 0) return resultado;

  const { data: registros } = await admin
    .from("campaign_recipient_templates")
    .select("recipient_id, template_name, template_language, tentativas_indisponivel")
    .eq("organization_id", campanha.organization_id)
    .in(
      "recipient_id",
      recusadas.map((r) => r.id),
    );
  const registroDe = new Map(
    (
      (registros ?? []) as Array<{
        recipient_id: string;
        template_name: string;
        template_language: string;
        tentativas_indisponivel: number | null;
      }>
    ).map((r) => [r.recipient_id, r]),
  );

  for (const falha of recusadas) {
    const registro = registroDe.get(falha.id);
    // Sem registro do modelo, não há como saber qual pular: fica a falha como estava.
    if (!registro) continue;
    const tentativas = registro.tentativas_indisponivel ?? 0;
    const modeloRecusado = `"${registro.template_name}" (${registro.template_language})`;

    if (tentativas >= TENTATIVAS_POR_INDISPONIBILIDADE) {
      await admin
        .from("campaign_recipients")
        .update({
          last_error_code: ESGOTADO,
          last_error_detail: `A plataforma recusou ${TENTATIVAS_POR_INDISPONIBILIDADE + 1} modelos para esta pessoa (o último, ${modeloRecusado}, com o erro ${falha.codigo}). Ela fica de fora desta campanha.`,
        })
        .eq("id", falha.id)
        .eq("status", "failed");
      resultado.esgotados++;
      continue;
    }

    const { data: voltou } = await admin
      .from("campaign_recipients")
      .update({
        status: "pending",
        next_attempt_at: null,
        sending_at: null,
        sent_at: null,
        message_id: null,
        last_error_code: DEVOLVIDO,
        last_error_detail: `A plataforma recusou o modelo ${modeloRecusado} com o erro ${falha.codigo}. A pessoa voltou à fila para outro modelo.`,
      })
      .eq("id", falha.id)
      .eq("status", "failed")
      .is("delivered_at", null)
      .is("read_at", null)
      .is("replied_at", null)
      .select("id");
    if ((voltou ?? []).length === 0) continue;
    resultado.devolvidos++;

    await admin
      .from("campaign_recipient_templates")
      .update({ tentativas_indisponivel: tentativas + 1 })
      .eq("recipient_id", falha.id);

    const status = CODIGOS[falha.codigo];
    if (status) {
      await marcarModeloIndisponivel(
        admin,
        {
          organizationId: campanha.organization_id,
          channelSessionId: falha.channel_session_id ?? campanha.channel_session_id,
          name: registro.template_name,
          language: registro.template_language,
        },
        status,
      );
    }
    await contarPulo(admin, campanha, registro, falha.codigo, agora);
  }
  return resultado;
}

/** Mais uma recusa deste modelo nesta campanha, com o motivo, para a tela. */
async function contarPulo(
  admin: SupabaseClient,
  campanha: { id: string; organization_id: string },
  modelo: { template_name: string; template_language: string },
  codigo: string,
  agora: Date,
): Promise<void> {
  const { data: atual } = await admin
    .from("campaign_template_skips")
    .select("vezes")
    .eq("organization_id", campanha.organization_id)
    .eq("campaign_id", campanha.id)
    .eq("template_name", modelo.template_name)
    .eq("template_language", modelo.template_language)
    .maybeSingle();
  await admin.from("campaign_template_skips").upsert(
    {
      campaign_id: campanha.id,
      organization_id: campanha.organization_id,
      template_name: modelo.template_name,
      template_language: modelo.template_language,
      motivo: codigo,
      vezes: ((atual as { vezes?: number } | null)?.vezes ?? 0) + 1,
      ultima_em: agora.toISOString(),
    },
    { onConflict: "campaign_id,template_name,template_language" },
  );
}

/**
 * O que a rodada faz antes de enviar numa campanha com modelos:
 *
 *   1. campanha que voltou a rodar perde a marca de "pausada pelo sistema"
 *      (senão uma pausa manual depois dela seria tomada por pausa do sistema e
 *      a campanha voltaria sozinha);
 *   2. quem a Meta recusou por modelo indisponível volta à fila;
 *   3. se nenhum modelo está aprovado, a campanha pausa e avisa.
 *
 * Devolve o detalhe da rodada quando pausou, `null` quando pode enviar.
 */
export async function antesDaRodadaComModelo(
  admin: SupabaseClient,
  campanha: { id: string; organization_id: string; channel_session_id: string; name?: string },
  modelo: ModeloDaCampanha,
  agora: Date,
): Promise<string | null> {
  const { data: atual } = await admin
    .from("campaigns")
    .select("failure_code")
    .eq("id", campanha.id)
    .eq("organization_id", campanha.organization_id)
    .maybeSingle();
  const marca = (atual as { failure_code?: string | null } | null)?.failure_code ?? null;
  if (pausadaPorFaltaDeModelo(marca)) {
    await admin
      .from("campaigns")
      .update({ failure_code: null, failure_detail: null })
      .eq("id", campanha.id)
      .eq("organization_id", campanha.organization_id)
      .eq("status", "running")
      .eq("failure_code", marca);
  }
  await devolverRecusadosPorModelo(admin, campanha, agora);
  return pausarSeOModeloSaiu(admin, campanha, modelo, agora);
}

/**
 * Retoma as campanhas que o SISTEMA pausou por falta de modelo, quando algum
 * modelo da lista voltou a ficar aprovado no número principal. Campanha pausada
 * por uma pessoa nunca volta sozinha. Chamada pelo webhook de status de modelo
 * e pela sincronização automática.
 */
export async function retomarCampanhasPausadasPorModelo(
  admin: SupabaseClient,
  organizationId: string | null,
  agora: Date,
): Promise<number> {
  let consulta = admin
    .from("campaigns")
    .select("id, organization_id, channel_session_id, name, failure_code")
    .eq("status", "paused");
  if (organizationId) consulta = consulta.eq("organization_id", organizationId);
  const { data, error } = await consulta.limit(200);
  if (error || !data) return 0;

  let retomadas = 0;
  for (const c of data as Array<{
    id: string;
    organization_id: string;
    channel_session_id: string;
    name: string;
    failure_code: string | null;
  }>) {
    if (!pausadaPorFaltaDeModelo(c.failure_code)) continue;
    const modelo = await lerModeloDaCampanha(admin, c.organization_id, c.id).catch(() => null);
    if (!modelo) continue;
    const definicoes = await situacaoDosModelos(
      admin,
      { organizationId: c.organization_id, channelSessionId: c.channel_session_id },
      modelo,
    );
    const voltou = modelo.itens.find((_, i) => modeloEnviavel(definicoes[i]?.status));
    if (!voltou) continue;

    const { data: retomada } = await admin
      .from("campaigns")
      .update({ status: "running", paused_at: null, failure_code: null, failure_detail: null })
      .eq("id", c.id)
      .eq("organization_id", c.organization_id)
      .eq("status", "paused")
      .eq("failure_code", c.failure_code)
      .select("id");
    if ((retomada ?? []).length === 0) continue;
    retomadas++;
    await avisarSobreModelo(admin, c.organization_id, {
      severity: "info",
      title: `Campanha "${c.name}" retomada: um modelo voltou a ficar aprovado`,
      body: `O modelo "${voltou.template_name}" (${voltou.template_language}) está aprovado de novo, e o disparo continuou de onde parou.`,
    });
  }
  void agora;
  return retomadas;
}

/**
 * Campanha que concluiu há pouco pode ter recusas que chegaram pelo aviso
 * posterior da Meta depois do último envio. Se alguém volta à fila, a campanha
 * volta a rodar. Chamada pela sincronização automática.
 */
export async function reabrirConcluidasComRecusa(
  admin: SupabaseClient,
  agora: Date,
): Promise<number> {
  const desde = new Date(agora.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await admin
    .from("campaigns")
    .select("id, organization_id, channel_session_id, completed_at")
    .eq("status", "completed")
    .gte("completed_at", desde)
    .limit(200);
  let reabertas = 0;
  for (const c of (data ?? []) as Array<{
    id: string;
    organization_id: string;
    channel_session_id: string;
  }>) {
    const modelo = await lerModeloDaCampanha(admin, c.organization_id, c.id).catch(() => null);
    if (!modelo) continue;
    const { devolvidos } = await devolverRecusadosPorModelo(admin, c, agora);
    if (devolvidos === 0) continue;
    const { data: reaberta } = await admin
      .from("campaigns")
      .update({ status: "running", completed_at: null })
      .eq("id", c.id)
      .eq("organization_id", c.organization_id)
      .eq("status", "completed")
      .select("id");
    reabertas += (reaberta ?? []).length;
  }
  return reabertas;
}
