/**
 * PostgREST em memória para os testes da campanha com modelo (fork da Genuine,
 * 2026-11-13): os filtros e escritas que a rodada, a devolução por modelo
 * indisponível e os avisos usam, aplicados a arrays de linhas. Filtro que ele
 * não conhece não filtra (`order`, `or`): o teste que depender dele mede errado,
 * e por isso a lista do que é entendido está aqui, explícita.
 */
export type Linha = Record<string, unknown>;

export function bancoEmMemoria(tabelas: Record<string, Linha[]>) {
  const builder = (tabela: string) => {
    const filtros: Array<(l: Linha) => boolean> = [];
    let limite = Infinity;
    let escrita:
      | { tipo: "update" | "delete"; dados?: Linha }
      | { tipo: "upsert" | "insert"; linhas: Linha[]; chaves: string[] }
      | null = null;
    let contar = false;
    const linhas = () => (tabelas[tabela] ??= []);
    const resolver = () => {
      if (escrita?.tipo === "insert") {
        for (const nova of escrita.linhas) linhas().push({ ...nova });
        return { data: escrita.linhas, error: null, count: null };
      }
      if (escrita?.tipo === "upsert") {
        const { linhas: novas, chaves } = escrita;
        for (const nova of novas) {
          const existente = linhas().find((l) => chaves.every((k) => l[k] === nova[k]));
          if (existente) Object.assign(existente, nova);
          else linhas().push({ ...nova });
        }
        return { data: novas, error: null, count: null };
      }
      const alvo = linhas()
        .filter((l) => filtros.every((f) => f(l)))
        .slice(0, limite);
      if (escrita?.tipo === "update") for (const l of alvo) Object.assign(l, escrita.dados);
      if (escrita?.tipo === "delete") tabelas[tabela] = linhas().filter((l) => !alvo.includes(l));
      return { data: alvo, error: null, count: contar ? alvo.length : null };
    };
    const filtrar = (f: (l: Linha) => boolean) => (filtros.push(f), b);
    const b: Record<string, unknown> = new Proxy(
      {},
      {
        get(_alvo, metodo) {
          switch (metodo) {
            case "then":
              return (ok: (v: unknown) => unknown) => Promise.resolve(resolver()).then(ok);
            case "maybeSingle":
            case "single":
              return async () => ({ data: resolver().data[0] ?? null, error: null });
            case "select":
              return (_cols?: string, opcoes?: { count?: string }) => {
                if (opcoes?.count) contar = true;
                return b;
              };
            case "update":
              return (dados: Linha) => ((escrita = { tipo: "update", dados }), b);
            case "delete":
              return () => ((escrita = { tipo: "delete" }), b);
            case "insert":
              return (dados: Linha | Linha[]) => {
                escrita = {
                  tipo: "insert",
                  linhas: Array.isArray(dados) ? dados : [dados],
                  chaves: [],
                };
                return b;
              };
            case "upsert":
              return (dados: Linha | Linha[], opcoes?: { onConflict?: string }) => {
                escrita = {
                  tipo: "upsert",
                  linhas: Array.isArray(dados) ? dados : [dados],
                  chaves: (opcoes?.onConflict ?? "id").split(","),
                };
                return b;
              };
            case "eq":
              return (c: string, v: unknown) =>
                c.includes(".") ? b : filtrar((l) => (l[c] ?? null) === v);
            case "neq":
              return (c: string, v: unknown) => filtrar((l) => (l[c] ?? null) !== v);
            case "in":
              return (c: string, vs: unknown[]) => filtrar((l) => vs.includes(l[c]));
            case "is":
              return (c: string, v: unknown) => filtrar((l) => (l[c] ?? null) === v);
            case "not":
              return (c: string, op: string, v: unknown) =>
                op === "is" && v === null ? filtrar((l) => l[c] != null) : b;
            case "gte":
              return (c: string, v: string) => filtrar((l) => l[c] != null && String(l[c]) >= v);
            case "lte":
              return (c: string, v: string) => filtrar((l) => l[c] != null && String(l[c]) <= v);
            case "limit":
              return (n: number) => ((limite = n), b);
            default:
              return () => b;
          }
        },
      },
    );
    return b;
  };
  return { from: (t: string) => builder(t) };
}
