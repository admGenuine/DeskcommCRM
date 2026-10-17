/**
 * O score da prospecção (Fase 4 do plano do fork da Genuine,
 * `docs/genuine/PLANO-PROSPECCAO.md`): uma nota de 0 a 100 por empresa, com o
 * motivo de cada ponto.
 *
 * Usa só o que já está no candidato: o porte da Receita, os sinais lidos do site
 * (`sinais/`), as avaliações do Maps e o gosto do dono (`aprendizado.ts`). Nada
 * é gravado: a nota é calculada na hora, então mudar um peso aqui muda a nota de
 * todas as empresas, inclusive as já encontradas.
 *
 * Os pesos foram decididos pelo dono em 17/10/2026. O pixel de anúncio, por
 * enquanto, SÓ INFORMA (`anuncio` no resultado) e não soma ponto; ver o peso
 * `sem_pixel_de_anuncio` abaixo.
 *
 * O `motivo` de cada item é uma frase FIXA (chave de `t()`, com espanhol no
 * dicionário); o que muda de uma empresa para outra vai em `detalhe`.
 */
import { normalizarTexto } from "./aceite/segmento";
import type { PerfilAprendido } from "./aprendizado";
import type { Prospect } from "./schema";
import type { TipoDeSinal } from "./sinais/tipos";

export const PESOS_DO_SCORE = {
  porte: { DEMAIS: 20, EPP: 12, ME: 6 } as Record<string, number>,
  procura_distribuidor: 15,
  vagas_comerciais: 10,
  registro_sif: 10,
  registro_estadual_municipal: 5,
  vende_em_varejo: 10,
  /**
   * OBSERVAÇÃO (dono, 17/10/2026): por enquanto o pixel só informa se a empresa
   * anuncia ou não, e vale 0. A ideia é, no futuro, dar mais pontos a quem
   * ainda NÃO anuncia (espaço para tráfego pago): basta trocar este número, e a
   * nota de todas as empresas muda junto, inclusive as já encontradas.
   */
  sem_pixel_de_anuncio: 0,
  espaco_para_site: 5,
  avaliacoes_no_maps: 5,
  gosto: 10,
};

/** A partir de quantas avaliações no Maps a empresa ganha o ponto de reputação. */
export const AVALIACOES_MINIMAS = 20;

export const MOTIVOS_DO_SCORE = {
  porte_DEMAIS: "Porte médio ou grande na Receita.",
  porte_EPP: "Empresa de pequeno porte (EPP) na Receita.",
  porte_ME: "Microempresa (ME) na Receita.",
  procura_distribuidor: "Procura distribuidores ou representantes.",
  vagas_comerciais: "Está contratando equipe comercial.",
  vende_em_varejo: "Vende no varejo.",
  registro_sif: "Tem SIF: pode vender para outros estados.",
  registro_estadual_municipal: "Tem SIE ou SIM.",
  sem_pixel_de_anuncio: "Ainda não anuncia: sem pixel da Meta nem tag do Google Ads no site.",
  espaco_para_site: "Site fraco ou ausente: sem site, fora do ar, sem cadeado ou desatualizado.",
  avaliacoes_no_maps: "20 ou mais avaliações no Maps.",
  gostei: "Você marcou como Gostei.",
  categoria_aprovada: "Categoria que você aprovou com Gostei.",
} as const;

export interface ItemDoScore {
  pontos: number;
  /** Frase fixa, chave de `t()`. */
  motivo: (typeof MOTIVOS_DO_SCORE)[keyof typeof MOTIVOS_DO_SCORE];
  /** O dado desta empresa que justifica o ponto (número de avaliações, categoria). */
  detalhe?: string;
}

/**
 * Se a empresa anuncia, pelo site: `anuncia` (pixel da Meta ou tag do Google
 * Ads), `nao_anuncia` (nenhum dos dois e nenhum Gerenciador de Tags que pudesse
 * escondê-los), `indefinido` (site analisado sem como afirmar, ou sem site) e
 * `null` quando o site ainda não foi analisado.
 */
export type Anuncio = "anuncia" | "nao_anuncia" | "indefinido";

export const ROTULO_DO_ANUNCIO: Record<Anuncio, string> = {
  anuncia: "Com pixel de anúncio",
  nao_anuncia: "Sem pixel de anúncio",
  indefinido: "Pixel não confirmado",
};

export interface Score {
  nota: number;
  itens: ItemDoScore[];
  /** Informativo: por enquanto não entra na nota (ver `PESOS_DO_SCORE.sem_pixel_de_anuncio`). */
  anuncio: Anuncio | null;
  /** O site ainda não foi analisado: a nota pode subir quando for. */
  semAnaliseDoSite: boolean;
}

const ANALISE_CONCLUIDA = new Set(["ok", "sem_site", "fora_do_ar"]);
const SITE_FRACO: TipoDeSinal[] = [
  "sem_site",
  "site_fora_do_ar",
  "site_sem_https",
  "site_desatualizado",
];
const SINAIS_PONTUADOS = ["procura_distribuidor", "vagas_comerciais", "vende_em_varejo"] as const;

export type ProspectParaScore = Pick<
  Prospect,
  "category" | "reviews" | "porte" | "analise" | "avaliacao"
>;

export function pontuar(p: ProspectParaScore, perfil: PerfilAprendido | null | undefined): Score {
  const M = MOTIVOS_DO_SCORE;
  const itens: ItemDoScore[] = [];

  const porte = p.porte ? PESOS_DO_SCORE.porte[p.porte] : undefined;
  if (porte) itens.push({ pontos: porte, motivo: M[`porte_${p.porte}` as "porte_ME"] });

  const analise = p.analise && ANALISE_CONCLUIDA.has(p.analise.status) ? p.analise : null;
  const tem = (tipo: TipoDeSinal) => !!analise?.sinais.some((s) => s.tipo === tipo);
  for (const tipo of SINAIS_PONTUADOS)
    if (tem(tipo)) itens.push({ pontos: PESOS_DO_SCORE[tipo], motivo: M[tipo] });
  const anuncio: Anuncio | null = !analise
    ? null
    : tem("anuncia_meta") || tem("anuncia_google")
      ? "anuncia"
      : tem("sem_pixel_de_anuncio")
        ? "nao_anuncia"
        : "indefinido";
  if (anuncio === "nao_anuncia" && PESOS_DO_SCORE.sem_pixel_de_anuncio > 0)
    itens.push({ pontos: PESOS_DO_SCORE.sem_pixel_de_anuncio, motivo: M.sem_pixel_de_anuncio });
  // SIF já cobre o que o SIE/SIM diria: só um dos dois conta.
  if (tem("registro_sif"))
    itens.push({ pontos: PESOS_DO_SCORE.registro_sif, motivo: M.registro_sif });
  else if (tem("registro_estadual_municipal"))
    itens.push({
      pontos: PESOS_DO_SCORE.registro_estadual_municipal,
      motivo: M.registro_estadual_municipal,
    });
  // Sem site, fora do ar, sem cadeado ou desatualizado: o mesmo espaço, conta uma vez.
  if (SITE_FRACO.some(tem))
    itens.push({ pontos: PESOS_DO_SCORE.espaco_para_site, motivo: M.espaco_para_site });

  if ((p.reviews ?? 0) >= AVALIACOES_MINIMAS)
    itens.push({
      pontos: PESOS_DO_SCORE.avaliacoes_no_maps,
      motivo: M.avaliacoes_no_maps,
      detalhe: String(p.reviews),
    });

  if (p.avaliacao?.nota === "gostei")
    itens.push({ pontos: PESOS_DO_SCORE.gosto, motivo: M.gostei });
  else if (p.avaliacao?.nota !== "nao_gostei" && p.category && perfil) {
    const chave = normalizarTexto(p.category);
    const aprovada = perfil.categorias.find(
      (c) => normalizarTexto(c.categoria) === chave && c.gostei > c.nao_gostei,
    );
    if (aprovada)
      itens.push({
        pontos: PESOS_DO_SCORE.gosto,
        motivo: M.categoria_aprovada,
        detalhe: aprovada.categoria,
      });
  }

  return {
    nota: Math.min(
      100,
      itens.reduce((t, i) => t + i.pontos, 0),
    ),
    itens,
    anuncio,
    semAnaliseDoSite: !analise,
  };
}

/**
 * Quais ficam numa seleção "só as melhores": nota mínima, as N primeiras, ou as
 * duas regras juntas. Empate na N-ésima nota entra pela ordem recebida.
 */
export function melhores<T>(
  itens: readonly { item: T; nota: number }[],
  regra: { notaMinima?: number | null; quantas?: number | null },
): T[] {
  const ordenados = [...itens].sort((a, b) => b.nota - a.nota);
  const acima = ordenados.filter((i) => i.nota >= (regra.notaMinima ?? 0));
  return (regra.quantas && regra.quantas > 0 ? acima.slice(0, regra.quantas) : acima).map(
    (i) => i.item,
  );
}
