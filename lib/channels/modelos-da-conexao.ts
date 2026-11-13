/**
 * OS MODELOS APROVADOS DE UMA CONEXÃO, para quem não pode saber qual canal é
 * (fork da Genuine, 2026-11-12: campanha com modelo).
 *
 * A campanha (`lib/campanhas/`) precisa responder três perguntas sobre o número
 * escolhido: ele só entrega modelo fora da janela de 24 horas? quais modelos
 * aprovados ele tem? qual o texto e as vagas de um deles? A doutrina de
 * restrição de canal (`docs/doctrine/restricao-de-canal.md`, invariante 1)
 * proíbe a feature de perguntar QUAL é o canal, e o `lint:channels` reprova. Por
 * isso as três respostas saem daqui, da fronteira, e a campanha recebe só
 * capacidade e dado.
 *
 * ─── Exige modelo = `requiresTemplates` ─────────────────────────────────────
 *
 * Vale para a API oficial e para os parceiros que a intermediam: a regra da
 * janela é da plataforma, e os dois guardam a definição no mesmo espelho
 * (`meta_templates`). A busca de UMA definição é a de `linhaDoEspelho`; a lista
 * segue a mesma precedência: a linha da própria conexão e, no canal oficial, a
 * linha da conta (WABA) dele, que o sync grava sem conexão.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { CHANNEL_PROVIDER_META, capabilitiesOf, transportaMensagem } from "./capabilities";
import { STATUS_ENVIAVEIS } from "./avisos-de-modelo";
import { linhaDoEspelho } from "./linha-do-espelho";
import { slotKey } from "./meta/build-components";
import { renderTemplateBody, renderTemplatePreview } from "./meta/render-template";
import { describeAddress, deriveTemplateContract } from "./meta/template-contract";
import type { ProviderDeMensagem } from "./types";

/** O status que a plataforma dá ao modelo que pode sair. */
export const MODELO_APROVADO = "APPROVED";

/** Uma vaga do modelo, do jeito que a tela e o montador do envio a enxergam. */
export interface VagaDoModelo {
  /** A chave de `template_values` (`slotKey`): "1", "header:1", "button0:1". */
  chave: string;
  /** Onde ela fica, em palavras: "corpo", "cabeçalho", "botão 1 (url)". */
  onde: string;
  /** O que a plataforma espera: "text", "image", "url_suffix"… */
  espera: string;
  /** Texto logo antes e logo depois da vaga, que é o rótulo útil para a tela. */
  antes: string;
  depois: string;
}

export interface ModeloDaConexao {
  name: string;
  language: string;
  category: string | null;
  status: string;
  /** A nota de qualidade da plataforma (GREEN, YELLOW, RED, UNKNOWN), quando há. */
  qualityScore: string | null;
  vagas: VagaDoModelo[];
  /** O texto do cabeçalho e do corpo, com as vagas ainda como `{{n}}`. */
  previa: string;
  /** Links de mídia salvos no modelo (`saved_values`), na chave da vaga. */
  valoresSalvos: Record<string, string>;
  /** A definição crua: o envio e o texto da conversa saem dela. */
  components: unknown;
  parameterFormat: string;
}

interface LinhaDoModelo {
  name: string;
  language: string;
  category: string | null;
  status: string;
  quality_score?: string | null;
  components: unknown;
  parameter_format: string | null;
  saved_values: unknown;
  channel_session_id: string | null;
}

const COLUNAS =
  "name, language, category, status, quality_score, components, parameter_format, saved_values, channel_session_id";

/** Este provedor só entrega modelo fora da janela? Desconhecido responde `false`. */
export function exigeModelo(provider: string | null | undefined): boolean {
  if (!transportaMensagem(provider)) return false;
  try {
    return capabilitiesOf(provider as ProviderDeMensagem).requiresTemplates;
  } catch {
    return false;
  }
}

/** A conexão desta organização, e se ela exige modelo. `null` = não é desta organização. */
export async function conexaoExigeModelo(
  admin: SupabaseClient,
  organizationId: string,
  channelSessionId: string,
): Promise<boolean | null> {
  const { data, error } = await admin
    .from("channel_sessions")
    .select("provider")
    .eq("organization_id", organizationId)
    .eq("id", channelSessionId)
    .maybeSingle();
  if (error) throw new Error(`conexao_lookup_failed: ${error.message}`);
  if (!data) return null;
  return exigeModelo((data as { provider: string | null }).provider);
}

/** As vagas do modelo, na ordem da plataforma, pelas MESMAS funções do envio. */
export function vagasDoModelo(m: {
  name: string;
  language: string;
  components: unknown;
  parameter_format?: string | null;
}): VagaDoModelo[] {
  const contrato = deriveTemplateContract({
    name: m.name,
    language: m.language,
    ...(m.parameter_format ? { parameter_format: m.parameter_format } : {}),
    components: (Array.isArray(m.components) ? m.components : []) as never,
  });
  return contrato.slots.map((s) => ({
    chave: slotKey(s.address, s.key),
    onde: describeAddress(s.address),
    espera: s.expects,
    antes: s.contextBefore,
    depois: s.contextAfter,
  }));
}

function paraModelo(l: LinhaDoModelo): ModeloDaConexao {
  const previa = renderTemplatePreview(
    l.components,
    {},
    {
      name: l.name,
      language: l.language,
      ...(l.parameter_format ? { parameterFormat: l.parameter_format } : {}),
    },
  );
  const salvos =
    l.saved_values && typeof l.saved_values === "object" && !Array.isArray(l.saved_values)
      ? Object.fromEntries(
          Object.entries(l.saved_values as Record<string, unknown>).filter(
            (e): e is [string, string] => typeof e[1] === "string",
          ),
        )
      : {};
  return {
    name: l.name,
    language: l.language,
    category: l.category,
    status: l.status,
    qualityScore: l.quality_score ?? null,
    vagas: vagasDoModelo(l),
    previa: [previa.cabecalho, previa.corpo].filter((p) => !!p).join("\n\n"),
    valoresSalvos: salvos,
    components: l.components,
    parameterFormat: l.parameter_format ?? "POSITIONAL",
  };
}

/**
 * Os modelos APROVADOS desta conexão, por nome. A linha da própria conexão vence
 * a da conta, como em `linhaDoEspelho`.
 */
export async function modelosAprovadosDaConexao(
  admin: SupabaseClient,
  organizationId: string,
  channelSessionId: string,
): Promise<ModeloDaConexao[]> {
  const { data: sessao, error: erroDaSessao } = await admin
    .from("channel_sessions")
    .select("provider, meta_waba_id")
    .eq("organization_id", organizationId)
    .eq("id", channelSessionId)
    .maybeSingle();
  if (erroDaSessao) throw new Error(`conexao_lookup_failed: ${erroDaSessao.message}`);
  if (!sessao) return [];
  const s = sessao as { provider: string | null; meta_waba_id: string | null };

  const linhas: LinhaDoModelo[] = [];
  const daConexao = await admin
    .from("meta_templates")
    .select(COLUNAS)
    .eq("organization_id", organizationId)
    .eq("channel_session_id", channelSessionId)
    .in("status", [...STATUS_ENVIAVEIS]);
  if (daConexao.error) throw new Error(`modelos_lookup_failed: ${daConexao.error.message}`);
  linhas.push(...((daConexao.data ?? []) as unknown as LinhaDoModelo[]));

  if (s.provider === CHANNEL_PROVIDER_META && s.meta_waba_id) {
    const daConta = await admin
      .from("meta_templates")
      .select(COLUNAS)
      .eq("organization_id", organizationId)
      .is("channel_session_id", null)
      .eq("waba_id", s.meta_waba_id)
      .in("status", [...STATUS_ENVIAVEIS]);
    if (daConta.error) throw new Error(`modelos_lookup_failed: ${daConta.error.message}`);
    linhas.push(...((daConta.data ?? []) as unknown as LinhaDoModelo[]));
  }

  const porChave = new Map<string, LinhaDoModelo>();
  for (const l of linhas) {
    const chave = `${l.name}\u0000${l.language}`;
    const atual = porChave.get(chave);
    if (!atual || (atual.channel_session_id === null && l.channel_session_id !== null)) {
      porChave.set(chave, l);
    }
  }
  return [...porChave.values()]
    .map(paraModelo)
    .sort((a, b) => a.name.localeCompare(b.name, "pt") || a.language.localeCompare(b.language));
}

/** Um modelo desta conexão, em qualquer status. `null` = não está no espelho. */
export async function modeloDaConexao(
  admin: SupabaseClient,
  chave: { organizationId: string; channelSessionId: string; name: string; language: string },
): Promise<ModeloDaConexao | null> {
  const { data, error } = await linhaDoEspelho<LinhaDoModelo>(admin, COLUNAS, chave);
  if (error) throw new Error(`modelo_lookup_failed: ${error.message}`);
  return data ? paraModelo(data) : null;
}

/** O texto que a conversa mostra depois do envio: cabeçalho e corpo com os valores. */
export function textoDoModelo(m: ModeloDaConexao, valores: Record<string, string>): string {
  return renderTemplateBody(m.components, valores, {
    name: m.name,
    language: m.language,
    parameterFormat: m.parameterFormat,
  });
}
