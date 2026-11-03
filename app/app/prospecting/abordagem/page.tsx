import type { Metadata } from "next";
import { Suspense } from "react";
import { ProspectingClient } from "../_client";
import { exigirAdminDaProspeccao } from "../_porta";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Abordagem · Etapa 3" };

/** Etapa 3: preparar a abordagem da campanha escolhida e iniciar as abordagens com IA. */
export default async function AbordagemPage() {
  await exigirAdminDaProspeccao();
  return (
    <Suspense fallback={null}>
      <ProspectingClient etapa="abordagem" />
    </Suspense>
  );
}
