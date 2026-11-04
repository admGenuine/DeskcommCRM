"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "@phosphor-icons/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { randomId } from "@/lib/random-id";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { apiClient } from "@/lib/api/client";
import { useT } from "@/hooks/i18n/useT";
import {
  RAZAO_NAO_SELECIONADA,
  type CampaignConfig,
  type Prospect,
} from "@/lib/prospecting/schema";
import { alcanceDaBusca, mesmaBusca } from "@/lib/prospecting/busca-repetida";
import { ProspectingAgentBuilder, type CreatedProspectingAgent } from "./_create-agent";
import { AprendizadoCard, AvaliacaoDaEmpresa, ReferenciaDaCampanha } from "./_avaliacao";
import { AnaliseDaCampanha, ProcurarNoMaps } from "./_sinais";
import { FicarComAsMelhores, NotaDaEmpresa } from "./_score";
import { DecisorDaEmpresa, UsoDeSociosCard } from "./_decisor";
import type { Decisor } from "@/lib/prospecting/mercado/socios";
import { pontuar } from "@/lib/prospecting/score";
import { passaNoFiltro, type Filtro } from "./_filtro";
import { MercadoForm } from "./_mercado";
import {
  PARAMETRO_DA_CAMPANHA,
  hrefDaCampanha,
  hrefDaEtapa,
  type AbaDaCampanha,
  type Tela,
} from "./_etapas";
import { Andamento, CabecalhoDaCampanha, CabecalhoDaEtapa, Etiqueta } from "./_etapas-ui";
import { EmpresasDaCampanha, bairroDaEmpresa, cidadeDaCampanha } from "./_empresas-da-campanha";
import { SEM_BAIRRO, contarPorBairro } from "@/lib/prospecting/mapa/bairro";
import { podeVoltarPorPerfil, type PerfilAprendido } from "@/lib/prospecting/aprendizado";
import type { ProspectingAgentSetupInput } from "@/lib/prospecting/agent-setup-schema";

type Campaign = {
  id: string;
  name: string;
  search: { niche?: string; location?: string } | null;
  status: string;
  search_status: string;
  error: string | null;
  config: CampaignConfig | null;
  result_count: number;
  skipped_count: number;
  cost_usd: string | null;
  next_send_at: string;
  referencia_em: string | null;
  referencia_motivo: string | null;
  /** Fork, Fase 3b: o gasto da leitura por IA, em centavos de dólar (numeric do Postgres). */
  gasto_ia_centavos?: string | number | null;
  /** Fork, Fase 3b: gasto (e reserva) da busca no Maps do Mercado, em dólares. */
  gasto_maps_usd?: string | number | null;
};
type Candidate = {
  id: string;
  campaign_id: string;
  data: Prospect;
  selected?: boolean;
  status: string;
  lead_id?: string | null;
  progress: string;
  message_status: string | null;
  error: string | null;
  conversation_id: string | null;
  /** Fork, Fase 5: o decisor pelo quadro de sócios, só com o uso ligado. */
  decisores?: Decisor[];
};
type State = {
  configured: boolean;
  campaigns: Campaign[];
  candidates: Candidate[];
  agents: { id: string; name: string }[];
  channels: {
    id: string;
    display_name: string | null;
    phone_number: string | null;
    status: string;
  }[];
  stages: { id: string; name: string; pipeline_id: string; pipeline_name: string }[];
  aprendizado?: PerfilAprendido;
  /** Fork, Fase 5: o uso do quadro de sócios da organização. */
  socios?: { ativo: boolean; base_legal_ref: string | null };
};
const labels: Record<string, string> = {
  draft: "Preparar campanha",
  running: "Em andamento",
  paused: "Pausada",
  completed: "Abordagens concluídas",
  starting: "Iniciando busca",
  succeeded: "Busca concluída",
  failed: "Revisar falha",
  unknown: "Busca sem confirmação",
  new: "Encontrado",
  queued: "Na fila",
  sending: "Preparando abordagem",
  sent: "Abordado",
  skipped: "Não abordado",
  replied: "Respondeu",
  qualified: "Qualificado",
};
const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
/** O teto de `candidate_ids` por chamada (`prospectingInputSchema`). */
const LOTE_DA_SELECAO = 5000;
const emLotes = (ids: readonly string[]) =>
  Array.from({ length: Math.ceil(ids.length / LOTE_DA_SELECAO) }, (_, i) =>
    ids.slice(i * LOTE_DA_SELECAO, (i + 1) * LOTE_DA_SELECAO),
  );
/** Os grupos da lista "Suas campanhas" (etapa 2): um filtro segmentado, como no Radar. */
const GRUPOS_DE_CAMPANHAS = ["todas", "rascunho", "andamento", "encerradas"] as const;
type GrupoDeCampanhas = (typeof GRUPOS_DE_CAMPANHAS)[number];
const ROTULO_DO_GRUPO: Record<GrupoDeCampanhas, string> = {
  todas: "Todas",
  rascunho: "Rascunho",
  andamento: "Andamento",
  encerradas: "Encerradas",
};
const emptyConfig: CampaignConfig = {
  agent_id: "",
  channel_session_id: "",
  pipeline_id: "",
  stage_id: "",
  qualified_stage_id: "",
  instruction: "",
  qualification: "",
  daily_limit: 10,
  interval_minutes: 15,
  legal_basis_ref: "",
  // Campanha nova nasce no modo recomendado; a configuração já gravada manda no que existe.
  funnel_entry: "on_send",
};
/**
 * A tela de uma etapa da Prospecção, ou da campanha aberta (`_etapas.ts`). A
 * lógica é uma só; `etapa` decide o que esta rota mostra:
 *
 *   - `empresas`  : encontrar empresas, perfil aprendido, decisor pelo quadro de
 *                   sócios e os resultados da busca (encontrados / aprovados / recusados);
 *   - `campanhas` : a lista de campanhas (cada uma com o botão Abrir) e os
 *                   resultados da abordagem (fila / responderam / qualificados), com a
 *                   análise das empresas, a nota e a avaliação;
 *   - `campanha`  : a campanha aberta (`campanhaId` vem do caminho), em duas abas:
 *                   `preparar` (nome, referência, ritmo e as empresas achadas, com o
 *                   mapa de bairros) e `abordagem` (o agente, o ritmo e o iniciar).
 *
 * Entre as etapas a campanha escolhida viaja na URL (`?campanha=`); na campanha
 * aberta ela é o próprio caminho, e trocar de campanha troca de rota.
 */
export function ProspectingClient({
  etapa,
  campanhaId = null,
  aba = "preparar",
}: {
  readonly etapa: Tela;
  readonly campanhaId?: string | null;
  readonly aba?: AbaDaCampanha;
}) {
  const t = useT();
  const query = useQuery({
    queryKey: ["prospecting"],
    queryFn: async () => (await apiClient.get<{ data: State }>("/api/v1/prospecting")).data,
    refetchInterval: 10000,
  });
  const data = query.data;
  const searchAttempt = useRef<{ fingerprint: string; id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [settings, setSettings] = useState(false);
  const busca = useSearchParams();
  const caminho = usePathname();
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(
    () => campanhaId ?? busca.get(PARAMETRO_DA_CAMPANHA),
  );
  // Na campanha aberta a campanha é o caminho: quando a rota muda, a escolha acompanha
  // (estado derivado da prop durante a renderização, sem efeito).
  const [campanhaDaRota, setCampanhaDaRota] = useState(campanhaId);
  if (campanhaId !== campanhaDaRota) {
    setCampanhaDaRota(campanhaId);
    if (campanhaId) setSelected(campanhaId);
  }
  // Etapa 2: qual grupo da lista de campanhas está à mostra.
  const [grupoDeCampanhas, setGrupoDeCampanhas] = useState<GrupoDeCampanhas>("todas");
  /**
   * Escolher a campanha grava na URL, para a etapa seguinte abrir na mesma.
   * `history.replaceState` e não `router.replace`, pela razão medida na Agenda
   * (#1629): a History API troca a query sem pedir um novo Server Component, e
   * trocar de campanha não é navegação nova (com `push`, o "voltar" acumularia
   * um passo por clique).
   */
  function escolherCampanha(id: string | null) {
    setSelected(id);
    if (etapa === "campanha") {
      // A campanha aberta é uma rota por campanha: trocar é ir para a outra, na mesma aba.
      if (id) router.replace(hrefDaCampanha(id, aba));
      return;
    }
    const parametros = new URLSearchParams(busca.toString());
    if (id) parametros.set(PARAMETRO_DA_CAMPANHA, id);
    else parametros.delete(PARAMETRO_DA_CAMPANHA);
    const query = parametros.toString();
    window.history.replaceState(null, "", query ? `${caminho}?${query}` : caminho);
  }
  const [filtro, setFiltro] = useState<{ tipo: Filtro }>({ tipo: "todos" });
  const resultados = useRef<HTMLDivElement>(null);
  const [niche, setNiche] = useState("");
  const [location, setLocation] = useState("");
  const [limit, setLimit] = useState(20);
  const [budget, setBudget] = useState(1);
  const [enrich, setEnrich] = useState(true);
  // De onde vêm as empresas: a busca paga no Maps ou o mercado da Receita (`_mercado.tsx`).
  const [fonte, setFonte] = useState<"maps" | "mercado">("maps");
  const [campaignDrafts, setCampaignDrafts] = useState<Record<string, CampaignConfig>>({});
  const [manualCampaigns, setManualCampaigns] = useState<Record<string, boolean>>({});
  const [createdAgents, setCreatedAgents] = useState<{ id: string; name: string }[]>([]);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  // Edição do ritmo de uma campanha PAUSADA; vale para uma campanha por vez.
  const [ritmo, setRitmo] = useState<{
    campaignId: string;
    daily_limit: number;
    interval_minutes: number;
  } | null>(null);
  // Nas etapas, sem escolha vale a campanha mais recente; na campanha aberta, só a do caminho.
  const campaign =
    data?.campaigns.find((c) => c.id === selected) ??
    (etapa === "campanha" ? undefined : data?.campaigns[0]);
  // A stored config is frozen by activation; unsaved choices belong to one campaign.
  const config = campaign?.config ?? (campaign && campaignDrafts[campaign.id]) ?? emptyConfig;
  const funil = config.pipeline_id;
  const manual = !!campaign && (manualCampaigns[campaign.id] || !!campaign.config);
  const agents = [
    ...new Map(
      [...(data?.agents ?? []), ...createdAgents].map((agent) => [agent.id, agent]),
    ).values(),
  ];
  function setConfig(update: CampaignConfig | ((previous: CampaignConfig) => CampaignConfig)) {
    if (!campaign || campaign.config) return;
    setCampaignDrafts((drafts) => ({
      ...drafts,
      [campaign.id]:
        typeof update === "function" ? update(drafts[campaign.id] ?? emptyConfig) : update,
    }));
  }
  async function selectCreatedAgent(
    campaignId: string,
    result: CreatedProspectingAgent,
    setup: Omit<
      ProspectingAgentSetupInput,
      "request_id" | "campaign_id" | "enable_router_continuity"
    >,
  ) {
    setCreatedAgents((current) => [
      ...current.filter((agent) => agent.id !== result.agent.id),
      result.agent,
    ]);
    setCampaignDrafts((drafts) => ({
      ...drafts,
      [campaignId]: {
        ...(drafts[campaignId] ?? emptyConfig),
        agent_id: result.agent.id,
        channel_session_id: setup.channel_session_id,
        pipeline_id: setup.pipeline_id,
        stage_id: setup.stage_id,
        qualified_stage_id: setup.qualified_stage_id,
        instruction: setup.instruction,
        qualification: setup.qualification,
      },
    }));
    setManualCampaigns((current) => ({ ...current, [campaignId]: false }));
    await query.refetch();
    setNotice(
      `${t("Agente publicado e selecionado.")} ${result.model_label}. ${t("Revise o ritmo e inicie a campanha quando estiver pronto.")}`,
    );
  }
  const candidates = data?.candidates.filter((c) => c.campaign_id === campaign?.id) ?? [];
  // Empresas que a busca digitada já trouxe em outras campanhas: a busca nova
  // passa por elas e vai mais fundo no Maps (`lib/prospecting/busca-repetida.ts`).
  const campanhasDaMesmaBusca = new Set(
    (data?.campaigns ?? [])
      .filter((c) => mesmaBusca(c.search ?? {}, { niche, location }))
      .map((c) => c.id),
  );
  const conhecidosDaBusca = campanhasDaMesmaBusca.size
    ? (data?.candidates ?? []).filter((c) => campanhasDaMesmaBusca.has(c.campaign_id)).length
    : 0;
  async function perform(body: unknown, message: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiClient.post("/api/v1/prospecting", body);
      await query.refetch();
      setNotice(message);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Não foi possível concluir a operação."));
      return false;
    } finally {
      setBusy(false);
    }
  }
  const update = <K extends keyof CampaignConfig>(field: K, value: CampaignConfig[K]) =>
    setConfig((c) => ({ ...c, [field]: value }));
  function alternarEdicaoDoRitmo(c: Campaign) {
    if (!c.config) return;
    const { daily_limit, interval_minutes } = c.config;
    setRitmo((atual) =>
      atual?.campaignId === c.id ? null : { campaignId: c.id, daily_limit, interval_minutes },
    );
  }
  const ritmoValido =
    !!ritmo &&
    Number.isInteger(ritmo.daily_limit) &&
    ritmo.daily_limit >= 1 &&
    ritmo.daily_limit <= 50 &&
    Number.isInteger(ritmo.interval_minutes) &&
    ritmo.interval_minutes >= 5 &&
    ritmo.interval_minutes <= 1440;
  async function salvarRitmo() {
    if (!ritmo || !ritmoValido) return;
    const salvou = await perform(
      {
        action: "adjust_pace",
        id: ritmo.campaignId,
        daily_limit: ritmo.daily_limit,
        interval_minutes: ritmo.interval_minutes,
      },
      t("Ritmo atualizado. A campanha continua pausada."),
    );
    if (salvou) setRitmo(null);
  }
  const buscaConcluida = !!campaign && campaign.search_status === "succeeded";
  const noRascunho = buscaConcluida && campaign?.status === "draft";
  // Depois de iniciada, a fila só se mexe com a campanha PAUSADA: o envio não está no meio
  // de uma abordagem. Quem já foi abordado, falhou ou está sendo preparado não muda.
  const naFilaPausada = buscaConcluida && campaign?.status === "paused";
  const canSelect = noRascunho || naFilaPausada;
  const criaSoNoEnvio = campaign?.config?.funnel_entry === "on_send";
  /**
   * Linha que a caixa pode alterar agora. Espelha as regras do servidor: na preparação,
   * `selecionarNaPreparacao` (a "Encontrado" e a recusada só por perfil, que volta ao ser
   * marcada); na fila pausada, `selecionarNaFila`.
   */
  const marcavel = (c: Candidate) => {
    if (noRascunho)
      return (
        c.status === "new" ||
        podeVoltarPorPerfil({ status: c.status, error: c.error, phone: c.data.phone })
      );
    if (c.status === "queued") return true;
    return (
      c.status === "skipped" &&
      c.selected === false &&
      c.error === RAZAO_NAO_SELECIONADA &&
      (criaSoNoEnvio || !!c.conversation_id)
    );
  };
  const elegiveis = canSelect ? candidates.filter(marcavel) : [];
  // Vai ser abordada: não foi recusada e não foi desmarcada. A recusada nasce com
  // `selected` verdadeiro, e a caixa dela aparecia marcada sem estar na fila.
  const estaMarcada = (c: Candidate) => c.status !== "skipped" && c.selected !== false;
  // "Marcar todas" da etapa 1 vale para as aprovadas: trazer de volta uma recusada é
  // decisão empresa a empresa, na campanha aberta, onde dá para ver cada uma.
  const elegiveisDaBusca = elegiveis.filter((c) => !(noRascunho && c.status === "skipped"));
  const allSelected = elegiveisDaBusca.length > 0 && elegiveisDaBusca.every((c) => estaMarcada(c));
  // Critério do #2048, medido sobre as linhas que a caixa pode alterar agora, não a fila inteira.
  const noneSelected = elegiveisDaBusca.every((c) => !estaMarcada(c));
  const desmarcadas = candidates.filter((c) => c.selected === false);
  /**
   * O que o botão "Excluir desmarcadas" realmente apaga. Espelha o `where` do servidor: sem
   * negócio nem conversa (o que já virou registro do CRM não é daqui) e só o que o operador
   * tirou. Numa campanha que criou o contato ao iniciar, toda desmarcada da fila já tem
   * conversa — e o botão não aparece, em vez de dizer "excluído" sem ter excluído nada.
   * (A linha-tomba de LGPD tem `error` nulo, então também fica de fora.)
   */
  const descartaveis = desmarcadas.filter(
    (c) =>
      !c.conversation_id &&
      !c.lead_id &&
      (c.status === "new" || (c.status === "skipped" && c.error === RAZAO_NAO_SELECIONADA)),
  );
  /** Marca ou desmarca, em lotes do tamanho que a rota aceita (`candidate_ids` até 5000). */
  async function setSelection(candidateIds: string[], selected: boolean) {
    if (!campaign || candidateIds.length === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      for (const lote of emLotes(candidateIds))
        await apiClient.post("/api/v1/prospecting", {
          action: noRascunho ? "select" : "select_in_queue",
          id: campaign.id,
          candidate_ids: lote,
          selected,
        });
      await query.refetch();
      setNotice(t("Seleção da fila atualizada."));
    } catch (e) {
      await query.refetch();
      setError(e instanceof Error ? e.message : t("Não foi possível concluir a operação."));
    } finally {
      setBusy(false);
    }
  }
  // Fork (Fase 4): a nota de cada empresa, calculada na hora (`lib/prospecting/score.ts`).
  const scores = new Map(candidates.map((c) => [c.id, pontuar(c.data, data?.aprendizado)]));
  const notaDe = (c: Candidate) => scores.get(c.id)?.nota ?? 0;
  // Disputam a escolha só as linhas que a seleção altera de fato: na preparação o servidor
  // só mexe em quem está como "Encontrado"; na fila pausada, nas que a caixa pode marcar.
  const naDisputa = elegiveis
    .filter((c) => !noRascunho || c.status === "new")
    .map((c) => ({
      id: c.id,
      selected: c.selected,
      nota: notaDe(c),
      semAnaliseDoSite: scores.get(c.id)?.semAnaliseDoSite ?? true,
    }));
  async function ficarComAsMelhores(entram: string[], saem: string[]) {
    if (!campaign) return false;
    const action = noRascunho ? "select" : "select_in_queue";
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      for (const [ids, selected] of [
        [saem, false],
        [entram, true],
      ] as const)
        for (const lote of emLotes(ids))
          await apiClient.post("/api/v1/prospecting", {
            action,
            id: campaign.id,
            candidate_ids: lote,
            selected,
          });
      await query.refetch();
      setNotice(t("Seleção ajustada: ficaram marcadas só as melhores pela nota."));
      return true;
    } catch (e) {
      await query.refetch();
      setError(e instanceof Error ? e.message : t("Não foi possível concluir a operação."));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function excluirDesmarcadas() {
    if (!campaign) return;
    const excluiu = await perform(
      { action: "discard_unselected", id: campaign.id },
      t("Empresas desmarcadas excluídas."),
    );
    if (excluiu) setConfirmandoExclusao(false);
  }
  const count = (filtro: Filtro) => candidates.filter((c) => passaNoFiltro(c, filtro)).length;
  // Recusado = não vai (ou não foi) abordado, com o motivo gravado pela régua de
  // aceite (`lib/prospecting/aceite`) ou pelo envio. O motivo vem do banco.
  const recusados = candidates.filter((c) => c.status === "skipped");
  const motivosDeRecusa = Object.entries(
    recusados.reduce<Record<string, number>>((acc, c) => {
      const motivo = c.error ?? t("Sem motivo registrado");
      acc[motivo] = (acc[motivo] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  // Os contadores da etapa 2 filtram a tabela de resultados (`_filtro.ts`). Fork,
  // 2026-11-04: a tabela mostra também as desmarcadas (a caixa vazia diz que ela
  // não vai), porque o "Mostrar desmarcadas" saiu com o resto da barra de seleção,
  // que agora mora na campanha aberta. A ordem é pela nota, da maior para a menor.
  const visiveis = candidates.filter((c) => passaNoFiltro(c, filtro.tipo));
  const linhas = [...visiveis].sort((a, b) => notaDe(b) - notaDe(a));
  const rotulosDosFiltros: Record<Filtro, string> = {
    todos: t("Encontrados"),
    aprovados: t("Aprovados"),
    recusados: t("Recusados"),
    fila: t("Na fila"),
    responderam: t("Responderam"),
    qualificados: t("Qualificados"),
  };
  // Cada etapa conta o que lhe diz respeito: a 1 o que a busca achou, a 2 o que a
  // abordagem fez. Os seis filtros continuam existindo em `_filtro.ts`.
  const filtrosDaEtapa: readonly Filtro[] =
    etapa === "campanhas"
      ? ["fila", "responderam", "qualificados"]
      : ["todos", "aprovados", "recusados"];
  const campanhaNaUrl = campaign?.id ?? null;
  // O botão Iniciar desligado diz por quê (fork, 2026-11-04). A ordem é a do que
  // falta primeiro: sem empresa marcada a fila nasceria vazia.
  const semMarcadas = t("Nenhuma empresa marcada para abordar.");
  const semConexao = t("Nenhuma conexão de WhatsApp ativa.");
  const faltaParaIniciar = !candidates.some((c) => c.status === "new" && c.selected !== false)
    ? semMarcadas
    : !data?.channels.some((c) => c.status === "WORKING")
      ? semConexao
      : !agents.length
        ? t("Nenhum agente publicado: crie um pela conversa acima.")
        : null;
  // Os três números do cabeçalho da campanha aberta.
  const aprovadasDaCampanha = candidates.filter((c) => c.status !== "skipped");
  const marcadasDaCampanha = aprovadasDaCampanha.filter((c) => c.selected !== false);
  const cidadeDaCampanhaAberta = cidadeDaCampanha(candidates, campaign?.search?.location);
  const bairrosDaCampanha = contarPorBairro(candidates, (c) =>
    bairroDaEmpresa(c, cidadeDaCampanhaAberta),
  ).filter((b) => b.bairro !== SEM_BAIRRO).length;
  const grupoDaCampanha = (c: Campaign): Exclude<GrupoDeCampanhas, "todas"> =>
    c.status === "running" || c.status === "paused"
      ? "andamento"
      : c.status === "completed"
        ? "encerradas"
        : "rascunho";
  const campanhasDoGrupo = (data?.campaigns ?? []).filter(
    (c) => grupoDeCampanhas === "todas" || grupoDaCampanha(c) === grupoDeCampanhas,
  );
  const contaDaCampanha = (id: string, tipo: Filtro) =>
    (data?.candidates ?? []).filter((c) => c.campaign_id === id && passaNoFiltro(c, tipo)).length;
  /** Etapa 2: o cartão da campanha, inteiro, mostra os resultados dela na coluna ao lado. */
  function verResultados(id: string) {
    escolherCampanha(id);
    setFiltro({ tipo: "todos" });
    setNotice(null);
    // A confirmação de exclusão vale para UMA campanha: ao trocar, ela some.
    setConfirmandoExclusao(false);
    // Numa coluna só (celular), os resultados ficam embaixo da lista: leva até eles.
    if (window.matchMedia?.("(max-width: 1023px)").matches)
      window.requestAnimationFrame(() =>
        resultados.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
  }
  const recusadasPorCampanha = (data?.candidates ?? []).reduce<Record<string, number>>(
    (acc, c) =>
      c.status === "skipped" ? { ...acc, [c.campaign_id]: (acc[c.campaign_id] ?? 0) + 1 } : acc,
    {},
  );
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 md:p-8">
      {etapa === "campanha" ? (
        <CabecalhoDaCampanha
          campanha={campaign ?? null}
          campanhas={data?.campaigns ?? []}
          aba={aba}
          situacao={campaign ? t(labels[campaign.status] ?? campaign.status) : ""}
          busca={campaign ? t(labels[campaign.search_status] ?? campaign.search_status) : ""}
          numeros={{
            aprovadas: aprovadasDaCampanha.length,
            marcadas: marcadasDaCampanha.length,
            bairros: bairrosDaCampanha,
          }}
          onTrocar={(id) => escolherCampanha(id)}
        />
      ) : (
        <CabecalhoDaEtapa
          etapa={etapa}
          campanhaId={campanhaNaUrl}
          acao={
            etapa === "empresas" ? (
              <Button variant="outline" onClick={() => setSettings((s) => !s)}>
                {t("Configurar busca")}
              </Button>
            ) : null
          }
        />
      )}
      {(error || query.error) && (
        <div
          role="alert"
          className="rounded-lg border border-destructive p-4 text-sm text-destructive"
        >
          {error ??
            (query.error instanceof Error
              ? query.error.message
              : t("Falha ao carregar a prospecção."))}
        </div>
      )}
      {notice && (
        <div role="status" className="rounded-lg border bg-muted/30 p-3 text-sm">
          {notice}
        </div>
      )}
      {!data && !query.error && <p role="status">{t("Carregando campanhas…")}</p>}
      {etapa === "empresas" && (
        <>
          {(settings || data?.configured === false) && (
            <Card className="p-5">
              <form
                className="flex flex-col gap-3 sm:flex-row sm:items-end"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (
                    await perform({ action: "configure", api_key: key }, t("Chave de busca salva."))
                  ) {
                    setKey("");
                    setSettings(false);
                  }
                }}
              >
                <div className="flex-1">
                  <Label htmlFor="prospecting-key">{t("Chave da Apify")}</Label>
                  <Input
                    id="prospecting-key"
                    type="password"
                    autoComplete="off"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    required
                    minLength={10}
                    className="mt-2"
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t(
                      "A chave fica cifrada no servidor. Cada busca tem seu próprio limite de gasto.",
                    )}
                  </p>
                </div>
                <Button disabled={busy || !key} type="submit">
                  {t("Salvar chave")}
                </Button>
              </form>
            </Card>
          )}
          <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
            <aside className="flex flex-col gap-5">
              <Card className="p-5">
                <h2 className="text-lg font-semibold">{t("Encontrar empresas")}</h2>
                <div
                  role="group"
                  aria-label={t("De onde vêm as empresas")}
                  className="mt-3 grid grid-cols-2 gap-1 rounded-md bg-muted p-1"
                >
                  <Button
                    type="button"
                    size="sm"
                    variant={fonte === "maps" ? "default" : "ghost"}
                    aria-pressed={fonte === "maps"}
                    onClick={() => setFonte("maps")}
                  >
                    {t("Google Maps")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={fonte === "mercado" ? "default" : "ghost"}
                    aria-pressed={fonte === "mercado"}
                    onClick={() => setFonte("mercado")}
                  >
                    {t("Mercado (Receita)")}
                  </Button>
                </div>
                {fonte === "mercado" ? (
                  <MercadoForm
                    busy={busy}
                    onCriar={async (body) => {
                      const criada = await perform(
                        { action: "market_campaign", ...body },
                        t(
                          "Campanha criada com as empresas do mercado. Revise a lista e prepare a abordagem.",
                        ),
                      );
                      if (criada) escolherCampanha(null);
                      return criada;
                    }}
                  />
                ) : (
                  <form
                    className="mt-4 space-y-4"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const fingerprint = JSON.stringify([niche, location, limit, budget, enrich]);
                      if (searchAttempt.current?.fingerprint !== fingerprint)
                        searchAttempt.current = { fingerprint, id: randomId() };
                      const success = await perform(
                        {
                          action: "search",
                          request_id: searchAttempt.current.id,
                          search: {
                            name: `${niche} · ${location}`.slice(0, 120),
                            niche,
                            location,
                            limit,
                            budget_usd: budget,
                            enrich,
                          },
                        },
                        t("Solicitação registrada. Acompanhe o estado da busca nesta tela."),
                      );
                      if (success) {
                        escolherCampanha(null);
                        searchAttempt.current = null;
                      }
                    }}
                  >
                    <div>
                      <Label htmlFor="prospecting-niche">{t("Público ou segmento")}</Label>
                      <Input
                        id="prospecting-niche"
                        value={niche}
                        onChange={(e) => setNiche(e.target.value)}
                        placeholder={t("Ex.: clínicas de estética")}
                        minLength={2}
                        maxLength={120}
                        required
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="prospecting-location">{t("Cidade ou região")}</Label>
                      <Input
                        id="prospecting-location"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        placeholder={t("Ex.: São Paulo, SP")}
                        minLength={2}
                        maxLength={160}
                        required
                        className="mt-1"
                      />
                    </div>
                    <div className="grid grid-cols-2 items-end gap-3">
                      <div>
                        <Label htmlFor="prospecting-limit">{t("Até quantas empresas")}</Label>
                        <Input
                          id="prospecting-limit"
                          type="number"
                          min={1}
                          max={100}
                          value={limit}
                          onChange={(e) => setLimit(Number(e.target.value))}
                          required
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label htmlFor="prospecting-budget">{t("Teto da busca (US$)")}</Label>
                        <Input
                          id="prospecting-budget"
                          type="number"
                          min={0.5}
                          max={10}
                          step={0.5}
                          value={budget}
                          onChange={(e) => setBudget(Number(e.target.value))}
                          required
                          className="mt-1"
                        />
                      </div>
                    </div>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={enrich}
                        onChange={(e) => setEnrich(e.target.checked)}
                        className="mt-1"
                      />
                      {t("Enriquecer com e-mails comerciais e redes encontradas no site")}
                    </label>
                    {conhecidosDaBusca > 0 && (
                      <p role="status" className="rounded-md border bg-muted/30 p-3 text-xs">
                        {conhecidosDaBusca}{" "}
                        {t(
                          "empresas desta busca já estão nas suas campanhas e não vão se repetir.",
                        )}{" "}
                        {t("Para trazer novas, a busca vai olhar até")}{" "}
                        {alcanceDaBusca(limit || 0, conhecidosDaBusca)}{" "}
                        {t("lugares no Maps, dentro do teto de gasto.")}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {t(
                        "A pesquisa usa seu saldo da Apify. A quantidade encontrada pode ser menor que o limite. Nenhuma abordagem começa nesta etapa.",
                      )}
                    </p>
                    <Button className="w-full" type="submit" disabled={busy || !data?.configured}>
                      {busy ? t("Aguarde…") : t("Buscar empresas")}
                    </Button>
                  </form>
                )}
              </Card>
              <AprendizadoCard perfil={data?.aprendizado} />
              <UsoDeSociosCard
                estado={data?.socios}
                busy={busy}
                onSalvar={(pedido) =>
                  perform(
                    { action: "socios_config", ...pedido },
                    pedido.ativo
                      ? t("Quadro de sócios ligado. O decisor aparece em cada empresa com CNPJ.")
                      : t("Quadro de sócios desligado. Nenhum sócio é mostrado."),
                  )
                }
              />
            </aside>
            <div className="min-w-0 space-y-5">
              {!campaign && (
                <Card className="flex min-h-80 flex-col items-center justify-center gap-3 p-8 text-center">
                  <h2 className="text-xl font-semibold">{t("Sua próxima conversa começa aqui")}</h2>
                  <p className="max-w-md text-sm text-muted-foreground">
                    {t(
                      "Escolha um segmento e uma região. Depois da pesquisa, defina como a IA deve abordar e o que precisa confirmar para qualificar.",
                    )}
                  </p>
                </Card>
              )}
              {campaign && (
                <Card className="flex flex-col gap-4 p-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <Etiqueta tom={buscaConcluida ? "forte" : "neutro"}>
                      {t(labels[campaign.search_status] ?? campaign.search_status)}
                    </Etiqueta>
                    <Etiqueta>{t(labels[campaign.status] ?? campaign.status)}</Etiqueta>
                  </div>
                  <div className="flex flex-col gap-1">
                    <h2 className="text-2xl font-semibold tracking-tight break-words">
                      {campaign.name}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {campaign.search?.location ? `${campaign.search.location} · ` : ""}
                      {campaign.result_count}{" "}
                      {campaign.result_count === 1 ? t("empresa") : t("empresas")}
                      {campaign.cost_usd !== null
                        ? ` · US$ ${Number(campaign.cost_usd).toFixed(2)}`
                        : ""}
                    </p>
                  </div>
                  {campaign.error &&
                    // Busca concluída e campanha ainda em rascunho: o campo traz o
                    // AVISO da busca (já em outra campanha, busca interrompida), não
                    // uma falha. Ver `avisoDaBusca` em lib/prospecting/store.ts.
                    (campaign.status === "draft" && campaign.search_status === "succeeded" ? (
                      <p className="rounded-lg border p-3 text-sm text-muted-foreground">
                        {campaign.error}
                      </p>
                    ) : (
                      <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm">
                        {campaign.error}
                      </p>
                    ))}
                  {campaign.skipped_count > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {campaign.skipped_count}{" "}
                      {t("resultados repetidos ou indisponíveis foram desconsiderados.")}
                    </p>
                  )}
                  {buscaConcluida && (
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                      <p className="max-w-md text-sm text-muted-foreground">
                        {t(
                          "As aprovadas seguem para a campanha. A abordagem só começa na campanha aberta, pela etapa 2.",
                        )}
                      </p>
                      <Button asChild>
                        <Link href={hrefDaEtapa("campanhas", campaign.id)}>
                          {t("Levar aprovadas para a campanha")}
                          <ArrowUpRight size={14} aria-hidden />
                        </Link>
                      </Button>
                    </div>
                  )}
                </Card>
              )}
              {campaign && candidates.length > 0 && (
                <Card ref={resultados} className="flex scroll-mt-4 flex-col gap-5 p-6">
                  <div className="flex flex-col gap-1">
                    <h2 className="text-lg font-semibold">{t("Acompanhar resultados")}</h2>
                    <p className="text-sm text-muted-foreground">
                      {t(
                        "Encontrado é diferente de qualificado. A qualificação depende do que for confirmado na conversa.",
                      )}
                    </p>
                  </div>
                  {canSelect && (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-elevated px-4 py-3">
                      <span className="max-w-md text-sm text-muted-foreground">
                        {noRascunho
                          ? t(
                              "Somente as empresas marcadas entram na fila ao iniciar as abordagens.",
                            )
                          : t(
                              "Com a campanha pausada, marque ou desmarque as empresas que ainda estão na fila. Quem já foi abordado não muda.",
                            )}
                      </span>
                      <span className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy || elegiveisDaBusca.length === 0 || allSelected}
                          onClick={() =>
                            setSelection(
                              elegiveisDaBusca.map((c) => c.id),
                              true,
                            )
                          }
                        >
                          {t("Marcar todas")}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy || noneSelected}
                          onClick={() =>
                            setSelection(
                              elegiveisDaBusca.map((c) => c.id),
                              false,
                            )
                          }
                        >
                          {t("Desmarcar todas")}
                        </Button>
                      </span>
                    </div>
                  )}
                  <div className="flex flex-col gap-3">
                    <dl className="grid grid-cols-3 overflow-hidden rounded-xl border">
                      {filtrosDaEtapa.map((tipo, indice) => (
                        <div
                          key={tipo}
                          className={`flex flex-col gap-0.5 px-4 py-3 ${indice > 0 ? "border-l" : ""}`}
                        >
                          <dd className="text-3xl font-normal tracking-tight tabular-nums">
                            {count(tipo)}
                          </dd>
                          <dt className="text-xs text-muted-foreground">
                            {rotulosDosFiltros[tipo]}
                          </dt>
                        </div>
                      ))}
                    </dl>
                    <div
                      aria-hidden="true"
                      className="flex h-2 overflow-hidden rounded-full bg-surface-elevated"
                    >
                      <i
                        className="block h-full bg-primary"
                        style={{ width: `${(count("aprovados") / candidates.length) * 100}%` }}
                      />
                      <i
                        className="block h-full bg-border-strong"
                        style={{ width: `${(count("recusados") / candidates.length) * 100}%` }}
                      />
                    </div>
                  </div>
                  {motivosDeRecusa.length > 0 && (
                    <div className="flex flex-col gap-3 rounded-xl border p-4">
                      <h3 className="text-sm font-medium">{t("Por que ficaram de fora")}</h3>
                      <ul className="flex flex-col gap-3">
                        {motivosDeRecusa.map(([motivo, quantos]) => (
                          <li
                            key={motivo}
                            className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-3"
                          >
                            <span className="text-right text-base font-medium tabular-nums">
                              {quantos}
                            </span>
                            <span className="flex min-w-0 flex-col gap-1.5">
                              <span className="text-sm text-muted-foreground">{motivo}</span>
                              <span
                                aria-hidden="true"
                                className="block h-1.5 overflow-hidden rounded-full bg-surface-elevated"
                              >
                                <i
                                  className="block h-full bg-border-strong"
                                  style={{ width: `${(quantos / recusados.length) * 100}%` }}
                                />
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </Card>
              )}
            </div>
          </div>
        </>
      )}
      {etapa === "campanhas" && (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,430px)_1fr]">
          <section
            aria-labelledby="suas-campanhas"
            className="flex flex-col gap-3.5 rounded-xl border bg-card p-4"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="suas-campanhas" className="text-base font-medium">
                {t("Suas campanhas")}
              </h2>
              <span className="text-xs text-text-subtle">
                {data?.campaigns.length ?? 0}{" "}
                {data?.campaigns.length === 1 ? t("campanha") : t("campanhas")}
                {" · "}
                {
                  (data?.campaigns ?? []).filter((c) => grupoDaCampanha(c) === "andamento").length
                }{" "}
                {t("em andamento")}
              </span>
            </div>
            <div
              role="group"
              aria-label={t("Filtrar campanhas")}
              className="flex flex-wrap gap-0.5 rounded-full bg-surface-elevated p-1"
            >
              {GRUPOS_DE_CAMPANHAS.map((grupo) => {
                const ativo = grupoDeCampanhas === grupo;
                const quantos =
                  grupo === "todas"
                    ? (data?.campaigns.length ?? 0)
                    : (data?.campaigns ?? []).filter((c) => grupoDaCampanha(c) === grupo).length;
                return (
                  <button
                    key={grupo}
                    type="button"
                    aria-pressed={ativo}
                    onClick={() => setGrupoDeCampanhas(grupo)}
                    className={`flex-1 rounded-full px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                      ativo
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t(ROTULO_DO_GRUPO[grupo])}
                    <span className="ml-1.5 font-normal opacity-65">{quantos}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-col gap-2">
              {campanhasDoGrupo.map((c) => {
                const atual = campaign?.id === c.id;
                const grupo = grupoDaCampanha(c);
                return (
                  <article
                    key={c.id}
                    aria-label={c.name}
                    className={`relative grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 rounded-xl border p-4 transition-colors ${
                      atual
                        ? "border-primary bg-card ring-1 ring-primary"
                        : "bg-card hover:border-border-strong hover:bg-surface-elevated"
                    }`}
                  >
                    {/* O cartão inteiro mostra os resultados desta campanha ao lado (fork,
                        2026-11-04: o dono clicava no cartão e só o Abrir respondia). Os textos
                        deixam o clique passar; os botões ficam por cima. */}
                    <button
                      type="button"
                      aria-pressed={atual}
                      aria-label={`${t("Ver resultados de")} ${c.name}`}
                      onClick={() => verResultados(c.id)}
                      className="absolute inset-0 cursor-pointer rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    />
                    <div className="pointer-events-none relative flex min-w-0 flex-wrap items-center gap-2">
                      <Etiqueta tom={grupo === "andamento" ? "forte" : "neutro"}>
                        {t(labels[c.status] ?? c.status)}
                      </Etiqueta>
                      <span className="text-base font-medium break-words">{c.name}</span>
                      {c.referencia_em && (
                        <span className="text-xs text-muted-foreground">{t("Referência")}</span>
                      )}
                    </div>
                    <Button
                      asChild
                      size="sm"
                      variant={atual ? "default" : "outline"}
                      className="relative col-start-2 row-span-2 self-start rounded-full"
                    >
                      <Link
                        href={hrefDaCampanha(c.id)}
                        aria-label={`${t("Abrir a campanha")} ${c.name}`}
                      >
                        {t("Abrir")}
                        <ArrowUpRight size={14} aria-hidden />
                      </Link>
                    </Button>
                    <div className="pointer-events-none relative col-start-1 flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
                      <span>
                        {c.search?.location ? `${c.search.location} · ` : ""}
                        {t(labels[c.search_status] ?? c.search_status)}
                        {" · "}
                        {c.result_count} {t("empresas")}
                        {recusadasPorCampanha[c.id]
                          ? ` · ${recusadasPorCampanha[c.id]} ${recusadasPorCampanha[c.id] === 1 ? t("recusada") : t("recusadas")}`
                          : ""}
                        {c.config &&
                          ` · ${t("ritmo")} ${c.config.daily_limit} ${t("em 24 h")}, ${c.config.interval_minutes} ${t("min entre elas")}`}
                      </span>
                      <span className="flex flex-wrap gap-1">
                        {(["fila", "responderam", "qualificados"] as const).map((tipo) => (
                          <span key={tipo} className="rounded-md bg-muted px-2 py-0.5">
                            {rotulosDosFiltros[tipo]} {contaDaCampanha(c.id, tipo)}
                          </span>
                        ))}
                      </span>
                    </div>
                    <div className="pointer-events-none relative col-span-2 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <span
                        className={`text-xs ${atual ? "font-medium text-foreground" : "text-text-subtle"}`}
                      >
                        {atual
                          ? `✓ ${t("Mostrando os resultados")}`
                          : t("Clique para ver os resultados")}
                      </span>
                      {c.status === "running" && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            perform({ action: "pause", id: c.id }, t("Novas abordagens pausadas."))
                          }
                          className="pointer-events-auto inline-flex min-h-8 items-center rounded-full border bg-card px-3 text-xs hover:bg-muted"
                        >
                          {t("Pausar abordagens")}
                        </button>
                      )}
                      {c.status === "paused" && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            perform({ action: "resume", id: c.id }, t("Campanha retomada."))
                          }
                          className="pointer-events-auto inline-flex min-h-8 items-center rounded-full border bg-card px-3 text-xs hover:bg-muted"
                        >
                          {t("Retomar fila")}
                        </button>
                      )}
                      {c.status === "draft" && c.search_status === "succeeded" && !c.config && (
                        <span className="text-xs text-text-subtle">
                          {t("Abordagem ainda não configurada")}
                        </span>
                      )}
                    </div>
                  </article>
                );
              })}
              {data && campanhasDoGrupo.length === 0 && (
                <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                  {data.campaigns.length === 0
                    ? t("Nenhuma campanha ainda.")
                    : t("Nenhuma campanha neste grupo.")}
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("Campanha nova nasce na etapa 1, quando você aprova empresas de uma busca.")}{" "}
              <Link href={hrefDaEtapa("empresas", null)} className="underline">
                {t("Nova busca")}
              </Link>
            </p>
          </section>
          <div className="flex min-w-0 flex-col gap-5">
            {data && !campaign && (
              <Card className="flex min-h-80 flex-col items-center justify-center gap-3 p-8 text-center">
                <h2 className="text-xl font-semibold">{t("Nenhuma campanha ainda")}</h2>
                <p className="max-w-md text-sm text-muted-foreground">
                  {t(
                    "Encontre empresas na etapa 1. Cada busca aprovada aparece aqui como uma campanha.",
                  )}
                </p>
                <Button asChild variant="outline">
                  <Link href={hrefDaEtapa("empresas", null)}>{t("Ir para a etapa 1")}</Link>
                </Button>
              </Card>
            )}
            {campaign && candidates.length === 0 && (
              <Card ref={resultados} className="flex scroll-mt-4 flex-col gap-3 p-6">
                <h2 className="text-lg font-semibold">{t("Resultados")}</h2>
                <p className="text-sm text-muted-foreground">
                  {campaign.search_status === "succeeded"
                    ? t("Esta campanha não tem empresas para abordar")
                    : t("A busca desta campanha ainda não terminou")}
                  {" · "}
                  {campaign.name}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline">
                    <Link href={hrefDaEtapa("empresas", campaign.id)}>
                      {t("Ir para a etapa 1")}
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href={hrefDaCampanha(campaign.id)}>{t("Abrir a campanha")}</Link>
                  </Button>
                </div>
              </Card>
            )}
            {campaign && candidates.length > 0 && (
              <Card ref={resultados} className="scroll-mt-4 overflow-hidden">
                <div className="flex flex-col gap-4 border-b p-5">
                  <div className="flex flex-col gap-1">
                    <h2 className="text-lg font-semibold">{t("Resultados")}</h2>
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">{campaign.name}</span>
                      {" · "}
                      {t(
                        "Encontrado é diferente de qualificado. A qualificação depende do que for confirmado na conversa.",
                      )}
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {filtrosDaEtapa.map((tipo) => {
                      const ativo = filtro.tipo === tipo;
                      return (
                        <button
                          key={tipo}
                          type="button"
                          aria-pressed={ativo}
                          title={t("Mostrar na tabela de resultados")}
                          onClick={() => setFiltro({ tipo: ativo ? "todos" : tipo })}
                          className={`rounded-lg p-2 text-left transition-colors hover:bg-muted ${ativo ? "bg-muted" : ""}`}
                        >
                          <p className="text-2xl font-semibold tabular-nums">{count(tipo)}</p>
                          <p className="text-xs text-muted-foreground">{rotulosDosFiltros[tipo]}</p>
                        </button>
                      );
                    })}
                  </div>
                  {buscaConcluida && (
                    <AnaliseDaCampanha
                      candidates={candidates}
                      busy={busy}
                      onAnalisar={() =>
                        perform(
                          { action: "analyze_sites", id: campaign.id },
                          t(
                            "Análise dos sites pedida. Os sinais aparecem conforme cada site é lido.",
                          ),
                        )
                      }
                      gastoIaCentavos={Number(campaign.gasto_ia_centavos ?? 0)}
                      onLerComIa={() =>
                        perform(
                          { action: "read_sites_ai", id: campaign.id },
                          t(
                            "Leitura por IA pedida. O resumo e os sinais aparecem conforme cada site é lido.",
                          ),
                        )
                      }
                    />
                  )}
                  <p className="text-xs text-muted-foreground">
                    {t(
                      "Nota de 0 a 100: porte, sinais do site, avaliações no Maps e o seu Gostei. Clique na nota para ver os pontos.",
                    )}
                  </p>
                  {filtro.tipo !== "todos" && (
                    <p role="status" className="rounded-lg bg-muted px-3 py-2 text-sm">
                      {t("Mostrando")} {visiveis.length} {t("de")} {candidates.length}:{" "}
                      {rotulosDosFiltros[filtro.tipo]}.{" "}
                      {t("Clique no número de novo para ver todas.")}
                    </p>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                      <tr>
                        {canSelect && <th className="p-4">{t("Abordar")}</th>}
                        <th className="min-w-48 p-4">{t("Empresa")}</th>
                        <th className="min-w-32 p-4">{t("Nota")}</th>
                        <th className="min-w-40 p-4">{t("Progresso")}</th>
                        <th className="p-4">{t("Conversa")}</th>
                        <th className="min-w-44 p-4">{t("Sua avaliação")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visiveis.length === 0 && (
                        <tr>
                          <td
                            colSpan={canSelect ? 6 : 5}
                            className="p-6 text-center text-sm text-muted-foreground"
                          >
                            {t("Nenhuma empresa neste filtro.")}
                          </td>
                        </tr>
                      )}
                      {linhas.map((c) => (
                        <tr key={c.id} className="border-b last:border-0">
                          {canSelect && (
                            <td className="p-4 align-top">
                              {marcavel(c) && (
                                <input
                                  type="checkbox"
                                  className="size-4"
                                  checked={estaMarcada(c)}
                                  disabled={busy}
                                  onChange={() => setSelection([c.id], !estaMarcada(c))}
                                  aria-label={`${t("Abordar")} ${c.data.name}`}
                                />
                              )}
                            </td>
                          )}
                          <td className="p-4 align-top">
                            <p className="font-medium">{c.data.name}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {c.data.category}
                              {c.data.category && c.data.phone ? " · " : ""}
                              {c.data.phone ?? (c.data.category ? "" : t("Sem telefone"))}
                            </p>
                            <DecisorDaEmpresa decisores={c.decisores} />
                          </td>
                          <td className="p-4 align-top">
                            <NotaDaEmpresa
                              score={scores.get(c.id) ?? pontuar(c.data, data?.aprendizado)}
                            />
                          </td>
                          <td className="max-w-64 p-4 align-top">
                            <Andamento
                              progresso={c.progress}
                              rotulo={t(labels[c.progress] ?? c.progress)}
                            />
                            {c.error && (
                              <p className="mt-1.5 text-xs text-muted-foreground">{c.error}</p>
                            )}
                            {c.message_status && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {t("Mensagem:")} {c.message_status}
                              </p>
                            )}
                          </td>
                          <td className="p-4 align-top">
                            {c.conversation_id ? (
                              <Link
                                className="underline"
                                href={`/app/inbox?id=${c.conversation_id}`}
                              >
                                {t("Abrir no Inbox")}
                              </Link>
                            ) : (
                              <span className="text-xs text-text-subtle">—</span>
                            )}
                          </td>
                          <td className="p-4 align-top">
                            <AvaliacaoDaEmpresa
                              avaliacao={c.data.avaliacao}
                              busy={busy}
                              onAvaliar={(nota, motivo) =>
                                perform(
                                  { action: "rate", id: c.id, nota, motivo: motivo || null },
                                  t(
                                    "Avaliação salva. As próximas buscas levam em conta o seu gosto.",
                                  ),
                                )
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
        </div>
      )}
      {etapa === "campanha" && data && !campaign && (
        <Card className="flex flex-col gap-3 p-6">
          <p className="text-sm text-muted-foreground">
            {t(
              "A campanha pedida não está na sua organização. As suas campanhas estão na etapa 2.",
            )}
          </p>
          <div>
            <Button asChild variant="outline">
              <Link href={hrefDaEtapa("campanhas", null)}>{t("Ir para a etapa 2")}</Link>
            </Button>
          </div>
        </Card>
      )}
      {etapa === "campanha" && aba === "preparar" && campaign && (
        <>
          {campaign && (
            <Card className="p-5">
              <h2 className="text-lg font-semibold">{t("Preparar a campanha")}</h2>
              <div className="mt-1 flex flex-col gap-1">
                <p className="text-base font-semibold">{campaign.name}</p>
                <p className="text-sm text-muted-foreground">
                  {t(labels[campaign.search_status] ?? campaign.search_status)}
                  {campaign.cost_usd !== null
                    ? ` · US$ ${Number(campaign.cost_usd).toFixed(2)}`
                    : ""}
                </p>
              </div>
              {campaign.error &&
                // Busca concluída e campanha ainda em rascunho: o campo traz o
                // AVISO da busca (já em outra campanha, busca interrompida), não
                // uma falha. Ver `avisoDaBusca` em lib/prospecting/store.ts.
                (campaign.status === "draft" && campaign.search_status === "succeeded" ? (
                  <p className="mt-4 rounded-md border p-3 text-sm text-muted-foreground">
                    {campaign.error}
                  </p>
                ) : (
                  <p role="alert" className="mt-4 rounded-md bg-destructive/10 p-3 text-sm">
                    {campaign.error}
                  </p>
                ))}
              {campaign.search_status === "succeeded" && (
                <ReferenciaDaCampanha
                  referencia={!!campaign.referencia_em}
                  motivo={campaign.referencia_motivo}
                  busy={busy}
                  onMarcar={(ativa, motivo) =>
                    perform(
                      { action: "reference", id: campaign.id, ativa, motivo: motivo || null },
                      ativa
                        ? t("Campanha marcada como referência do perfil ideal.")
                        : t("A campanha deixou de ser referência."),
                    )
                  }
                />
              )}
              {campaign.skipped_count > 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {campaign.skipped_count}{" "}
                  {t("resultados repetidos ou indisponíveis foram desconsiderados.")}
                </p>
              )}
              {campaign.config && (
                <>
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                    <p className="text-sm text-muted-foreground">
                      {t("Ritmo:")} {campaign.config.daily_limit}{" "}
                      {t("abordagens em 24 horas, com pelo menos")}{" "}
                      {campaign.config.interval_minutes} {t("minutos entre elas.")}
                    </p>
                    {campaign.status === "running" ? (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          perform(
                            { action: "pause", id: campaign.id },
                            t("Novas abordagens pausadas."),
                          )
                        }
                      >
                        {t("Pausar abordagens")}
                      </Button>
                    ) : campaign.status === "paused" ? (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => alternarEdicaoDoRitmo(campaign)}
                        >
                          {t("Editar ritmo")}
                        </Button>
                        <Button
                          disabled={busy}
                          onClick={() =>
                            perform({ action: "resume", id: campaign.id }, t("Campanha retomada."))
                          }
                        >
                          {t("Retomar fila")}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  {campaign.status === "paused" && ritmo?.campaignId === campaign.id && (
                    <form
                      className="mt-4 space-y-3 rounded-md border p-4"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void salvarRitmo();
                      }}
                    >
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="prospecting-pace-daily">{t("Máximo em 24 horas")}</Label>
                          <Input
                            id="prospecting-pace-daily"
                            type="number"
                            min={1}
                            max={50}
                            required
                            value={ritmo.daily_limit}
                            onChange={(e) =>
                              setRitmo({ ...ritmo, daily_limit: Number(e.target.value) })
                            }
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label htmlFor="prospecting-pace-spacing">
                            {t("Intervalo mínimo (minutos)")}
                          </Label>
                          <Input
                            id="prospecting-pace-spacing"
                            type="number"
                            min={5}
                            max={1440}
                            required
                            value={ritmo.interval_minutes}
                            onChange={(e) =>
                              setRitmo({ ...ritmo, interval_minutes: Number(e.target.value) })
                            }
                            className="mt-1"
                          />
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t(
                          "Só dá para ajustar com a campanha pausada. Ao retomar, o próximo envio já usa o ritmo novo. Limite de 1 a 50 por dia e intervalo de 5 a 1440 minutos.",
                        )}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button type="submit" disabled={busy || !ritmoValido}>
                          {t("Salvar ritmo")}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busy}
                          onClick={() => setRitmo(null)}
                        >
                          {t("Cancelar")}
                        </Button>
                      </div>
                    </form>
                  )}
                </>
              )}
              {noRascunho && candidates.length > 0 && !campaign.config && (
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                  <p className="text-sm text-muted-foreground">
                    {t("As empresas marcadas entram na fila quando a abordagem começar.")}
                  </p>
                  <Button asChild>
                    <Link href={hrefDaCampanha(campaign.id, "abordagem")}>
                      {t("Preparar a abordagem")}
                    </Link>
                  </Button>
                </div>
              )}
            </Card>
          )}
          {candidates.length > 0 ? (
            <EmpresasDaCampanha
              empresas={candidates}
              cidadeDaBusca={campaign.search?.location ?? null}
              scores={scores}
              busy={busy}
              canSelect={canSelect}
              marcavel={marcavel}
              rotuloDoProgresso={(c) => t(labels[c.progress] ?? c.progress)}
              onMarcar={(c, marcar) => setSelection([c.id], marcar)}
              onMarcarVarias={(ids, marcar) => setSelection(ids, marcar)}
              avisoDaFila={
                canSelect
                  ? noRascunho
                    ? t("Somente as empresas marcadas entram na fila ao iniciar as abordagens.")
                    : naFilaPausada && !criaSoNoEnvio
                      ? t(
                          "Esta campanha já criou o contato e o negócio dessas empresas ao iniciar. Desmarcar só impede o envio: elas continuam no funil.",
                        )
                      : t(
                          "Com a campanha pausada, marque ou desmarque as empresas que ainda estão na fila. Quem já foi abordado não muda.",
                        )
                  : null
              }
              ferramentas={
                <>
                  {buscaConcluida && (
                    <ProcurarNoMaps
                      candidates={candidates}
                      busy={busy}
                      gastoMapsUsd={Number(campaign.gasto_maps_usd ?? 0)}
                      onProcurarNoMaps={() =>
                        perform(
                          { action: "search_maps_market", id: campaign.id },
                          t(
                            "Busca no Maps começada. O que for achado aparece em alguns minutos, e o site achado entra na análise.",
                          ),
                        )
                      }
                    />
                  )}
                  {canSelect && (
                    <FicarComAsMelhores
                      disputa={naDisputa}
                      busy={busy}
                      onAplicar={ficarComAsMelhores}
                    />
                  )}
                  {canSelect &&
                    descartaveis.length > 0 &&
                    (confirmandoExclusao ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {t(
                            "Excluir tira essas empresas da lista. Em outra busca, elas podem aparecer de novo como novas.",
                          )}
                        </span>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          disabled={busy}
                          onClick={() => void excluirDesmarcadas()}
                        >
                          {t("Confirmar exclusão")}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => setConfirmandoExclusao(false)}
                        >
                          {t("Cancelar")}
                        </Button>
                      </span>
                    ) : (
                      <span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => setConfirmandoExclusao(true)}
                        >
                          {`${t("Excluir desmarcadas")} (${descartaveis.length})`}
                        </Button>
                      </span>
                    ))}
                </>
              }
              onAvaliar={(c, nota, motivo) =>
                perform(
                  { action: "rate", id: c.id, nota, motivo: motivo || null },
                  t("Avaliação salva. As próximas buscas levam em conta o seu gosto."),
                )
              }
            />
          ) : (
            <Card className="flex flex-col gap-3 p-6">
              <h2 className="text-lg font-semibold">
                {campaign.search_status === "succeeded"
                  ? t("Esta campanha não tem empresas para abordar")
                  : t("A busca desta campanha ainda não terminou")}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t("Encontre e aprove empresas na etapa 1; depois prepare a campanha na etapa 2.")}
              </p>
              <div>
                <Button asChild variant="outline">
                  <Link href={hrefDaEtapa("empresas", campaign.id)}>{t("Ir para a etapa 1")}</Link>
                </Button>
              </div>
            </Card>
          )}
        </>
      )}
      {etapa === "campanha" && aba === "abordagem" && campaign && (
        <>
          {campaign.status === "draft" &&
            campaign.search_status === "succeeded" &&
            candidates.length > 0 && (
              <Card className="p-5">
                <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
                  {campaign.name}
                </p>
                <h2 className="mt-1 text-lg font-semibold">{t("Preparar a abordagem")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t(
                    "A IA usa o agente escolhido para abrir a conversa e atender as respostas. As proteções do canal continuam valendo.",
                  )}
                </p>
                {!campaign.config && (
                  <div className="mt-4 space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant={!manual ? "secondary" : "outline"}
                        onClick={() =>
                          setManualCampaigns((current) => ({
                            ...current,
                            [campaign.id]: false,
                          }))
                        }
                      >
                        {t("Configurar por conversa")}
                      </Button>
                      <Button
                        type="button"
                        variant={manual ? "secondary" : "outline"}
                        onClick={() =>
                          setManualCampaigns((current) => ({ ...current, [campaign.id]: true }))
                        }
                      >
                        {t("Usar agente existente / configurar manualmente")}
                      </Button>
                    </div>
                    {!manual && !config.agent_id && data && (
                      <ProspectingAgentBuilder
                        key={campaign.id}
                        campaign={campaign}
                        config={config}
                        channels={data.channels}
                        stages={data.stages}
                        onCreated={selectCreatedAgent}
                      />
                    )}
                    {!manual && config.agent_id && (
                      <section
                        aria-label={t("Agente selecionado")}
                        className="space-y-2 rounded-xl border bg-muted/20 p-4 text-sm"
                      >
                        <p className="font-semibold">
                          {agents.find((agent) => agent.id === config.agent_id)?.name ??
                            t("Agente selecionado")}
                        </p>
                        <p className="whitespace-pre-wrap text-muted-foreground">
                          {config.instruction}
                        </p>
                        <div className="flex flex-wrap gap-4">
                          <Link className="underline" href={`/app/ai/agents/${config.agent_id}`}>
                            {t("Configurações avançadas do agente")}
                          </Link>
                          <Link
                            className="underline"
                            href={`/app/ai/agents/${config.agent_id}#voice-assistant`}
                          >
                            {t("Configurar assistente de voz")}
                          </Link>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {t(
                            "Agente pronto. Escolha o ritmo abaixo e inicie quando estiver preparado.",
                          )}
                        </p>
                      </section>
                    )}
                  </div>
                )}
                {(manual || config.agent_id) && (
                  <form
                    className="mt-5 space-y-4"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void perform(
                        { action: "start", id: campaign.id, config },
                        t("Campanha iniciada. A primeira abordagem será preparada após um minuto."),
                      );
                    }}
                  >
                    {campaign.config && (
                      <p className="text-sm text-muted-foreground">
                        {t(
                          "Esta campanha já começou a preparar contatos. Sua configuração foi preservada para retomar com segurança.",
                        )}
                      </p>
                    )}
                    <fieldset disabled={!!campaign.config} className="space-y-4">
                      {manual && (
                        <div className="space-y-4">
                          <div className="grid gap-4 md:grid-cols-2">
                            <div>
                              <Label htmlFor="prospecting-agent">{t("Agente de IA")}</Label>
                              <select
                                id="prospecting-agent"
                                className={`${selectClass} mt-1`}
                                value={config.agent_id}
                                onChange={(e) => update("agent_id", e.target.value)}
                                required
                              >
                                <option value="">{t("Escolha um agente publicado")}</option>
                                {agents.map((a) => (
                                  <option key={a.id} value={a.id}>
                                    {a.name}
                                  </option>
                                ))}
                              </select>
                              {config.agent_id && (
                                <Link
                                  className="mt-2 block text-xs underline"
                                  href={`/app/ai/agents/${config.agent_id}`}
                                >
                                  {t("Configurações avançadas do agente")}
                                </Link>
                              )}
                            </div>
                            <div>
                              <Label htmlFor="prospecting-channel">{t("Conexão de saída")}</Label>
                              <select
                                id="prospecting-channel"
                                className={`${selectClass} mt-1`}
                                value={config.channel_session_id}
                                onChange={(e) => update("channel_session_id", e.target.value)}
                                required
                              >
                                <option value="">{t("Escolha uma conexão ativa")}</option>
                                {data?.channels
                                  .filter((c) => c.status === "WORKING")
                                  .map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.display_name ?? c.phone_number ?? c.id}
                                    </option>
                                  ))}
                              </select>
                              <Link className="text-xs underline" href="/app/connections">
                                {t("Ver conexões e proteções de envio")}
                              </Link>
                            </div>
                          </div>
                          <div>
                            <Label htmlFor="prospecting-pipeline">{t("Funil")}</Label>
                            <select
                              id="prospecting-pipeline"
                              className={`${selectClass} mt-1`}
                              value={funil}
                              required
                              onChange={(e) => {
                                setConfig((c) => ({
                                  ...c,
                                  pipeline_id: e.target.value,
                                  stage_id: "",
                                  qualified_stage_id: "",
                                }));
                              }}
                            >
                              <option value="">{t("Escolha o funil")}</option>
                              {[
                                ...new Map(
                                  data?.stages.map((s) => [s.pipeline_id, s.pipeline_name]),
                                ).entries(),
                              ].map(([id, name]) => (
                                <option key={id} value={id}>
                                  {name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="grid gap-4 md:grid-cols-2">
                            {(
                              [
                                ["stage_id", "Etapa inicial"],
                                ["qualified_stage_id", "Etapa de qualificados"],
                              ] as const
                            ).map(([field, label]) => (
                              <div key={field}>
                                <Label htmlFor={`prospecting-${field}`}>{t(label)}</Label>
                                <select
                                  id={`prospecting-${field}`}
                                  className={`${selectClass} mt-1`}
                                  required
                                  value={config[field]}
                                  onChange={(e) => update(field, e.target.value)}
                                >
                                  <option value="">{t("Escolha a etapa")}</option>
                                  {data?.stages
                                    .filter((s) => s.pipeline_id === funil)
                                    .map((s) => (
                                      <option key={s.id} value={s.id}>
                                        {s.name}
                                      </option>
                                    ))}
                                </select>
                              </div>
                            ))}
                          </div>
                          <div>
                            <Label htmlFor="prospecting-instruction">
                              {t("O que a IA deve oferecer e como iniciar")}
                            </Label>
                            <Textarea
                              id="prospecting-instruction"
                              value={config.instruction}
                              onChange={(e) => update("instruction", e.target.value)}
                              required
                              minLength={10}
                              maxLength={2000}
                              className="mt-1"
                              placeholder={t(
                                "Descreva sua oferta e o objetivo da primeira conversa.",
                              )}
                            />
                            <p className="mt-1 text-xs text-muted-foreground">
                              {t(
                                "Este texto se soma ao prompt do agente nas conversas desta campanha. Se você mudar o prompt do agente, confira se os dois ainda dizem a mesma coisa.",
                              )}
                            </p>
                          </div>
                          <div>
                            <Label htmlFor="prospecting-qualification">
                              {t("Quando considerar o cliente qualificado")}
                            </Label>
                            <Textarea
                              id="prospecting-qualification"
                              value={config.qualification}
                              onChange={(e) => update("qualification", e.target.value)}
                              required
                              minLength={10}
                              maxLength={2000}
                              className="mt-1"
                              placeholder={t(
                                "Ex.: confirmou a necessidade, participa da decisão e deseja conversar sobre a solução.",
                              )}
                            />
                          </div>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="prospecting-daily">{t("Máximo em 24 horas")}</Label>
                          <Input
                            id="prospecting-daily"
                            type="number"
                            min={1}
                            max={50}
                            required
                            value={config.daily_limit}
                            onChange={(e) => update("daily_limit", Number(e.target.value))}
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label htmlFor="prospecting-spacing">
                            {t("Intervalo mínimo (minutos)")}
                          </Label>
                          <Input
                            id="prospecting-spacing"
                            type="number"
                            min={5}
                            max={1440}
                            required
                            value={config.interval_minutes}
                            onChange={(e) => update("interval_minutes", Number(e.target.value))}
                            className="mt-1"
                          />
                        </div>
                      </div>
                      <fieldset className="space-y-2">
                        <legend className="text-sm font-medium">
                          {t("Quando a empresa entra no funil")}
                        </legend>
                        <label className="flex items-start gap-2 text-sm">
                          <input
                            type="radio"
                            name="prospecting-funnel-entry"
                            checked={(config.funnel_entry ?? "on_start") === "on_send"}
                            onChange={() => update("funnel_entry", "on_send")}
                            className="mt-1"
                          />
                          <span>
                            {t("Só quando for abordada (recomendado)")}
                            <span className="block text-xs text-muted-foreground">
                              {t("O funil mostra só quem já recebeu a primeira mensagem.")}
                            </span>
                          </span>
                        </label>
                        <label className="flex items-start gap-2 text-sm">
                          <input
                            type="radio"
                            name="prospecting-funnel-entry"
                            checked={(config.funnel_entry ?? "on_start") === "on_start"}
                            onChange={() => update("funnel_entry", "on_start")}
                            className="mt-1"
                          />
                          <span>
                            {t("Todas ao iniciar")}
                            <span className="block text-xs text-muted-foreground">
                              {t(
                                "Contato, negócio e conversa de toda a fila são criados na hora de iniciar.",
                              )}
                            </span>
                          </span>
                        </label>
                      </fieldset>
                      <div>
                        <Label htmlFor="prospecting-basis">
                          {t("Referência da avaliação de legítimo interesse")}
                        </Label>
                        <Input
                          id="prospecting-basis"
                          value={config.legal_basis_ref}
                          onChange={(e) => update("legal_basis_ref", e.target.value)}
                          minLength={3}
                          maxLength={500}
                          required
                          className="mt-1"
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t(
                            "Informe a referência real da avaliação que fundamenta esta prospecção. Isso não registra consentimento dos contatos.",
                          )}
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {(config.funnel_entry ?? "on_start") === "on_send"
                          ? t(
                              "Ao iniciar, as empresas com telefone entram na fila. Cada uma entra no funil só quando for abordada. Contatos já existentes são preservados. A fila faz uma primeira abordagem; respostas seguem no Inbox. Uma mensagem já em transmissão pode concluir após a pausa.",
                            )
                          : t(
                              "Ao iniciar, os contatos novos com telefone entram no funil. Contatos já existentes são preservados. A fila faz uma primeira abordagem; respostas seguem no Inbox. Uma mensagem já em transmissão pode concluir após a pausa.",
                            )}
                      </p>
                    </fieldset>
                    <div className="flex flex-wrap items-center gap-3">
                      <Button type="submit" disabled={busy || !!faltaParaIniciar}>
                        {t("Iniciar abordagens com IA")}
                      </Button>
                      {faltaParaIniciar && (
                        <span role="status" className="text-sm text-muted-foreground">
                          {faltaParaIniciar}{" "}
                          {faltaParaIniciar === semMarcadas ? (
                            <Link className="underline" href={hrefDaCampanha(campaign.id)}>
                              {t("Marcar na aba Preparar a campanha")}
                            </Link>
                          ) : faltaParaIniciar === semConexao ? (
                            <Link className="underline" href="/app/connections">
                              {t("Abrir Conexões")}
                            </Link>
                          ) : null}
                        </span>
                      )}
                    </div>
                  </form>
                )}
              </Card>
            )}
        </>
      )}
      {etapa === "campanha" &&
        aba === "abordagem" &&
        campaign &&
        !(noRascunho && candidates.length > 0) && (
          <Card className="flex flex-col gap-3 p-6">
            <h2 className="text-lg font-semibold">
              {!campaign
                ? t("Nenhuma campanha ainda")
                : campaign.config
                  ? t("Esta campanha já tem a abordagem configurada")
                  : campaign.search_status !== "succeeded"
                    ? t("A busca desta campanha ainda não terminou")
                    : t("Esta campanha não tem empresas para abordar")}
            </h2>
            {campaign && (
              <p className="text-sm text-muted-foreground">
                {campaign.name} · {t(labels[campaign.status] ?? campaign.status)}
                {campaign.config
                  ? ` · ${t("Ritmo:")} ${campaign.config.daily_limit} ${t("abordagens em 24 horas, com pelo menos")} ${campaign.config.interval_minutes} ${t("minutos entre elas.")}`
                  : ""}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              {!campaign || campaign.search_status !== "succeeded" || candidates.length === 0
                ? t("Encontre e aprove empresas na etapa 1; depois prepare a campanha na etapa 2.")
                : t(
                    "A fila, as respostas e os qualificados estão na etapa 2. Pausar e retomar também.",
                  )}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link href={hrefDaEtapa("empresas", campanhaNaUrl)}>{t("Ir para a etapa 1")}</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={hrefDaEtapa("campanhas", campanhaNaUrl)}>{t("Ir para a etapa 2")}</Link>
              </Button>
            </div>
          </Card>
        )}
    </main>
  );
}
