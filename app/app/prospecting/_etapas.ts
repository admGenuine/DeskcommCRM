/**
 * A Prospecção em três etapas, cada uma com a sua tela (fork, 2026-11-02).
 *
 * Até aqui era uma tela só, de 1.570 linhas, com "1. Encontrar empresas",
 * "2. Preparar a abordagem" e "3. Acompanhar resultados" empilhados. O dono do
 * fork pediu a divisão: uma porta de entrada (`/app/prospecting`) com texto
 * curto e três botões, e uma tela por etapa. A lógica e os componentes são os
 * mesmos; o que muda é o que cada rota mostra (`_client.tsx`, prop `etapa`).
 *
 * A campanha escolhida viaja entre as etapas pela query `?campanha=<id>`: é o
 * único estado que precisa sobreviver à troca de rota. O resto (filtro da
 * tabela, rascunho da configuração) nasce de novo em cada tela, como já nascia
 * ao recarregar a página.
 */
export const ETAPAS = ["empresas", "campanhas", "abordagem"] as const;
export type Etapa = (typeof ETAPAS)[number];

export const RAIZ_DA_PROSPECCAO = "/app/prospecting";

export const ROTA_DA_ETAPA: Record<Etapa, string> = {
  empresas: `${RAIZ_DA_PROSPECCAO}/empresas`,
  campanhas: `${RAIZ_DA_PROSPECCAO}/campanhas`,
  abordagem: `${RAIZ_DA_PROSPECCAO}/abordagem`,
};

export const NUMERO_DA_ETAPA: Record<Etapa, 1 | 2 | 3> = {
  empresas: 1,
  campanhas: 2,
  abordagem: 3,
};

/** O nome da query que carrega a campanha escolhida de uma etapa à outra. */
export const PARAMETRO_DA_CAMPANHA = "campanha";

/** O endereço de uma etapa (ou da porta, com `null`), levando a campanha junto quando há uma. */
export function hrefDaEtapa(etapa: Etapa | null, campanhaId?: string | null): string {
  const base = etapa ? ROTA_DA_ETAPA[etapa] : RAIZ_DA_PROSPECCAO;
  if (!campanhaId) return base;
  return `${base}?${PARAMETRO_DA_CAMPANHA}=${encodeURIComponent(campanhaId)}`;
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
 * Busca concluída e abordagem ainda não configurada: etapa 2, para preparar a
 * campanha (de lá sai o botão para a etapa 3). Abordagem já configurada
 * (iniciada, pausada ou concluída): etapa 2, onde a fila e as respostas estão.
 */
export function etapaParaContinuar(campanha: ParadaDaCampanha | null | undefined): Etapa {
  if (!campanha) return "empresas";
  if (campanha.search_status !== "succeeded" || campanha.result_count === 0) return "empresas";
  return "campanhas";
}
