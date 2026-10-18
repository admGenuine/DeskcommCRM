/**
 * O teto da leitura de sites por IA (Fase 3b do fork da Genuine). Arquivo só de
 * constantes, para a tela importar sem puxar o leitor de páginas (`leitor.ts`
 * usa `node:http`, `node:dns`, que não entram no navegador).
 */

/** Decisão do dono em 17/10/2026: US$ 1,00 por campanha. */
export const TETO_DA_IA_POR_CAMPANHA_CENTAVOS = 100;

/**
 * Quanto se reserva do teto antes de cada leitura. Cobre com folga o modelo
 * econômico (menos de 1 centavo por empresa) e um modelo médio (perto de 2);
 * depois da leitura, a reserva é trocada pelo custo real.
 */
export const RESERVA_POR_LEITURA_CENTAVOS = 3;
