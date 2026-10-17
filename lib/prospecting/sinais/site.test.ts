import { describe, expect, it } from "vitest";

import { dominioDoEmail, palavrasDoNome, siteConfere, siteDoCandidato } from "./site";

describe("onde está o site", () => {
  it("o do Maps vem primeiro", () => {
    expect(
      siteDoCandidato({ website: "www.massas.com.br", emails: ["contato@outra.com.br"] }),
    ).toEqual({ url: "https://www.massas.com.br/", origem: "maps" });
  });

  it("sem Maps, o domínio do e-mail, pulando provedor gratuito", () => {
    expect(
      siteDoCandidato({
        website: null,
        emails: ["fabrica@gmail.com", "vendas@laticiniosul.com.br"],
      }),
    ).toEqual({ url: "https://laticiniosul.com.br/", origem: "email" });
    expect(
      siteDoCandidato({ website: null, emails: ["x@hotmail.com", "y@uol.com.br"] }),
    ).toBeNull();
  });

  it("e-mail malformado não vira site", () => {
    expect(dominioDoEmail("sem arroba")).toBeNull();
    expect(dominioDoEmail("a@localhost")).toBeNull();
    expect(dominioDoEmail(" Vendas@Frigo.COM.BR ")).toBe("frigo.com.br");
  });
});

describe("o site é desta empresa?", () => {
  it("palavras próprias do nome, sem as genéricas", () => {
    expect(palavrasDoNome("PRESTO ALIMENTOS LTDA", "Indústria de Massas Presto")).toEqual([
      "presto",
      "massas",
    ]);
  });

  it("vale quando o domínio ou o texto citam o nome", () => {
    expect(
      siteConfere({
        url: "https://prestoalimentos.com.br/",
        texto: "Bem-vindo",
        nomes: ["PRESTO ALIMENTOS LTDA"],
      }),
    ).toBe(true);
    expect(
      siteConfere({
        url: "https://fabrica123.com.br/",
        texto: "A Massas Bortolini nasceu em 1990.",
        nomes: ["BORTOLINI INDUSTRIA DE MASSAS LTDA"],
      }),
    ).toBe(true);
  });

  it("site do contador não vale, mesmo citando a empresa", () => {
    expect(
      siteConfere({
        url: "https://contabilsul.com.br/",
        texto: "Escritório de contabilidade. Clientes: Bortolini.",
        nomes: ["BORTOLINI LTDA"],
      }),
    ).toBe(false);
  });

  it("nome todo genérico não dá para conferir", () => {
    expect(
      siteConfere({
        url: "https://alimentos.com.br/",
        texto: "Indústria de alimentos",
        nomes: ["INDUSTRIA DE ALIMENTOS LTDA"],
      }),
    ).toBe(false);
  });
});
