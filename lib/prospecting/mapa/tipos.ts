/** O desenho de uma cidade por bairro, como a tela da campanha o pinta (fork, 2026-11-03). */
export interface BairroDesenhado {
  /** O nome oficial, como aparece na legenda e no ranking. */
  readonly nome: string;
  /** A regional administrativa; só informa. */
  readonly regional: string;
  /** O centro do bairro no SVG, para o rótulo. */
  readonly cx: number;
  readonly cy: number;
  /** O caminho SVG do contorno. */
  readonly d: string;
}

export interface MapaDeBairros {
  readonly cidade: string;
  readonly uf: string;
  /** O tamanho do SVG em que os caminhos foram desenhados. */
  readonly largura: number;
  readonly altura: number;
  readonly bairros: readonly BairroDesenhado[];
}
