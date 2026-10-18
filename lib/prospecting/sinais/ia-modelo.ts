/**
 * A chamada de modelo da leitura de sites por IA, pelo seam da casa
 * (`runModelCall`): a credencial e o modelo da organização, o teto de gasto de
 * IA da organização, e o registro em `llm_calls` com o ponto
 * `prospecting_site_read` (`lib/ai/pontos/registro.ts`).
 *
 * Separado de `ia.ts` para o resto da leitura ser testável sem banco nem env.
 */
import type pg from "pg";

import { llmEdgeConfigFromEnv } from "@/lib/agent-engine/edge/llm/credentials";
import { runModelCall } from "@/lib/agent-engine/edge/llm/run-model-call";
import { env } from "@/lib/env";

import type { ChamarModelo } from "./ia";

export function chamarModeloPeloSeam(pool: pg.Pool): ChamarModelo {
  return async ({ organizationId, sistema, usuario, maxTokensDeSaida }) => {
    const r = await runModelCall(pool, llmEdgeConfigFromEnv(env), {
      tenantId: organizationId,
      purpose: "prospecting_site_read",
      system: sistema,
      messages: [{ role: "user", content: usuario }],
      maxSteps: 1,
      maxOutputTokens: maxTokensDeSaida,
      reasoning: "none",
    });
    return {
      texto: r.result.text ?? "",
      custoCentavos: r.costCents,
      modelo: r.model,
      tokensDeEntrada: r.usage.inputTokens,
      tokensDeSaida: r.usage.outputTokens,
    };
  };
}
