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
