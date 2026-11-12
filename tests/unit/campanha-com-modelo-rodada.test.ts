/**
 * A RODADA DE CAMPANHA COM MODELO, de ponta a ponta (fork da Genuine,
 * 2026-11-12).
 *
 * Passa pela `rodarUmaRodadaDeCampanha` de verdade, com o banco em memória e
 * o envio dublado na borda (`sendMessageHandler`), para medir o que o pedido
 * prometeu:
 *
 *   1. campanha com modelo envia MODELO, com os valores de cada pessoa, e faz
 *      vários envios na mesma rodada;
 *   2. quem pediu para sair continua pulado, no meio da repetição;
 *   3. os tetos continuam mandando (o da campanha e o do número);
 *   4. modelo pausado na plataforma pausa a campanha, sem envio;
 *   5. campanha de texto continua igual: um envio de texto por rodada.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const borda = vi.hoisted(() => ({
  envios: [] as Array<Record<string, unknown>>,
  enviadosHojeNoNumero: 0,
  statusDoModelo: "APPROVED" as string,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
}));
vi.mock("@/app/api/v1/messages/_handler", () => ({
  sendMessageHandler: async (_admin: unknown, _ctx: unknown, corpo: Record<string, unknown>) => {
    borda.envios.push(corpo);
    return { id: `msg-${borda.envios.length}`, status: "sent" };
  },
}));
vi.mock("@/lib/agent-engine/db/request-pool", () => ({ getRequestPool: () => ({}) }));
vi.mock("@/lib/agent-engine/pacing/store", async () => {
  const { PACING_DEFAULTS } = (await vi.importActual("@/lib/agent-engine/pacing/defaults")) as {
    PACING_DEFAULTS: Record<string, unknown>;
  };
  return {
    loadChannelKnobs: async () => ({
      knobs: { ...PACING_DEFAULTS, timezone: "America/Sao_Paulo" },
      numberActivatedAt: null,
    }),
    loadPacingState: async () => ({
      lastSentAt: null,
      sentToday: borda.enviadosHojeNoNumero,
      numberActivatedAt: null,
    }),
    recordSend: async () => {
      borda.enviadosHojeNoNumero++;
    },
  };
});
vi.mock("@/lib/atendimento/origem", () => ({
  beginServiceAtOrigin: async () => ({ conversation_id: "conversa-1" }),
}));
vi.mock("@/lib/channels/modelos-da-conexao", () => ({
  MODELO_APROVADO: "APPROVED",
  conexaoExigeModelo: async () => true,
  modeloDaConexao: async (_admin: unknown, chave: { name: string; language: string }) => ({
    name: chave.name,
    language: chave.language,
    category: "MARKETING",
    status: borda.statusDoModelo,
    vagas: [],
    previa: "",
    valoresSalvos: {},
    components: [],
    parameterFormat: "POSITIONAL",
  }),
  textoDoModelo: (_m: unknown, valores: Record<string, string>) =>
    `Olá ${valores["1"]}, a promoção de ${valores["2"]} começou.`,
}));

import { serializarModelo } from "@/lib/campanhas/modelo-da-campanha";
import { renderizar } from "@/lib/campanhas/renderizador";
import { rodarUmaRodadaDeCampanha } from "@/lib/campanhas/rodada";
import { STATUS_OPERANTE } from "@/lib/organizacao/operante";

type Linha = Record<string, unknown>;

/** PostgREST em memória: os filtros e escritas que a rodada usa, aplicados às linhas. */
function bancoEmMemoria(tabelas: Record<string, Linha[]>) {
  const builder = (tabela: string) => {
    const filtros: Array<(l: Linha) => boolean> = [];
    let limite = Infinity;
    let escrita: { tipo: "update" | "delete"; dados?: Linha } | null = null;
    let contar = false;
    const linhas = () => (tabelas[tabela] ??= []);
    const resolver = () => {
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
            case "eq":
              return (c: string, v: unknown) => (c.includes(".") ? b : filtrar((l) => l[c] === v));
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

const ORG = "11111111-1111-4111-8111-111111111111";
const CAMPANHA = "22222222-2222-4222-8222-222222222222";
const NUMERO = "33333333-3333-4333-8333-333333333333";
// Quinta-feira, 14h em São Paulo: dentro da janela de envio do número.
const AGORA = new Date("2026-11-12T17:00:00.000Z");

const MAPA = { "1": "{{primeiro_nome}}", "2": "{{lead.cidade}}" };
const CORPO_DO_MODELO = serializarModelo({
  template_name: "promo",
  template_language: "pt_BR",
  variable_map: MAPA,
});

function campanha(extra: Linha = {}): Linha {
  return {
    id: CAMPANHA,
    organization_id: ORG,
    channel_session_id: NUMERO,
    name: "Promoção",
    message_body: CORPO_DO_MODELO,
    content_version: 1,
    intervalo_segundos: null,
    janela_inicio_hora: null,
    janela_fim_hora: null,
    teto_diario: null,
    teto_horario: null,
    status: "running",
    started_at: "2026-11-12T12:00:00.000Z",
    organizations: { status: STATUS_OPERANTE },
    ...extra,
  };
}

function destinatario(
  indice: number,
  pessoa: { nome: string; cidade: string; bloqueado?: boolean },
  corpo = CORPO_DO_MODELO,
): Linha {
  // O corpo congelado como a preparação do original congela: renderizado sem hora.
  const congelado = renderizar(corpo, { nome: pessoa.nome, lead: { cidade: pessoa.cidade } }).texto;
  return {
    id: `dest-${indice}`,
    campaign_id: CAMPANHA,
    organization_id: ORG,
    contact_id: `contato-${indice}`,
    status: "pending",
    recipient_address: `+55419999900${indice}`,
    rendered_body: congelado,
    next_attempt_at: null,
    sent_at: null,
    created_at: `2026-11-12T10:00:0${indice}.000Z`,
    contacts: {
      id: `contato-${indice}`,
      name: pessoa.nome,
      display_name: null,
      phone_number: `+55419999900${indice}`,
      is_blocked: !!pessoa.bloqueado,
      is_personal: false,
      is_anonymized: false,
      consent: {},
    },
  };
}

function cenario(opcoes: { campanha?: Linha; modelo?: Linha | null; destinatarios: Linha[] }) {
  const tabelas: Record<string, Linha[]> = {
    campaigns: [opcoes.campanha ?? campanha()],
    campaign_message_templates:
      opcoes.modelo === null
        ? []
        : [
            {
              campaign_id: CAMPANHA,
              organization_id: ORG,
              template_name: "promo",
              template_language: "pt_BR",
              variable_map: MAPA,
              envios_por_rodada: 2,
              ...(opcoes.modelo ?? {}),
            },
          ],
    campaign_recipients: opcoes.destinatarios,
    channel_sessions: [
      { id: NUMERO, organization_id: ORG, status: "WORKING", daily_message_limit: null },
    ],
  };
  return { admin: bancoEmMemoria(tabelas) as never, tabelas };
}

beforeEach(() => {
  borda.envios = [];
  borda.enviadosHojeNoNumero = 0;
  borda.statusDoModelo = "APPROVED";
});

describe("rodada de campanha com modelo", () => {
  it("envia o MODELO, com os valores de cada pessoa, e faz `envios_por_rodada` envios na rodada", async () => {
    const { admin, tabelas } = cenario({
      destinatarios: [
        destinatario(1, { nome: "Ana Souza", cidade: "Curitiba" }),
        destinatario(2, { nome: "Bruno Lima", cidade: "Londrina" }),
        destinatario(3, { nome: "Carla Dias", cidade: "Maringá" }),
      ],
    });
    const r = await rodarUmaRodadaDeCampanha(admin, AGORA);
    expect(r.enviadas).toBe(2);
    expect(borda.envios).toHaveLength(2);
    expect(borda.envios[0]).toMatchObject({
      type: "template",
      template_name: "promo",
      template_language: "pt_BR",
      template_values: { "1": "Ana", "2": "Curitiba" },
      body: "Olá Ana, a promoção de Curitiba começou.",
      metadata: { source: "campaign", campaign_id: CAMPANHA },
    });
    expect(borda.envios[1]).toMatchObject({ template_values: { "1": "Bruno", "2": "Londrina" } });
    // A terceira fica para a próxima rodada.
    const status = Object.fromEntries(tabelas.campaign_recipients!.map((d) => [d.id, d.status]));
    expect(status).toEqual({ "dest-1": "sent", "dest-2": "sent", "dest-3": "pending" });
  });

  it("quem pediu para sair continua pulado no meio da repetição, sem gastar envio", async () => {
    const { admin, tabelas } = cenario({
      destinatarios: [
        destinatario(1, { nome: "Ana Souza", cidade: "Curitiba", bloqueado: true }),
        destinatario(2, { nome: "Bruno Lima", cidade: "Londrina" }),
        destinatario(3, { nome: "Carla Dias", cidade: "Maringá" }),
      ],
    });
    const r = await rodarUmaRodadaDeCampanha(admin, AGORA);
    expect(r).toMatchObject({ enviadas: 2, pulados: 1 });
    expect(borda.envios.map((e) => (e.template_values as Record<string, string>)["1"])).toEqual([
      "Bruno",
      "Carla",
    ]);
    expect(tabelas.campaign_recipients![0]).toMatchObject({
      status: "opted_out",
      exclusion_reason: "opt_out",
    });
  });

  it("o teto do número continua mandando: com 19 de 20 já enviados hoje, sai só mais um", async () => {
    // Número sem data de ativação gravada conta como novo: o aquecimento dá 20 por dia.
    borda.enviadosHojeNoNumero = 19;
    const { admin } = cenario({
      modelo: { envios_por_rodada: 10 },
      destinatarios: [1, 2, 3].map((i) =>
        destinatario(i, { nome: `Pessoa ${i}`, cidade: "Curitiba" }),
      ),
    });
    const r = await rodarUmaRodadaDeCampanha(admin, AGORA);
    expect(r.enviadas).toBe(1);
    expect(borda.envios).toHaveLength(1);
  });

  it("modelo pausado na plataforma: a campanha pausa com o motivo, e nada sai", async () => {
    borda.statusDoModelo = "PAUSED";
    const { admin, tabelas } = cenario({
      destinatarios: [destinatario(1, { nome: "Ana Souza", cidade: "Curitiba" })],
    });
    const r = await rodarUmaRodadaDeCampanha(admin, AGORA);
    expect(r.enviadas).toBe(0);
    expect(borda.envios).toHaveLength(0);
    expect(tabelas.campaigns![0]).toMatchObject({
      status: "paused",
      failure_code: "modelo_nao_aprovado:PAUSED",
    });
    expect(tabelas.campaign_recipients![0]!.status).toBe("pending");
  });

  it("cópia de modelo sem a escolha ao lado: o destinatário falha com o motivo, nada sai como texto", async () => {
    const { admin, tabelas } = cenario({
      modelo: null,
      destinatarios: [destinatario(1, { nome: "Ana Souza", cidade: "Curitiba" })],
    });
    await rodarUmaRodadaDeCampanha(admin, AGORA);
    expect(borda.envios).toHaveLength(0);
    expect(tabelas.campaign_recipients![0]).toMatchObject({
      status: "failed",
      last_error_code: "send_exception",
    });
    expect(String(tabelas.campaign_recipients![0]!.last_error_detail)).toMatch(/modelo_ausente/);
  });
});

describe("rodada de campanha de texto: igual a antes", () => {
  it("um envio de texto por rodada, mesmo com mais gente na fila", async () => {
    const texto = "Oi {{primeiro_nome}}, tudo bem?";
    const { admin } = cenario({
      campanha: campanha({ message_body: texto }),
      modelo: null,
      destinatarios: [
        destinatario(1, { nome: "Ana Souza", cidade: "Curitiba" }, texto),
        destinatario(2, { nome: "Bruno Lima", cidade: "Londrina" }, texto),
      ],
    });
    const r = await rodarUmaRodadaDeCampanha(admin, AGORA);
    expect(r.enviadas).toBe(1);
    expect(borda.envios).toEqual([
      expect.objectContaining({ type: "text", body: "Oi Ana, tudo bem?" }),
    ]);
    expect(borda.envios[0]).not.toHaveProperty("template_name");
  });
});
