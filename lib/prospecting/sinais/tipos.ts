/**
 * Sinais de oportunidade de uma empresa, lidos do site dela (Fase 3 do plano da
 * prospecção, fork da Genuine: `docs/genuine/PLANO-PROSPECCAO.md`).
 *
 * Todo sinal tem PROVA: o trecho ou o código que foi achado e o link da página.
 * Nunca é texto solto. Esta primeira fatia não usa IA nem fonte paga: é leitura
 * direta do HTML, então o custo por empresa é zero.
 *
 * A análise mora em `prospecting_candidates.data.analise`, como a avaliação do
 * dono (`aprendizado.ts`). Dois motivos: a cascata da LGPD reescreve o `data`
 * inteiro com um conjunto fixo de chaves, então a análise sai junto sem caminho
 * próprio de redação; e a régua de entrada já impede a mesma empresa em duas
 * campanhas da organização, então "por candidato" é "por empresa".
 */
import { z } from "zod";

export const TIPOS_DE_SINAL = [
  "procura_distribuidor",
  "vagas_comerciais",
  "registro_sif",
  "registro_estadual_municipal",
  "vende_em_varejo",
  "anuncia_meta",
  "anuncia_google",
  "sem_pixel_de_anuncio",
  "site_sem_https",
  "site_desatualizado",
  "sem_site",
  "site_fora_do_ar",
] as const;
export type TipoDeSinal = (typeof TIPOS_DE_SINAL)[number];

/** O nome curto de cada sinal na tela (chave de `t()`). */
export const ROTULO_DO_SINAL: Record<TipoDeSinal, string> = {
  procura_distribuidor: "Procura distribuidores",
  vagas_comerciais: "Contratando equipe comercial",
  registro_sif: "Tem SIF",
  registro_estadual_municipal: "Tem SIE ou SIM",
  vende_em_varejo: "Vende no varejo",
  anuncia_meta: "Anuncia na Meta",
  anuncia_google: "Anuncia no Google",
  sem_pixel_de_anuncio: "Sem pixel de anúncio",
  site_sem_https: "Site sem cadeado",
  site_desatualizado: "Site desatualizado",
  sem_site: "Sem site",
  site_fora_do_ar: "Site fora do ar",
};

export const sinalSchema = z
  .object({
    tipo: z.enum(TIPOS_DE_SINAL),
    /** O trecho, o código ou o fato que prova o sinal. */
    evidencia: z.string().max(240),
    /** A página onde a prova está; null quando o sinal é a ausência do site. */
    link: z.string().max(500).nullable(),
    /**
     * `ia` quando o sinal veio da leitura por IA (Fase 3b); ausente quando veio
     * das réguas da leitura grátis. A prova da IA é um trecho LITERAL da página,
     * conferido antes de gravar (`ia.ts`).
     */
    fonte: z.enum(["ia"]).optional(),
  })
  .strict();
export type Sinal = z.infer<typeof sinalSchema>;

export const ESTADOS_DA_ANALISE = [
  "pendente",
  "analisando",
  "ok",
  "sem_site",
  "fora_do_ar",
] as const;
export type EstadoDaAnalise = (typeof ESTADOS_DA_ANALISE)[number];

/** De onde veio o endereço do site. */
export const ORIGENS_DO_SITE = ["maps", "email"] as const;

/**
 * A empresa do Maps achada na base da Receita que já está no banco
 * (`prospecting_market_companies`), pelo telefone ou pelo nome, na mesma
 * cidade (Fase 3b, grátis). É de onde a nota tira o porte de quem não veio do
 * Mercado. Só vale achado ÚNICO: dois CNPJs possíveis é não achado.
 */
export const CRITERIOS_DA_RECEITA = ["telefone", "nome"] as const;
export const receitaSchema = z
  .object({
    cnpj: z.string().regex(/^[0-9]{14}$/),
    razao_social: z.string().max(200),
    porte: z.string().max(20),
    criterio: z.enum(CRITERIOS_DA_RECEITA),
  })
  .strict();
export type AchadoNaReceita = z.infer<typeof receitaSchema>;

/**
 * A leitura do site por IA (Fase 3b, paga, só quando o dono pede). Fica dentro
 * da análise: refazer a análise grátis zera a leitura, e o gasto da campanha
 * fica guardado à parte (`prospecting_campaigns.gasto_ia_centavos`), para o
 * teto não renascer.
 */
export const ESTADOS_DA_LEITURA_IA = [
  "pendente",
  "lendo",
  "ok",
  "sem_texto",
  "teto",
  "falhou",
] as const;
export type EstadoDaLeituraIa = (typeof ESTADOS_DA_LEITURA_IA)[number];

export const leituraIaSchema = z
  .object({
    status: z.enum(ESTADOS_DA_LEITURA_IA),
    pedida_em: z.string(),
    iniciada_em: z.string().nullable(),
    lida_em: z.string().nullable(),
    /** O que a empresa faz e para quem vende, em até duas frases. */
    resumo: z.string().max(400).nullable(),
    produtos: z.array(z.string().max(80)).max(8),
    /** Quantos sinais a IA trouxe que a leitura grátis não tinha achado. */
    sinais_novos: z.number().int().min(0),
    /** Em centavos de dólar; estimado pelo preço mais alto quando o modelo não tem preço. */
    custo_centavos: z.number().min(0),
    modelo: z.string().max(120).nullable(),
    observacao: z.string().max(300).nullable(),
  })
  .strict();
export type LeituraIa = z.infer<typeof leituraIaSchema>;

export const analiseSchema = z
  .object({
    status: z.enum(ESTADOS_DA_ANALISE),
    pedida_em: z.string(),
    /** Quando a rodada pegou a empresa; serve para devolver à fila a que travou. */
    iniciada_em: z.string().nullable(),
    analisada_em: z.string().nullable(),
    site: z
      .object({ url: z.string().max(500), origem: z.enum(ORIGENS_DO_SITE) })
      .strict()
      .nullable(),
    perfil: z
      .object({
        instagram: z.string().max(500).nullable(),
        facebook: z.string().max(500).nullable(),
        linkedin: z.string().max(500).nullable(),
      })
      .strict(),
    sinais: z.array(sinalSchema).max(30),
    /** As páginas lidas, na ordem. */
    paginas: z.array(z.string().max(500)).max(6),
    /** Por que não houve site ou leitura, em português, para a tela. */
    observacao: z.string().max(300).nullable(),
    /** Versão das réguas que fizeram a análise; a de versão antiga pode ser refeita. */
    versao: z.number().int().min(1),
    /** Achado na Receita (só para quem não veio do Mercado); null = procurado e não achado. */
    receita: receitaSchema.nullable().optional(),
    /** A leitura por IA, quando pedida. */
    ia: leituraIaSchema.optional(),
  })
  .strict();
export type Analise = z.infer<typeof analiseSchema>;

/**
 * A versão das réguas. Sobe quando uma correção muda o resultado (17/10/2026,
 * versão 2: perfil da agência, site do Maps que é rede social ou página de
 * pedidos, cadeado, página de aviso; versão 3: a busca na Receita, que traz o
 * porte das empresas do Maps); a análise de versão anterior volta a poder ser
 * pedida, sem esperar os 180 dias.
 */
export const VERSAO_DA_ANALISE = 3;

/** Uma análise vale por 180 dias (plano: cache de dados da empresa). */
export const VALIDADE_DA_ANALISE_DIAS = 180;

export const PERFIL_VAZIO: Analise["perfil"] = { instagram: null, facebook: null, linkedin: null };

export function analisePendente(agora: Date): Analise {
  return {
    status: "pendente",
    pedida_em: agora.toISOString(),
    iniciada_em: null,
    analisada_em: null,
    site: null,
    perfil: PERFIL_VAZIO,
    sinais: [],
    paginas: [],
    observacao: null,
    versao: VERSAO_DA_ANALISE,
  };
}
