/**
 * A régua de aceite da prospecção: quem entra na fila de abordagem, e por quê
 * não entrou quem ficou de fora.
 *
 * Roda na ENTRADA, quando o resultado da busca chega. Antes o único critério era
 * "tem nome, place_id e um telefone com cara de brasileiro"; segmento e região
 * nunca eram conferidos, e o motivo de quem saía não ficava em lugar nenhum.
 *
 * Cada recusa devolve o motivo em português, que vai para
 * `prospecting_candidates.error` e aparece na tela. A duplicidade com o CRM e a
 * existência do número no WhatsApp ficam fora daqui porque dependem do banco e
 * do canal: a primeira é conferida em `store.ts`, a segunda em `whatsapp.ts`.
 */
import type { Prospect, SearchInput } from "../schema";
import { ufDaBusca } from "./regiao";
import { segmentoForaDoPerfil } from "./segmento";
import { avaliarTelefoneBR } from "./telefone";

export type Veredito = { aprovado: true } | { aprovado: false; motivo: string };

export function avaliarCandidato(p: Prospect, busca: Pick<SearchInput, "location">): Veredito {
  if (!p.phone) return { aprovado: false, motivo: p.phone_issue ?? "Sem telefone brasileiro válido." };
  if (p.country_code && p.country_code.toUpperCase() !== "BR")
    return { aprovado: false, motivo: "Empresa fora do Brasil." };
  const segmento = segmentoForaDoPerfil({ nome: p.name, principal: p.category, outras: p.categories ?? [] });
  if (segmento) return { aprovado: false, motivo: segmento };
  const pedida = ufDaBusca(busca.location);
  if (pedida && p.state_code && p.state_code !== pedida)
    return { aprovado: false, motivo: `Fora do estado pedido (${p.state_code}).` };
  return { aprovado: true };
}

/**
 * Candidato gravado ANTES da régua (sem `aceite`) passa por ela ao iniciar a
 * campanha. Sem isto, uma campanha montada pela versão antiga levaria para a
 * fila exatamente o que a régua existe para barrar (medido em 02/10/2026: o
 * "Mercado Paineiras" de uma busca de 01/10).
 *
 * O telefone gravado pela régua antiga é conferido de novo: "+5508001234567"
 * (um 0800) e "+5504133334444" (zero de discagem) caem no DDD inexistente.
 * Devolve o motivo da recusa, ou `null` quando o candidato segue.
 */
export function motivoDeRecusaDoLegado(p: Prospect, busca: Pick<SearchInput, "location">): string | null {
  if (p.aceite) return null;
  if (p.phone) {
    const telefone = avaliarTelefoneBR(p.phone);
    if (!telefone.ok) return telefone.motivo;
  }
  const veredito = avaliarCandidato(p, busca);
  return veredito.aprovado ? null : veredito.motivo;
}
