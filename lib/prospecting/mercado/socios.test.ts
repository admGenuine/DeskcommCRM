import { describe, expect, it } from "vitest";

import { escolherDecisores, nomeLegivel, raizDoCnpj, type LinhaDeSocio } from "./socios";

const linha = (nome: string, codigo: string, qualificacao: string, entrada: string | null) =>
  ({
    cnpj_basico: "19518682",
    nome,
    qualificacao_codigo: codigo,
    qualificacao,
    data_entrada: entrada,
  }) satisfies LinhaDeSocio;

describe("o decisor pelo quadro de sócios", () => {
  it("nome da Receita (maiúsculas, sem acento) fica legível, com as partículas em minúsculas", () => {
    expect(nomeLegivel("JOAO  DA SILVA E SOUZA")).toBe("Joao da Silva e Souza");
  });

  it("o sócio-administrador vem antes do sócio, e o mais antigo antes no mesmo cargo", () => {
    const d = escolherDecisores([
      linha("MARIA SOUZA", "22", "Sócio", "2010-01-01"),
      linha("JOAO DA SILVA", "49", "Sócio-Administrador", "2018-05-01"),
      linha("ANA LIMA", "49", "Sócio-Administrador", "2012-03-01"),
    ]);
    expect(d).toEqual([
      { nome: "Ana Lima", cargo: "Sócio-Administrador", desde: 2012 },
      { nome: "Joao da Silva", cargo: "Sócio-Administrador", desde: 2018 },
      { nome: "Maria Souza", cargo: "Sócio", desde: 2010 },
    ]);
  });

  it("no máximo três, sem repetir a mesma pessoa com dois cargos", () => {
    const d = escolherDecisores([
      linha("JOAO DA SILVA", "49", "Sócio-Administrador", "2015-01-01"),
      linha("JOAO DA SILVA", "22", "Sócio", "2015-01-01"),
      linha("B", "22", "Sócio", null),
      linha("C", "22", "Sócio", null),
      linha("D", "22", "Sócio", null),
    ]);
    expect(d.map((x) => x.nome)).toEqual(["Joao da Silva", "B", "C"]);
  });

  it("cargo fora da lista vem por último, e sem descrição mostra o código", () => {
    const d = escolherDecisores([
      linha("PROCURADOR X", "17", "", "2020-01-01"),
      linha("DONO", "05", "Administrador", null),
    ]);
    expect(d).toEqual([
      { nome: "Dono", cargo: "Administrador", desde: null },
      { nome: "Procurador X", cargo: "Qualificação 17", desde: 2020 },
    ]);
  });

  it("a raiz do CNPJ vem do Mercado ou do achado na Receita", () => {
    expect(raizDoCnpj({ cnpj: "19518682000157" })).toBe("19518682");
    expect(
      raizDoCnpj({
        analise: {
          status: "ok",
          pedida_em: "x",
          iniciada_em: null,
          analisada_em: null,
          site: null,
          perfil: { instagram: null, facebook: null, linkedin: null },
          sinais: [],
          paginas: [],
          observacao: null,
          versao: 3,
          receita: {
            cnpj: "22222222000102",
            razao_social: "X",
            porte: "EPP",
            criterio: "telefone",
          },
        },
      }),
    ).toBe("22222222");
    expect(raizDoCnpj({})).toBeNull();
  });
});
