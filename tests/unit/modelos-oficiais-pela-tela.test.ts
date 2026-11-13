/**
 * CRIAR, EDITAR E APAGAR MODELO DO CANAL OFICIAL PELA TELA (fork da Genuine,
 * 2026-11-13).
 *
 * Passa pela rota de verdade (`POST /api/v1/channels/templates`) com o papel,
 * a sessão e a credencial dublados, o banco em memória e a Meta simulada num
 * `fetch` que registra cada chamada. Mede:
 *
 *   1. criar manda à Meta o pedido no formato dela, grava no espelho como
 *      Pendente e devolve a categoria que a Meta deu ao lado da escolhida;
 *   2. pedido fora das regras é recusado ANTES de chegar à Meta;
 *   3. editar acha a variante pelo nome + idioma e edita pelo id; só onde a
 *      Meta deixa;
 *   4. apagar leva SÓ aquele idioma (hsm_id + nome) e pergunta antes quando o
 *      modelo está em uso;
 *   5. só administrador cria ou apaga;
 *   6. a imagem do cabeçalho vira o "handle" da Meta, e só a desta organização.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Linha } from "./helpers/banco-em-memoria";

const ORG = "11111111-1111-4111-8111-111111111111";
const USUARIO = "22222222-2222-4222-8222-222222222222";
const SESSAO = "33333333-3333-4333-8333-333333333333";
const WABA = "1029384756";

const h = vi.hoisted(() => ({
  papel: "admin" as string,
  tabelas: {} as Record<string, Array<Record<string, unknown>>>,
  chamadas: [] as Array<{
    metodo: string;
    url: string;
    corpo: unknown;
    cabecalhos: Record<string, string>;
  }>,
  /** A categoria que a Meta devolve ao criar. */
  categoriaDaMeta: "UTILITY",
  /** Erro que a Meta devolve no próximo POST de criação. */
  erroAoCriar: null as null | Record<string, unknown>,
  audit: vi.fn(async () => undefined),
  storage: new Map<string, { bytes: Uint8Array; type: string }>(),
}));

const PAPEIS = ["viewer", "agent", "manager", "admin"];

vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async (minimo: string) => {
    if (PAPEIS.indexOf(h.papel) < PAPEIS.indexOf(minimo)) {
      const { fail } = await import("@/lib/api/wrappers");
      return { ok: false, response: fail("forbidden_role", "forbidden", 403) };
    }
    return { ok: true, org: { orgId: ORG }, user: { id: USUARIO, idioma: "pt-BR" } };
  },
}));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/channels/meta/session", () => ({
  metaSessionForOrg: async () => ({
    id: SESSAO,
    organizationId: ORG,
    wabaId: WABA,
    phoneNumberId: "PN-1",
  }),
}));
vi.mock("@/lib/channels/meta/credentials", () => ({
  resolveMetaCreds: async () => ({
    phoneNumberId: "PN-1",
    token: "TOKEN-SECRETO",
    graphVersion: "v23.0",
    source: "session",
  }),
}));
vi.mock("@/lib/supabase/admin", async () => {
  const { bancoEmMemoria: banco } = await import("./helpers/banco-em-memoria");
  return {
    createAdminClient: () => ({
      ...banco(h.tabelas),
      storage: {
        from: () => ({
          download: async (caminho: string) => {
            const a = h.storage.get(caminho);
            return a
              ? { data: new Blob([a.bytes as BlobPart], { type: a.type }), error: null }
              : { data: null, error: { message: "não existe" } };
          },
        }),
      },
    }),
  };
});

/** A Meta, simulada: responde por método e caminho, e registra o que recebeu. */
function metaFalsa(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const metodo = init?.method ?? "GET";
  const corpo = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
  h.chamadas.push({
    metodo,
    url,
    corpo,
    cabecalhos: (init?.headers ?? {}) as Record<string, string>,
  });
  const responder = (dados: unknown, status = 200) =>
    Promise.resolve(
      new Response(JSON.stringify(dados), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  const caminho = new URL(url).pathname;

  if (metodo === "POST" && caminho.endsWith(`/${WABA}/message_templates`)) {
    if (h.erroAoCriar) return responder({ error: h.erroAoCriar }, 400);
    return responder({ id: "tpl-novo", status: "PENDING", category: h.categoriaDaMeta });
  }
  if (metodo === "GET" && caminho.endsWith(`/${WABA}/message_templates`)) {
    const nome = new URL(url).searchParams.get("name");
    return responder({
      data: [
        {
          id: "tpl-en",
          name: nome,
          language: "en_US",
          status: "APPROVED",
          category: "UTILITY",
          components: [],
        },
        {
          id: "tpl-pt",
          name: nome,
          language: "pt_BR",
          status: "PENDING",
          category: "UTILITY",
          components: [
            { type: "BODY", text: "Seu pedido {{1}} saiu.", example: { body_text: [["123"]] } },
          ],
        },
      ],
    });
  }
  if (metodo === "POST" && caminho.endsWith("/tpl-pt")) return responder({ success: true });
  if (metodo === "DELETE") return responder({ success: true });
  if (metodo === "GET" && caminho.endsWith("/app")) return responder({ id: "app-do-token" });
  if (metodo === "POST" && caminho.endsWith("/uploads"))
    return responder({ id: "upload:sessao-1" });
  if (metodo === "POST" && caminho.endsWith("/upload:sessao-1"))
    return responder({ h: "4::handle-da-meta" });
  return responder({ error: { message: `rota não simulada: ${metodo} ${caminho}` } }, 404);
}

import { POST } from "@/app/api/v1/channels/templates/route";
import { caminhoNoStorage } from "@/lib/channels/meta/modelos-oficiais";
import { montarComponents } from "@/lib/channels/template-conteudo";

const pedir = (corpo: unknown) =>
  POST(
    new NextRequest("http://localhost/api/v1/channels/templates", {
      method: "POST",
      body: JSON.stringify(corpo),
    }),
  );

const UTILIDADE_COM_BOTOES = {
  acao: "criar",
  name: "pedido_saiu_v1",
  language: "pt_BR",
  category: "UTILITY",
  components: montarComponents({
    body: "Olá {{1}}, seu pedido {{2}} saiu para entrega.",
    exemplos: ["Maria", "12345"],
    footer: "Loja Exemplo",
    botoes: [
      {
        tipo: "url",
        texto: "Rastrear",
        url: "https://loja.com.br/rastreio/{{1}}",
        exemplo: "12345",
      },
      { tipo: "phone_number", texto: "Falar com a loja", telefone: "+5541999990000" },
    ],
  }),
};

function espelho(status: string, extra: Linha = {}): Linha {
  return {
    id: "linha-1",
    organization_id: ORG,
    waba_id: WABA,
    channel_session_id: null,
    name: "pedido_saiu_v1",
    language: "pt_BR",
    status,
    category: "UTILITY",
    ...extra,
  };
}

beforeEach(() => {
  h.papel = "admin";
  h.tabelas = { meta_templates: [], followup_flow_pointers: [], ai_agents: [] };
  h.chamadas = [];
  h.categoriaDaMeta = "UTILITY";
  h.erroAoCriar = null;
  h.audit.mockClear();
  h.storage = new Map();
  delete process.env.META_APP_ID;
  vi.stubGlobal("fetch", vi.fn(metaFalsa));
});

describe("criar", () => {
  it("manda à Meta o pedido no formato dela, grava como Pendente e audita", async () => {
    const res = await pedir(UTILIDADE_COM_BOTOES);
    expect(res.status).toBe(200);
    const envio = h.chamadas.find((c) => c.metodo === "POST")!;
    expect(envio.url).toBe(`https://graph.facebook.com/v23.0/${WABA}/message_templates`);
    expect(envio.cabecalhos.Authorization).toBe("Bearer TOKEN-SECRETO");
    expect(envio.corpo).toEqual({
      name: "pedido_saiu_v1",
      language: "pt_BR",
      category: "UTILITY",
      components: [
        {
          type: "BODY",
          text: "Olá {{1}}, seu pedido {{2}} saiu para entrega.",
          example: { body_text: [["Maria", "12345"]] },
        },
        { type: "FOOTER", text: "Loja Exemplo" },
        {
          type: "BUTTONS",
          buttons: [
            {
              type: "URL",
              text: "Rastrear",
              url: "https://loja.com.br/rastreio/{{1}}",
              example: ["12345"],
            },
            { type: "PHONE_NUMBER", text: "Falar com a loja", phone_number: "+5541999990000" },
          ],
        },
      ],
    });
    // O token nunca vai na URL.
    expect(h.chamadas.every((c) => !c.url.includes("TOKEN-SECRETO"))).toBe(true);
    expect(h.tabelas.meta_templates).toEqual([
      expect.objectContaining({
        organization_id: ORG,
        waba_id: WABA,
        name: "pedido_saiu_v1",
        status: "PENDING",
        category: "UTILITY",
        categoria_pedida: "UTILITY",
      }),
    ]);
    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "template.created", organizationId: ORG }),
    );
  });

  it("a Meta deu outra categoria: a resposta mostra as duas, e o espelho guarda as duas", async () => {
    h.categoriaDaMeta = "MARKETING";
    const res = await pedir(UTILIDADE_COM_BOTOES);
    await expect(res.json()).resolves.toMatchObject({
      data: { status: "PENDING", categoria: "MARKETING", categoriaPedida: "UTILITY" },
    });
    expect(h.tabelas.meta_templates![0]).toMatchObject({
      category: "MARKETING",
      categoria_pedida: "UTILITY",
    });
  });

  it("fora das regras: recusa com o motivo e NÃO chama a Meta", async () => {
    const res = await pedir({ ...UTILIDADE_COM_BOTOES, name: "Pedido Saiu" });
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        code: "validation_failed",
        message: "O nome aceita só letras minúsculas, números e _ (sem espaço, acento ou hífen).",
        details: { problemas: ["nome_formato"] },
      },
    });
    const semExemplo = await pedir({
      ...UTILIDADE_COM_BOTOES,
      components: montarComponents({ body: "Olá {{1}}, tudo certo?", exemplos: [""] }),
    });
    expect(semExemplo.status).toBe(422);
    expect(h.chamadas).toEqual([]);
    expect(h.tabelas.meta_templates).toEqual([]);
  });

  it("a recusa da Meta chega à tela com a frase dela", async () => {
    h.erroAoCriar = {
      message: "Invalid parameter",
      code: 100,
      error_subcode: 2388024,
      error_user_title: "Content in this language already exists",
      error_user_msg: "Já existe conteúdo neste idioma para este modelo.",
    };
    const res = await pedir(UTILIDADE_COM_BOTOES);
    expect(res.status).toBe(502);
    const corpo = (await res.json()) as { error: { message: string } };
    expect(corpo.error.message).toContain("Já existe conteúdo neste idioma para este modelo.");
    expect(corpo.error.message).not.toContain("TOKEN");
    expect(h.tabelas.meta_templates).toEqual([]);
  });

  it("autenticação vai no formato fixo da Meta", async () => {
    const res = await pedir({
      acao: "criar",
      name: "codigo_de_acesso",
      language: "pt_BR",
      category: "AUTHENTICATION",
      components: [
        { type: "BODY", add_security_recommendation: true },
        { type: "FOOTER", code_expiration_minutes: 10 },
        {
          type: "BUTTONS",
          buttons: [{ type: "OTP", otp_type: "COPY_CODE", text: "Copiar código" }],
        },
      ],
    });
    expect(res.status).toBe(200);
    expect((h.chamadas[0]!.corpo as { category: string }).category).toBe("AUTHENTICATION");
  });
});

describe("editar", () => {
  const edicao = {
    acao: "editar",
    name: "pedido_saiu_v1",
    language: "pt_BR",
    components: montarComponents({ body: "Oi {{1}}, seu pedido saiu hoje.", exemplos: ["Ana"] }),
  };

  it("acha a variante pelo nome E idioma e edita pelo id; relê e regrava o espelho", async () => {
    h.tabelas.meta_templates = [espelho("APPROVED")];
    const res = await pedir(edicao);
    expect(res.status).toBe(200);
    const busca = h.chamadas.find((c) => c.metodo === "GET")!;
    expect(new URL(busca.url).searchParams.get("name")).toBe("pedido_saiu_v1");
    const envio = h.chamadas.find((c) => c.metodo === "POST")!;
    // A variante pt_BR (tpl-pt), não a en_US que veio primeiro na lista.
    expect(envio.url).toBe("https://graph.facebook.com/v23.0/tpl-pt");
    expect(envio.corpo).toEqual({ components: edicao.components });
    // O espelho volta com o que a Meta diz agora (em revisão).
    expect(h.tabelas.meta_templates![0]).toMatchObject({ status: "PENDING" });
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "template.updated" }));
  });

  it("só onde a Meta deixa: pendente não edita", async () => {
    h.tabelas.meta_templates = [espelho("PENDING")];
    const res = await pedir(edicao);
    expect(res.status).toBe(409);
    expect(h.chamadas).toEqual([]);
  });

  it("a categoria só muda em modelo recusado", async () => {
    h.tabelas.meta_templates = [espelho("APPROVED")];
    expect((await pedir({ ...edicao, category: "MARKETING" })).status).toBe(409);
    h.tabelas.meta_templates = [espelho("REJECTED")];
    expect((await pedir({ ...edicao, category: "MARKETING" })).status).toBe(200);
    expect(h.chamadas.find((c) => c.metodo === "POST")!.corpo).toMatchObject({
      category: "MARKETING",
    });
  });
});

describe("apagar", () => {
  const apagar = { acao: "apagar", name: "pedido_saiu_v1", language: "pt_BR" };

  it("apaga SÓ o idioma escolhido (hsm_id + nome) e tira do espelho", async () => {
    h.tabelas.meta_templates = [espelho("APPROVED")];
    const res = await pedir(apagar);
    expect(res.status).toBe(200);
    const pedido = new URL(h.chamadas.find((c) => c.metodo === "DELETE")!.url);
    expect(pedido.pathname).toBe(`/v23.0/${WABA}/message_templates`);
    expect(pedido.searchParams.get("name")).toBe("pedido_saiu_v1");
    expect(pedido.searchParams.get("hsm_id")).toBe("tpl-pt");
    expect(h.tabelas.meta_templates).toEqual([]);
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "template.deleted" }));
  });

  it("em uso num agente: pergunta antes, e só apaga com a confirmação", async () => {
    h.tabelas.meta_templates = [espelho("APPROVED")];
    h.tabelas.ai_agents = [{ organization_id: ORG, name: "Atendente", published_version_id: "v1" }];
    h.tabelas.ai_agent_versions = [
      { id: "v1", organization_id: ORG, system_prompt: "Use o modelo pedido_saiu_v1 para avisar." },
    ];
    const res = await pedir(apagar);
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "template_in_use", details: { usos: ["Agente «Atendente»"] } },
    });
    expect(h.chamadas.some((c) => c.metodo === "DELETE")).toBe(false);
    expect((await pedir({ ...apagar, confirmado: true })).status).toBe(200);
  });

  it("desativado a Meta não apaga", async () => {
    h.tabelas.meta_templates = [espelho("DISABLED")];
    expect((await pedir(apagar)).status).toBe(409);
    expect(h.chamadas).toEqual([]);
  });
});

describe("quem pode", () => {
  it("atendente não cria, não edita e não apaga", async () => {
    h.papel = "agent";
    for (const corpo of [
      UTILIDADE_COM_BOTOES,
      { acao: "apagar", name: "pedido_saiu_v1", language: "pt_BR" },
    ]) {
      expect((await pedir(corpo)).status).toBe(403);
    }
    expect(h.chamadas).toEqual([]);
  });

  it("gerente também não: criar e apagar é de quem administra", async () => {
    h.papel = "manager";
    expect((await pedir(UTILIDADE_COM_BOTOES)).status).toBe(403);
  });
});

describe("a imagem do cabeçalho", () => {
  const ASSINADO = (caminho: string) =>
    `https://projeto.supabase.co/storage/v1/object/sign/whatsapp-media/${caminho}?token=abc`;
  const comImagem = (link: string) => ({
    ...UTILIDADE_COM_BOTOES,
    components: montarComponents({
      body: "Olá {{1}}, seu pedido saiu.",
      exemplos: ["Maria"],
      cabecalho: { midiaUrl: link },
    }),
  });

  it("lê do nosso storage, sobe pelo envio retomável da Meta e manda o handle", async () => {
    const caminho = `${ORG}/templates/foto.png`;
    h.storage.set(caminho, { bytes: new Uint8Array([137, 80, 78, 71]), type: "image/png" });
    const res = await pedir(comImagem(ASSINADO(caminho)));
    expect(res.status).toBe(200);
    // Sem META_APP_ID, o id do aplicativo vem da própria credencial.
    expect(h.chamadas.map((c) => `${c.metodo} ${new URL(c.url).pathname}`)).toEqual([
      "GET /v23.0/app",
      "POST /v23.0/app-do-token/uploads",
      "POST /v23.0/upload:sessao-1",
      `POST /v23.0/${WABA}/message_templates`,
    ]);
    const abrir = new URL(h.chamadas[1]!.url);
    expect(abrir.searchParams.get("file_length")).toBe("4");
    expect(abrir.searchParams.get("file_type")).toBe("image/png");
    expect(h.chamadas[2]!.cabecalhos).toMatchObject({
      Authorization: "OAuth TOKEN-SECRETO",
      file_offset: "0",
    });
    const criar = h.chamadas[3]!.corpo as {
      components: Array<{ type: string; example?: unknown }>;
    };
    expect(criar.components[0]).toEqual({
      type: "HEADER",
      format: "IMAGE",
      example: { header_handle: ["4::handle-da-meta"] },
    });
  });

  it("com META_APP_ID, usa ele", async () => {
    process.env.META_APP_ID = "app-do-env";
    const caminho = `${ORG}/templates/foto.jpg`;
    h.storage.set(caminho, { bytes: new Uint8Array([255, 216, 255]), type: "image/jpeg" });
    h.chamadas = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes("/app-do-env/uploads")
          ? Promise.resolve(new Response(JSON.stringify({ id: "upload:sessao-1" })))
          : metaFalsa(input, init),
      ),
    );
    expect((await pedir(comImagem(ASSINADO(caminho)))).status).toBe(200);
    expect(h.chamadas.some((c) => new URL(c.url).pathname.endsWith("/app"))).toBe(false);
  });

  it("imagem de OUTRA organização não é lida, e link de fora não é baixado", async () => {
    const alheio = "99999999-9999-4999-8999-999999999999/templates/foto.png";
    h.storage.set(alheio, { bytes: new Uint8Array([1]), type: "image/png" });
    expect((await pedir(comImagem(ASSINADO(alheio)))).status).toBe(502);
    expect((await pedir(comImagem("https://site-qualquer.com/foto.png"))).status).toBe(502);
    expect(h.chamadas.filter((c) => c.metodo === "POST")).toEqual([]);
  });

  it("o caminho sai só de link assinado nosso", () => {
    expect(caminhoNoStorage(ASSINADO(`${ORG}/templates/a%20b.png`))).toBe(
      `${ORG}/templates/a b.png`,
    );
    expect(caminhoNoStorage("https://outro.com/qualquer/coisa.png")).toBeNull();
  });
});

describe("sincronizar continua igual", () => {
  it("sem corpo, sincroniza (o botão da tela e o hook de sempre)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })),
    );
    const res = await POST(
      new NextRequest("http://localhost/api/v1/channels/templates", { method: "POST" }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      data: { sincronizadas: 0, total: 0, inserted: 0 },
    });
  });
});
