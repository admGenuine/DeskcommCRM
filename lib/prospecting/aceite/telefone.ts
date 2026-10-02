/**
 * Telefone brasileiro vindo de fonte pública (Google Maps, site, cadastro).
 *
 * ─── Por que um módulo, e não uma regex no normalizador ──────────────────────
 *
 * A regra antiga contava dígitos: 10 ou 11 ganhavam `55` na frente e 12 ou 13
 * começando com `55` passavam. Medido contra números reais de listagem:
 *
 *   0800 123 4567     → +5508001234567   (0800 virava "WhatsApp")
 *   (041) 3333-4444   → +5504133334444   (o zero de discagem virava DDD)
 *   (00) 99999-9999   → +5500999999999   (DDD inexistente passava)
 *
 * Os três entravam na fila de abordagem e só falhavam no envio, depois de criar
 * contato, negócio e conversa no CRM.
 *
 * ─── O que este módulo decide ────────────────────────────────────────────────
 *
 *   - tira o zero de discagem e o código de operadora (`0 XX`);
 *   - recusa número de atendimento (0300, 0500, 0800, 0900, 3003, 4003, 4004…);
 *   - confere o DDD contra a lista da Anatel;
 *   - diz se é CELULAR (9 dígitos começando com 9) ou FIXO (8 dígitos de 2 a 5).
 *
 * O que ele NÃO decide: se o número tem WhatsApp. Isso só o WhatsApp responde,
 * e quem pergunta é o envio (`lib/prospecting/aceite/whatsapp.ts`).
 */

/** Os 67 DDDs em uso no Brasil (Anatel). */
const DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43,
  44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77,
  79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

export type TipoDeTelefone = "celular" | "fixo";

export type TelefoneAvaliado =
  | { ok: true; e164: string; tipo: TipoDeTelefone }
  | { ok: false; motivo: string };

const recusa = (motivo: string): TelefoneAvaliado => ({ ok: false, motivo });

/** Número de atendimento nacional: 0300/0500/0800/0900 e 3003/400X sem DDD. */
function ehNumeroDeAtendimento(digitos: string): boolean {
  return /^0[3589]00/.test(digitos) || (digitos.length === 8 && /^(300|400)\d/.test(digitos));
}

export function avaliarTelefoneBR(bruto: string | null | undefined): TelefoneAvaliado {
  const texto = (bruto ?? "").trim();
  let digitos = texto.replace(/\D/g, "");
  if (!digitos) return recusa("Sem telefone.");

  if (texto.startsWith("+")) {
    if (!digitos.startsWith("55")) return recusa("Telefone de fora do Brasil.");
    digitos = digitos.slice(2);
  } else {
    if (ehNumeroDeAtendimento(digitos))
      return recusa("Número de atendimento (0800, 0300, 4003 ou similar).");
    if (digitos.startsWith("55") && (digitos.length === 12 || digitos.length === 13)) {
      digitos = digitos.slice(2);
    } else if (digitos.startsWith("00")) {
      // Nenhum DDD começa com zero: "00" aqui é DDD 00 digitado, não discagem.
      return recusa("DDD inexistente (00).");
    } else if (digitos.startsWith("0")) {
      // 0 + DDD + número, ou 0 + operadora (2 dígitos) + DDD + número.
      if (digitos.length === 11 || digitos.length === 12) digitos = digitos.slice(1);
      else if (digitos.length === 13 || digitos.length === 14) digitos = digitos.slice(3);
    }
  }

  if (ehNumeroDeAtendimento(digitos))
    return recusa("Número de atendimento (0800, 0300, 4003 ou similar).");
  if (digitos.length === 8 || digitos.length === 9) return recusa("Telefone sem DDD.");
  if (digitos.length !== 10 && digitos.length !== 11)
    return recusa("Telefone com quantidade de dígitos inválida.");

  const ddd = Number(digitos.slice(0, 2));
  if (!DDDS.has(ddd)) return recusa(`DDD inexistente (${digitos.slice(0, 2)}).`);

  const local = digitos.slice(2);
  if (local.length === 9) {
    if (local[0] !== "9") return recusa("Telefone com quantidade de dígitos inválida.");
    return { ok: true, e164: `+55${digitos}`, tipo: "celular" };
  }
  const primeiro = local[0] ?? "";
  if (primeiro >= "2" && primeiro <= "5") return { ok: true, e164: `+55${digitos}`, tipo: "fixo" };
  if (primeiro >= "6" && primeiro <= "9") {
    // Celular na grafia antiga, sem o nono dígito. O CRM guarda celular SEMPRE
    // com o nono (`lib/channels/phone-variants.ts`); o envio confere as duas
    // grafias com o WhatsApp.
    return { ok: true, e164: `+55${digitos.slice(0, 2)}9${local}`, tipo: "celular" };
  }
  return recusa("Telefone inválido.");
}
