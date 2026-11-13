/**
 * A SITUAÇÃO de cada modelo numa campanha, para a tela (fork da Genuine,
 * 2026-11-13). Puro: a rota junta o espelho e o contador de recusas, e a tela
 * só traduz os códigos daqui em frase.
 *
 *   - `ativo`: o rodízio pode escolhê-lo agora (aprovado no espelho);
 *   - `motivo`: por que está fora, quando está;
 *   - `recusas`: quantas vezes a plataforma recusou um envio desta campanha com
 *     ele, e o código da última recusa. Um modelo pode estar ativo de novo e
 *     ainda mostrar recusas antigas: é o histórico desta campanha.
 */

export type MotivoDoPulo =
  "pausado" | "desativado" | "recusado" | "em_analise" | "fora_do_numero" | "outro";

export type CodigoDaRecusa = "pausado" | "desativado" | "nao_aprovado";

export interface SituacaoDoModelo {
  ativo: boolean;
  motivo: MotivoDoPulo | null;
  qualidadeBaixa: boolean;
  recusas: number;
  ultimaRecusa: CodigoDaRecusa | null;
  ultimaRecusaEm: string | null;
}

const ENVIAVEIS = new Set(["APPROVED", "REINSTATED"]);

const MOTIVO_DO_STATUS: Record<string, MotivoDoPulo> = {
  PAUSED: "pausado",
  DISABLED: "desativado",
  REJECTED: "recusado",
  PENDING: "em_analise",
  IN_APPEAL: "em_analise",
  PENDING_DELETION: "desativado",
  DELETED: "desativado",
};

const CODIGO_DA_RECUSA: Record<string, CodigoDaRecusa> = {
  "132015": "pausado",
  "132016": "desativado",
  "132001": "nao_aprovado",
};

export function situacaoDoModelo(entrada: {
  status: string | null;
  qualidade: string | null;
  pulos: { vezes: number; motivo: string; ultima_em: string | null } | null;
}): SituacaoDoModelo {
  const status = (entrada.status ?? "").toUpperCase();
  const ativo = ENVIAVEIS.has(status);
  return {
    ativo,
    motivo: ativo ? null : status === "" ? "fora_do_numero" : (MOTIVO_DO_STATUS[status] ?? "outro"),
    qualidadeBaixa: (entrada.qualidade ?? "").toUpperCase() === "RED",
    recusas: entrada.pulos?.vezes ?? 0,
    ultimaRecusa: entrada.pulos ? (CODIGO_DA_RECUSA[entrada.pulos.motivo] ?? null) : null,
    ultimaRecusaEm: entrada.pulos?.ultima_em ?? null,
  };
}
