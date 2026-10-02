/**
 * O número tem WhatsApp? Perguntado à plataforma, um candidato por vez.
 *
 * Telefone fixo de empresa raramente tem WhatsApp, e celular desativado também
 * não. Sem esta conferência, o envio falhava depois de o CRM já ter gastado a
 * vez da fila. Ela roda no ENVIO, e não na entrada da busca, de propósito:
 * consultar cem números de uma vez é o padrão que a detecção de automação
 * procura. No envio, ela acompanha o ritmo da esteira fria (um por vez, com
 * intervalo e jitter).
 *
 * Três respostas, e só uma tira o candidato da fila:
 *   - `tem`     → segue para o envio;
 *   - `nao_tem` → a plataforma respondeu, por todas as grafias, que não existe;
 *   - `nao_sei` → canal que não sabe perguntar, transporte fora do ar, erro.
 *                 Segue para o envio, como era antes: não saber não é motivo
 *                 para descartar uma empresa.
 *
 * Não nomeia provider (doutrina de restrição de canal): pergunta ao adapter se
 * ele implementa `numeroExiste`.
 */
import type pg from "pg";

import {
  CHANNEL_SESSION_REF_COLUMNS,
  getAdapter,
  resolveSessionRef,
  type ChannelSessionRef,
} from "@/lib/channels";
import type { ChannelProvider } from "@/lib/channels/types";

export type RespostaDoWhatsapp = "tem" | "nao_tem" | "nao_sei";

export async function conferirWhatsappDoCandidato(
  db: pg.PoolClient,
  organizationId: string,
  channelSessionId: string,
  telefone: string,
): Promise<RespostaDoWhatsapp> {
  const sessao = (
    await db.query<ChannelSessionRef>(
      `select ${CHANNEL_SESSION_REF_COLUMNS} from channel_sessions where organization_id=$1 and id=$2`,
      [organizationId, channelSessionId],
    )
  ).rows[0];
  if (!sessao) return "nao_sei";
  let adapter;
  try {
    adapter = getAdapter(sessao.provider as ChannelProvider);
  } catch {
    return "nao_sei";
  }
  const sessionRef = resolveSessionRef(sessao);
  if (!adapter.numeroExiste || !sessionRef) return "nao_sei";
  const existe = await adapter
    .numeroExiste({ organizationId, sessionRef, phone: telefone })
    .catch(() => null);
  return existe === true ? "tem" : existe === false ? "nao_tem" : "nao_sei";
}
