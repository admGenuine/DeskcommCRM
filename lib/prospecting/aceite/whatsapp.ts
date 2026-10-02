/**
 * O número tem WhatsApp? Perguntado ao WhatsApp, um candidato por vez.
 *
 * Telefone fixo de empresa raramente tem WhatsApp, e celular desativado também
 * não. Sem esta conferência, o envio falhava depois de o CRM já ter gastado a
 * vez da fila. Ela roda no ENVIO, e não na entrada da busca, de propósito:
 * consultar cem números de uma vez é o padrão que a detecção de automação do
 * WhatsApp procura. No envio, ela acompanha o ritmo da esteira fria (um por vez,
 * com intervalo e jitter).
 *
 * Três respostas, e só uma tira o candidato da fila:
 *   - `tem`     → segue para o envio;
 *   - `nao_tem` → TODAS as grafias do número responderam que não existe;
 *   - `nao_sei` → canal que não é WAHA, transporte fora do ar, erro de rede.
 *                 Segue para o envio, como era antes: não saber não é motivo
 *                 para descartar uma empresa.
 */
import type pg from "pg";

import { phoneLookupVariants } from "@/lib/channels/phone-variants";
import { getWahaClient } from "@/lib/waha/client";

export type RespostaDoWhatsapp = "tem" | "nao_tem" | "nao_sei";

export async function numeroTemWhatsapp(
  consultar: (digitos: string) => Promise<{ numberExists: boolean }>,
  telefone: string,
): Promise<RespostaDoWhatsapp> {
  const grafias = [...new Set(phoneLookupVariants(telefone).map((v) => v.replace(/\D/g, "")))].filter(Boolean);
  if (!grafias.length) return "nao_sei";
  let todasResponderam = true;
  for (const digitos of grafias) {
    try {
      if ((await consultar(digitos)).numberExists) return "tem";
    } catch {
      todasResponderam = false;
    }
  }
  return todasResponderam ? "nao_tem" : "nao_sei";
}

export async function conferirWhatsappDoCandidato(
  db: pg.PoolClient,
  organizationId: string,
  channelSessionId: string,
  telefone: string,
): Promise<RespostaDoWhatsapp> {
  const sessao = (
    await db.query<{ provider: string; waha_session_name: string | null }>(
      "select provider,waha_session_name from channel_sessions where organization_id=$1 and id=$2",
      [organizationId, channelSessionId],
    )
  ).rows[0];
  if (sessao?.provider !== "waha" || !sessao.waha_session_name) return "nao_sei";
  const cliente = getWahaClient();
  if (!cliente) return "nao_sei";
  const nome = sessao.waha_session_name;
  return numeroTemWhatsapp((digitos) => cliente.checkContactExists(nome, digitos), telefone);
}
