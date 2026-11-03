/**
 * A PROSPECÇÃO EM TRÊS ETAPAS (fork, 2026-11-02).
 *
 * O dono do fork pediu a tela única dividida em uma porta de entrada e três
 * telas, uma por etapa (`app/app/prospecting/_etapas.ts`). Este arquivo mede o
 * que a divisão prometeu, e não a lógica da prospecção (que continua coberta
 * por `prospecting-agent-dialog.test.tsx` e pelos invariantes):
 *
 *   1. a porta tem três botões, cada um para a sua rota, e a faixa "Onde você
 *      parou" aponta para a etapa em que a campanha mais recente está;
 *   2. cada etapa mostra os seus blocos e NÃO mostra os das outras;
 *   3. a campanha escolhida viaja na URL de uma etapa à outra.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
const navegacao = vi.hoisted(() => ({ busca: "", caminho: "/app/prospecting/empresas" }));
vi.mock("@/lib/api/client", () => ({ apiClient: api }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (text: string) => text }));
vi.mock("next/navigation", () => ({
  usePathname: () => navegacao.caminho,
  useSearchParams: () => new URLSearchParams(navegacao.busca),
}));

import { ProspectingClient } from "@/app/app/prospecting/_client";
import { HubDaProspeccao } from "@/app/app/prospecting/_hub";
import {
  ETAPAS,
  ROTA_DA_ETAPA,
  etapaParaContinuar,
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
      phone: "+55 41 99999-0000",
      address: "Rua X, 1",
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
  api.get.mockImplementation(async () => ({ data: estado() }));
  navegacao.busca = "";
  navegacao.caminho = "/app/prospecting/empresas";
  window.history.replaceState(null, "", "/app/prospecting/empresas");
});
afterEach(cleanup);

describe("as etapas e os seus endereços", () => {
  it("são três, em ordem, cada uma com a sua rota sob /app/prospecting", () => {
    expect(ETAPAS).toEqual(["empresas", "campanhas", "abordagem"]);
    expect(Object.values(ROTA_DA_ETAPA)).toEqual([
      "/app/prospecting/empresas",
      "/app/prospecting/campanhas",
      "/app/prospecting/abordagem",
    ]);
  });

  it("o endereço leva a campanha na query, e sem campanha fica limpo", () => {
    expect(hrefDaEtapa("campanhas", CAMPANHA)).toBe(
      `/app/prospecting/campanhas?campanha=${CAMPANHA}`,
    );
    expect(hrefDaEtapa("abordagem", null)).toBe("/app/prospecting/abordagem");
    expect(hrefDaEtapa(null, CAMPANHA)).toBe(`/app/prospecting?campanha=${CAMPANHA}`);
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
  it("tem o título, um texto e três botões, um por etapa, levando a campanha mais recente", async () => {
    renderizar(<HubDaProspeccao />);
    expect(screen.getByRole("heading", { level: 1, name: "Prospecção" })).toBeVisible();
    const botoes = [
      ["Abrir prospecção", "empresas"],
      ["Abrir campanhas", "campanhas"],
      ["Abrir abordagem", "abordagem"],
    ] as const;
    for (const [rotulo, etapa] of botoes) {
      expect(screen.getByRole("link", { name: rotulo })).toHaveAttribute(
        "href",
        ROTA_DA_ETAPA[etapa],
      );
    }
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
    // E a saída é para a etapa 2, com a campanha.
    expect(screen.getByRole("link", { name: "Levar aprovadas para a campanha" })).toHaveAttribute(
      "href",
      `/app/prospecting/campanhas?campanha=${CAMPANHA}`,
    );
  });

  it("etapa 2: suas campanhas, preparar a campanha e resultados da abordagem; a saída é a etapa 3", async () => {
    navegacao.caminho = "/app/prospecting/campanhas";
    renderizar(<ProspectingClient etapa="campanhas" />);
    await screen.findByRole("heading", { name: "Preparar a campanha" });
    expect(screen.getByRole("heading", { level: 1, name: "Campanha" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "Suas campanhas" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Acompanhar resultados" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Na fila/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /Qualificados/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Encontrados/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Encontrar empresas" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Preparar a abordagem" })).toHaveAttribute(
      "href",
      `/app/prospecting/abordagem?campanha=${CAMPANHA}`,
    );
  });

  it("etapa 3: só preparar a abordagem, da campanha que veio na URL", async () => {
    navegacao.caminho = "/app/prospecting/abordagem";
    navegacao.busca = `campanha=${OUTRA}`;
    renderizar(<ProspectingClient etapa="abordagem" />);
    await screen.findByRole("heading", { level: 2, name: "Preparar a abordagem" });
    expect(screen.getByRole("heading", { level: 1, name: "Abordagem" })).toBeVisible();
    // O nome aparece no cabeçalho do bloco e no seletor de campanha.
    expect(screen.getAllByText("Padarias · Londrina").length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "Suas campanhas" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Acompanhar resultados" }),
    ).not.toBeInTheDocument();
    // Trocar de campanha aqui é um seletor (a lista é da etapa 2), já na campanha da URL.
    expect(screen.getByLabelText("Campanha")).toHaveValue(OUTRA);
  });

  it("etapa 3 sem campanha pronta explica o que falta e aponta as etapas 1 e 2", async () => {
    navegacao.caminho = "/app/prospecting/abordagem";
    api.get.mockImplementation(async () => ({
      data: estado([campanha(CAMPANHA, "Em busca", { search_status: "starting" })]),
    }));
    renderizar(<ProspectingClient etapa="abordagem" />);
    await screen.findByRole("heading", { name: "A busca desta campanha ainda não terminou" });
    expect(screen.getByRole("link", { name: "Ir para a etapa 1" })).toHaveAttribute(
      "href",
      `/app/prospecting/empresas?campanha=${CAMPANHA}`,
    );
  });
});

describe("a campanha escolhida viaja na URL", () => {
  it("escolher outra campanha na etapa 2 grava ?campanha= e o seletor 1 · 2 · 3 passa a levá-la", async () => {
    navegacao.caminho = "/app/prospecting/campanhas";
    window.history.replaceState(null, "", "/app/prospecting/campanhas");
    renderizar(<ProspectingClient etapa="campanhas" />);
    fireEvent.click(await screen.findByRole("button", { name: /Padarias · Londrina/ }));
    expect(window.location.search).toBe(`?campanha=${OUTRA}`);
    const seletor = screen.getByRole("navigation", { name: "Etapas da prospecção" });
    expect(within(seletor).getByRole("link", { name: /Abordagem/ })).toHaveAttribute(
      "href",
      `/app/prospecting/abordagem?campanha=${OUTRA}`,
    );
    expect(screen.getByRole("link", { name: "Voltar para Prospecção" })).toHaveAttribute(
      "href",
      `/app/prospecting?campanha=${OUTRA}`,
    );
  });
});
