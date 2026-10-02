/**
 * O gosto aprendido, lido do banco: avaliações do dono e empresas de campanhas
 * de referência. Separado de `avaliacao.ts` para `store.ts` poder ler sem
 * importar quem importa `store.ts`.
 */
import type pg from "pg";

import {
  perfilAprendido,
  sinalDaLinha,
  type PerfilAprendido,
  type SinalDeGosto,
} from "./aprendizado";

export async function carregarPerfilAprendido(
  db: pg.Pool | pg.PoolClient,
  org: string,
): Promise<PerfilAprendido> {
  const { rows } = await db.query<{
    categoria: string | null;
    nota: string | null;
    referencia: boolean;
    error: string | null;
  }>(
    `select p.data->>'category' as categoria,
            p.data->'avaliacao'->>'nota' as nota,
            c.referencia_em is not null as referencia,
            p.error
       from prospecting_candidates p
       join prospecting_campaigns c on c.organization_id = p.organization_id and c.id = p.campaign_id
      where p.organization_id = $1
        and p.suppression_salt is null
        and (p.data ? 'avaliacao' or c.referencia_em is not null)`,
    [org],
  );
  return perfilAprendido(rows.map(sinalDaLinha).filter((s): s is SinalDeGosto => s !== null));
}
