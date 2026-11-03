import { redirect } from "next/navigation";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";

/**
 * A mesma porta das quatro telas da Prospecção: sessão válida e papel de
 * administrador na organização ativa. Quem não é admin volta à Inbox, como a
 * tela única já fazia antes da divisão em etapas.
 */
export async function exigirAdminDaProspeccao(): Promise<void> {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (org?.role !== "admin") redirect("/app/inbox");
}
