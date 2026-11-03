import { redirect } from "next/navigation";
import { hrefDaCampanha, PARAMETRO_DA_CAMPANHA, ROTA_DA_ETAPA } from "../_etapas";
import { exigirAdminDaProspeccao } from "../_porta";

export const dynamic = "force-dynamic";

/**
 * A antiga etapa 3 (fork, 2026-11-02 a 2026-11-03). A abordagem passou a ser a
 * segunda aba da campanha aberta; este endereço só existe para os links salvos
 * não morrerem: com `?campanha=`, abre a aba Abordagem daquela campanha; sem,
 * abre a etapa 2, onde as campanhas estão.
 */
export default async function AbordagemPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigirAdminDaProspeccao();
  const valor = (await searchParams)[PARAMETRO_DA_CAMPANHA];
  const campanhaId = Array.isArray(valor) ? valor[0] : valor;
  redirect(campanhaId ? hrefDaCampanha(campanhaId, "abordagem") : ROTA_DA_ETAPA.campanhas);
}
