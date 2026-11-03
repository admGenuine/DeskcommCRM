import type { Metadata } from "next";
import { Suspense } from "react";
import { ProspectingClient } from "../../_client";
import { abaDaQuery, PARAMETRO_DA_ABA } from "../../_etapas";
import { exigirAdminDaProspeccao } from "../../_porta";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Campanha" };

/**
 * A campanha aberta: duas abas, "Preparar a campanha" (nome, referência, ritmo e
 * as empresas achadas, com o mapa de bairros) e "Abordagem" (o agente, o ritmo e
 * o botão de iniciar). Alcançada pelo botão "Abrir" de cada campanha na etapa 2.
 */
export default async function CampanhaAbertaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigirAdminDaProspeccao();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return (
    <Suspense fallback={null}>
      <ProspectingClient
        etapa="campanha"
        campanhaId={id}
        aba={abaDaQuery(query[PARAMETRO_DA_ABA])}
      />
    </Suspense>
  );
}
