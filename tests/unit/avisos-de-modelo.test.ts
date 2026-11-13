/**
 * OS AVISOS DE QUALIDADE E DE CATEGORIA DE MODELO (fork da Genuine,
 * 2026-11-13): o parser do webhook passa a entendê-los, o espelho é atualizado,
 * e o que pesa no custo ou no envio vira aviso na Central.
 *
 * Os formatos de `value` são os da referência de webhooks da Cloud API
 * (`message_template_quality_update` e `template_category_update`, lidos em
 * 2026-11-13).
 */
import { describe, expect, it } from "vitest";

import {
  aplicarAvisoDeModelo,
  marcarModeloIndisponivel,
  modeloEnviavel,
} from "@/lib/channels/avisos-de-modelo";
import {
  parseMetaWebhook,
  type TemplateCategoryEvent,
  type TemplateQualityEvent,
} from "@/lib/channels/meta/webhook";

import { bancoEmMemoria, type Linha } from "./helpers/banco-em-memoria";

const ORG = "11111111-1111-4111-8111-111111111111";
const WABA = "102290129340398";
const NUMERO = "33333333-3333-4333-8333-333333333333";

const envelope = (field: string, value: Linha) => ({
  object: "whatsapp_business_account",
  entry: [{ id: WABA, time: 1731500000, changes: [{ field, value }] }],
});

function espelho(extra: Linha = {}) {
  const tabelas: Record<string, Linha[]> = {
    meta_templates: [
      {
        id: "tpl-1",
        organization_id: ORG,
        waba_id: WABA,
        channel_session_id: NUMERO,
        name: "aviso_pedido",
        language: "pt_BR",
        status: "APPROVED",
        category: "UTILITY",
        quality_score: "GREEN",
        ...extra,
      },
    ],
    agent_inbox_items: [],
  };
  return { admin: bancoEmMemoria(tabelas) as never, tabelas };
}

describe("o parser entende os dois avisos", () => {
  it("qualidade", () => {
    const eventos = parseMetaWebhook(
      envelope("message_template_quality_update", {
        previous_quality_score: "GREEN",
        new_quality_score: "red",
        message_template_id: 806312974732579,
        message_template_name: "aviso_pedido",
        message_template_language: "pt_BR",
      }) as never,
    );
    expect(eventos).toEqual([
      {
        kind: "template_quality",
        wabaId: WABA,
        templateName: "aviso_pedido",
        templateLanguage: "pt_BR",
        previousQuality: "GREEN",
        newQuality: "RED",
      },
    ]);
  });

  it("categoria: mudança feita e mudança anunciada", () => {
    const feita = parseMetaWebhook(
      envelope("template_category_update", {
        message_template_id: 1,
        message_template_name: "aviso_pedido",
        message_template_language: "pt_BR",
        previous_category: "UTILITY",
        new_category: "MARKETING",
      }) as never,
    );
    expect(feita[0]).toMatchObject({
      kind: "template_category",
      previousCategory: "UTILITY",
      newCategory: "MARKETING",
      correctCategory: null,
      updateTimestamp: null,
    });

    const anunciada = parseMetaWebhook(
      envelope("template_category_update", {
        message_template_id: 1,
        message_template_name: "aviso_pedido",
        message_template_language: "pt_BR",
        new_category: "UTILITY",
        correct_category: "MARKETING",
        category_update_timestamp: 1733000000,
      }) as never,
    );
    expect(anunciada[0]).toMatchObject({
      previousCategory: null,
      newCategory: "UTILITY",
      correctCategory: "MARKETING",
      updateTimestamp: 1733000000,
    });
  });

  it("aviso sem nome ou idioma do modelo não vira evento", () => {
    expect(
      parseMetaWebhook(
        envelope("message_template_quality_update", { new_quality_score: "RED" }) as never,
      ),
    ).toEqual([]);
  });
});

describe("o que o aviso faz", () => {
  const qualidade = (nova: string): TemplateQualityEvent => ({
    kind: "template_quality",
    wabaId: WABA,
    templateName: "aviso_pedido",
    templateLanguage: "pt_BR",
    previousQuality: "GREEN",
    newQuality: nova,
  });
  const categoria = (e: Partial<TemplateCategoryEvent>): TemplateCategoryEvent => ({
    kind: "template_category",
    wabaId: WABA,
    templateName: "aviso_pedido",
    templateLanguage: "pt_BR",
    previousCategory: null,
    newCategory: null,
    correctCategory: null,
    updateTimestamp: null,
    ...e,
  });

  it("qualidade vai para o espelho; só a vermelha avisa", async () => {
    const { admin, tabelas } = espelho();
    await aplicarAvisoDeModelo(admin, ORG, qualidade("YELLOW"));
    expect(tabelas.meta_templates![0]!.quality_score).toBe("YELLOW");
    expect(tabelas.agent_inbox_items).toEqual([]);

    await aplicarAvisoDeModelo(admin, ORG, qualidade("RED"));
    expect(tabelas.agent_inbox_items).toEqual([
      expect.objectContaining({
        severity: "warn",
        title: 'Modelo "aviso_pedido" com qualidade baixa',
      }),
    ]);
    // Qualidade não tira o modelo do rodízio: quem tira é a pausa.
    expect(tabelas.meta_templates![0]!.status).toBe("APPROVED");
  });

  it("Utilidade virou Marketing: grava a categoria e avisa que custa mais; o modelo segue no rodízio", async () => {
    const { admin, tabelas } = espelho();
    await aplicarAvisoDeModelo(
      admin,
      ORG,
      categoria({ previousCategory: "UTILITY", newCategory: "MARKETING" }),
    );
    expect(tabelas.meta_templates![0]).toMatchObject({ category: "MARKETING", status: "APPROVED" });
    expect(tabelas.agent_inbox_items).toEqual([
      expect.objectContaining({
        severity: "warn",
        title: 'Modelo "aviso_pedido" passou de Utilidade para Marketing',
      }),
    ]);
    expect(String(tabelas.agent_inbox_items![0]!.body)).toMatch(/custa mais/);
  });

  it("mudança ANUNCIADA: avisa com a data e não mexe na categoria de hoje", async () => {
    const { admin, tabelas } = espelho();
    await aplicarAvisoDeModelo(
      admin,
      ORG,
      categoria({
        newCategory: "UTILITY",
        correctCategory: "MARKETING",
        updateTimestamp: 1733000000,
      }),
    );
    expect(tabelas.meta_templates![0]!.category).toBe("UTILITY");
    expect(tabelas.agent_inbox_items![0]).toMatchObject({
      severity: "warn",
      title: 'Modelo "aviso_pedido" vai passar de Utilidade para Marketing',
    });
    expect(String(tabelas.agent_inbox_items![0]!.body)).toMatch(/a partir de 30\/11\/2024/);
  });

  it("outra mudança de categoria só informa", async () => {
    const { admin, tabelas } = espelho({ category: "MARKETING" });
    await aplicarAvisoDeModelo(
      admin,
      ORG,
      categoria({ previousCategory: "MARKETING", newCategory: "UTILITY" }),
    );
    expect(tabelas.agent_inbox_items![0]).toMatchObject({ severity: "info" });
  });

  it("o mesmo aviso aberto não se repete", async () => {
    const { admin, tabelas } = espelho();
    await aplicarAvisoDeModelo(admin, ORG, qualidade("RED"));
    tabelas.agent_inbox_items![0]!.status = "open";
    await aplicarAvisoDeModelo(admin, ORG, qualidade("RED"));
    expect(tabelas.agent_inbox_items).toHaveLength(1);
  });
});

describe("a marca da recusa no espelho", () => {
  it("só rebaixa modelo que estava enviável", async () => {
    const { admin, tabelas } = espelho();
    const chave = {
      organizationId: ORG,
      channelSessionId: NUMERO,
      name: "aviso_pedido",
      language: "pt_BR",
    };
    await marcarModeloIndisponivel(admin, chave, "PAUSED");
    expect(tabelas.meta_templates![0]!.status).toBe("PAUSED");
    // Já pausado: a recusa seguinte por desativação não reescreve o que a plataforma disse.
    await marcarModeloIndisponivel(admin, chave, "DISABLED");
    expect(tabelas.meta_templates![0]!.status).toBe("PAUSED");
  });

  it("REINSTATED vale como aprovado", () => {
    expect(modeloEnviavel("REINSTATED")).toBe(true);
    expect(modeloEnviavel("approved")).toBe(true);
    expect(modeloEnviavel("PAUSED")).toBe(false);
    expect(modeloEnviavel(null)).toBe(false);
  });
});
