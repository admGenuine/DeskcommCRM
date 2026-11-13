/**
 * GET/POST /api/v1/cron/sincronizar-modelos (fork da Genuine, 2026-11-13).
 *
 * A rede de segurança dos modelos da API oficial. O webhook de status já grava
 * no espelho quando a plataforma pausa, desativa ou devolve um modelo; aviso
 * perdido (instalação fora do ar, assinatura do webhook incompleta) deixaria o
 * espelho errado até alguém apertar "Sincronizar modelos". A cada 10 minutos,
 * esta rota:
 *
 *   1. sincroniza os modelos de cada conta oficial conectada (a mesma
 *      `syncTemplates` do botão), de organização que opera;
 *   2. devolve à fila quem a plataforma recusou por modelo indisponível depois
 *      de a campanha já ter concluído, e reabre a campanha;
 *   3. retoma as campanhas que o SISTEMA pausou por falta de modelo, quando um
 *      modelo da lista voltou a ficar aprovado.
 *
 * Audita só quando houve efeito (`tests/unit/cron-audita-so-quando-ha-efeito.test.ts`).
 * Agendada em `docker/scheduler/entrypoint.sh`.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import {
  reabrirConcluidasComRecusa,
  retomarCampanhasPausadasPorModelo,
} from "@/lib/campanhas/modelo-indisponivel";
import { conexoesOficiaisParaSincronizar } from "@/lib/channels/avisos-de-modelo";
import { resolveMetaCreds } from "@/lib/channels/meta/credentials";
import { syncTemplates } from "@/lib/channels/meta/template-sync";
import { logger } from "@/lib/logger";
import { idsDeOrgsParadas } from "@/lib/organizacao/operante";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Contas por rodada: cada uma é uma chamada à Graph API. A sobra vai na rodada seguinte. */
const CONTAS_POR_RODADA = 20;

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const admin = createAdminClient();
  const agora = new Date();
  const resultado = { contas: 0, mudancas: 0, falhas: 0, reabertas: 0, retomadas: 0 };

  try {
    const paradas = new Set(await idsDeOrgsParadas(admin));
    const conexoes = (await conexoesOficiaisParaSincronizar(admin))
      .filter((c) => !paradas.has(c.organizationId))
      .slice(0, CONTAS_POR_RODADA);

    for (const c of conexoes) {
      resultado.contas++;
      try {
        const creds = await resolveMetaCreds(admin, {
          organizationId: c.organizationId,
          phoneNumberId: c.phoneNumberId,
        });
        if (!creds) continue;
        const n = await syncTemplates({
          organizationId: c.organizationId,
          wabaId: c.wabaId,
          token: creds.token,
          graphVersion: creds.graphVersion,
        });
        resultado.mudancas += n.inserted + n.updated + n.disabled;
      } catch (err) {
        // Uma conta com token vencido não pode impedir as outras.
        resultado.falhas++;
        logger.warn("[sincronizar-modelos] sincronização de uma conta falhou", {
          organization_id: c.organizationId,
          motivo: err instanceof Error ? err.message : String(err),
          requestId,
        });
      }
    }

    resultado.reabertas = await reabrirConcluidasComRecusa(admin, agora);
    resultado.retomadas = await retomarCampanhasPausadasPorModelo(admin, null, agora);
  } catch (err) {
    logger.error("[sincronizar-modelos] rodada falhou", {
      motivo: err instanceof Error ? err.message : String(err),
      requestId,
    });
    return fail("internal_error", "Template sync round failed.", 500, { requestId });
  }

  if (
    resultado.mudancas > 0 ||
    resultado.falhas > 0 ||
    resultado.reabertas > 0 ||
    resultado.retomadas > 0
  ) {
    void audit({
      action: "cron.sincronizar_modelos",
      requestId,
      bypassedRls: true,
      metadata: { ...resultado },
    });
  }

  return ok(resultado, { requestId });
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}
