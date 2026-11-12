/**
 * O resultado de cada modelo de uma campanha que alterna modelos (fork da
 * Genuine, 2026-11-13): a mesma régua do relatório da campanha, recortada por
 * modelo.
 */
import { describe, expect, it } from "vitest";

import { metricasPorModelo, type CarimbosDoDestinatario } from "./metricas-por-modelo";

const T = "2026-11-13T12:00:00.000Z";
const pessoa = (
  id: string,
  extra: Partial<CarimbosDoDestinatario> = {},
): CarimbosDoDestinatario => ({
  id,
  status: "sent",
  sent_at: T,
  delivered_at: null,
  read_at: null,
  replied_at: null,
  ...extra,
});
const registro = (recipient_id: string, template_name: string) => ({
  recipient_id,
  template_name,
  template_language: "pt_BR",
});

describe("metricas por modelo", () => {
  it("conta por carimbo: quem leu também foi entregue; quem respondeu também leu", () => {
    const [a] = metricasPorModelo(
      [registro("1", "promo_a"), registro("2", "promo_a"), registro("3", "promo_a")],
      [
        pessoa("1", { status: "replied", delivered_at: T, read_at: T, replied_at: T }),
        pessoa("2", { status: "delivered", delivered_at: T }),
        pessoa("3"),
      ],
    );
    expect(a).toMatchObject({ enviados: 3, entregues: 2, lidos: 1, responderam: 1, falharam: 0 });
    expect(a!.taxas.entrega).toBeCloseTo(2 / 3);
    expect(a!.taxas.leitura).toBe(0.5);
    expect(a!.taxas.falha).toBe(0);
  });

  it("separa os modelos, e a falha conta para o modelo que tentou sair", () => {
    const resultado = metricasPorModelo(
      [registro("1", "promo_a"), registro("2", "promo_b"), registro("3", "promo_b")],
      [
        pessoa("1", { delivered_at: T, read_at: T }),
        pessoa("2", { status: "failed", sent_at: null }),
        pessoa("3", { delivered_at: T }),
      ],
      [
        { template_name: "promo_a", template_language: "pt_BR" },
        { template_name: "promo_b", template_language: "pt_BR" },
      ],
    );
    expect(
      resultado.map((m) => [m.template_name, m.enviados, m.entregues, m.lidos, m.falharam]),
    ).toEqual([
      ["promo_a", 1, 1, 1, 0],
      ["promo_b", 1, 1, 0, 1],
    ]);
    expect(resultado[1]!.taxas.falha).toBe(0.5);
  });

  it("modelo da lista que ainda não saiu aparece zerado, com as taxas vazias e não 0%", () => {
    const [, b] = metricasPorModelo(
      [registro("1", "promo_a")],
      [pessoa("1")],
      [
        { template_name: "promo_a", template_language: "pt_BR" },
        { template_name: "promo_b", template_language: "pt_BR" },
      ],
    );
    expect(b).toMatchObject({ template_name: "promo_b", enviados: 0 });
    expect(b!.taxas).toEqual({ entrega: null, leitura: null, falha: null });
  });

  it("registro de pessoa que não está mais na lista não conta, nem cria linha", () => {
    expect(metricasPorModelo([registro("x", "promo_a")], [])).toEqual([]);
  });
});
