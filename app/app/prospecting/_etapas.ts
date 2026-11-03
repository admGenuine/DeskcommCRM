/**
 * A Prospecção em duas etapas e a campanha aberta (fork, 2026-11-02 e 2026-11-03).
 *
 * Até 2026-11-02 era uma tela só, de 1.570 linhas. O dono do fork pediu a
 * divisão em uma porta de entrada (`/app/prospecting`) e uma tela por etapa; em
 * 2026-11-03 pediu o segundo ajuste: a etapa 2 fica só com "Suas campanhas" e
 * "Acompanhar resultados", e cada campanha abre numa tela própria
 * (`/app/prospecting/campanhas/<id>`) com duas abas, "Preparar a campanha" e
 * "Abordagem". A antiga etapa 3 virou essa segunda aba. A lógica e os
 * componentes são os mesmos; o que muda é o que cada rota mostra
 * (`_client.tsx`, props `etapa`, `campanhaId` e `aba`).
 *
 * Entre as etapas a campanha escolhida viaja pela query `?campanha=<id>`; na
 * campanha aberta ela é o próprio caminho, e a aba viaja em `?aba=`.
 */
export const ETAPAS = ["empresas", "campanhas"] as const;
export type Etapa = (typeof ETAPAS)[number];

/** O que o `_client.tsx` pode mostrar: uma das etapas ou a campanha aberta. */
export type Tela = Etapa | "campanha";

export const RAIZ_DA_PROSPECCAO = "/app/prospecting";

export const ROTA_DA_ETAPA: Record<Etapa, string> = {
  empresas: `${RAIZ_DA_PROSPECCAO}/empresas`,
  campanhas: `${RAIZ_DA_PROSPECCAO}/campanhas`,
};

export const NUMERO_DA_ETAPA: Record<Etapa, 1 | 2> = {
  empresas: 1,
  campanhas: 2,
};

/** O nome da query que carrega a campanha escolhida de uma etapa à outra. */
export const PARAMETRO_DA_CAMPANHA = "campanha";

/** O endereço de uma etapa (ou da porta, com `null`), levando a campanha junto quando há uma. */
export function hrefDaEtapa(etapa: Etapa | null, campanhaId?: string | null): string {
  const base = etapa ? ROTA_DA_ETAPA[etapa] : RAIZ_DA_PROSPECCAO;
  if (!campanhaId) return base;
  return `${base}?${PARAMETRO_DA_CAMPANHA}=${encodeURIComponent(campanhaId)}`;
}

/** As duas abas da campanha aberta, na ordem em que se trabalha. */
export const ABAS_DA_CAMPANHA = ["preparar", "abordagem"] as const;
export type AbaDaCampanha = (typeof ABAS_DA_CAMPANHA)[number];

/** O nome da query que escolhe a aba da campanha aberta. */
export const PARAMETRO_DA_ABA = "aba";

/** A rota da campanha aberta, sem aba. */
export function rotaDaCampanha(campanhaId: string): string {
  return `${ROTA_DA_ETAPA.campanhas}/${encodeURIComponent(campanhaId)}`;
}

/** O endereço de uma aba da campanha aberta; a primeira aba é a rota limpa. */
export function hrefDaCampanha(campanhaId: string, aba: AbaDaCampanha = "preparar"): string {
  const rota = rotaDaCampanha(campanhaId);
  return aba === "preparar" ? rota : `${rota}?${PARAMETRO_DA_ABA}=${aba}`;
}

/** A aba pedida na query; qualquer coisa que não seja uma aba cai na primeira. */
export function abaDaQuery(valor: string | string[] | null | undefined): AbaDaCampanha {
  const texto = Array.isArray(valor) ? valor[0] : valor;
  return (ABAS_DA_CAMPANHA as readonly string[]).includes(texto ?? "")
    ? (texto as AbaDaCampanha)
    : "preparar";
}

/** O pedaço de campanha que decide onde ela está parada. */
export type ParadaDaCampanha = {
  readonly status: string;
  readonly search_status: string;
  readonly config: unknown;
  readonly result_count: number;
};

/**
 * Em que etapa quem volta à porta deve continuar.
 *
 * Busca ainda rodando ou sem resultado: etapa 1, que é onde a busca se vê.
 * Busca concluída: etapa 2, onde a campanha se abre para preparar e, depois,
 * onde a fila e as respostas estão.
 */
export function etapaParaContinuar(campanha: ParadaDaCampanha | null | undefined): Etapa {
  if (!campanha) return "empresas";
  if (campanha.search_status !== "succeeded" || campanha.result_count === 0) return "empresas";
  return "campanhas";
}
