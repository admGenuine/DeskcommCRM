/**
 * O dono avalia empresas e marca campanhas de referência. Regras puras em
 * `aprendizado.ts`; a leitura do gosto aprendido em `perfil-aprendido.ts`.
 */
import type pg from "pg";

import { efeitoDaAvaliacao, type Avaliacao, type Nota } from "./aprendizado";
import { ProspectingError } from "./provider";
import { withProspectingLock } from "./store";

export async function avaliarEmpresa(
  pool: pg.Pool,
  org: string,
  userId: string,
  input: { id: string; nota: Nota; motivo?: string | null },
) {
  return withProspectingLock(pool, org, async (db) => {
    const linha = (
      await db.query<{
        id: string;
        status: string;
        phone: string | null;
        error: string | null;
        anonimizada: boolean;
        campaign_status: string;
      }>(
        `select p.id, p.status, p.phone, p.error, p.suppression_salt is not null as anonimizada,
                c.status as campaign_status
           from prospecting_candidates p
           join prospecting_campaigns c on c.organization_id = p.organization_id and c.id = p.campaign_id
          where p.organization_id = $1 and p.id = $2`,
        [org, input.id],
      )
    ).rows[0];
    if (!linha) throw new ProspectingError("Empresa não encontrada.", 404, "candidato");
    if (linha.anonimizada)
      throw new ProspectingError(
        "Esta empresa foi anonimizada e não pode ser avaliada.",
        409,
        "candidato",
      );
    const motivo = input.motivo?.trim() || null;
    const avaliacao: Avaliacao = {
      nota: input.nota,
      motivo,
      em: new Date().toISOString(),
      por: userId,
    };
    const efeito = efeitoDaAvaliacao({
      nota: input.nota,
      motivo,
      status: linha.status,
      error: linha.error,
      phone: linha.phone,
      campanhaEmRascunho: linha.campaign_status === "draft",
    });
    await db.query(
      "update prospecting_candidates set data = data || jsonb_build_object('avaliacao', $3::jsonb), status = $4, error = $5, updated_at = now() where organization_id = $1 and id = $2",
      [org, linha.id, JSON.stringify(avaliacao), efeito.status, efeito.error],
    );
    return { id: linha.id, avaliacao, ...efeito };
  });
}

export async function marcarReferencia(
  pool: pg.Pool,
  org: string,
  input: { id: string; ativa: boolean; motivo?: string | null },
) {
  const motivo = input.ativa ? input.motivo?.trim() || null : null;
  const { rows } = await pool.query<{ id: string; referencia_em: Date | null }>(
    `update prospecting_campaigns
        set referencia_em = case when $3::boolean then coalesce(referencia_em, now()) else null end,
            referencia_motivo = $4,
            updated_at = now()
      where organization_id = $1 and id = $2 and search_status = 'succeeded'
      returning id, referencia_em`,
    [org, input.id, input.ativa, motivo],
  );
  if (!rows[0]) throw new ProspectingError("Campanha com busca concluída não encontrada.", 404);
  return { id: rows[0].id, referencia: rows[0].referencia_em !== null };
}
