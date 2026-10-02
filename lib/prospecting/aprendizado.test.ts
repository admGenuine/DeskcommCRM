import { describe, expect, it } from "vitest";

import type { Prospect } from "./schema";
import { avaliarCandidato } from "./aceite";
import { segmentoForaDoPerfil } from "./aceite/segmento";
import {
  LIMIAR_DE_RECUSA,
  efeitoDaAvaliacao,
  motivoDoNaoGostei,
  perfilAprendido,
  recusaAprendida,
  recusaDePerfil,
  sinalDaLinha,
  type SinalDeGosto,
} from "./aprendizado";

const nao = (categoria: string | null): SinalDeGosto => ({
  categoria,
  nota: "nao_gostei",
  origem: "avaliacao",
});
const sim = (
  categoria: string | null,
  origem: SinalDeGosto["origem"] = "avaliacao",
): SinalDeGosto => ({
  categoria,
  nota: "gostei",
  origem,
});

describe("perfil aprendido", () => {
  it("junta a mesma categoria sem diferenciar acento e caixa, e conta as fontes", () => {
    const perfil = perfilAprendido([
      nao("Loja de produtos naturais"),
      nao("loja de produtos NATURAIS"),
      sim("Fabricante de alimentos"),
      sim("Fabricante de alimentos", "referencia"),
      sim(null),
    ]);
    expect(perfil.avaliadas).toBe(4);
    expect(perfil.de_referencia).toBe(1);
    expect(perfil.categorias).toEqual([
      { categoria: "Fabricante de alimentos", gostei: 2, nao_gostei: 0, recusa: false },
      { categoria: "Loja de produtos naturais", gostei: 0, nao_gostei: 2, recusa: true },
    ]);
  });

  it(`recusa a categoria só com ${LIMIAR_DE_RECUSA} "não gostei" e nenhum "gostei"`, () => {
    expect(perfilAprendido([nao("Atacadista")]).categorias[0]!.recusa).toBe(false);
    expect(
      perfilAprendido([nao("Atacadista"), nao("Atacadista"), sim("Atacadista")]).categorias[0]!
        .recusa,
    ).toBe(false);
    expect(perfilAprendido([nao("Atacadista"), nao("Atacadista")]).categorias[0]!.recusa).toBe(
      true,
    );
  });

  it("o motivo da recusa aprendida diz de onde veio", () => {
    const perfil = perfilAprendido([
      nao("Loja de produtos naturais"),
      nao("Loja de produtos naturais"),
    ]);
    expect(recusaAprendida(perfil, "loja de produtos naturais")).toBe(
      "Categoria que você marcou como não gostei 2 vezes: Loja de produtos naturais.",
    );
    expect(recusaAprendida(perfil, "Fabricante de alimentos")).toBeNull();
    expect(recusaAprendida(perfil, null)).toBeNull();
  });
});

describe("recusa de perfil (o gostei desfaz) e recusa de fato (não desfaz)", () => {
  const lugar = (extra: Partial<Prospect>): Prospect => ({
    key: "p",
    name: "Empresa Exemplo",
    phone: "+5541999998888",
    website: null,
    category: "Fábrica de alimentos",
    address: null,
    state_code: "PR",
    country_code: "BR",
    maps_url: null,
    rating: null,
    reviews: null,
    emails: [],
    socials: [],
    ...extra,
  });
  const motivo = (p: Prospect) => {
    const v = avaliarCandidato(p, { location: "Curitiba, PR" });
    return v.aprovado ? null : v.motivo;
  };

  // Os motivos saem das funções reais: se um texto mudar lá, este teste acusa.
  it.each([
    ["segmento", segmentoForaDoPerfil({ nome: "Empresa", principal: "Padaria" })],
    ["nome de varejo", segmentoForaDoPerfil({ nome: "Mercado Exemplo", principal: null })],
    ["estado", motivo(lugar({ state_code: "SC" }))],
    ["aprendida", recusaAprendida(perfilAprendido([nao("Padaria"), nao("Padaria")]), "Padaria")],
    ["do dono", motivoDoNaoGostei("caro demais")],
    ["do dono sem motivo", motivoDoNaoGostei(null)],
  ])("%s é de perfil", (_, m) => {
    expect(m).toBeTruthy();
    expect(recusaDePerfil(m)).toBe(true);
  });

  it.each([
    [
      "telefone",
      motivo(
        lugar({ phone: null, phone_issue: "Número de atendimento (0800, 0300, 4003 ou similar)." }),
      ),
    ],
    ["país", motivo(lugar({ country_code: "PY" }))],
    ["CRM", "Já está no CRM."],
    ["WhatsApp", "Número sem WhatsApp."],
    ["sem motivo", null],
  ])("%s é de fato", (_, m) => {
    expect(recusaDePerfil(m)).toBe(false);
  });
});

describe("o que a avaliação muda na fila", () => {
  const base = { motivo: null, error: null, phone: "+5541999998888", campanhaEmRascunho: true };

  it.each(["new", "queued"])("não gostei tira da fila quem está %s", (status) => {
    expect(
      efeitoDaAvaliacao({ ...base, nota: "nao_gostei", motivo: "só revende", status }),
    ).toEqual({
      status: "skipped",
      error: "Você marcou como não gostei: só revende",
    });
  });

  it.each(["sending", "sent", "failed"])("não gostei não mexe em quem está %s", (status) => {
    expect(efeitoDaAvaliacao({ ...base, nota: "nao_gostei", status })).toEqual({
      status,
      error: null,
    });
  });

  it("não gostei em quem já saiu pela régua mantém o motivo da régua", () => {
    const error = "Fora do estado pedido (SC).";
    expect(efeitoDaAvaliacao({ ...base, nota: "nao_gostei", status: "skipped", error })).toEqual({
      status: "skipped",
      error,
    });
  });

  it("trocar o motivo do não gostei regrava o motivo", () => {
    expect(
      efeitoDaAvaliacao({
        ...base,
        nota: "nao_gostei",
        motivo: "outro",
        status: "skipped",
        error: motivoDoNaoGostei("antigo"),
      }),
    ).toEqual({ status: "skipped", error: "Você marcou como não gostei: outro" });
  });

  it("gostei devolve à fila quem saiu por perfil, com a campanha em rascunho", () => {
    expect(
      efeitoDaAvaliacao({
        ...base,
        nota: "gostei",
        status: "skipped",
        error: "Categoria fora do perfil: Padaria.",
      }),
    ).toEqual({ status: "new", error: null });
    expect(
      efeitoDaAvaliacao({
        ...base,
        nota: "gostei",
        status: "skipped",
        error: motivoDoNaoGostei(null),
      }),
    ).toEqual({ status: "new", error: null });
  });

  it("gostei não devolve quem saiu por fato, nem depois de a campanha começar, nem sem telefone", () => {
    const error = "Categoria fora do perfil: Padaria.";
    expect(
      efeitoDaAvaliacao({ ...base, nota: "gostei", status: "skipped", error: "Já está no CRM." }),
    ).toEqual({
      status: "skipped",
      error: "Já está no CRM.",
    });
    expect(
      efeitoDaAvaliacao({
        ...base,
        nota: "gostei",
        status: "skipped",
        error,
        campanhaEmRascunho: false,
      }),
    ).toEqual({ status: "skipped", error });
    expect(
      efeitoDaAvaliacao({ ...base, nota: "gostei", status: "skipped", error, phone: null }),
    ).toEqual({
      status: "skipped",
      error,
    });
  });
});

describe("linha do banco vira sinal", () => {
  it("a avaliação explícita vence a referência", () => {
    expect(
      sinalDaLinha({ categoria: "X", nota: "nao_gostei", referencia: true, error: null }),
    ).toEqual({
      categoria: "X",
      nota: "nao_gostei",
      origem: "avaliacao",
    });
  });

  it("empresa de campanha de referência conta como gostei, salvo se saiu por perfil", () => {
    expect(sinalDaLinha({ categoria: "X", nota: null, referencia: true, error: null })).toEqual({
      categoria: "X",
      nota: "gostei",
      origem: "referencia",
    });
    expect(
      sinalDaLinha({ categoria: "X", nota: null, referencia: true, error: "Já está no CRM." }),
    ).not.toBeNull();
    expect(
      sinalDaLinha({
        categoria: "Padaria",
        nota: null,
        referencia: true,
        error: "Categoria fora do perfil: Padaria.",
      }),
    ).toBeNull();
  });

  it("sem avaliação e sem referência não é sinal; nota desconhecida também não", () => {
    expect(sinalDaLinha({ categoria: "X", nota: null, referencia: false, error: null })).toBeNull();
    expect(
      sinalDaLinha({ categoria: "X", nota: "talvez", referencia: false, error: null }),
    ).toBeNull();
  });
});
