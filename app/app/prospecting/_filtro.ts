/**
 * Os contadores da campanha também são filtros da tabela de resultados.
 *
 * Antes eles só contavam: com "3 recusados" no topo, as três empresas ficavam
 * misturadas às aprovadas no fim da página, e não havia como chegar a elas para
 * dar o "gostei" que as devolve à fila (`lib/prospecting/aprendizado.ts`).
 * Medido na VPS da Genuine em 02/10/2026: "não consigo acessar as empresas
 * recusadas".
 *
 * Cada filtro conta exatamente o que o contador do mesmo nome mostra.
 */
export const FILTROS = [
  "todos",
  "aprovados",
  "recusados",
  "fila",
  "responderam",
  "qualificados",
] as const;
export type Filtro = (typeof FILTROS)[number];

export function passaNoFiltro(c: { status: string; progress: string }, filtro: Filtro): boolean {
  switch (filtro) {
    case "todos":
      return true;
    case "aprovados":
      return c.status !== "skipped";
    case "recusados":
      return c.status === "skipped";
    case "fila":
      return c.progress === "queued" || c.progress === "sending";
    case "responderam":
      return c.progress === "replied" || c.progress === "qualified";
    case "qualificados":
      return c.progress === "qualified";
  }
}
