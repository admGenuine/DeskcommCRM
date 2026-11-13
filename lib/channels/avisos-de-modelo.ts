/**
 * O QUE A PLATAFORMA DIZ SOBRE UM MODELO, levado ao espelho e a quem opera
 * (fork da Genuine, 2026-11-13).
 *
 * Três fontes, a mesma regra de onde gravar:
 *
 *   - os avisos de QUALIDADE e de CATEGORIA do webhook (`TemplateQualityEvent`,
 *     `TemplateCategoryEvent`), que até aqui eram descartados;
 *   - a RECUSA de um envio porque o modelo está pausado ou desativado
 *     (códigos 132015 e 132016 da Meta), que marca o modelo na hora, sem
 *     esperar o aviso de status chegar.
 *
 * O espelho (`meta_templates`) continua sendo a cópia do que a plataforma diz;
 * a sincronização automática (`app/api/v1/cron/sincronizar-modelos`) devolve o
 * estado verdadeiro se alguma marca daqui ficar para trás.
 *
 * Os avisos vão para a Central (`agent_inbox_items`, tipo
 * `channel_template_review`), pela mesma porta que os avisos de modelo dos
 * parceiros já usam (`registrarAviso`): um aviso aberto com o mesmo título não
 * se repete.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { CHANNEL_PROVIDER_META } from "./capabilities";
import { linhaDoEspelho } from "./linha-do-espelho";
import type { TemplateCategoryEvent, TemplateQualityEvent } from "./meta/webhook";
import { registrarAviso } from "./zernio/avisos";

/**
 * Status em que o modelo pode sair. `REINSTATED` é como a plataforma avisa que
 * um modelo voltou; até a sincronização trazer o status de lista, ele vale como
 * aprovado.
 */
const ENVIAVEIS = new Set(["APPROVED", "REINSTATED"]);

export function modeloEnviavel(status: string | null | undefined): boolean {
  return ENVIAVEIS.has((status ?? "").toUpperCase());
}

export const STATUS_ENVIAVEIS: readonly string[] = [...ENVIAVEIS];

const ROTULO_DA_CATEGORIA: Record<string, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utilidade",
  AUTHENTICATION: "Autenticação",
};

/**
 * dd/mm/aaaa no horário de Brasília, para o texto do aviso, que é gravado (não
 * é tela). Brasília não tem horário de verão desde 2019: o deslocamento é fixo.
 */
function dataDeBrasilia(segundos: number): string {
  const d = new Date(segundos * 1000 - 3 * 60 * 60 * 1000);
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${dois(d.getUTCDate())}/${dois(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

const rotulo = (c: string | null) => (c ? (ROTULO_DA_CATEGORIA[c] ?? c) : "sem categoria");

/** A qualidade e a categoria vão para o espelho; o que pesa no custo ou no envio vira aviso. */
export async function aplicarAvisoDeModelo(
  admin: SupabaseClient,
  organizationId: string,
  e: TemplateQualityEvent | TemplateCategoryEvent,
): Promise<string> {
  const linha = () =>
    admin
      .from("meta_templates")
      .update({ updated_at: new Date().toISOString(), ...mudanca })
      .eq("organization_id", organizationId)
      .eq("waba_id", e.wabaId)
      .eq("name", e.templateName)
      .eq("language", e.templateLanguage);
  let mudanca: Record<string, unknown> = {};

  if (e.kind === "template_quality") {
    mudanca = { quality_score: e.newQuality };
    await linha();
    if (e.newQuality === "RED") {
      await registrarAviso(admin, organizationId, {
        kind: "channel_template_review",
        severity: "warn",
        title: `Modelo "${e.templateName}" com qualidade baixa`,
        body: "A plataforma marcou a qualidade deste modelo como baixa. Se continuar assim, ela pausa o modelo, e as campanhas seguem com os outros modelos da lista.",
      });
    }
    return "modelo_qualidade";
  }

  // Categoria: mudança feita grava; mudança anunciada só avisa (a de hoje ainda vale).
  const anunciada = e.correctCategory !== null && e.previousCategory === null;
  if (!anunciada && e.newCategory) {
    mudanca = { category: e.newCategory };
    await linha();
  }
  const de = anunciada ? e.newCategory : e.previousCategory;
  const para = anunciada ? e.correctCategory : e.newCategory;
  if (de === "UTILITY" && para === "MARKETING") {
    const quando =
      anunciada && e.updateTimestamp ? ` a partir de ${dataDeBrasilia(e.updateTimestamp)}` : "";
    await registrarAviso(admin, organizationId, {
      kind: "channel_template_review",
      severity: "warn",
      title: anunciada
        ? `Modelo "${e.templateName}" vai passar de Utilidade para Marketing`
        : `Modelo "${e.templateName}" passou de Utilidade para Marketing`,
      body: `A plataforma ${anunciada ? "vai cobrar" : "passou a cobrar"} este modelo como Marketing${quando}, que custa mais por mensagem.`,
    });
  } else if (de && para && de !== para) {
    await registrarAviso(admin, organizationId, {
      kind: "channel_template_review",
      severity: "info",
      title: `Modelo "${e.templateName}" ${anunciada ? "vai mudar" : "mudou"} de categoria`,
      body: `De ${rotulo(de)} para ${rotulo(para)}.`,
    });
  }
  return "modelo_categoria";
}

/**
 * A plataforma recusou um envio porque o modelo está pausado ou desativado: o
 * espelho passa a dizer isso já, para o rodízio de modelos não escolhê-lo de
 * novo enquanto o aviso de status não chega.
 */
export async function marcarModeloIndisponivel(
  admin: SupabaseClient,
  chave: { organizationId: string; channelSessionId: string; name: string; language: string },
  status: "PAUSED" | "DISABLED",
): Promise<boolean> {
  const { data, error } = await linhaDoEspelho<{ id: string; status: string }>(
    admin,
    "id, status",
    chave,
  );
  if (error || !data) return false;
  if (!modeloEnviavel(data.status)) return true;
  const { error: erroDaMarca } = await admin
    .from("meta_templates")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("organization_id", chave.organizationId)
    .eq("id", data.id);
  return !erroDaMarca;
}

/** Uma conexão oficial que a sincronização automática alcança. */
export interface ConexaoParaSincronizar {
  organizationId: string;
  channelSessionId: string;
  phoneNumberId: string;
  wabaId: string;
}

/** As conexões oficiais ativas com conta (WABA) e número conhecidos, de todas as organizações. */
export async function conexoesOficiaisParaSincronizar(
  admin: SupabaseClient,
): Promise<ConexaoParaSincronizar[]> {
  const { data, error } = await admin
    .from("channel_sessions")
    .select("id, organization_id, meta_phone_number_id, meta_waba_id, archived_at")
    .eq("provider", CHANNEL_PROVIDER_META)
    .not("meta_waba_id", "is", null)
    .not("meta_phone_number_id", "is", null);
  if (error) throw new Error(`conexoes_oficiais: ${error.message}`);
  const vistas = new Set<string>();
  const conexoes: ConexaoParaSincronizar[] = [];
  for (const l of (data ?? []) as Array<{
    id: string;
    organization_id: string;
    meta_phone_number_id: string;
    meta_waba_id: string;
    archived_at?: string | null;
  }>) {
    if (l.archived_at) continue;
    // A definição é da CONTA: uma sincronização por organização e conta basta.
    const chave = `${l.organization_id}|${l.meta_waba_id}`;
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    conexoes.push({
      organizationId: l.organization_id,
      channelSessionId: l.id,
      phoneNumberId: l.meta_phone_number_id,
      wabaId: l.meta_waba_id,
    });
  }
  return conexoes;
}

/**
 * Um aviso sobre modelo na Central, para quem não pode nomear o canal (a
 * campanha). Mesmo tipo e mesma regra de repetição dos outros avisos de modelo.
 */
export async function avisarSobreModelo(
  admin: SupabaseClient,
  organizationId: string,
  aviso: { severity: "info" | "warn" | "critical"; title: string; body: string | null },
): Promise<"criado" | "ja_aberto"> {
  return registrarAviso(admin, organizationId, { kind: "channel_template_review", ...aviso });
}
