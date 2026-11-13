/**
 * CRIAR, EDITAR E APAGAR MODELO NA CLOUD API, pela tela (fork da Genuine,
 * 2026-11-13).
 *
 * Até aqui o canal oficial só ESPELHAVA os modelos (`template-sync.ts`). Os
 * canais intermediários já criavam, editavam e apagavam pela mesma tela
 * (`components/connections/TemplatesParceiroClient.tsx`); este módulo dá ao
 * oficial o mesmo, falando direto com a Graph API da Meta, e reaproveita a
 * regra de "apagar pergunta onde está em uso" (`gestao-de-modelos.ts`).
 *
 * ═══ Os endpoints (documentação da Meta, lida em 2026-11-13) ═══
 *
 *   - criar:  POST   /{waba}/message_templates  → { id, status, category }
 *   - editar: POST   /{template_id}             → { success }
 *   - apagar: DELETE /{waba}/message_templates?name=…&hsm_id=…  (só esse idioma;
 *     só o nome apagaria todos os idiomas)
 *
 * O id do modelo não é guardado no espelho: ele é buscado por nome + idioma
 * antes de editar ou apagar. Sem a variante, nada sai do lugar.
 *
 * ═══ A imagem do cabeçalho ═══
 *
 * A Meta não aceita link no exemplo do cabeçalho: exige o "handle" do envio
 * retomável (`POST /{app_id}/uploads`, depois `POST /upload:…`). A tela sobe a
 * imagem para o nosso storage (a mesma rota dos intermediários) e manda o link
 * assinado; aqui o arquivo é lido DO STORAGE, pelo caminho, e só se for desta
 * organização. Link de fora não é baixado, com uma exceção: na edição, o
 * exemplo que a Meta devolve é um endereço do CDN dela, e esse é aceito.
 *
 * O id do aplicativo vem de `META_APP_ID`; sem ele, da própria credencial
 * (`GET /app`). Se nenhum dos dois responder, a criação para com o motivo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";

import { acaoApagarSchema, acaoEditarSchema } from "../gestao-de-modelos";
import {
  TEXTO_DO_PROBLEMA,
  travaOEnvio,
  validarModelo,
  type ProblemaDoModelo,
} from "../regras-do-modelo";
import type { ChannelTemplate, ChannelTemplateOps } from "../types";
import { hashContract } from "./contract-hash";
import { graphBaseUrl } from "./graph-base";
import { templatesToRows } from "./template-sync";

export interface ContaOficial {
  organizationId: string;
  wabaId: string;
  token: string;
  graphVersion: string;
}

const CATEGORIA = z.enum(["AUTHENTICATION", "MARKETING", "UTILITY"]);

export const acaoCriarSchema = z.object({
  acao: z.literal("criar"),
  name: z.string().trim().min(1).max(512),
  language: z.string().trim().min(2).max(15),
  category: CATEGORIA,
  components: z.array(z.record(z.string(), z.unknown())).min(1).max(10),
});

/** O corpo do POST da rota de modelos do canal oficial. Sem corpo = sincronizar, como antes. */
export const corpoDaGestaoOficialSchema = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("sincronizar") }),
  acaoCriarSchema,
  acaoEditarSchema,
  acaoApagarSchema,
]);

export type CorpoDaGestaoOficial = z.infer<typeof corpoDaGestaoOficialSchema>;

interface ErroDaGraph {
  message?: string;
  code?: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
}

interface RespostaDaGraph {
  id?: string;
  status?: string;
  category?: string;
  success?: boolean;
  h?: string;
  error?: ErroDaGraph;
}

interface ModeloRemoto {
  id?: string;
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  components?: unknown[];
  rejected_reason?: string | null;
  quality_score?: unknown;
  parameter_format?: string | null;
}

/** O erro da Meta, com a frase dela para quem usa quando ela manda uma. */
export class ErroDaMeta extends Error {
  constructor(
    acao: string,
    readonly status: number,
    readonly detalhe: ErroDaGraph | undefined,
  ) {
    const frase = [detalhe?.error_user_title, detalhe?.error_user_msg].filter(Boolean).join(": ");
    super(`meta_template_${acao}: ${frase || detalhe?.message || `HTTP ${status}`}`);
  }
}

async function json(res: Response): Promise<
  RespostaDaGraph & {
    data?: ModeloRemoto[];
    paging?: { cursors?: { after?: string }; next?: string };
  }
> {
  return ((await res.json().catch(() => null)) ?? {}) as never;
}

function cabecalhos(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${token}`, ...extra };
}

const CAMPOS =
  "id,name,language,status,category,parameter_format,rejected_reason,quality_score,components";

/** A variante de idioma de um modelo, com o id. `null` quando não está na conta. */
export async function acharModelo(
  conta: ContaOficial,
  name: string,
  language: string,
): Promise<ModeloRemoto | null> {
  const base = `${graphBaseUrl(conta.graphVersion)}/${encodeURIComponent(conta.wabaId)}/message_templates?limit=100&fields=${CAMPOS}&name=${encodeURIComponent(name)}`;
  let depois: string | null = null;
  // O mesmo laço de páginas da sincronização: o cursor vai na NOSSA url.
  for (let pagina = 0; pagina < 20; pagina++) {
    const url: string = depois ? `${base}&after=${encodeURIComponent(depois)}` : base;
    const res = await fetch(url, { headers: cabecalhos(conta.token) });
    const corpo = await json(res);
    if (!res.ok || corpo.error) throw new ErroDaMeta("buscar", res.status, corpo.error);
    const achado = (corpo.data ?? []).find((t) => t.name === name && t.language === language);
    if (achado) return achado;
    if (!corpo.paging?.next || !corpo.paging.cursors?.after) return null;
    depois = corpo.paging.cursors.after;
  }
  return null;
}

async function idDaVariante(conta: ContaOficial, name: string, language: string): Promise<string> {
  const modelo = await acharModelo(conta, name, language);
  if (!modelo?.id) {
    throw new Error(`meta_template_variante_ausente: ${name} (${language}) não está nesta conta.`);
  }
  return modelo.id;
}

/** Cria o modelo na Meta. Devolve o que ela respondeu: id, status e a categoria que ELA deu. */
export async function criarModelo(
  conta: ContaOficial,
  pedido: { name: string; language: string; category: string; components: unknown[] },
): Promise<{ id: string | null; status: string; category: string | null }> {
  const res = await fetch(
    `${graphBaseUrl(conta.graphVersion)}/${encodeURIComponent(conta.wabaId)}/message_templates`,
    {
      method: "POST",
      headers: cabecalhos(conta.token, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        name: pedido.name,
        language: pedido.language,
        category: pedido.category,
        components: pedido.components,
      }),
    },
  );
  const corpo = await json(res);
  if (!res.ok || corpo.error) throw new ErroDaMeta("criar", res.status, corpo.error);
  return {
    id: corpo.id ?? null,
    status: corpo.status ?? "PENDING",
    category: corpo.category ?? null,
  };
}

/** Edita a variante, pelo id. A Meta troca os `components` inteiros. */
export async function editarModelo(
  conta: ContaOficial,
  pedido: { name: string; language: string; components?: unknown[]; category?: string },
): Promise<void> {
  const id = await idDaVariante(conta, pedido.name, pedido.language);
  const res = await fetch(`${graphBaseUrl(conta.graphVersion)}/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: cabecalhos(conta.token, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      ...(pedido.components ? { components: pedido.components } : {}),
      ...(pedido.category ? { category: pedido.category } : {}),
    }),
  });
  const corpo = await json(res);
  if (!res.ok || corpo.error) throw new ErroDaMeta("editar", res.status, corpo.error);
}

/** Apaga SÓ esta variante de idioma: o id em `hsm_id`, o nome junto (a Meta exige os dois). */
export async function apagarModelo(
  conta: ContaOficial,
  pedido: { name: string; language: string },
): Promise<void> {
  const id = await idDaVariante(conta, pedido.name, pedido.language);
  const url = `${graphBaseUrl(conta.graphVersion)}/${encodeURIComponent(conta.wabaId)}/message_templates?name=${encodeURIComponent(pedido.name)}&hsm_id=${encodeURIComponent(id)}`;
  const res = await fetch(url, { method: "DELETE", headers: cabecalhos(conta.token) });
  const corpo = await json(res);
  if (!res.ok || corpo.error) throw new ErroDaMeta("apagar", res.status, corpo.error);
}

/**
 * As operações no formato que `executarGestao` usa. `sessionRef` é ignorado: a
 * conta já está fechada aqui, resolvida pela rota a partir da sessão.
 */
export function opsDaContaOficial(conta: ContaOficial): ChannelTemplateOps {
  return {
    async list(): Promise<ChannelTemplate[]> {
      // Quem lista o canal oficial é a sincronização (`template-sync.ts`).
      return [];
    },
    async create({ draft }) {
      const r = await criarModelo(conta, draft);
      return {
        name: draft.name,
        language: draft.language,
        status: r.status,
        category: r.category,
        components: draft.components,
        rejectedReason: null,
        parameterFormat: null,
      };
    },
    async update({ name, language, patch }) {
      await editarModelo(conta, {
        name,
        language,
        components: patch.components,
        category: patch.category,
      });
      return {
        name,
        language,
        status: "PENDING",
        category: patch.category ?? null,
        components: patch.components ?? [],
        rejectedReason: null,
        parameterFormat: null,
      };
    },
    async remove({ name, language }) {
      await apagarModelo(conta, { name, language });
    },
  };
}

// ─── A imagem do cabeçalho ──────────────────────────────────────────────────

const BUCKET = "whatsapp-media";
/** O CDN de onde a Meta devolve o exemplo de mídia de um modelo existente. */
const HOSTS_DA_META = [".fbcdn.net", ".whatsapp.net"];

/** O caminho no storage de um link assinado nosso, ou `null` quando o link não é nosso. */
export function caminhoNoStorage(link: string): string | null {
  try {
    const u = new URL(link);
    const m = /\/storage\/v1\/object\/sign\/whatsapp-media\/(.+)$/.exec(u.pathname);
    return m ? decodeURIComponent(m[1]!) : null;
  } catch {
    return null;
  }
}

function doCdnDaMeta(link: string): boolean {
  try {
    const u = new URL(link);
    return u.protocol === "https:" && HOSTS_DA_META.some((h) => u.hostname.endsWith(h));
  } catch {
    return false;
  }
}

async function idDoAplicativo(conta: ContaOficial): Promise<string> {
  const doAmbiente = process.env.META_APP_ID?.trim();
  if (doAmbiente) return doAmbiente;
  const res = await fetch(`${graphBaseUrl(conta.graphVersion)}/app?fields=id`, {
    headers: cabecalhos(conta.token),
  });
  const corpo = await json(res);
  if (!res.ok || !corpo.id) {
    throw new Error(
      "meta_template_sem_app_id: para subir a imagem do cabeçalho, a Meta pede o id do aplicativo. Preencha META_APP_ID no .env.",
    );
  }
  return corpo.id;
}

/** O envio retomável da Meta: abre a sessão, manda os bytes, devolve o handle. */
export async function subirParaAMeta(
  conta: ContaOficial,
  arquivo: { bytes: Uint8Array; tipo: string; nome: string },
): Promise<string> {
  const app = await idDoAplicativo(conta);
  const abrir = await fetch(
    `${graphBaseUrl(conta.graphVersion)}/${encodeURIComponent(app)}/uploads?file_name=${encodeURIComponent(arquivo.nome)}&file_length=${arquivo.bytes.byteLength}&file_type=${encodeURIComponent(arquivo.tipo)}`,
    { method: "POST", headers: cabecalhos(conta.token) },
  );
  const sessao = await json(abrir);
  if (!abrir.ok || !sessao.id) throw new ErroDaMeta("imagem", abrir.status, sessao.error);
  const enviar = await fetch(`${graphBaseUrl(conta.graphVersion)}/${sessao.id}`, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${conta.token}`,
      file_offset: "0",
      "Content-Type": arquivo.tipo,
    },
    body: Buffer.from(arquivo.bytes),
  });
  const pronto = await json(enviar);
  if (!enviar.ok || !pronto.h) throw new ErroDaMeta("imagem", enviar.status, pronto.error);
  return pronto.h;
}

/**
 * Troca o link da imagem do cabeçalho pelo handle da Meta. Sem cabeçalho de
 * mídia, ou já com handle, devolve os `components` como vieram.
 */
export async function prepararImagemDoCabecalho(
  admin: SupabaseClient,
  conta: ContaOficial,
  components: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  const saida: Record<string, unknown>[] = [];
  for (const bruto of components) {
    const c = bruto;
    const formato = String(c?.format ?? "").toUpperCase();
    const exemplo = (c?.example as { header_handle?: unknown[] } | undefined)?.header_handle;
    const link = Array.isArray(exemplo) && typeof exemplo[0] === "string" ? exemplo[0] : "";
    if (
      String(c?.type ?? "").toUpperCase() !== "HEADER" ||
      formato === "TEXT" ||
      !/^https?:\/\//.test(link)
    ) {
      saida.push(bruto);
      continue;
    }
    const arquivo = await baixarImagem(admin, conta.organizationId, link);
    const handle = await subirParaAMeta(conta, arquivo);
    saida.push({ ...c, example: { header_handle: [handle] } });
  }
  return saida;
}

async function baixarImagem(
  admin: SupabaseClient,
  organizationId: string,
  link: string,
): Promise<{ bytes: Uint8Array; tipo: string; nome: string }> {
  const caminho = caminhoNoStorage(link);
  if (caminho) {
    // Só a pasta de modelos DESTA organização: o link vem do corpo do pedido.
    if (!caminho.startsWith(`${organizationId}/templates/`)) {
      throw new Error(
        "meta_template_imagem_alheia: a imagem do cabeçalho não é desta organização.",
      );
    }
    const { data, error } = await admin.storage.from(BUCKET).download(caminho);
    if (error || !data)
      throw new Error(`meta_template_imagem: ${error?.message ?? "arquivo não encontrado"}`);
    return {
      bytes: new Uint8Array(await data.arrayBuffer()),
      tipo: data.type || (caminho.endsWith(".png") ? "image/png" : "image/jpeg"),
      nome: caminho.split("/").pop() ?? "cabecalho.jpg",
    };
  }
  if (doCdnDaMeta(link)) {
    const res = await fetch(link);
    if (!res.ok)
      throw new Error(`meta_template_imagem: a Meta não devolveu a imagem atual (${res.status}).`);
    const tipo = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      tipo,
      nome: tipo === "image/png" ? "cabecalho.png" : "cabecalho.jpg",
    };
  }
  throw new Error("meta_template_imagem_link: suba a imagem do cabeçalho pela tela.");
}

// ─── O espelho, logo depois da ação ─────────────────────────────────────────

/**
 * Grava no espelho o modelo recém-criado, já como a Meta respondeu (status e
 * categoria), e a categoria que a pessoa ESCOLHEU (`categoria_pedida`, 9009).
 * A sincronização seguinte não apaga a escolha: ela não lista essa coluna.
 */
export async function espelharCriado(
  admin: SupabaseClient,
  conta: ContaOficial,
  pedido: { name: string; language: string; category: string; components: unknown[] },
  resposta: { status: string; category: string | null },
): Promise<void> {
  const agora = new Date().toISOString();
  const { error } = await admin.from("meta_templates").upsert(
    {
      organization_id: conta.organizationId,
      waba_id: conta.wabaId,
      name: pedido.name,
      language: pedido.language,
      status: resposta.status,
      category: resposta.category ?? pedido.category,
      categoria_pedida: pedido.category,
      rejected_reason: null,
      components: pedido.components,
      contract_hash: hashContract(pedido.components, "POSITIONAL"),
      parameter_format: "POSITIONAL",
      synced_at: agora,
      updated_at: agora,
    },
    { onConflict: "organization_id,waba_id,name,language" },
  );
  if (error) throw new Error(`modelo_espelho_criar: ${error.message}`);
}

/** Relê da Meta a variante editada e regrava o espelho (status e conteúdo novos). */
export async function espelharEditado(
  admin: SupabaseClient,
  conta: ContaOficial,
  pedido: { name: string; language: string },
): Promise<void> {
  const remoto = await acharModelo(conta, pedido.name, pedido.language);
  if (!remoto) return;
  const [linha] = templatesToRows({ data: [remoto] }, conta.organizationId, conta.wabaId);
  if (!linha) return;
  const agora = new Date().toISOString();
  const { error } = await admin
    .from("meta_templates")
    .upsert(
      { ...linha, synced_at: agora, updated_at: agora },
      { onConflict: "organization_id,waba_id,name,language" },
    );
  if (error) throw new Error(`modelo_espelho_editar: ${error.message}`);
}

/** A primeira frase que trava, para a mensagem de erro; os códigos vão inteiros nos detalhes. */
export function recusaDaValidacao(
  pedido: { name: string; language: string; category: string; components: unknown[] },
  idioma: Idioma,
): { mensagem: string; problemas: ProblemaDoModelo[] } | null {
  const problemas = validarModelo(pedido);
  if (!travaOEnvio(problemas)) return null;
  const primeiro = problemas.find((p) => !p.aviso)!;
  return { mensagem: traduzir(TEXTO_DO_PROBLEMA[primeiro.codigo], idioma), problemas };
}
