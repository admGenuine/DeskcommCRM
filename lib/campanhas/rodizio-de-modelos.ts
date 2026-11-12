/**
 * O RODÍZIO DE MODELOS — qual modelo aprovado sai neste envio (fork da Genuine,
 * 2026-11-13).
 *
 * Irmão de `rodizio.ts`, que escolhe o NÚMERO. São duas perguntas diferentes e
 * ficam em dois arquivos: o número é escolhido primeiro (o modelo é aprovado
 * por conta, então quem decide se ele pode sair é o número), e o modelo depois.
 *
 * ═══ A regra, em ordem ═══
 *
 * 1. Só entra quem está APROVADO na plataforma agora. Modelo pausado,
 *    desativado ou fora da lista é pulado; o disparo segue com os outros.
 * 2. Entre os aprovados, o mais ATRASADO em relação ao seu peso: o de menor
 *    `(enviados + 1) / peso`. Com pesos 2 e 1, a sequência sai A, A, B, A, A, B.
 * 3. Empate: o que vem antes na lista.
 * 4. Nenhum aprovado: ninguém — quem chama pausa a campanha.
 *
 * ═══ Por que a conta é pelo que JÁ saiu, e não por um contador ═══
 *
 * `enviados` é contado no banco a cada envio (`campaign_recipient_templates`).
 * Um contador guardado à parte erraria depois de uma queda no meio da rodada, e
 * a proporção que o operador pediu é sobre o que de fato saiu. Quando um modelo
 * é pausado e volta, ele está atrasado: sai nos envios seguintes até alcançar a
 * proporção da campanha inteira, e então volta a alternar. O ritmo não muda,
 * porque cada envio continua sendo um envio; muda só qual modelo sai.
 *
 * ═══ O que o rodízio NÃO faz ═══
 *
 * Não escolhe número, não olha ritmo e não confere a pessoa. Puro de propósito.
 */

export interface ModeloNoRodizio {
  /** A posição do modelo na lista da campanha. */
  posicao: number;
  /** Quantas partes da proporção ele leva (1 a 10). */
  peso: number;
  /** Quantos envios desta campanha já usaram este modelo. */
  enviados: number;
  /** Aprovado na plataforma, para o número escolhido, agora. */
  aprovado: boolean;
}

/** A posição do modelo que sai agora, ou `null` quando nenhum está aprovado. */
export function escolherModelo(lista: readonly ModeloNoRodizio[]): number | null {
  let melhor: ModeloNoRodizio | null = null;
  for (const m of lista) {
    if (!m.aprovado || m.peso < 1) continue;
    if (!melhor) {
      melhor = m;
      continue;
    }
    // Compara (enviados+1)/peso sem divisão: a×b' < a'×b.
    const atraso = (m.enviados + 1) * melhor.peso;
    const atrasoDoMelhor = (melhor.enviados + 1) * m.peso;
    if (atraso < atrasoDoMelhor || (atraso === atrasoDoMelhor && m.posicao < melhor.posicao)) {
      melhor = m;
    }
  }
  return melhor ? melhor.posicao : null;
}
