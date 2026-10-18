/**
 * A empresa do Maps na base da Receita que já está no banco (Fase 3b, grátis).
 *
 * A busca do Maps não traz CNPJ nem porte, e a nota (`score.ts`) dá até 20
 * pontos pelo porte. A base do Mercado (`prospecting_market_companies`, escrita
 * pela rotina `genuine-mercado.yml`) tem as indústrias de alimentos do recorte
 * com telefone e nome. Procurar a empresa ali, NA MESMA CIDADE, traz o porte de
 * graça.
 *
 * Duas formas de achar, nesta ordem:
 *  1. **Telefone:** DDD e os últimos 8 dígitos iguais a um dos dois telefones da
 *     Receita. É a prova mais forte (o nono dígito do celular não atrapalha).
 *  2. **Nome:** todas as palavras próprias do nome do Maps (`palavrasDoNome`,
 *     sem "indústria", "alimentos", "ltda"...) aparecem na razão social ou no
 *     nome fantasia.
 *
 * Só vale achado ÚNICO: se dois CNPJs diferentes (raiz diferente) cabem, não
 * há como saber qual é, e a empresa fica sem porte em vez de ganhar o porte de
 * outra. Filiais da mesma raiz contam como uma empresa só.
 */
import type pg from "pg";

import type { Prospect } from "../schema";
import { palavrasDoNome } from "./site";
import type { AchadoNaReceita } from "./tipos";

export interface LinhaDaReceita {
  cnpj: string;
  cnpj_basico: string;
  matriz: boolean;
  razao_social: string;
  nome_fantasia: string | null;
  telefone1: string | null;
  telefone2: string | null;
  porte: string;
}

function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Como o nome da cidade é comparado: maiúsculo, sem acento, espaços simples. */
export function municipioComparavel(nome: string): string {
  return semAcento(nome).toUpperCase().replace(/\s+/g, " ").trim();
}

/**
 * DDD + os últimos 8 dígitos, ou null. Aceita o E.164 do Maps (+55...) e o
 * formato da Receita (DDD e número, com ou sem máscara).
 */
export function telefoneComparavel(numero: string | null | undefined): string | null {
  if (!numero) return null;
  let d = numero.replace(/\D/g, "");
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  d = d.replace(/^0+/, "");
  if (d.length < 10 || d.length > 11) return null;
  return d.slice(0, 2) + d.slice(-8);
}

function palavrasDaLinha(l: LinhaDaReceita): Set<string> {
  return new Set(
    semAcento(`${l.razao_social} ${l.nome_fantasia ?? ""}`)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
}

/** A linha da empresa, se houver UMA raiz de CNPJ só; a matriz primeiro. */
function unica(linhas: LinhaDaReceita[]): LinhaDaReceita | null {
  const raizes = new Set(linhas.map((l) => l.cnpj_basico));
  if (raizes.size !== 1) return null;
  return linhas.find((l) => l.matriz) ?? linhas[0] ?? null;
}

export function acharNaReceita(
  p: Pick<Prospect, "name" | "phone">,
  linhas: readonly LinhaDaReceita[],
): AchadoNaReceita | null {
  const achado = (l: LinhaDaReceita, criterio: AchadoNaReceita["criterio"]) => ({
    cnpj: l.cnpj,
    razao_social: l.razao_social.slice(0, 200),
    porte: l.porte,
    criterio,
  });

  const alvo = telefoneComparavel(p.phone);
  if (alvo) {
    const pelo = unica(
      linhas.filter(
        (l) => telefoneComparavel(l.telefone1) === alvo || telefoneComparavel(l.telefone2) === alvo,
      ),
    );
    if (pelo) return achado(pelo, "telefone");
  }

  const palavras = palavrasDoNome(p.name);
  if (!palavras.length) return null;
  const pelo = unica(
    linhas.filter((l) => {
      const daLinha = palavrasDaLinha(l);
      return palavras.every((w) => daLinha.has(w));
    }),
  );
  return pelo ? achado(pelo, "nome") : null;
}

/**
 * Procura no banco, na cidade e UF do candidato. Sem cidade ou UF, ou se veio
 * do Mercado (já tem CNPJ e porte), não procura. `undefined` = não se aplica;
 * `null` = procurado e não achado.
 */
export async function buscarNaReceita(
  pool: Pick<pg.Pool, "query">,
  p: Pick<Prospect, "name" | "phone" | "city" | "state_code" | "cnpj" | "fonte">,
): Promise<AchadoNaReceita | null | undefined> {
  if (p.fonte === "mercado" || p.cnpj) return undefined;
  if (!p.city || !p.state_code) return undefined;
  const { rows } = await pool.query<LinhaDaReceita>(
    `select cnpj, cnpj_basico, matriz, razao_social, nome_fantasia, telefone1, telefone2, porte
       from public.prospecting_market_companies
      where uf = $1
        and translate(upper(coalesce(municipio, '')),
                      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC') = $2
      limit 5000`,
    [p.state_code.toUpperCase(), municipioComparavel(p.city)],
  );
  return acharNaReceita(p, rows);
}
