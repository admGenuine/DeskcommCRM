import { describe, expect, it } from "vitest";

import type { Prospect } from "../schema";
import { avaliarCandidato } from "./index";
import { ufDaBusca, ufDoLugar } from "./regiao";
import { categoriaForaDoPerfil } from "./segmento";

const lugar = (extra: Partial<Prospect> = {}): Prospect => ({
  key: "p1",
  name: "Fábrica Exemplo",
  phone: "+5541999998888",
  phone_kind: "celular",
  phone_issue: null,
  website: null,
  category: "Fábrica de alimentos",
  categories: [],
  address: "R. Exemplo, 100 - Centro, Curitiba - PR, 80000-000, Brasil",
  city: "Curitiba",
  state_code: "PR",
  country_code: "BR",
  maps_url: null,
  rating: null,
  reviews: null,
  emails: [],
  socials: [],
  ...extra,
});

describe("segmento: varejo e serviço de alimentação saem, fábrica fica", () => {
  it.each(["Padaria", "Restaurante japonês", "Bar e restaurante", "Supermercado", "Lanchonete", "Açougue", "Café"])(
    "recusa %s",
    (categoria) => {
      expect(categoriaForaDoPerfil(categoria)).toBe(categoria);
    },
  );

  it.each([
    "Fábrica de alimentos",
    "Distribuidora de alimentos",
    "Atacadista",
    "Fornecedor de produtos alimentícios",
    "Barbearia",
    "Cervejaria",
    "Torrefação de café",
  ])("aceita %s", (categoria) => {
    expect(categoriaForaDoPerfil(categoria)).toBeNull();
  });

  it("padaria que também é fábrica fica", () => {
    expect(categoriaForaDoPerfil("Padaria", ["Fábrica de pães"])).toBeNull();
  });

  it("sem categoria não recusa: quem decide é o CNAE na Fase 2", () => {
    expect(categoriaForaDoPerfil(null, [])).toBeNull();
  });
});

describe("região: o estado pedido e o estado do lugar", () => {
  it.each([
    ["Curitiba, PR", "PR"],
    ["curitiba, pr", "PR"],
    ["Curitiba", "PR"],
    ["Paraná", "PR"],
    ["SP", "SP"],
    ["São Paulo", "SP"],
    ["Mato Grosso do Sul", "MS"],
    ["Belém do Pará", "PA"],
    ["Paraíba", "PB"],
    ["Londrina, PR", "PR"],
  ])("busca %s → %s", (local, uf) => {
    expect(ufDaBusca(local)).toBe(uf);
  });

  it("cidade que não é capital, sem estado, não vira estado nenhum", () => {
    expect(ufDaBusca("São José dos Pinhais")).toBeNull();
  });

  it.each([
    ["R. A, 1 - Centro, São José dos Pinhais - PR, 83000-000, Brasil", null, "PR"],
    ["Av. B, 2 - Joinville - SC, 89200-000", null, "SC"],
    [null, "Paraná", "PR"],
    [null, "State of Santa Catarina", "SC"],
    [null, null, null],
  ])("lugar %s / %s → %s", (endereco, estado, uf) => {
    expect(ufDoLugar(endereco, estado)).toBe(uf);
  });
});

describe("veredito de entrada", () => {
  const busca = { location: "Curitiba, PR" };

  it("aprova a fábrica no estado pedido", () => {
    expect(avaliarCandidato(lugar(), busca)).toEqual({ aprovado: true });
  });

  it("aprova a vizinha do mesmo estado (decisão do dono)", () => {
    expect(avaliarCandidato(lugar({ city: "São José dos Pinhais" }), busca)).toEqual({ aprovado: true });
  });

  it("recusa outro estado, dizendo qual", () => {
    expect(avaliarCandidato(lugar({ state_code: "SC" }), busca)).toEqual({
      aprovado: false,
      motivo: "Fora do estado pedido (SC).",
    });
  });

  it("não recusa quando o estado do lugar é desconhecido", () => {
    expect(avaliarCandidato(lugar({ state_code: null }), busca)).toEqual({ aprovado: true });
  });

  it("recusa a padaria com o motivo", () => {
    expect(avaliarCandidato(lugar({ category: "Padaria" }), busca)).toEqual({
      aprovado: false,
      motivo: "Categoria fora do perfil: Padaria.",
    });
  });

  it("recusa telefone inválido com o motivo da régua de telefone", () => {
    const r = avaliarCandidato(
      lugar({ phone: null, phone_issue: "Número de atendimento (0800, 0300, 4003 ou similar)." }),
      busca,
    );
    expect(r).toEqual({ aprovado: false, motivo: "Número de atendimento (0800, 0300, 4003 ou similar)." });
  });

  it("recusa empresa fora do Brasil", () => {
    expect(avaliarCandidato(lugar({ country_code: "PY" }), busca)).toEqual({
      aprovado: false,
      motivo: "Empresa fora do Brasil.",
    });
  });
});
