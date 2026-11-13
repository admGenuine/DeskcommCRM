/**
 * Criar, editar e apagar modelo do canal oficial pela tela (fork da Genuine,
 * 2026-11-13). Chamado pelo POST de `./route.ts` depois que ele já resolveu
 * papel (`admin`), sessão de suporte, conexão e credencial. A conversa com a
 * Meta mora em `lib/channels/meta/modelos-oficiais.ts`; as regras, em
 * `lib/channels/regras-do-modelo.ts`; o "apagar pergunta onde está em uso", em
 * `lib/channels/gestao-de-modelos.ts`, o mesmo dos canais intermediários.
 */
import type { NextResponse } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { executarGestao } from "@/lib/channels/gestao-de-modelos";
import {
  criarModelo,
  espelharCriado,
  espelharEditado,
  opsDaContaOficial,
  prepararImagemDoCabecalho,
  recusaDaValidacao,
  type ContaOficial,
  type CorpoDaGestaoOficial,
} from "@/lib/channels/meta/modelos-oficiais";
import { podeApagar, podeEditar, podeTrocarCategoria } from "@/lib/channels/regras-do-modelo";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export interface ContextoDaGestao {
  requestId: string;
  userId: string;
  idioma: Idioma;
  sessionId: string;
  conta: ContaOficial;
}

type Acao = Exclude<CorpoDaGestaoOficial, { acao: "sincronizar" }>;

export async function responderGestaoOficial(
  ctx: ContextoDaGestao,
  corpo: Acao,
): Promise<NextResponse> {
  const { requestId, conta } = ctx;
  const t = (texto: string) => traduzir(texto, ctx.idioma);
  const admin = createAdminClient();

  const auditar = (action: "template.created" | "template.updated" | "template.deleted") =>
    audit({
      action,
      actorUserId: ctx.userId,
      organizationId: conta.organizationId,
      resourceType: "channel_session",
      resourceId: ctx.sessionId,
      requestId,
      metadata: { name: corpo.name, language: corpo.language },
    });

  try {
    if (corpo.acao === "criar") {
      const recusa = recusaDaValidacao(corpo, ctx.idioma);
      if (recusa) {
        return fail("validation_failed", recusa.mensagem, 422, {
          requestId,
          details: { problemas: recusa.problemas.map((p) => p.codigo) },
        });
      }
      const components = await prepararImagemDoCabecalho(admin, conta, corpo.components);
      const resposta = await criarModelo(conta, { ...corpo, components });
      await espelharCriado(admin, conta, { ...corpo, components }, resposta);
      await auditar("template.created");
      return ok(
        {
          sincronizadas: 1,
          total: 1,
          status: resposta.status,
          categoria: resposta.category,
          categoriaPedida: corpo.category,
        },
        { requestId },
      );
    }

    // Editar e apagar partem do espelho: é ele que diz o status de hoje.
    const { data: linha } = await admin
      .from("meta_templates")
      .select("status, category")
      .eq("organization_id", conta.organizationId)
      .eq("waba_id", conta.wabaId)
      .eq("name", corpo.name)
      .eq("language", corpo.language)
      .maybeSingle();
    const atual = linha as { status: string; category: string | null } | null;

    if (corpo.acao === "editar") {
      if (!atual)
        return fail("not_found", t("Modelo não encontrado. Sincronize e tente de novo."), 404, {
          requestId,
        });
      if (!podeEditar(atual.status)) {
        return fail(
          "failed_precondition",
          t("A Meta só deixa editar modelo aprovado, recusado ou pausado."),
          409,
          { requestId },
        );
      }
      if (
        corpo.category &&
        corpo.category !== atual.category &&
        !podeTrocarCategoria(atual.status)
      ) {
        return fail(
          "failed_precondition",
          t("A categoria só muda em modelo recusado pela Meta."),
          409,
          {
            requestId,
          },
        );
      }
      const recusa = recusaDaValidacao(
        { ...corpo, category: corpo.category ?? atual.category ?? "" },
        ctx.idioma,
      );
      if (recusa) {
        return fail("validation_failed", recusa.mensagem, 422, {
          requestId,
          details: { problemas: recusa.problemas.map((p) => p.codigo) },
        });
      }
      const components = await prepararImagemDoCabecalho(admin, conta, corpo.components);
      await executarGestao(
        opsDaContaOficial(conta),
        admin,
        {
          orgId: conta.organizationId,
          sessionId: ctx.sessionId,
          sessionRef: conta.wabaId,
          wabaId: conta.wabaId,
        },
        { ...corpo, components },
      );
      await espelharEditado(admin, conta, corpo);
      await auditar("template.updated");
      return ok({ sincronizadas: 1, total: 1 }, { requestId });
    }

    if (atual && !podeApagar(atual.status)) {
      return fail("failed_precondition", t("A Meta não deixa apagar modelo desativado."), 409, {
        requestId,
      });
    }
    const gestao = await executarGestao(
      opsDaContaOficial(conta),
      admin,
      {
        orgId: conta.organizationId,
        sessionId: ctx.sessionId,
        sessionRef: conta.wabaId,
        wabaId: conta.wabaId,
      },
      corpo,
    );
    if (!gestao.ok) {
      return fail(
        "template_in_use",
        t("Este modelo está em uso. Confirme para apagar assim mesmo."),
        409,
        {
          requestId,
          details: {
            usos: gestao.usos.map(
              (u) => `${u.tipo === "fluxo" ? t("Follow-up") : t("Agente")} «${u.nome}»`,
            ),
          },
        },
      );
    }
    await auditar("template.deleted");
    return ok({ sincronizadas: 0, total: 0 }, { requestId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "erro";
    logger.error("[channels/templates] gestão do modelo falhou", {
      acao: corpo.acao,
      detail: msg,
      requestId,
    });
    // A frase da Meta CHEGA a quem opera: é ela que diz "nome já existe" ou
    // "editado demais nesta semana". Nunca carrega o token (vai no cabeçalho).
    return fail("upstream_error", msg, 502, { requestId });
  }
}
