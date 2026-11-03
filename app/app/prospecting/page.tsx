import type { Metadata } from "next";
import { HubDaProspeccao } from "./_hub";
import { exigirAdminDaProspeccao } from "./_porta";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Prospecção" };

/** A porta de entrada: texto curto e três botões, um por etapa (`_etapas.ts`). */
export default async function ProspectingPage() {
  await exigirAdminDaProspeccao();
  return <HubDaProspeccao />;
}
