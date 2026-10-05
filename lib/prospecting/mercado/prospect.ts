/**
 * Uma empresa do mercado (linha de `prospecting_market_companies`) no formato
 * de candidato da prospecção, o mesmo `Prospect` que a busca do Maps grava.
 *
 * A chave é `cnpj:<14 dígitos>`, para não colidir com o place_id do Maps e
 * para a supressão da LGPD (que guarda o hash da chave) valer igual.
 */
import type { Veredito } from "../aceite";
import { avaliarTelefoneBR } from "../aceite/telefone";
import type { Prospect } from "../schema";

export interface LinhaDoMercado {
  cnpj: string;
  razao_social: string;
  nome_fantasia: string | null;
  cnae_principal: string;
  cnae_principal_descricao: string | null;
  uf: string;
  municipio: string | null;
  bairro: string | null;
  cep: string | null;
  endereco: string | null;
  telefone1: string | null;
  telefone2: string | null;
  email: string | null;
  porte: string;
  capital_social_centavos: string | number | null;
}

/** O melhor telefone dos dois da Receita: celular válido antes de fixo válido. */
function melhorTelefone(numeros: (string | null)[]) {
  const avaliados = numeros.filter((n): n is string => !!n).map((n) => avaliarTelefoneBR(n));
  const validos = avaliados.filter((a) => a.ok);
  const escolhido =
    validos.find((a) => a.ok && a.tipo === "celular") ?? validos[0] ?? avaliados[0] ?? null;
  if (!escolhido) return { phone: null, phone_kind: null, phone_issue: "Sem telefone na Receita." };
  return escolhido.ok
    ? { phone: escolhido.e164, phone_kind: escolhido.tipo, phone_issue: null }
    : { phone: null, phone_kind: null, phone_issue: escolhido.motivo };
}

export function prospectDoMercado(l: LinhaDoMercado): Prospect {
  const fantasia = l.nome_fantasia?.trim();
  const local = [l.municipio, l.uf].filter(Boolean).join(" - ");
  return {
    key: `cnpj:${l.cnpj}`,
    name: fantasia || l.razao_social,
    ...melhorTelefone([l.telefone1, l.telefone2]),
    website: null,
    category: l.cnae_principal_descricao || `CNAE ${l.cnae_principal}`,
    categories: [],
    address: [l.endereco, l.bairro, local, l.cep].filter(Boolean).join(", ") || null,
    city: l.municipio,
    state_code: l.uf,
    country_code: "BR",
    maps_url: null,
    rating: null,
    reviews: null,
    emails: l.email ? [l.email] : [],
    socials: [],
    fonte: "mercado",
    cnpj: l.cnpj,
    razao_social: l.razao_social,
    porte: l.porte,
  };
}

/**
 * O veredito da fonte para o mercado: só o telefone. O segmento e a região já
 * foram decididos pelo CNAE e pela UF na importação, e a régua de segmento do
 * Maps (que lê nome e categoria do Maps) recusaria por engano uma
 * "Panificadora X Ltda" de panificação industrial.
 */
export function vereditoDoMercado(p: Prospect): Veredito {
  return p.phone
    ? { aprovado: true }
    : { aprovado: false, motivo: p.phone_issue ?? "Sem telefone brasileiro válido." };
}
