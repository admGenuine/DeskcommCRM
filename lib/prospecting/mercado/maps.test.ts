import { describe, expect, it } from "vitest";

import type { Prospect } from "../schema";
import { buscaNoMapsSchema, type BuscaNoMaps } from "./busca-no-maps";
import { confereComAEmpresa, mudancaDoLugar, termoDeBusca } from "./maps";

const empresa: Prospect = {
  key: "cnpj:22222222000102",
  name: "IMPERIO DAS AVES INDUSTRIA E COMERCIO DE ALIMENTOS LTDA",
  razao_social: "IMPERIO DAS AVES INDUSTRIA E COMERCIO DE ALIMENTOS LTDA",
  phone: "+554333334444",
  website: null,
  category: "Abate de aves",
  address: null,
  city: "LONDRINA",
  state_code: "PR",
  maps_url: null,
  rating: null,
  reviews: null,
  emails: [],
  socials: [],
  fonte: "mercado",
  cnpj: "22222222000102",
  porte: "EPP",
};

const busca: BuscaNoMaps = {
  status: "buscando",
  run_id: "run-1",
  termo: "IMPERIO DAS AVES INDUSTRIA E COMERCIO DE ALIMENTOS LONDRINA PR",
  teto_usd: 0.1,
  pedida_em: "2026-10-18T10:00:00.000Z",
  concluida_em: null,
  titulo: null,
  observacao: null,
};

const lugar = (over: Record<string, unknown> = {}) => ({
  title: "Império das Aves",
  placeId: "ChIJ-imperio",
  city: "Londrina",
  website: "https://www.papytobirds.com.br/",
  url: "https://maps.google.com/?cid=1",
  totalScore: 4.6,
  reviewsCount: 87,
  phone: "(43) 3333-4444",
  ...over,
});

const agora = new Date("2026-10-18T10:05:00.000Z");

describe("o termo da busca", () => {
  it("nome sem a forma jurídica, cidade e UF", () => {
    expect(termoDeBusca(empresa)).toBe(
      "IMPERIO DAS AVES INDUSTRIA E COMERCIO DE ALIMENTOS LONDRINA PR",
    );
    expect(termoDeBusca({ name: "Massas Serra Ltda.", city: "Toledo", state_code: "PR" })).toBe(
      "Massas Serra Toledo PR",
    );
    expect(termoDeBusca({ ...empresa, city: null })).toBeNull();
  });
});

describe("o lugar do Maps é a empresa?", () => {
  it("palavra própria do nome no lugar e a mesma cidade (sem acento e caixa)", () => {
    expect(confereComAEmpresa(empresa, { name: "Império das Aves", city: "Londrina" })).toBe(true);
  });

  it("outra empresa com nome genérico, ou a mesma marca noutra cidade, não conferem", () => {
    expect(
      confereComAEmpresa(empresa, { name: "Indústria de Alimentos Sul", city: "Londrina" }),
    ).toBe(false);
    expect(confereComAEmpresa(empresa, { name: "Império das Aves", city: "Maringá" })).toBe(false);
  });
});

describe("o que muda no candidato", () => {
  it("achada: site, link, nota e avaliações; o site volta para a análise grátis; o telefone da Receita fica", () => {
    const m = mudancaDoLugar(empresa, busca, lugar(), agora);
    expect(m).toMatchObject({
      website: "https://www.papytobirds.com.br/",
      maps_url: "https://maps.google.com/?cid=1",
      rating: 4.6,
      reviews: 87,
      analise: { status: "pendente" },
      maps_busca: { status: "achada", titulo: "Império das Aves", observacao: null },
    });
    expect(m).not.toHaveProperty("phone");
    expect(buscaNoMapsSchema.parse(m.maps_busca)).toEqual(m.maps_busca);
  });

  it("achada sem site no Maps: traz nota e avaliações, sem mexer na análise", () => {
    const m = mudancaDoLugar(empresa, busca, lugar({ website: undefined }), agora);
    expect(m).not.toHaveProperty("website");
    expect(m).not.toHaveProperty("analise");
    expect(m).toMatchObject({ reviews: 87, maps_busca: { status: "achada" } });
  });

  it("outro lugar: só registra o nome dele, sem trocar nada", () => {
    const m = mudancaDoLugar(empresa, busca, lugar({ title: "Padaria do Zé" }), agora);
    expect(Object.keys(m)).toEqual(["maps_busca"]);
    expect(m.maps_busca).toMatchObject({ status: "nao_confere", titulo: "Padaria do Zé" });
  });

  it("nada no Maps, ou lugar fechado", () => {
    expect(mudancaDoLugar(empresa, busca, null, agora).maps_busca).toMatchObject({
      status: "nao_achada",
    });
    expect(
      mudancaDoLugar(empresa, busca, lugar({ permanentlyClosed: true }), agora).maps_busca,
    ).toMatchObject({ status: "nao_achada" });
  });
});
