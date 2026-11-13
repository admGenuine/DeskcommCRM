/**
 * A fronteira que a campanha com modelo consulta (fork da Genuine, 2026-11-12):
 * quem exige modelo sai da matriz de capacidades, e as vagas saem da MESMA
 * derivação de contrato que o envio usa.
 */
import { describe, expect, it } from "vitest";

import { exigeModelo, textoDoModelo, vagasDoModelo } from "./modelos-da-conexao";

const COMPONENTES = [
  { type: "HEADER", format: "IMAGE", example: { header_handle: ["https://x/a.jpg"] } },
  { type: "BODY", text: "Olá {{1}}, a promoção de {{2}} começou." },
  { type: "FOOTER", text: "Responda SAIR para não receber." },
  {
    type: "BUTTONS",
    buttons: [{ type: "URL", text: "Ver", url: "https://loja.com.br/{{1}}" }],
  },
];

describe("quem exige modelo", () => {
  it("o canal oficial e os parceiros dele exigem; o não oficial e o desconhecido, não", () => {
    expect(exigeModelo("meta_cloud")).toBe(true);
    expect(exigeModelo("datafy")).toBe(true);
    expect(exigeModelo("waha")).toBe(false);
    expect(exigeModelo("wacalls")).toBe(false);
    expect(exigeModelo("canal_do_futuro")).toBe(false);
    expect(exigeModelo(null)).toBe(false);
  });
});

describe("as vagas de um modelo", () => {
  it("cabeçalho de imagem, as duas do corpo e o sufixo do botão, nas chaves do envio", () => {
    const vagas = vagasDoModelo({ name: "promo", language: "pt_BR", components: COMPONENTES });
    expect(vagas.map((v) => [v.chave, v.espera])).toEqual([
      ["header:1", "image"],
      ["1", "text"],
      ["2", "text"],
      ["button0:1", "url_suffix"],
    ]);
    expect(vagas[1]).toMatchObject({ onde: "corpo", antes: "Olá " });
  });

  it("o texto que a conversa mostra é o do envio, com os valores aplicados", () => {
    const vagas = vagasDoModelo({ name: "promo", language: "pt_BR", components: COMPONENTES });
    const texto = textoDoModelo(
      {
        name: "promo",
        language: "pt_BR",
        category: "MARKETING",
        status: "APPROVED",
        qualityScore: null,
        vagas,
        previa: "",
        valoresSalvos: {},
        components: COMPONENTES,
        parameterFormat: "POSITIONAL",
      },
      { "header:1": "https://x/a.jpg", "1": "Ana", "2": "Curitiba", "button0:1": "abc" },
    );
    expect(texto).toContain("Olá Ana, a promoção de Curitiba começou.");
  });
});
