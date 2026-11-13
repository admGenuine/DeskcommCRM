/**
 * CAMPANHA QUE PULA MODELO INDISPONÍVEL, de ponta a ponta (fork da Genuine,
 * 2026-11-13).
 *
 * Passa pela `rodarUmaRodadaDeCampanha` de verdade, com o banco em memória e
 * o envio dublado na borda (`sendMessageHandler`). O espelho de modelos
 * (`meta_templates`) é uma tabela do banco em memória: a marca que a recusa
 * grava nele é a mesma que o rodízio lê na rodada seguinte.
 *
 * O que o pedido prometeu, e cada caso mede:
 *
 *   1. modelo pausado (recusa na resposta do envio, e recusa pelo aviso
 *      posterior): a pessoa volta à fila e recebe o próximo modelo, sem contar
 *      como falha definitiva;
 *   2. ninguém recebe a mesma campanha duas vezes: quem tem entrega, leitura ou
 *      resposta nunca volta à fila, e cada nova tentativa é uma mensagem nova;
 *   3. modelo que volta a ficar aprovado volta ao rodízio, e a campanha que o
 *      sistema pausou retoma sozinha; a que uma pessoa pausou não;
 *   4. todos os modelos indisponíveis: a campanha pausa e avisa, e ninguém fica
 *      como falha;
 *   5. teto de três voltas por pessoa.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bancoEmMemoria, type Linha } from "./helpers/banco-em-memoria";

const borda = vi.hoisted(() => ({
  envios: [] as Array<Record<string, unknown>>,
  /** Modelo → código com que a plataforma recusa o envio NA RESPOSTA. */
  recusar: new Map<string, string>(),
  tabelas: {} as Record<string, Array<Record<string, unknown>>>,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
}));
vi.mock("@/app/api/v1/messages/_handler", () => ({
  sendMessageHandler: async (
    _admin: unknown,
    ctx: { internalMessageId: string },
    corpo: Record<string, unknown>,
  ) => {
    borda.envios.push({ ...corpo, id: ctx.internalMessageId });
    const codigo = borda.recusar.get(String(corpo.template_name));
    // O que o handler grava quando o adaptador lança `meta_<código>: <texto>`.
    (borda.tabelas.messages ??= []).push({
      id: ctx.internalMessageId,
      organization_id: "11111111-1111-4111-8111-111111111111",
      status: codigo ? "failed" : "sent",
      error_code: codigo ? "send_failed" : null,
      error_message: codigo ? `meta_${codigo}: Template is paused due to low quality` : null,
    });
    return { id: ctx.internalMessageId, status: codigo ? "failed" : "sent" };
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
    loadPacingState: async () => ({ lastSentAt: null, sentToday: 0, numberActivatedAt: null }),
    recordSend: async () => undefined,
  };
});
vi.mock("@/lib/atendimento/origem", () => ({
  beginServiceAtOrigin: async () => ({ conversation_id: "conversa-1" }),
}));
// A definição do modelo sai do espelho EM MEMÓRIA: o status que o rodízio lê é
// o mesmo que a recusa marca.
vi.mock("@/lib/channels/modelos-da-conexao", () => ({
  MODELO_APROVADO: "APPROVED",
  conexaoExigeModelo: async () => true,
  modeloDaConexao: async (_admin: unknown, chave: { name: string; language: string }) => {
    const linha = (borda.tabelas.meta_templates ?? []).find(
      (l) => l.name === chave.name && l.language === chave.language,
    );
    if (!linha) return null;
    return {
      name: chave.name,
      language: chave.language,
      category: "MARKETING",
      status: linha.status,
      qualityScore: null,
      vagas: [],
      previa: "",
      valoresSalvos: {},
      components: [],
      parameterFormat: "POSITIONAL",
    };
  },
  textoDoModelo: (_m: unknown, valores: Record<string, string>) => `Olá ${valores["1"]}.`,
}));

import {
  TENTATIVAS_POR_INDISPONIBILIDADE,
  codigoDeModeloIndisponivel,
  devolverRecusadosPorModelo,
  reabrirConcluidasComRecusa,
  retomarCampanhasPausadasPorModelo,
} from "@/lib/campanhas/modelo-indisponivel";
import { serializarModelo } from "@/lib/campanhas/modelo-da-campanha";
import { renderizar } from "@/lib/campanhas/renderizador";
import { rodarUmaRodadaDeCampanha } from "@/lib/campanhas/rodada";
import { situacaoDoModelo } from "@/lib/campanhas/situacao-do-modelo";
import { STATUS_OPERANTE } from "@/lib/organizacao/operante";

const ORG = "11111111-1111-4111-8111-111111111111";
const CAMPANHA = "22222222-2222-4222-8222-222222222222";
const NUMERO = "33333333-3333-4333-8333-333333333333";
// Quinta-feira, 14h em São Paulo: dentro da janela de envio do número.
const AGORA = new Date("2026-11-12T17:00:00.000Z");

const MAPA = { "1": "{{primeiro_nome}}" };
const CORPO = serializarModelo({
  itens: [
    { template_name: "promo_a", template_language: "pt_BR", variable_map: MAPA },
    { template_name: "promo_b", template_language: "pt_BR", variable_map: MAPA },
  ],
});

function pessoa(i: number, extra: Linha = {}): Linha {
  return {
    id: `dest-${i}`,
    campaign_id: CAMPANHA,
    organization_id: ORG,
    contact_id: `contato-${i}`,
    status: "pending",
    recipient_address: `+55419999900${i}`,
    rendered_body: renderizar(CORPO, { nome: `Pessoa${i} Silva` }).texto,
    next_attempt_at: null,
    sent_at: null,
    delivered_at: null,
    read_at: null,
    replied_at: null,
    message_id: null,
    created_at: `2026-11-12T10:00:0${i}.000Z`,
    contacts: {
      id: `contato-${i}`,
      name: `Pessoa${i} Silva`,
      display_name: null,
      phone_number: `+55419999900${i}`,
      is_blocked: false,
      is_personal: false,
      is_anonymized: false,
      consent: {},
    },
    ...extra,
  };
}

function cenario(opcoes: {
  pessoas: Linha[];
  campanha?: Linha;
  status?: { promo_a?: string; promo_b?: string };
  registros?: Linha[];
}) {
  const modelo = (posicao: number, nome: string): Linha => ({
    campaign_id: CAMPANHA,
    organization_id: ORG,
    posicao,
    peso: 1,
    template_name: nome,
    template_language: "pt_BR",
    variable_map: MAPA,
    envios_por_rodada: 2,
  });
  const espelho = (nome: string, status: string): Linha => ({
    id: `tpl-${nome}`,
    organization_id: ORG,
    channel_session_id: NUMERO,
    name: nome,
    language: "pt_BR",
    status,
  });
  const tabelas: Record<string, Linha[]> = {
    campaigns: [
      {
        id: CAMPANHA,
        organization_id: ORG,
        channel_session_id: NUMERO,
        name: "Promoção",
        message_body: CORPO,
        content_version: 1,
        intervalo_segundos: null,
        janela_inicio_hora: null,
        janela_fim_hora: null,
        teto_diario: null,
        teto_horario: null,
        status: "running",
        failure_code: null,
        started_at: "2026-11-12T12:00:00.000Z",
        organizations: { status: STATUS_OPERANTE },
        ...(opcoes.campanha ?? {}),
      },
    ],
    campaign_message_templates: [modelo(0, "promo_a"), modelo(1, "promo_b")],
    campaign_recipient_templates: opcoes.registros ?? [],
    campaign_recipients: opcoes.pessoas,
    campaign_template_skips: [],
    meta_templates: [
      espelho("promo_a", opcoes.status?.promo_a ?? "APPROVED"),
      espelho("promo_b", opcoes.status?.promo_b ?? "APPROVED"),
    ],
    messages: [],
    agent_inbox_items: [],
    channel_sessions: [
      { id: NUMERO, organization_id: ORG, status: "WORKING", daily_message_limit: null },
    ],
  };
  borda.tabelas = tabelas;
  return { admin: bancoEmMemoria(tabelas) as never, tabelas };
}

const statusDoEspelho = (tabelas: Record<string, Linha[]>, nome: string) =>
  tabelas.meta_templates!.find((l) => l.name === nome)!.status;

/** Envios que a plataforma ACEITOU, por pessoa: é o que a pessoa recebeu. */
function recebidos(): Map<string, string[]> {
  const porPessoa = new Map<string, string[]>();
  for (const e of borda.envios) {
    if (borda.recusar.has(String(e.template_name))) continue;
    const quem = String((e.metadata as Linha).campaign_recipient_id);
    porPessoa.set(quem, [...(porPessoa.get(quem) ?? []), String(e.template_name)]);
  }
  return porPessoa;
}

beforeEach(() => {
  borda.envios = [];
  borda.recusar = new Map();
  borda.tabelas = {};
});

describe("modelo pausado: a pessoa volta à fila e recebe o próximo modelo", () => {
  it("recusa NA RESPOSTA do envio (132015): marca o modelo, devolve a pessoa e segue com o outro", async () => {
    borda.recusar.set("promo_a", "132015");
    const { admin, tabelas } = cenario({ pessoas: [pessoa(1), pessoa(2)] });

    // Rodada 1: o espelho ainda diz aprovado; a plataforma recusa o primeiro envio.
    await rodarUmaRodadaDeCampanha(admin, AGORA);
    expect(borda.envios.map((e) => e.template_name)).toEqual(["promo_a"]);
    expect(tabelas.campaign_recipients![0]).toMatchObject({
      status: "failed",
      last_error_code: "send_failed",
    });

    // Rodada 2: a pessoa volta, o modelo A sai do rodízio, e as duas recebem o B.
    await rodarUmaRodadaDeCampanha(admin, AGORA);
    expect(statusDoEspelho(tabelas, "promo_a")).toBe("PAUSED");
    expect(borda.envios.map((e) => e.template_name)).toEqual(["promo_a", "promo_b", "promo_b"]);
    expect(tabelas.campaign_recipients!.map((d) => d.status)).toEqual(["sent", "sent"]);
    expect(tabelas.campaigns![0]!.status).toBe("running");

    // Ninguém recebeu duas vezes, e a nova tentativa é uma mensagem NOVA.
    expect(recebidos()).toEqual(
      new Map([
        ["dest-1", ["promo_b"]],
        ["dest-2", ["promo_b"]],
      ]),
    );
    const idsDaPessoa1 = borda.envios
      .filter((e) => (e.metadata as Linha).campaign_recipient_id === "dest-1")
      .map((e) => e.id);
    expect(new Set(idsDaPessoa1).size).toBe(2);

    // O relatório lê o modelo que saiu por último, e a tela, o pulo com o motivo.
    expect(
      tabelas.campaign_recipient_templates!.find((r) => r.recipient_id === "dest-1"),
    ).toMatchObject({
      template_name: "promo_b",
      tentativas_indisponivel: 1,
    });
    expect(tabelas.campaign_template_skips).toEqual([
      expect.objectContaining({ template_name: "promo_a", motivo: "132015", vezes: 1 }),
    ]);
  });

  it("recusa pelo AVISO POSTERIOR (o trigger grava 132015 na pessoa): devolve e reenvia com o outro", async () => {
    const { admin, tabelas } = cenario({
      status: { promo_a: "PAUSED" },
      pessoas: [
        pessoa(1, {
          status: "failed",
          last_error_code: "132015",
          sent_at: "2026-11-12T16:00:00.000Z",
          message_id: "msg-antiga",
        }),
      ],
      registros: [
        {
          campaign_id: CAMPANHA,
          organization_id: ORG,
          recipient_id: "dest-1",
          template_name: "promo_a",
          template_language: "pt_BR",
          tentativas_indisponivel: 0,
        },
      ],
    });
    await rodarUmaRodadaDeCampanha(admin, AGORA);
    expect(borda.envios.map((e) => e.template_name)).toEqual(["promo_b"]);
    expect(tabelas.campaign_recipients![0]).toMatchObject({ status: "sent" });
    // A mensagem recusada deixou de apontar para a pessoa: um aviso atrasado sobre ela não a mexe.
    expect(tabelas.campaign_recipients![0]!.message_id).not.toBe("msg-antiga");
  });

  it("quem tem entrega, leitura ou resposta NUNCA volta à fila, mesmo com o código de pausa", async () => {
    const recusado = { status: "failed", last_error_code: "132015", message_id: "m" };
    const { admin, tabelas } = cenario({
      pessoas: [
        pessoa(1, { ...recusado, delivered_at: "2026-11-12T16:01:00.000Z" }),
        pessoa(2, { ...recusado, read_at: "2026-11-12T16:02:00.000Z" }),
        pessoa(3, { ...recusado, replied_at: "2026-11-12T16:03:00.000Z" }),
      ],
      registros: [1, 2, 3].map((i) => ({
        campaign_id: CAMPANHA,
        organization_id: ORG,
        recipient_id: `dest-${i}`,
        template_name: "promo_a",
        template_language: "pt_BR",
        tentativas_indisponivel: 0,
      })),
    });
    const r = await devolverRecusadosPorModelo(admin, tabelas.campaigns![0] as never, AGORA);
    expect(r).toEqual({ devolvidos: 0, esgotados: 0 });
    expect(tabelas.campaign_recipients!.map((d) => d.status)).toEqual([
      "failed",
      "failed",
      "failed",
    ]);
  });

  it("falha que não é de modelo continua falha: não volta à fila", async () => {
    const { admin, tabelas } = cenario({
      pessoas: [pessoa(1, { status: "failed", last_error_code: "send_failed", message_id: "m1" })],
      registros: [
        {
          campaign_id: CAMPANHA,
          organization_id: ORG,
          recipient_id: "dest-1",
          template_name: "promo_a",
          template_language: "pt_BR",
        },
      ],
    });
    tabelas.messages!.push({
      id: "m1",
      organization_id: ORG,
      error_code: "send_failed",
      error_message: "meta_131026: Message undeliverable",
    });
    const r = await devolverRecusadosPorModelo(admin, tabelas.campaigns![0] as never, AGORA);
    expect(r.devolvidos).toBe(0);
    expect(tabelas.campaign_recipients![0]!.status).toBe("failed");
  });

  it(`teto: depois de ${TENTATIVAS_POR_INDISPONIBILIDADE} voltas, a pessoa fica como falha, com o motivo`, async () => {
    const { admin, tabelas } = cenario({
      pessoas: [pessoa(1, { status: "failed", last_error_code: "132015", message_id: "m" })],
      registros: [
        {
          campaign_id: CAMPANHA,
          organization_id: ORG,
          recipient_id: "dest-1",
          template_name: "promo_b",
          template_language: "pt_BR",
          tentativas_indisponivel: TENTATIVAS_POR_INDISPONIBILIDADE,
        },
      ],
    });
    const r = await devolverRecusadosPorModelo(admin, tabelas.campaigns![0] as never, AGORA);
    expect(r).toEqual({ devolvidos: 0, esgotados: 1 });
    expect(tabelas.campaign_recipients![0]).toMatchObject({
      status: "failed",
      last_error_code: "modelo_indisponivel_esgotado",
    });
    // E a rodada seguinte não a pega de novo.
    expect(
      (await devolverRecusadosPorModelo(admin, tabelas.campaigns![0] as never, AGORA)).esgotados,
    ).toBe(0);
  });
});

describe("todos os modelos indisponíveis", () => {
  it("a campanha pausa e avisa na Central; ninguém fica como falha", async () => {
    borda.recusar.set("promo_a", "132015");
    borda.recusar.set("promo_b", "132016");
    const { admin, tabelas } = cenario({ pessoas: [pessoa(1), pessoa(2), pessoa(3)] });

    for (let i = 0; i < 4; i++) await rodarUmaRodadaDeCampanha(admin, AGORA);

    expect(tabelas.campaigns![0]).toMatchObject({
      status: "paused",
      failure_code: "modelos_nao_aprovados",
    });
    expect(statusDoEspelho(tabelas, "promo_a")).toBe("PAUSED");
    expect(statusDoEspelho(tabelas, "promo_b")).toBe("DISABLED");
    expect(tabelas.campaign_recipients!.map((d) => d.status)).toEqual([
      "pending",
      "pending",
      "pending",
    ]);
    expect(recebidos().size).toBe(0);
    expect(tabelas.agent_inbox_items).toEqual([
      expect.objectContaining({
        organization_id: ORG,
        kind: "channel_template_review",
        severity: "critical",
        title: 'Campanha "Promoção" pausada: nenhum modelo aprovado',
      }),
    ]);
  });
});

describe("modelo que volta a ficar aprovado", () => {
  it("volta ao rodízio, e a campanha que o SISTEMA pausou retoma sozinha", async () => {
    const { admin, tabelas } = cenario({
      status: { promo_a: "PAUSED", promo_b: "PAUSED" },
      campanha: { status: "paused", failure_code: "modelos_nao_aprovados" },
      pessoas: [pessoa(1), pessoa(2)],
    });
    // Nada volta enquanto os dois seguem pausados.
    expect(await retomarCampanhasPausadasPorModelo(admin, ORG, AGORA)).toBe(0);

    // A plataforma devolve o A (o webhook grava REINSTATED, que vale como aprovado).
    tabelas.meta_templates!.find((l) => l.name === "promo_a")!.status = "REINSTATED";
    expect(await retomarCampanhasPausadasPorModelo(admin, ORG, AGORA)).toBe(1);
    expect(tabelas.campaigns![0]).toMatchObject({ status: "running", failure_code: null });
    expect(tabelas.agent_inbox_items).toEqual([
      expect.objectContaining({
        severity: "info",
        title: 'Campanha "Promoção" retomada: um modelo voltou a ficar aprovado',
      }),
    ]);

    await rodarUmaRodadaDeCampanha(admin, AGORA);
    expect(borda.envios.map((e) => e.template_name)).toEqual(["promo_a", "promo_a"]);
  });

  it("campanha que uma PESSOA pausou continua pausada", async () => {
    const { admin, tabelas } = cenario({
      campanha: { status: "paused", failure_code: null },
      pessoas: [pessoa(1)],
    });
    expect(await retomarCampanhasPausadasPorModelo(admin, ORG, AGORA)).toBe(0);
    expect(tabelas.campaigns![0]!.status).toBe("paused");
  });

  it("retomada pela pessoa apaga a marca do sistema: uma pausa manual depois dela não volta sozinha", async () => {
    const { admin, tabelas } = cenario({
      campanha: { status: "running", failure_code: "modelos_nao_aprovados" },
      pessoas: [pessoa(1)],
    });
    await rodarUmaRodadaDeCampanha(admin, AGORA);
    expect(tabelas.campaigns![0]!.failure_code).toBeNull();
    // A pessoa pausa (a ação do original não mexe em failure_code).
    tabelas.campaigns![0]!.status = "paused";
    expect(await retomarCampanhasPausadasPorModelo(admin, ORG, AGORA)).toBe(0);
  });
});

describe("campanha que concluiu antes de a recusa chegar", () => {
  it("a sincronização automática devolve a pessoa e reabre a campanha", async () => {
    const { admin, tabelas } = cenario({
      status: { promo_a: "PAUSED" },
      campanha: { status: "completed", completed_at: "2026-11-12T16:30:00.000Z" },
      pessoas: [
        pessoa(1, { status: "failed", last_error_code: "132015", message_id: "m" }),
        pessoa(2, {
          status: "sent",
          sent_at: "2026-11-12T16:00:00.000Z",
          delivered_at: "2026-11-12T16:00:05.000Z",
        }),
      ],
      registros: [
        {
          campaign_id: CAMPANHA,
          organization_id: ORG,
          recipient_id: "dest-1",
          template_name: "promo_a",
          template_language: "pt_BR",
          tentativas_indisponivel: 0,
        },
      ],
    });
    expect(await reabrirConcluidasComRecusa(admin, AGORA)).toBe(1);
    expect(tabelas.campaigns![0]!.status).toBe("running");
    expect(tabelas.campaign_recipients!.map((d) => d.status)).toEqual(["pending", "sent"]);

    await rodarUmaRodadaDeCampanha(admin, AGORA);
    expect(recebidos()).toEqual(new Map([["dest-1", ["promo_b"]]]));
  });
});

describe("as peças puras", () => {
  it("lê o código da recusa no código ou no texto, e só os três de modelo", () => {
    expect(codigoDeModeloIndisponivel("132015", null)).toBe("132015");
    expect(
      codigoDeModeloIndisponivel("send_failed", "meta_132016: Template was paused too many times"),
    ).toBe("132016");
    expect(
      codigoDeModeloIndisponivel("send_failed", "meta_132001: Template name does not exist"),
    ).toBe("132001");
    expect(
      codigoDeModeloIndisponivel("send_failed", "meta_131026: Message undeliverable"),
    ).toBeNull();
    expect(codigoDeModeloIndisponivel("send_failed", "meta_1320150: outro")).toBeNull();
    expect(codigoDeModeloIndisponivel(null, null)).toBeNull();
  });

  it("situação para a tela: ativo, pulado com o motivo, qualidade e recusas", () => {
    expect(situacaoDoModelo({ status: "APPROVED", qualidade: "GREEN", pulos: null })).toEqual({
      ativo: true,
      motivo: null,
      qualidadeBaixa: false,
      recusas: 0,
      ultimaRecusa: null,
      ultimaRecusaEm: null,
    });
    expect(situacaoDoModelo({ status: "REINSTATED", qualidade: "RED", pulos: null })).toMatchObject(
      {
        ativo: true,
        qualidadeBaixa: true,
      },
    );
    expect(
      situacaoDoModelo({
        status: "PAUSED",
        qualidade: null,
        pulos: { vezes: 4, motivo: "132015", ultima_em: "2026-11-12T17:00:00.000Z" },
      }),
    ).toMatchObject({ ativo: false, motivo: "pausado", recusas: 4, ultimaRecusa: "pausado" });
    expect(situacaoDoModelo({ status: null, qualidade: null, pulos: null }).motivo).toBe(
      "fora_do_numero",
    );
    expect(situacaoDoModelo({ status: "DISABLED", qualidade: null, pulos: null }).motivo).toBe(
      "desativado",
    );
  });
});
