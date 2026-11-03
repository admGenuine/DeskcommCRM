import type { Metadata } from "next";
import { Suspense } from "react";
import { ProspectingClient } from "../_client";
import { exigirAdminDaProspeccao } from "../_porta";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Prospecção · Etapa 1" };

/** Etapa 1: encontrar empresas, o perfil aprendido, o decisor pelo quadro de sócios e os resultados da busca. */
export default async function EmpresasPage() {
  await exigirAdminDaProspeccao();
  return (
    <Suspense fallback={null}>
      <ProspectingClient etapa="empresas" />
    </Suspense>
  );
}
