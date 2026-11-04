/**
 * MARCAR NA PREPARAÇÃO DEVOLVE QUEM A RÉGUA RECUSOU SÓ POR PERFIL (ação `select`).
 *
 * A ação `select` do original (`app/api/v1/prospecting/route.ts`) só mexe em
 * quem está como "Encontrado" (`status='new'`). O fork acrescentou a régua de
 * aceite (`aceite/`), que grava `skipped` com o motivo na entrada, e a tela da
 * campanha aberta oferece "+ Abordar" em cada empresa. Sem esta função o
 * clique numa empresa recusada pela régua não mudava nada, e a tela dizia
 * "Seleção da fila atualizada." Medido na VPS da Genuine em 2026-11-04: uma
 * busca de panificadoras teve as 20 recusadas por "Categoria fora do perfil:
 * Padaria." e nenhum botão de abordar respondia.
 *
 * Marcar agora faz, antes da seleção do original, o que o "gostei" já fazia
 * (`efeitoDaAvaliacao`): devolve a "Encontrado" quem saiu só por PERFIL e tem
 * telefone (`podeVoltarPorPerfil`). Recusa de FATO (telefone, país, já no CRM,
 * sem WhatsApp) e a linha que a LGPD anonimizou não voltam. Quem chama já
 * conferiu que a campanha está em preparação, dentro do lock da organização.
 */
import type pg from "pg";

import { podeVoltarPorPerfil } from "./aprendizado";

/** Devolve a "Encontrado" as recusadas só por perfil entre `candidateIds`; diz quantas. */
export async function devolverRecusadasPorPerfil(
  db: pg.PoolClient,
  org: string,
  campaignId: string,
  candidateIds: readonly string[],
): Promise<number> {
  const recusadas = (
    await db.query<{ id: string; error: string | null; phone: string | null }>(
      "select id,error,phone from prospecting_candidates where organization_id=$1 and campaign_id=$2 and status='skipped' and suppression_salt is null and id=any($3::uuid[])",
      [org, campaignId, candidateIds],
    )
  ).rows;
  const voltam = recusadas
    .filter((r) => podeVoltarPorPerfil({ status: "skipped", error: r.error, phone: r.phone }))
    .map((r) => r.id);
  if (!voltam.length) return 0;
  return (
    (
      await db.query(
        "update prospecting_candidates set status='new',error=null,updated_at=now() where organization_id=$1 and campaign_id=$2 and status='skipped' and suppression_salt is null and id=any($3::uuid[])",
        [org, campaignId, voltam],
      )
    ).rowCount ?? 0
  );
}
