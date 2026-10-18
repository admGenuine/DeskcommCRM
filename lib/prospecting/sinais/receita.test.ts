import { describe, expect, it } from "vitest";

import {
  acharNaReceita,
  buscarNaReceita,
  municipioComparavel,
  telefoneComparavel,
  type LinhaDaReceita,
} from "./receita";

const linha = (over: Partial<LinhaDaReceita>): LinhaDaReceita => ({
  cnpj: "11111111000101",
  cnpj_basico: "11111111",
  matriz: true,
  razao_social: "EMPRESA QUALQUER LTDA",
  nome_fantasia: null,
  telefone1: null,
  telefone2: null,
  porte: "ME",
  ...over,
});

describe("comparação de telefone e cidade", () => {
  it("DDD e os últimos 8 dígitos, do E.164 do Maps ou da máscara da Receita", () => {
    expect(telefoneComparavel("+5543999998888")).toBe("4399998888");
    expect(telefoneComparavel("(43) 9999-8888")).toBe("4399998888");
    expect(telefoneComparavel("043 3333 4444")).toBe("4333334444");
    expect(telefoneComparavel("3333-4444")).toBeNull();
    expect(telefoneComparavel(null)).toBeNull();
  });

  it("cidade sem acento e em maiúsculas", () => {
    expect(municipioComparavel("São José  dos Pinhais")).toBe("SAO JOSE DOS PINHAIS");
  });
});

describe("achar a empresa do Maps na Receita", () => {
  const imperio = linha({
    cnpj: "22222222000102",
    cnpj_basico: "22222222",
    razao_social: "IMPERIO DAS AVES INDUSTRIA E COMERCIO DE ALIMENTOS LTDA",
    nome_fantasia: "PAPYTO BIRDS",
    telefone1: "4333334444",
    porte: "EPP",
  });
  const outra = linha({
    cnpj: "33333333000103",
    cnpj_basico: "33333333",
    razao_social: "AVES DO SUL ALIMENTOS LTDA",
  });

  it("pelo telefone, mesmo com o nome diferente", () => {
    expect(
      acharNaReceita({ name: "Papyto Birds", phone: "+554333334444" }, [outra, imperio]),
    ).toEqual({
      cnpj: "22222222000102",
      razao_social: "IMPERIO DAS AVES INDUSTRIA E COMERCIO DE ALIMENTOS LTDA",
      porte: "EPP",
      criterio: "telefone",
    });
  });

  it("pelo nome: todas as palavras próprias do nome do Maps na razão ou na fantasia", () => {
    const achado = acharNaReceita(
      { name: "IMPÉRIO DAS AVES INDUSTRIA E COMERCIO DE ALIMENTOS", phone: null },
      [outra, imperio],
    );
    expect(achado).toMatchObject({ cnpj: "22222222000102", criterio: "nome" });
  });

  it("dois CNPJs que cabem no nome: não há como saber, fica sem", () => {
    const gemea = linha({
      cnpj: "44444444000104",
      cnpj_basico: "44444444",
      razao_social: "IMPERIO DAS AVES ABATEDOURO LTDA",
    });
    expect(acharNaReceita({ name: "Império das Aves", phone: null }, [imperio, gemea])).toBeNull();
  });

  it("filiais da mesma raiz contam como uma empresa só, e a matriz vem primeiro", () => {
    const filial = { ...imperio, cnpj: "22222222000283", matriz: false };
    expect(acharNaReceita({ name: "Império das Aves", phone: null }, [filial, imperio])?.cnpj).toBe(
      "22222222000102",
    );
  });

  it("nome só com palavras genéricas não acha nada pelo nome", () => {
    expect(
      acharNaReceita({ name: "Indústria de Alimentos", phone: null }, [imperio, outra]),
    ).toBeNull();
  });

  it("não procura no banco quem veio do Mercado ou não tem cidade", async () => {
    const pool = {
      query: async () => {
        throw new Error("não devia consultar");
      },
    };
    const base = { name: "X", phone: null, city: "Londrina", state_code: "PR" };
    expect(await buscarNaReceita(pool, { ...base, fonte: "mercado" })).toBeUndefined();
    expect(await buscarNaReceita(pool, { ...base, city: null })).toBeUndefined();
  });
});
