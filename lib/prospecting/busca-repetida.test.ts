import { describe, expect, it } from "vitest";

import {
  ALCANCE_MAXIMO,
  alcanceDaBusca,
  chaveDaBusca,
  mesmaBusca,
  motivoDeFaltarem,
} from "./busca-repetida";

describe("busca repetida", () => {
  it("termo e local são comparados sem acento, caixa e espaço sobrando", () => {
    expect(
      mesmaBusca(
        { niche: "Fábrica de  Alimentos", location: "Londrina, PR" },
        { niche: "fabrica de alimentos ", location: "londrina, pr" },
      ),
    ).toBe(true);
    expect(
      mesmaBusca(
        { niche: "fábrica", location: "Londrina, PR" },
        { niche: "fábrica", location: "Maringá, PR" },
      ),
    ).toBe(false);
  });

  it("busca gravada sem termo não casa com nada", () => {
    expect(chaveDaBusca({})).toBeNull();
    expect(mesmaBusca({}, {})).toBe(false);
  });

  it.each([
    [20, 0, 20],
    [10, 7, 17],
    [100, 500, ALCANCE_MAXIMO],
    [10, -3, 10],
  ])("limite %i com %i conhecidas pede %i lugares", (limite, conhecidos, alcance) => {
    expect(alcanceDaBusca(limite, conhecidos)).toBe(alcance);
  });

  const base = {
    limite: 10,
    novos: 4,
    pedidos: 30,
    devolvidos: 30,
    custoUsd: 0.2,
    tetoUsd: 1,
    interrompida: false,
  };

  it("vieram todas as novas: sem aviso", () => {
    expect(motivoDeFaltarem({ ...base, novos: 10 })).toBeNull();
  });

  it("busca interrompida: o aviso de interrupção já diz mais", () => {
    expect(motivoDeFaltarem({ ...base, interrompida: true, custoUsd: 1 })).toBeNull();
  });

  it("o teto de gasto parou a busca", () => {
    expect(motivoDeFaltarem({ ...base, custoUsd: 0.95, devolvidos: 18 })).toBe(
      "O teto de gasto (US$ 1.00) acabou antes de a busca achar 10 empresas novas. Aumente o teto para ir mais fundo.",
    );
  });

  it("o Maps acabou antes do pedido", () => {
    expect(motivoDeFaltarem({ ...base, devolvidos: 18 })).toBe(
      "O Maps não mostrou mais empresas para este termo e local. Para achar outras, mude o termo ou a cidade.",
    );
  });

  it("veio tudo o que foi pedido, mas parte era de buscas com outro termo: sem aviso extra", () => {
    expect(motivoDeFaltarem(base)).toBeNull();
  });

  it("custo desconhecido não é teto atingido", () => {
    expect(motivoDeFaltarem({ ...base, custoUsd: null })).toBeNull();
  });
});
