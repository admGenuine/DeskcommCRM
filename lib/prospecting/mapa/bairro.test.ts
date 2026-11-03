import { describe, expect, it } from "vitest";
import {
  SEM_BAIRRO,
  bairroDoEndereco,
  contarPorBairro,
  faixaDaContagem,
  mapaDaCidade,
  nomeOficial,
} from "./bairro";
import { CURITIBA } from "./curitiba";

describe("o bairro lido do endereço", () => {
  it("lê o formato do Maps: depois do ' - ' do trecho anterior à cidade", () => {
    expect(
      bairroDoEndereco(
        "R. João Gava, 830 - Abranches, Curitiba - PR, 82130-010, Brasil",
        "Curitiba",
      ),
    ).toBe("Abranches");
    expect(bairroDoEndereco("R. Exemplo, 100 - Centro, Curitiba - PR, 80000-000, Brasil")).toBe(
      "Centro",
    );
  });

  it("lê o formato do Mercado: o trecho anterior ao 'Cidade - UF', em caixa normal", () => {
    expect(bairroDoEndereco("RUA DAS FLORES 100, CENTRO, PALHOCA - SC, 88130000", "PALHOCA")).toBe(
      "Centro",
    );
    expect(bairroDoEndereco("AV BRASIL 10, JARDIM DAS AMERICAS, CURITIBA - PR, 81530000")).toBe(
      "Jardim das Américas",
    );
  });

  it("devolve o nome oficial do desenho, com acento, e resolve apelidos do Maps", () => {
    expect(bairroDoEndereco("R. X, 1 - Agua Verde, Curitiba - PR", "Curitiba")).toBe("Água Verde");
    expect(bairroDoEndereco("R. X, 1 - Ecoville, Curitiba - PR", "Curitiba")).toBe("Mossunguê");
    expect(bairroDoEndereco("R. X, 1 - CIC, Curitiba - PR", "Curitiba")).toBe(
      "Cidade Industrial de Curitiba",
    );
    expect(nomeOficial("cidade industrial", "Curitiba")).toBe("Cidade Industrial de Curitiba");
  });

  it("não inventa bairro: endereço curto, sem bairro ou só com número devolve null", () => {
    expect(bairroDoEndereco("Rua X, 1", "Curitiba")).toBeNull();
    expect(bairroDoEndereco(null)).toBeNull();
    expect(bairroDoEndereco("R. B, 2 - Joinville - SC, 89200-000")).toBeNull();
    expect(bairroDoEndereco("R. B, 2, Joinville - SC, 89200-000")).toBeNull();
  });
});

describe("o desenho da cidade", () => {
  it("existe para Curitiba, com os 75 bairros, e não para outra cidade", () => {
    expect(mapaDaCidade("Curitiba")).toBe(CURITIBA);
    expect(mapaDaCidade("curitiba - PR")).toBeNull();
    expect(mapaDaCidade("Londrina")).toBeNull();
    expect(CURITIBA.bairros).toHaveLength(75);
    expect(new Set(CURITIBA.bairros.map((b) => b.nome)).size).toBe(75);
    for (const b of CURITIBA.bairros) expect(b.d.startsWith("M")).toBe(true);
  });
});

describe("a contagem por bairro", () => {
  it("ordena do maior para o menor, desempata pelo nome e deixa 'Sem bairro' por último", () => {
    const itens = ["Centro", null, "Batel", "Centro", "Abranches", "Batel"];
    expect(contarPorBairro(itens, (b) => b)).toEqual([
      { bairro: "Batel", total: 2 },
      { bairro: "Centro", total: 2 },
      { bairro: "Abranches", total: 1 },
      { bairro: SEM_BAIRRO, total: 1 },
    ]);
  });

  it("pinta em cinco faixas na escala de uma campanha", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 30].map(faixaDaContagem)).toEqual([0, 1, 2, 2, 3, 3, 4, 4]);
  });
});
