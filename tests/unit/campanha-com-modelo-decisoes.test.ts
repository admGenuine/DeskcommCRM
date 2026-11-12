/**
 * CAMPANHA COM MODELO: o que as rotas de criar e editar aceitam (fork da
 * Genuine, 2026-11-12, `lib/campanhas/modelo-da-campanha.ts`).
 *
 *   1. número que só entrega modelo recusa campanha de texto, com a mensagem
 *      que explica por quê;
 *   2. número que manda texto livre continua aceitando texto, e recusa modelo;
 *   3. o modelo pedido tem de estar aprovado no número principal e em cada
 *      número do rodízio, e toda vaga precisa de origem;
 *   4. a cópia que vai para o texto da campanha sai do servidor, na ordem das
 *      vagas do modelo;
 *   5. o envio monta o modelo com os valores da pessoa, e uma cópia de modelo
 *      sem a escolha ao lado falha fechada em vez de virar texto.
 *
 * A fronteira de canal (`lib/channels/modelos-da-conexao.ts`) é dublada: o que
 * se mede aqui é a decisão da campanha, não a leitura do espelho.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const canal = vi.hoisted(() => ({
  exige: new Map<string, boolean | null>(),
  modelos: new Map<string, { status: string } | null>(),
}));

vi.mock("@/lib/channels/modelos-da-conexao", () => ({
  MODELO_APROVADO: "APPROVED",
  conexaoExigeModelo: async (_admin: unknown, _org: string, id: string) =>
    canal.exige.has(id) ? canal.exige.get(id) : null,
  modeloDaConexao: async (_admin: unknown, chave: { channelSessionId: string; name: string }) => {
    const m = canal.modelos.get(`${chave.channelSessionId}:${chave.name}`);
    if (!m) return null;
    return {
      name: chave.name,
      language: "pt_BR",
      category: "MARKETING",
      status: m.status,
      vagas: [
        { chave: "header:1", onde: "cabeçalho", espera: "image", antes: "", depois: "" },
        { chave: "1", onde: "corpo", espera: "text", antes: "Olá ", depois: "," },
      ],
      previa: "Olá {{1}},",
      valoresSalvos: { "header:1": "https://cdn.exemplo.com.br/a.jpg" },
      components: [],
      parameterFormat: "POSITIONAL",
    };
  },
  textoDoModelo: (_m: unknown, valores: Record<string, string>) => `Olá ${valores["1"]},`,
}));

import {
  MENSAGEM_EXIGE_MODELO,
  conteudoDoEnvio,
  decidirConteudo,
  enviosPorRodada,
  lerModeloDoPedido,
  repetirNaRodada,
  serializarModelo,
} from "@/lib/campanhas/modelo-da-campanha";

const ORG = "org-1";
const OFICIAL = "oficial-1";
const OFICIAL_2 = "oficial-2";
const TEXTO_LIVRE = "texto-livre-1";
const admin = {} as never;

const pedido = (extra: Record<string, unknown> = {}) => ({
  template_name: "promo",
  template_language: "pt_BR",
  variable_map: { "1": "{{primeiro_nome}}" },
  envios_por_rodada: 20,
  ...extra,
});

beforeEach(() => {
  canal.exige = new Map([
    [OFICIAL, true],
    [OFICIAL_2, true],
    [TEXTO_LIVRE, false],
  ]);
  canal.modelos = new Map([[`${OFICIAL}:promo`, { status: "APPROVED" }]]);
});

describe("o que a campanha pode gravar", () => {
  it("número oficial sem modelo: recusa, dizendo que é preciso escolher um modelo", async () => {
    const r = await decidirConteudo(admin, {
      organizationId: ORG,
      canalPrincipal: OFICIAL,
      extras: [],
      modelo: null,
    });
    expect(r).toMatchObject({ ok: false, codigo: "campanha_conteudo_invalido", status: 422 });
    expect(!r.ok && r.mensagem).toBe(MENSAGEM_EXIGE_MODELO);
    expect(MENSAGEM_EXIGE_MODELO).toMatch(/Escolha um modelo aprovado/);
  });

  it("número de texto livre sem modelo: segue como sempre", async () => {
    expect(
      await decidirConteudo(admin, {
        organizationId: ORG,
        canalPrincipal: TEXTO_LIVRE,
        extras: [],
        modelo: null,
      }),
    ).toEqual({ ok: true, modelo: null });
  });

  it("número de texto livre com modelo: recusa (o envio não teria como sair)", async () => {
    const r = await decidirConteudo(admin, {
      organizationId: ORG,
      canalPrincipal: TEXTO_LIVRE,
      extras: [],
      modelo: pedido(),
    });
    expect(r.ok).toBe(false);
  });

  it("número de outra organização: recusa com 409", async () => {
    const r = await decidirConteudo(admin, {
      organizationId: ORG,
      canalPrincipal: "alheio",
      extras: [],
      modelo: null,
    });
    expect(r).toMatchObject({ ok: false, status: 409 });
  });

  it("modelo aprovado e vagas preenchidas: grava a escolha e a cópia, mídia pelo link salvo", async () => {
    const r = await decidirConteudo(admin, {
      organizationId: ORG,
      canalPrincipal: OFICIAL,
      extras: [],
      modelo: pedido(),
    });
    expect(r.ok && r.modelo).toEqual({
      template_name: "promo",
      template_language: "pt_BR",
      variable_map: { "header:1": "https://cdn.exemplo.com.br/a.jpg", "1": "{{primeiro_nome}}" },
      envios_por_rodada: 20,
    });
    // A cópia sai na ordem das vagas do modelo, com o cabeçalho de mídia primeiro.
    expect(r.ok && r.modelo && r.corpo).toBe(
      serializarModelo(
        {
          template_name: "promo",
          template_language: "pt_BR",
          variable_map: {
            "header:1": "https://cdn.exemplo.com.br/a.jpg",
            "1": "{{primeiro_nome}}",
          },
        },
        ["header:1", "1"],
      ),
    );
  });

  it("modelo pausado ou fora da lista: recusa, nomeando o status", async () => {
    canal.modelos.set(`${OFICIAL}:promo`, { status: "PAUSED" });
    const pausado = await decidirConteudo(admin, {
      organizationId: ORG,
      canalPrincipal: OFICIAL,
      extras: [],
      modelo: pedido(),
    });
    expect(!pausado.ok && pausado.mensagem).toMatch(/PAUSED/);
    const ausente = await decidirConteudo(admin, {
      organizationId: ORG,
      canalPrincipal: OFICIAL,
      extras: [],
      modelo: pedido({ template_name: "outro" }),
    });
    expect(!ausente.ok && ausente.mensagem).toMatch(/não está na lista desta conexão/);
  });

  it("número do rodízio sem o modelo aprovado: recusa", async () => {
    const r = await decidirConteudo(admin, {
      organizationId: ORG,
      canalPrincipal: OFICIAL,
      extras: [OFICIAL_2],
      modelo: pedido(),
    });
    expect(!r.ok && r.mensagem).toMatch(/rodízio/);
    canal.modelos.set(`${OFICIAL_2}:promo`, { status: "APPROVED" });
    const ok = await decidirConteudo(admin, {
      organizationId: ORG,
      canalPrincipal: OFICIAL,
      extras: [OFICIAL_2],
      modelo: pedido(),
    });
    expect(ok.ok).toBe(true);
  });

  it("vaga sem origem: recusa, nomeando a vaga", async () => {
    const r = await decidirConteudo(admin, {
      organizationId: ORG,
      canalPrincipal: OFICIAL,
      extras: [],
      modelo: pedido({ variable_map: {} }),
    });
    expect(!r.ok && r.mensagem).toMatch(/Falta dizer de onde sai: corpo \{\{1\}\}/);
  });
});

describe("o campo `modelo` do pedido", () => {
  it("ausente, nulo, válido ou malformado", () => {
    expect(lerModeloDoPedido({ name: "x" })).toEqual({ ok: true, modelo: undefined });
    expect(lerModeloDoPedido({ modelo: null })).toEqual({ ok: true, modelo: null });
    expect(lerModeloDoPedido({ modelo: pedido() })).toMatchObject({
      ok: true,
      modelo: { template_name: "promo" },
    });
    expect(lerModeloDoPedido({ modelo: pedido({ envios_por_rodada: 61 }) }).ok).toBe(false);
    expect(lerModeloDoPedido({ modelo: pedido({ variable_map: { "um espaço": "x" } }) }).ok).toBe(
      false,
    );
  });
});

describe("o conteúdo do envio", () => {
  const conexao = { organizationId: ORG, channelSessionId: OFICIAL };
  const modelo = {
    template_name: "promo",
    template_language: "pt_BR",
    variable_map: { "1": "{{primeiro_nome}}" },
    envios_por_rodada: null,
  };

  it("campanha de texto: o texto de sempre", async () => {
    expect(await conteudoDoEnvio(admin, conexao, "Oi Ana", null)).toEqual({
      type: "text",
      body: "Oi Ana",
    });
  });

  it("campanha com modelo: o modelo, os valores da pessoa e o texto que a conversa mostra", async () => {
    const renderizado = serializarModelo({ ...modelo, variable_map: { "1": "Ana" } });
    expect(await conteudoDoEnvio(admin, conexao, renderizado, modelo)).toEqual({
      type: "template",
      body: "Olá Ana,",
      template_name: "promo",
      template_language: "pt_BR",
      template_values: { "1": "Ana" },
    });
  });

  it("cópia de modelo sem a escolha ao lado: falha fechada, nunca vira texto", async () => {
    const renderizado = serializarModelo({ ...modelo, variable_map: { "1": "Ana" } });
    await expect(conteudoDoEnvio(admin, conexao, renderizado, null)).rejects.toThrow(
      /modelo_ausente/,
    );
  });

  it("modelo que saiu do espelho do número: falha com o motivo", async () => {
    await expect(
      conteudoDoEnvio(admin, { ...conexao, channelSessionId: OFICIAL_2 }, "x", modelo),
    ).rejects.toThrow(/template_missing/);
  });
});

describe("envios por rodada", () => {
  it("texto: um, como sempre; modelo: o escolhido, com padrão 10 e teto 60", () => {
    expect(enviosPorRodada(null)).toBe(1);
    const base = { template_name: "p", template_language: "pt_BR", variable_map: {} };
    expect(enviosPorRodada({ ...base, envios_por_rodada: null })).toBe(10);
    expect(enviosPorRodada({ ...base, envios_por_rodada: 25 })).toBe(25);
    expect(enviosPorRodada({ ...base, envios_por_rodada: 999 })).toBe(60);
  });

  const vez = (enviadas: number, pulados = 0, concluidas = 0) => ({
    enviadas,
    pulados,
    concluidas,
    detalhe: enviadas ? "enviado" : pulados ? "pulado" : "ritmo:teto_diario",
  });

  it("repete até o número pedido de envios", async () => {
    const umaVez = vi.fn(async () => vez(1));
    const r = await repetirNaRodada(3, () => false, umaVez);
    expect(umaVez).toHaveBeenCalledTimes(3);
    expect(r).toMatchObject({ enviadas: 3, detalhe: "x3:enviado" });
  });

  it("para no primeiro veto (teto, ritmo, número ocupado): o teto diário continua mandando", async () => {
    const respostas = [vez(1), vez(0)];
    const umaVez = vi.fn(async () => respostas.shift() ?? vez(1));
    const r = await repetirNaRodada(10, () => false, umaVez);
    expect(umaVez).toHaveBeenCalledTimes(2);
    expect(r.enviadas).toBe(1);
  });

  it("quem é pulado (pedido de saída) não gasta envio, mas as tentativas têm teto", async () => {
    const umaVez = vi.fn(async () => vez(0, 1));
    const r = await repetirNaRodada(3, () => false, umaVez);
    expect(umaVez).toHaveBeenCalledTimes(6);
    expect(r).toMatchObject({ enviadas: 0, pulados: 6 });
  });

  it("para quando o prazo da rodada acaba, ou quando a campanha conclui", async () => {
    let chamadas = 0;
    const r = await repetirNaRodada(
      10,
      () => chamadas >= 2,
      async () => (chamadas++, vez(1)),
    );
    expect(r.enviadas).toBe(2);
    const concluida = await repetirNaRodada(
      10,
      () => false,
      async () => vez(0, 0, 1),
    );
    expect(concluida.concluidas).toBe(1);
  });
});
