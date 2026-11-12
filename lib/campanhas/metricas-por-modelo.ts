/**
 * O DESEMPENHO DE CADA MODELO numa campanha que alterna modelos (fork da
 * Genuine, 2026-11-13).
 *
 * A mesma régua de `metricas.ts`, recortada por modelo:
 *
 *   - o funil é contado por CARIMBO (`sent_at`, `delivered_at`, `read_at`,
 *     `replied_at`), nunca por `status`: quem respondeu também foi entregue e
 *     lido;
 *   - falha é `status = failed`;
 *   - taxa sem denominador é `null`, nunca 0.
 *
 * Qual modelo saiu para cada pessoa vem de `campaign_recipient_templates`. Quem
 * ainda não saiu não tem registro e não entra em modelo nenhum.
 */

export interface RegistroDoModelo {
  recipient_id: string;
  template_name: string;
  template_language: string;
}

export interface CarimbosDoDestinatario {
  id: string;
  status: string;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  replied_at: string | null;
}

export interface MetricaDoModelo {
  template_name: string;
  template_language: string;
  /** Saíram ou falharam com este modelo. */
  tentados: number;
  enviados: number;
  entregues: number;
  lidos: number;
  responderam: number;
  falharam: number;
  taxas: {
    /** entregues / enviados */
    entrega: number | null;
    /** lidos / entregues */
    leitura: number | null;
    /** falharam / tentados */
    falha: number | null;
  };
}

function taxa(numerador: number, denominador: number): number | null {
  return denominador > 0 ? numerador / denominador : null;
}

/**
 * Uma linha por modelo, na ordem de `ordem` (a lista da campanha) e, depois,
 * os que aparecem só nos registros (um modelo que saiu da lista depois de usado).
 */
export function metricasPorModelo(
  registros: readonly RegistroDoModelo[],
  destinatarios: readonly CarimbosDoDestinatario[],
  ordem: readonly { template_name: string; template_language: string }[] = [],
): MetricaDoModelo[] {
  const porId = new Map(destinatarios.map((d) => [d.id, d]));
  const chave = (m: { template_name: string; template_language: string }) =>
    `${m.template_name}|${m.template_language}`;
  const contas = new Map<string, MetricaDoModelo>();
  const vazia = (m: { template_name: string; template_language: string }): MetricaDoModelo => ({
    template_name: m.template_name,
    template_language: m.template_language,
    tentados: 0,
    enviados: 0,
    entregues: 0,
    lidos: 0,
    responderam: 0,
    falharam: 0,
    taxas: { entrega: null, leitura: null, falha: null },
  });
  for (const m of ordem) contas.set(chave(m), vazia(m));

  for (const r of registros) {
    const d = porId.get(r.recipient_id);
    if (!d) continue;
    const conta = contas.get(chave(r)) ?? vazia(r);
    contas.set(chave(r), conta);
    if (d.sent_at) conta.enviados++;
    if (d.delivered_at) conta.entregues++;
    if (d.read_at) conta.lidos++;
    if (d.replied_at) conta.responderam++;
    if (d.status === "failed") conta.falharam++;
  }

  return [...contas.values()].map((c) => {
    const tentados = c.enviados + c.falharam;
    return {
      ...c,
      tentados,
      taxas: {
        entrega: taxa(c.entregues, c.enviados),
        leitura: taxa(c.lidos, c.entregues),
        falha: taxa(c.falharam, tentados),
      },
    };
  });
}
