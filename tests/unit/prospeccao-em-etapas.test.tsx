/**
 * A PROSPECÇÃO EM DUAS ETAPAS E A CAMPANHA ABERTA (fork, 2026-11-02 e 2026-11-03).
 *
 * O dono do fork pediu a tela única dividida em uma porta de entrada e uma tela
 * por etapa; depois, que a etapa 2 ficasse só com "Suas campanhas" e "Acompanhar
 * resultados", e que cada campanha abrisse numa tela própria com as abas
 * "Preparar a campanha" e "Abordagem" (`app/app/prospecting/_etapas.ts`). Este
 * arquivo mede o que a divisão prometeu, e não a lógica da prospecção (que
 * continua coberta por `prospecting-agent-dialog.test.tsx` e pelos invariantes):
 *
 *   1. a porta tem dois botões, cada um para a sua rota, e a faixa "Onde você
 *      parou" aponta para a etapa em que a campanha mais recente está;
 *   2. cada etapa mostra os seus blocos e NÃO mostra os das outras; a campanha
 *      aberta mostra a aba pedida, com as empresas e o botão de abordar;
 *   3. a campanha escolhida viaja na URL entre as etapas, e é o caminho na
 *      campanha aberta.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
const navegacao = vi.hoisted(() => ({
  busca: "",
  caminho: "/app/prospecting/empresas",
  replace: vi.fn(),
}));
vi.mock("@/lib/api/client", () => ({ apiClient: api }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (text: string) => text }));
vi.mock("next/navigation", () => ({
  usePathname: () => navegacao.caminho,
  useSearchParams: () => new URLSearchParams(navegacao.busca),
  useRouter: () => ({ replace: navegacao.replace, push: vi.fn() }),
}));

import { ProspectingClient } from "@/app/app/prospecting/_client";
import { HubDaProspeccao } from "@/app/app/prospecting/_hub";
import {
  ETAPAS,
  ROTA_DA_ETAPA,
  abaDaQuery,
  etapaParaContinuar,
  hrefDaCampanha,
  hrefDaEtapa,
} from "@/app/app/prospecting/_etapas";

const CAMPANHA = "11111111-1111-4111-8111-111111111111";
const OUTRA = "11111111-1111-4111-8111-111111111112";

function campanha(id: string, nome: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: nome,
    search: { niche: "clínicas", location: "Curitiba, PR" },
    status: "draft",
    search_status: "succeeded",
    error: null,
    config: null,
    result_count: 1,
    skipped_count: 0,
    cost_usd: "0.10",
    next_send_at: "2026-11-02T00:00:00Z",
    referencia_em: null,
    referencia_motivo: null,
    ...extra,
  };
}
function candidato(campaignId: string, indice: number) {
  return {
    id: `candidato-${campaignId}-${indice}`,
    campaign_id: campaignId,
    status: "new",
    progress: "new",
    message_status: null,
    error: null,
    conversation_id: null,
    data: {
      name: `Empresa ${indice}`,
      category: "Serviços",
      phone: "+5541999990000",
      address: "R. Exemplo, 100 - Centro, Curitiba - PR, 80000-000, Brasil",
      city: "Curitiba",
      website: null,
      rating: null,
      reviews: 0,
      emails: [],
      socials: [],
    },
  };
}
function estado(
  campanhas = [campanha(CAMPANHA, "Clínicas · Curitiba"), campanha(OUTRA, "Padarias · Londrina")],
) {
  return {
    configured: true,
    campaigns: campanhas,
    candidates: campanhas.map((c) => candidato(c.id, 1)),
    agents: [],
    channels: [],
    stages: [],
  };
}

function renderizar(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  navegacao.replace.mockReset();
  api.get.mockImplementation(async () => ({ data: estado() }));
  navegacao.busca = "";
  navegacao.caminho = "/app/prospecting/empresas";
  window.history.replaceState(null, "", "/app/prospecting/empresas");
});
afterEach(cleanup);

describe("as etapas, a campanha aberta e os seus endereços", () => {
  it("são duas etapas, em ordem, cada uma com a sua rota sob /app/prospecting", () => {
    expect(ETAPAS).toEqual(["empresas", "campanhas"]);
    expect(Object.values(ROTA_DA_ETAPA)).toEqual([
      "/app/prospecting/empresas",
      "/app/prospecting/campanhas",
    ]);
  });

  it("o endereço da etapa leva a campanha na query, e sem campanha fica limpo", () => {
    expect(hrefDaEtapa("campanhas", CAMPANHA)).toBe(
      `/app/prospecting/campanhas?campanha=${CAMPANHA}`,
    );
    expect(hrefDaEtapa("empresas", null)).toBe("/app/prospecting/empresas");
    expect(hrefDaEtapa(null, CAMPANHA)).toBe(`/app/prospecting?campanha=${CAMPANHA}`);
  });

  it("a campanha aberta é uma rota por campanha; a aba vai na query e qualquer lixo cai na primeira", () => {
    expect(hrefDaCampanha(CAMPANHA)).toBe(`/app/prospecting/campanhas/${CAMPANHA}`);
    expect(hrefDaCampanha(CAMPANHA, "abordagem")).toBe(
      `/app/prospecting/campanhas/${CAMPANHA}?aba=abordagem`,
    );
    expect(abaDaQuery("abordagem")).toBe("abordagem");
    expect(abaDaQuery(["abordagem", "x"])).toBe("abordagem");
    expect(abaDaQuery("qualquer")).toBe("preparar");
    expect(abaDaQuery(undefined)).toBe("preparar");
  });

  it("'onde você parou' manda à etapa 1 sem campanha ou com busca em andamento, e à 2 depois", () => {
    expect(etapaParaContinuar(undefined)).toBe("empresas");
    expect(etapaParaContinuar(campanha(CAMPANHA, "x", { search_status: "starting" }))).toBe(
      "empresas",
    );
    expect(etapaParaContinuar(campanha(CAMPANHA, "x", { result_count: 0 }))).toBe("empresas");
    expect(etapaParaContinuar(campanha(CAMPANHA, "x"))).toBe("campanhas");
    expect(etapaParaContinuar(campanha(CAMPANHA, "x", { status: "running", config: {} }))).toBe(
      "campanhas",
    );
  });
});

describe("a porta de entrada", () => {
  it("tem o título, um texto e dois botões, um por etapa, levando a campanha mais recente", async () => {
    renderizar(<HubDaProspeccao />);
    expect(screen.getByRole("heading", { level: 1, name: "Prospecção" })).toBeVisible();
    expect(screen.getByText(/São duas etapas, nesta ordem/)).toBeVisible();
    const botoes = [
      ["Abrir prospecção", "empresas"],
      ["Abrir campanhas", "campanhas"],
    ] as const;
    for (const [rotulo, etapa] of botoes) {
      expect(screen.getByRole("link", { name: rotulo })).toHaveAttribute(
        "href",
        ROTA_DA_ETAPA[etapa],
      );
    }
    expect(screen.queryByRole("link", { name: "Abrir abordagem" })).not.toBeInTheDocument();
    // A porta anuncia que a abordagem mora dentro da campanha aberta.
    expect(screen.getByText("Campanha aberta: Preparar a campanha e Abordagem")).toBeVisible();
    // Depois de carregar, os botões levam a campanha mais recente junto.
    await screen.findByText(/Clínicas · Curitiba/);
    expect(screen.getByRole("link", { name: "Abrir campanhas" })).toHaveAttribute(
      "href",
      `/app/prospecting/campanhas?campanha=${CAMPANHA}`,
    );
    // E a faixa aponta para a etapa 2: busca concluída, abordagem ainda não configurada.
    const faixa = screen.getByRole("region", { name: "Onde você parou" });
    expect(within(faixa).getByRole("link", { name: /Continuar na etapa 2/ })).toHaveAttribute(
      "href",
      `/app/prospecting/campanhas?campanha=${CAMPANHA}`,
    );
    expect(faixa).toHaveTextContent("1 aprovada");
  });

  it("sem campanha nenhuma, a faixa manda começar pela etapa 1", async () => {
    api.get.mockImplementation(async () => ({ data: estado([]) }));
    renderizar(<HubDaProspeccao />);
    await screen.findByText("Nenhuma campanha ainda. Comece pela etapa 1.");
    expect(screen.getByRole("link", { name: /Continuar na etapa 1/ })).toHaveAttribute(
      "href",
      "/app/prospecting/empresas",
    );
  });
});

describe("cada etapa mostra o seu, e só o seu", () => {
  it("etapa 1: encontrar empresas, aprendizado, decisor e resultados; nada de campanha nem abordagem", async () => {
    renderizar(<ProspectingClient etapa="empresas" />);
    await screen.findByRole("heading", { level: 2, name: "Acompanhar resultados" });
    expect(screen.getByRole("heading", { level: 1, name: "Prospecção" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Encontrar empresas" })).toBeVisible();
    // O cartão "O que a prospecção aprendeu com você" só aparece com perfil aprendido
    // (`AprendizadoCard`); a fixture não tem um, e o cartão não é desta mudança.
    expect(screen.getByRole("heading", { name: "Decisor pelo quadro de sócios" })).toBeVisible();
    // Os contadores são os da busca.
    expect(screen.getByRole("button", { name: /Encontrados/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /Recusados/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Qualificados/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Suas campanhas" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Preparar a abordagem" })).not.toBeInTheDocument();
    // O seletor tem duas etapas, e a saída é para a etapa 2, com a campanha.
    const seletor = screen.getByRole("navigation", { name: "Etapas da prospecção" });
    expect(within(seletor).getAllByRole("link")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Levar aprovadas para a campanha" })).toHaveAttribute(
      "href",
      `/app/prospecting/campanhas?campanha=${CAMPANHA}`,
    );
  });

  it("etapa 2: suas campanhas com o botão Abrir, e os resultados da abordagem; preparar mora na campanha aberta", async () => {
    navegacao.caminho = "/app/prospecting/campanhas";
    renderizar(<ProspectingClient etapa="campanhas" />);
    await screen.findByRole("heading", { name: "Acompanhar resultados" });
    expect(screen.getByRole("heading", { level: 1, name: "Campanha" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "Suas campanhas" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Na fila/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /Qualificados/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Encontrados/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Encontrar empresas" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Preparar a campanha" })).not.toBeInTheDocument();
    // A análise das empresas, a nota e a avaliação ficam nos resultados.
    expect(screen.getByRole("button", { name: /Analisar sites/ })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Nota" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Sua avaliação" })).toBeVisible();
    // As informações e os sinais do site saíram da tabela: moram na campanha aberta.
    expect(screen.queryByRole("columnheader", { name: "Informações" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Sinais do site" })).not.toBeInTheDocument();
    // Cada campanha tem o seu Abrir, para a rota própria.
    expect(
      screen.getByRole("link", { name: "Abrir a campanha Clínicas · Curitiba" }),
    ).toHaveAttribute("href", `/app/prospecting/campanhas/${CAMPANHA}`);
    // O filtro da lista agrupa por situação.
    const filtro = screen.getByRole("group", { name: "Filtrar campanhas" });
    expect(within(filtro).getByRole("button", { name: /Todas/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(within(filtro).getByRole("button", { name: /Encerradas/ }));
    expect(screen.getByText("Nenhuma campanha neste grupo.")).toBeVisible();
  });

  it("campanha aberta, aba Preparar: o cartão de preparar, as empresas com o botão de abordar, e a saída é a aba Abordagem", async () => {
    navegacao.caminho = `/app/prospecting/campanhas/${OUTRA}`;
    renderizar(<ProspectingClient etapa="campanha" campanhaId={OUTRA} aba="preparar" />);
    await screen.findByRole("heading", { level: 2, name: "Preparar a campanha" });
    expect(screen.getByRole("heading", { level: 1, name: "Padarias · Londrina" })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Quem foi achado, e quem vai ser abordado" }),
    ).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Suas campanhas" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Preparar a abordagem" })).not.toBeInTheDocument();
    // As abas marcam a atual, e a saída do cartão é a aba 2.
    const abas = screen.getByRole("navigation", { name: "Abas da campanha" });
    expect(within(abas).getByRole("link", { name: /Preparar a campanha/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(abas).getByRole("link", { name: /Abordagem/ })).toHaveAttribute(
      "href",
      `/app/prospecting/campanhas/${OUTRA}?aba=abordagem`,
    );
    expect(screen.getByRole("link", { name: "Preparar a abordagem" })).toHaveAttribute(
      "href",
      `/app/prospecting/campanhas/${OUTRA}?aba=abordagem`,
    );
    // A empresa aparece com o bairro lido do endereço, os contatos e o botão de abordar.
    const empresa = screen.getByRole("article", { name: "Empresa 1" });
    expect(within(empresa).getByRole("button", { name: "Vai abordar" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(empresa).getByRole("link", { name: "WhatsApp" })).toHaveAttribute(
      "href",
      "https://wa.me/5541999990000",
    );
    expect(screen.getByRole("heading", { name: "Bairros com mais alvos" })).toBeVisible();
    expect(screen.getByRole("button", { name: /^Centro/ })).toBeVisible();
    // Curitiba tem o desenho dos bairros; o mapa aparece.
    expect(screen.getByRole("img", { name: /Mapa dos bairros de Curitiba/ })).toBeVisible();
    // Desmarcar chama a seleção da campanha, como a caixa da tabela fazia.
    api.post.mockResolvedValue({});
    fireEvent.click(within(empresa).getByRole("button", { name: "Vai abordar" }));
    expect(api.post).toHaveBeenCalledWith("/api/v1/prospecting", {
      action: "select",
      id: OUTRA,
      candidate_ids: [`candidato-${OUTRA}-1`],
      selected: false,
    });
  });

  it("campanha aberta, aba Abordagem: só preparar a abordagem; trocar de campanha é trocar de rota", async () => {
    navegacao.caminho = `/app/prospecting/campanhas/${OUTRA}`;
    navegacao.busca = "aba=abordagem";
    renderizar(<ProspectingClient etapa="campanha" campanhaId={OUTRA} aba="abordagem" />);
    await screen.findByRole("heading", { level: 2, name: "Preparar a abordagem" });
    expect(screen.getByRole("heading", { level: 1, name: "Padarias · Londrina" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Suas campanhas" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Quem foi achado, e quem vai ser abordado" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Campanha")).toHaveValue(OUTRA);
    fireEvent.change(screen.getByLabelText("Campanha"), { target: { value: CAMPANHA } });
    expect(navegacao.replace).toHaveBeenCalledWith(
      `/app/prospecting/campanhas/${CAMPANHA}?aba=abordagem`,
    );
  });

  it("campanha aberta sem busca pronta explica o que falta e aponta a etapa 1", async () => {
    api.get.mockImplementation(async () => ({
      data: estado([campanha(CAMPANHA, "Em busca", { search_status: "starting" })]),
    }));
    renderizar(<ProspectingClient etapa="campanha" campanhaId={CAMPANHA} aba="abordagem" />);
    await screen.findByRole("heading", { name: "A busca desta campanha ainda não terminou" });
    expect(screen.getByRole("link", { name: "Ir para a etapa 1" })).toHaveAttribute(
      "href",
      `/app/prospecting/empresas?campanha=${CAMPANHA}`,
    );
  });

  it("campanha que não existe na organização não cai na mais recente: diz que não achou", async () => {
    renderizar(<ProspectingClient etapa="campanha" campanhaId="nao-existe" aba="preparar" />);
    // O cartão com a saída só aparece depois de a lista chegar e confirmar que não há tal campanha.
    expect(await screen.findByRole("link", { name: "Ir para a etapa 2" })).toHaveAttribute(
      "href",
      "/app/prospecting/campanhas",
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Campanha não encontrada" }),
    ).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Preparar a campanha" })).not.toBeInTheDocument();
  });
});

describe("a campanha escolhida viaja na URL", () => {
  it("ver os resultados de outra campanha na etapa 2 grava ?campanha= e o seletor passa a levá-la", async () => {
    navegacao.caminho = "/app/prospecting/campanhas";
    window.history.replaceState(null, "", "/app/prospecting/campanhas");
    renderizar(<ProspectingClient etapa="campanhas" />);
    const outra = await screen.findByRole("article", { name: "Padarias · Londrina" });
    fireEvent.click(within(outra).getByRole("button", { name: "Ver resultados" }));
    expect(window.location.search).toBe(`?campanha=${OUTRA}`);
    expect(within(outra).getByRole("button", { name: /Mostrando resultados/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const seletor = screen.getByRole("navigation", { name: "Etapas da prospecção" });
    expect(within(seletor).getByRole("link", { name: /Prospecção/ })).toHaveAttribute(
      "href",
      `/app/prospecting/empresas?campanha=${OUTRA}`,
    );
    expect(screen.getByRole("link", { name: "Voltar para Prospecção" })).toHaveAttribute(
      "href",
      `/app/prospecting?campanha=${OUTRA}`,
    );
  });
});
