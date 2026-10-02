import { describe, expect, it } from "vitest";

import { avaliarTelefoneBR } from "./telefone";

const ok = (bruto: string) => {
  const r = avaliarTelefoneBR(bruto);
  return r.ok ? `${r.e164} ${r.tipo}` : `recusado: ${r.motivo}`;
};

describe("telefone brasileiro de fonte pública", () => {
  it.each([
    ["(41) 99999-8888", "+5541999998888 celular"],
    ["(41) 3333-4444", "+554133334444 fixo"],
    ["+55 41 3333-4444", "+554133334444 fixo"],
    ["+5541999998888", "+5541999998888 celular"],
    ["55 41 99999-8888", "+5541999998888 celular"],
    ["4133334444", "+554133334444 fixo"],
  ])("aceita %s", (bruto, esperado) => {
    expect(ok(bruto)).toBe(esperado);
  });

  it("tira o zero de discagem, que a regra antiga transformava em DDD 04", () => {
    expect(ok("(041) 3333-4444")).toBe("+554133334444 fixo");
  });

  it("tira o zero e o código de operadora", () => {
    expect(ok("0 41 41 3333-4444")).toBe("+554133334444 fixo");
    expect(ok("0xx41 99999-8888".replace("xx", "15"))).toBe("+5541999998888 celular");
  });

  it("devolve o celular antigo sem o nono dígito já com o nono", () => {
    expect(ok("(41) 9999-8888")).toBe("+5541999998888 celular");
  });

  it.each([
    ["0800 123 4567", "Número de atendimento"],
    ["0300 789 1234", "Número de atendimento"],
    ["4003-1234", "Número de atendimento"],
    ["3003 1234", "Número de atendimento"],
    ["(00) 99999-9999", "DDD inexistente (00)"],
    ["(20) 3333-4444", "DDD inexistente (20)"],
    ["3333-4444", "Telefone sem DDD"],
    ["99999-8888", "Telefone sem DDD"],
    ["(41) 3333-444", "Telefone sem DDD"],
    ["(41) 8999-88888", "quantidade de dígitos inválida"],
    ["(41) 1333-4444", "Telefone inválido"],
    ["+1 212 555 1234", "fora do Brasil"],
    ["", "Sem telefone"],
  ])("recusa %s", (bruto, motivo) => {
    expect(ok(bruto)).toContain("recusado");
    expect(ok(bruto)).toContain(motivo);
  });
});
