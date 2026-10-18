/**
 * O registro da busca no Maps de uma empresa do Mercado (Fase 3b do fork da
 * Genuine), em `prospecting_candidates.data.maps_busca`. Só o formato: a regra
 * mora em `maps.ts`. Separado para a tela e o `Prospect` lerem sem puxar banco.
 */
import { z } from "zod";

/** Decisão do dono em 17/10/2026: US$ 1,00 por campanha. */
export const TETO_DO_MAPS_POR_CAMPANHA_USD = 1;
/** Abaixo disto de teto restante, não vale começar uma execução. */
export const MINIMO_PARA_BUSCAR_USD = 0.05;

export const ESTADOS_DA_BUSCA_NO_MAPS = [
  "buscando",
  "achada",
  "nao_achada",
  "nao_confere",
  "falhou",
] as const;

export const buscaNoMapsSchema = z
  .object({
    status: z.enum(ESTADOS_DA_BUSCA_NO_MAPS),
    run_id: z.string().max(200).nullable(),
    termo: z.string().max(200),
    /** O teto da execução, reservado no gasto da campanha até ela terminar. */
    teto_usd: z.number().min(0),
    pedida_em: z.string(),
    concluida_em: z.string().nullable(),
    /** O nome do lugar que o Maps devolveu (achado ou não). */
    titulo: z.string().max(200).nullable(),
    observacao: z.string().max(300).nullable(),
  })
  .strict();
export type BuscaNoMaps = z.infer<typeof buscaNoMapsSchema>;
