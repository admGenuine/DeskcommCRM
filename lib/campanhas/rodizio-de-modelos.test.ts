/**
 * O RODÍZIO DE MODELOS e a PROPORÇÃO (fork da Genuine, 2026-11-13).
 *
 * Simula o disparo: a cada envio pergunta ao rodízio qual modelo sai e conta o
 * envio nele, como a rodada faz pelo registro no banco.
 */
import { describe, expect, it } from "vitest";

import { escolherModelo, type ModeloNoRodizio } from "./rodizio-de-modelos";

/** Dispara `envios` vezes e devolve a sequência de posições que saíram. */
function disparar(
  pesos: readonly number[],
  envios: number,
  aprovadoEm: (posicao: number, envio: number) => boolean = () => true,
): number[] {
  const enviados = pesos.map(() => 0);
  const sequencia: number[] = [];
  for (let envio = 0; envio < envios; envio++) {
    const lista: ModeloNoRodizio[] = pesos.map((peso, posicao) => ({
      posicao,
      peso,
      enviados: enviados[posicao]!,
      aprovado: aprovadoEm(posicao, envio),
    }));
    const escolhido = escolherModelo(lista);
    if (escolhido === null) break;
    enviados[escolhido]!++;
    sequencia.push(escolhido);
  }
  return sequencia;
}

const contar = (sequencia: readonly number[], posicao: number) =>
  sequencia.filter((p) => p === posicao).length;

describe("o rodízio de modelos", () => {
  it("pesos iguais alternam um a um, começando pelo primeiro da lista", () => {
    expect(disparar([1, 1], 6)).toEqual([0, 1, 0, 1, 0, 1]);
  });

  it("dois do A para cada um do B: A, A, B, A, A, B", () => {
    expect(disparar([2, 1], 6)).toEqual([0, 0, 1, 0, 0, 1]);
  });

  it("três modelos em 3 : 2 : 1 cumprem a proporção a cada ciclo de seis", () => {
    const sequencia = disparar([3, 2, 1], 6);
    expect([contar(sequencia, 0), contar(sequencia, 1), contar(sequencia, 2)]).toEqual([3, 2, 1]);
  });

  it("ao longo de 100 envios, a proporção 2 : 1 fica exata ou a um envio dela", () => {
    const sequencia = disparar([2, 1], 100);
    expect(sequencia).toHaveLength(100);
    expect(Math.abs(contar(sequencia, 0) - 67)).toBeLessThanOrEqual(1);
    expect(Math.abs(contar(sequencia, 1) - 33)).toBeLessThanOrEqual(1);
    // Em qualquer trecho, nenhum modelo fica mais de um envio fora da proporção.
    for (let n = 1; n <= 100; n++) {
      const aN = contar(sequencia.slice(0, n), 0);
      expect(Math.abs(aN - (2 * n) / 3)).toBeLessThanOrEqual(1);
    }
  });

  it("modelo pausado é pulado, e o envio segue com os outros", () => {
    // O A é pausado do envio 3 ao 8: nesse trecho só sai o B.
    const pausadoNoMeio = (posicao: number, envio: number) =>
      !(posicao === 0 && envio >= 3 && envio < 9);
    const sequencia = disparar([2, 1], 12, pausadoNoMeio);
    expect(sequencia).toHaveLength(12);
    expect(sequencia.slice(3, 9)).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it("quando o modelo pausado volta, ele sai até alcançar a proporção da campanha inteira", () => {
    const pausadoNoMeio = (posicao: number, envio: number) =>
      !(posicao === 0 && envio >= 3 && envio < 9);
    const sequencia = disparar([1, 1], 20, pausadoNoMeio);
    // Depois da volta, o A sai em sequência só até alcançar o B; então alternam.
    const depois = sequencia.slice(9);
    const aDepois = contar(depois, 0);
    expect(aDepois).toBeGreaterThan(contar(depois, 1));
    expect(contar(sequencia, 0)).toBe(contar(sequencia, 1));
  });

  it("nenhum aprovado: ninguém sai (quem chama pausa a campanha)", () => {
    expect(
      escolherModelo([
        { posicao: 0, peso: 2, enviados: 0, aprovado: false },
        { posicao: 1, peso: 1, enviados: 0, aprovado: false },
      ]),
    ).toBeNull();
    expect(escolherModelo([])).toBeNull();
  });

  it("um modelo só sai sempre, como na campanha de um modelo", () => {
    expect(disparar([1], 5)).toEqual([0, 0, 0, 0, 0]);
  });

  it("o atraso conta o que já saiu antes: campanha retomada continua a proporção", () => {
    // Já saíram 10 do A e 2 do B com pesos 2 : 1. O B está atrasado e sai.
    expect(
      escolherModelo([
        { posicao: 0, peso: 2, enviados: 10, aprovado: true },
        { posicao: 1, peso: 1, enviados: 2, aprovado: true },
      ]),
    ).toBe(1);
  });
});
