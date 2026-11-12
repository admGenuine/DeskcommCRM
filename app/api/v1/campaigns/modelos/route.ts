/**
 * GET /api/v1/campaigns/modelos?channel_session_id=<uuid> — o que a tela de
 * campanha precisa saber do número escolhido (fork da Genuine, 2026-11-12):
 * se ele só entrega modelo aprovado e, se sim, quais modelos aprovados ele tem,
 * com as vagas de cada um.
 *
 * Não grava nada. A organização vem do papel conferido, nunca da query; o
 * número é conferido contra ela. A lista sai de `lib/channels/modelos-da-conexao.ts`,
 * a mesma que a rota de criar usa para conferir o modelo pedido.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import {
  ENVIOS_POR_RODADA_MAXIMO,
  ENVIOS_POR_RODADA_PADRAO,
} from "@/lib/campanhas/modelo-da-campanha";
import { conexaoExigeModelo, modelosAprovadosDaConexao } from "@/lib/channels/modelos-da-conexao";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const consultaSchema = z.object({ channel_session_id: z.string().uuid() });

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "campaigns" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = consultaSchema.safeParse({
    channel_session_id: req.nextUrl.searchParams.get("channel_session_id"),
  });
  if (!parsed.success) {
    return fail("validation_failed", t("Escolha uma conexão de WhatsApp desta organização."), 422, {
      requestId,
    });
  }

  const admin = createAdminClient();
  try {
    const exige = await conexaoExigeModelo(admin, authz.org.orgId, parsed.data.channel_session_id);
    if (exige === null) {
      return fail(
        "campanha_canal_indisponivel",
        t("Escolha uma conexão de WhatsApp desta organização."),
        409,
        { requestId },
      );
    }
    const modelos = exige
      ? await modelosAprovadosDaConexao(admin, authz.org.orgId, parsed.data.channel_session_id)
      : [];
    return ok(
      {
        exige_modelo: exige,
        envios_por_rodada: { padrao: ENVIOS_POR_RODADA_PADRAO, maximo: ENVIOS_POR_RODADA_MAXIMO },
        modelos: modelos.map((m) => ({
          name: m.name,
          language: m.language,
          category: m.category,
          previa: m.previa,
          vagas: m.vagas,
          valores_salvos: m.valoresSalvos,
        })),
      },
      { requestId },
    );
  } catch (err) {
    return fail("internal_error", err instanceof Error ? err.message : String(err), 500, {
      requestId,
    });
  }
}
