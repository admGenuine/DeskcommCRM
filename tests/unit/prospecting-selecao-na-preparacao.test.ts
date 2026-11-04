/**
 * MARCAR NA PREPARAÇÃO DEVOLVE QUEM A RÉGUA RECUSOU SÓ POR PERFIL
 * (`lib/prospecting/selecao-na-preparacao.ts`, fork, 2026-11-04).
 *
 * Na VPS da Genuine, uma busca de panificadoras teve as 20 empresas recusadas
 * por "Categoria fora do perfil: Padaria.", e o "+ Abordar" da campanha aberta
 * não mudava nada: a ação `select` só tocava em quem estava como "Encontrado".
 * Aqui se mede o que marcar passa a fazer, e o que continua sem fazer:
 *
 *   - a recusada por perfil, com telefone, volta a "Encontrado" (e a seleção
 *     do original, logo depois, a marca);
 *   - a recusada de fato (sem telefone, já no CRM, sem WhatsApp) não volta;
 *   - a rota só devolve ao marcar, depois de conferir a preparação;
 *   - todo SQL filtra a organização e a campanha.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { devolverRecusadasPorPerfil } from "@/lib/prospecting/selecao-na-preparacao";
import {
  entraNaAnalise,
  naoGosteiDoDono,
  PADROES_SQL_DA_REGUA,
  podeVoltarPorPerfil,
  recusaDaRegua,
} from "@/lib/prospecting/aprendizado";

const ORG = "org-1";
const CAMPANHA = "11111111-1111-4111-8111-111111111111";

type Recusada = { id: string; error: string | null; phone: string | null };

function banco(recusadas: Recusada[]) {
  const chamadas: { sql: string; params: unknown[] }[] = [];
  const db = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      chamadas.push({ sql, params });
      if (sql.startsWith("select id,error,phone from prospecting_candidates"))
        return { rows: recusadas, rowCount: recusadas.length };
      if (sql.includes("set status='new'"))
        return { rows: [], rowCount: (params[2] as string[]).length };
      return { rows: [], rowCount: 0 };
    }),
  };
  return { db: db as never, chamadas };
}

describe("marcar na preparação devolve a recusada por perfil", () => {
  it("devolve a recusada por perfil com telefone, e não a recusada de fato", async () => {
    const { db, chamadas } = banco([
      { id: "a", error: "Categoria fora do perfil: Padaria.", phone: "+5541999990001" },
      { id: "b", error: "Sem telefone brasileiro válido.", phone: null },
      { id: "c", error: "Já está no CRM.", phone: "+5541999990003" },
      { id: "d", error: "Categoria fora do perfil: Padaria.", phone: null },
    ]);
    expect(await devolverRecusadasPorPerfil(db, ORG, CAMPANHA, ["a", "b", "c", "d", "e"])).toBe(1);
    const busca = chamadas[0]!;
    expect(busca.sql).toContain("status='skipped'");
    expect(busca.sql).toContain("suppression_salt is null");
    expect(busca.params).toEqual([ORG, CAMPANHA, ["a", "b", "c", "d", "e"]]);
    const volta = chamadas.find((c) => c.sql.includes("set status='new'"))!;
    expect(volta.params).toEqual([ORG, CAMPANHA, ["a"]]);
    // A volta só vale para quem ainda está recusado e não foi anonimizado.
    expect(volta.sql).toContain("status='skipped'");
    expect(volta.sql).toContain("suppression_salt is null");
    // Todo SQL filtra a organização e a campanha.
    for (const c of chamadas) {
      expect(c.sql).toContain("organization_id=$1 and campaign_id=$2");
      expect(c.params.slice(0, 2)).toEqual([ORG, CAMPANHA]);
    }
  });

  it("sem recusada que possa voltar, não escreve nada", async () => {
    const { db, chamadas } = banco([
      { id: "b", error: "Número sem WhatsApp.", phone: "+5541999990002" },
    ]);
    expect(await devolverRecusadasPorPerfil(db, ORG, CAMPANHA, ["b"])).toBe(0);
    expect(chamadas.some((c) => c.sql.startsWith("update"))).toBe(false);
  });
});

describe("a rota chama a devolução só ao marcar, dentro da seleção do original", () => {
  const rota = fs.readFileSync(
    path.resolve(__dirname, "../../app/api/v1/prospecting/route.ts"),
    "utf8",
  );
  const acao = rota.slice(
    rota.indexOf('body.action === "select"'),
    rota.indexOf('body.action === "select_in_queue"'),
  );
  it("confere a preparação antes, devolve só com `selected`, e audita quantas voltaram", () => {
    expect(acao.indexOf("status='draft'")).toBeLessThan(acao.indexOf("devolverRecusadasPorPerfil"));
    expect(acao).toMatch(/body\.selected\s*\?\s*await devolverRecusadasPorPerfil/);
    expect(acao).toMatch(/devolvidas: selecao\.devolvidas/);
  });
});

describe("as regras puras que a tela e o servidor dividem", () => {
  it("volta por perfil: régua, gosto aprendido e o não gostei; nunca recusa de fato", () => {
    const linha = (error: string | null, phone: string | null = "+5541999990000") => ({
      status: "skipped",
      error,
      phone,
    });
    expect(podeVoltarPorPerfil(linha("Categoria fora do perfil: Padaria."))).toBe(true);
    expect(podeVoltarPorPerfil(linha("Fora do estado pedido (SC)."))).toBe(true);
    expect(podeVoltarPorPerfil(linha("Você marcou como não gostei: só revende"))).toBe(true);
    expect(podeVoltarPorPerfil(linha("Já está no CRM."))).toBe(false);
    expect(podeVoltarPorPerfil(linha("Número sem WhatsApp."))).toBe(false);
    expect(podeVoltarPorPerfil(linha(null))).toBe(false);
    expect(podeVoltarPorPerfil(linha("Categoria fora do perfil: Padaria.", null))).toBe(false);
    expect(podeVoltarPorPerfil({ ...linha("Categoria fora do perfil: Bar."), status: "new" })).toBe(
      false,
    );
  });

  it("a análise pega a régua, não o não gostei dado à empresa", () => {
    expect(recusaDaRegua("Categoria fora do perfil: Padaria.")).toBe(true);
    expect(recusaDaRegua("Categoria que você marcou como não gostei 3 vezes: Bar.")).toBe(true);
    expect(recusaDaRegua("Você marcou como não gostei.")).toBe(false);
    expect(naoGosteiDoDono("Você marcou como não gostei: caro")).toBe(true);
    expect(naoGosteiDoDono("Categoria que você marcou como não gostei 3 vezes: Bar.")).toBe(false);
    expect(
      entraNaAnalise({ status: "skipped", error: "Você marcou como não gostei.", phone: "+55" }),
    ).toBe(false);
    expect(entraNaAnalise({ status: "new", error: null, phone: null })).toBe(true);
  });

  it("os padrões do SQL são os começos da régua, com o curinga no fim", () => {
    expect(PADROES_SQL_DA_REGUA).toContain("Categoria fora do perfil:%");
    expect(PADROES_SQL_DA_REGUA.every((p) => p.endsWith("%"))).toBe(true);
    expect(PADROES_SQL_DA_REGUA.some((p) => p.startsWith("Você marcou"))).toBe(false);
    // Um padrão LIKE de cada começo casa o motivo que a régua grava.
    const casa = (motivo: string) =>
      PADROES_SQL_DA_REGUA.some((p) => motivo.startsWith(p.slice(0, -1)));
    expect(casa("Nome indica varejo ou alimentação ao público: Padaria Bom Pão.")).toBe(true);
  });
});
