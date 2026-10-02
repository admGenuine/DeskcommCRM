import { describe, expect, it } from "vitest";

import { FILTROS, passaNoFiltro } from "./_filtro";

const candidatos = [
  { status: "new", progress: "new" },
  { status: "skipped", progress: "skipped" },
  { status: "skipped", progress: "skipped" },
  { status: "queued", progress: "queued" },
  { status: "sending", progress: "sending" },
  { status: "sent", progress: "replied" },
  { status: "sent", progress: "qualified" },
];
const contar = (f: (typeof FILTROS)[number]) =>
  candidatos.filter((c) => passaNoFiltro(c, f)).length;

describe("os contadores da campanha filtram a tabela", () => {
  it("cada filtro conta o que o contador do mesmo nome mostra", () => {
    expect(Object.fromEntries(FILTROS.map((f) => [f, contar(f)]))).toEqual({
      todos: 7,
      aprovados: 5,
      recusados: 2,
      fila: 2,
      responderam: 2,
      qualificados: 1,
    });
  });

  it("aprovados e recusados repartem todos, sem sobra nem repetição", () => {
    expect(contar("aprovados") + contar("recusados")).toBe(contar("todos"));
  });
});
