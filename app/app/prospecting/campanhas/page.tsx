import type { Metadata } from "next";
import { Suspense } from "react";
import { ProspectingClient } from "../_client";
import { exigirAdminDaProspeccao } from "../_porta";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Campanha · Etapa 2" };

/** Etapa 2: suas campanhas, preparar a campanha e acompanhar a fila e as respostas. */
export default async function CampanhasPage() {
  await exigirAdminDaProspeccao();
  return (
    <Suspense fallback={null}>
      <ProspectingClient etapa="campanhas" />
    </Suspense>
  );
}
