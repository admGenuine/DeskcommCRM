/**
 * A régua de entrada de candidatos numa campanha, a mesma para as duas fontes:
 * a busca do Maps (`store.ts`, `synchronizeSearch`) e o mercado da Receita
 * (`mercado/campanha.ts`).
 *
 * Três perguntas, nesta ordem, e o primeiro "não" vira o motivo gravado em
 * `prospecting_candidates.error`, que a tela mostra:
 *   1. o veredito da fonte (telefone, segmento, região: quem chama decide);
 *   2. o telefone já é de um contato do CRM? ("Já está no CRM.");
 *   3. o gosto aprendido do dono recusa a categoria? (`aprendizado.ts`).
 */
import type pg from "pg";

import { phoneLookupVariants } from "@/lib/channels/phone-variants";

import type { Veredito } from "./aceite";
import { recusaAprendida } from "./aprendizado";
import { carregarPerfilAprendido } from "./perfil-aprendido";
import type { Prospect } from "./schema";

export async function reguaDaEntrada(
  db: pg.Pool | pg.PoolClient,
  organizationId: string,
  prospects: readonly Prospect[],
): Promise<(p: Prospect, veredito: Veredito) => string | null> {
  const variantes = [
    ...new Set(prospects.flatMap((p) => (p.phone ? phoneLookupVariants(p.phone) : []))),
  ];
  const noCrm = new Set(
    variantes.length
      ? (
          await db.query<{ phone_number: string }>(
            "select phone_number from contacts where organization_id=$1 and phone_number=any($2::text[])",
            [organizationId, variantes],
          )
        ).rows.map((r) => r.phone_number)
      : [],
  );
  const perfil = await carregarPerfilAprendido(db, organizationId);
  return (p, veredito) =>
    !veredito.aprovado
      ? veredito.motivo
      : p.phone && phoneLookupVariants(p.phone).some((v) => noCrm.has(v))
        ? "Já está no CRM."
        : recusaAprendida(perfil, p.category);
}

/** Grava o candidato com o veredito; devolve 1 se entrou, 0 se o banco já tinha o lugar ou o telefone. */
export async function inserirCandidato(
  db: pg.Pool | pg.PoolClient,
  organizationId: string,
  campaignId: string,
  p: Prospect,
  motivo: string | null,
): Promise<number> {
  const result = await db.query(
    "insert into prospecting_candidates(organization_id,campaign_id,place_id,phone,data,status,error) values($1,$2,$3,$4,$5,$6,$7) on conflict do nothing",
    [
      organizationId,
      campaignId,
      p.key,
      p.phone,
      { ...p, aceite: motivo ? { aprovado: false, motivo } : { aprovado: true } },
      motivo ? "skipped" : "new",
      motivo,
    ],
  );
  return result.rowCount ?? 0;
}
