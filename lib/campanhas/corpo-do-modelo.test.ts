/**
 * A PARTE PURA DA CAMPANHA COM MODELO (fork da Genuine, 2026-11-12).
 *
 * O desenho depende de uma volta: o mapa de variáveis vira texto
 * (`serializarModelo`), a preparação do original renderiza esse texto para cada
 * pessoa, e o envio lê os valores de volta (`valoresDoCorpo`). Estes casos
 * passam pelo `renderizar` de verdade, nas duas passadas que a campanha faz
 * (preparação, sem hora; envio, com hora), para a volta não ser provada só
 * contra ela mesma.
 */
import { describe, expect, it } from "vitest";

import type { VagaDoModelo } from "@/lib/channels/modelos-da-conexao";

import {
  conferirMapa,
  ehCorpoDeModelo,
  escolhaDoModelo,
  normalizarParametro,
  origemDoValor,
  pedidoDaEscolha,
  serializarModelo,
  valorDaOrigem,
  valoresDoCorpo,
  type ModeloParaEscolha,
} from "./corpo-do-modelo";
import { renderizar } from "./renderizador";

const vaga = (chave: string, espera = "text", onde = "corpo"): VagaDoModelo => ({
  chave,
  onde,
  espera,
  antes: "",
  depois: "",
});

const MODELO = {
  template_name: "promo_novembro",
  template_language: "pt_BR",
  variable_map: {
    "1": "{{primeiro_nome}}",
    "2": "{{lead.cidade}}",
    "3": "{{saudacao}}",
    "header:1": "https://cdn.exemplo.com.br/banner.jpg",
  },
};

describe("a volta do mapa: cópia → preparação → envio → valores", () => {
  it("cada vaga recebe o dado da pessoa, e a saudação sai na hora do envio", () => {
    const corpo = serializarModelo(MODELO, ["header:1", "1", "2", "3"]);
    expect(ehCorpoDeModelo(corpo)).toBe(true);

    // Preparação: sem hora, como `preparacao.ts` faz. Saudação fica literal.
    const preparado = renderizar(corpo, {
      nome: "Ana Paula Souza",
      lead: { cidade: "Curitiba" },
    });
    expect(preparado.faltando).toEqual([]);

    // Envio: com hora (14h em São Paulo), como `rodada.ts` faz.
    const final = renderizar(
      preparado.texto,
      { nome: "Ana Paula Souza" },
      {
        agora: new Date("2026-11-12T17:00:00.000Z"),
        fuso: "America/Sao_Paulo",
      },
    ).texto;

    expect(valoresDoCorpo(final)).toEqual({
      "header:1": "https://cdn.exemplo.com.br/banner.jpg",
      "1": "Ana",
      "2": "Curitiba",
      "3": "Boa tarde",
    });
  });

  it("dado ausente na preparação vira falta, e a pessoa sai da lista (variavel_ausente)", () => {
    const corpo = serializarModelo(MODELO);
    const preparado = renderizar(corpo, { nome: "Ana", lead: {} });
    expect(preparado.faltando).toEqual(["lead.cidade"]);
  });

  it("cadastro com chaves, quebra de linha ou espaços demais não quebra a vaga nem o envio", () => {
    const corpo = serializarModelo({
      ...MODELO,
      variable_map: { "1": "{{contato.obs}}", "2": "fixo" },
    });
    const preparado = renderizar(corpo, {
      nome: "Ana",
      contato: { obs: "linha um\nlinha {{saudacao}}\t     fim" },
    });
    const final = renderizar(
      preparado.texto,
      { nome: "Ana" },
      {
        agora: new Date("2026-11-12T12:00:00.000Z"),
        fuso: "America/Sao_Paulo",
      },
    ).texto;
    expect(valoresDoCorpo(final)).toEqual({
      "1": "linha um linha {{saudacao}}   fim",
      "2": "fixo",
    });
  });

  it("texto comum de campanha não é confundido com a cópia de um modelo", () => {
    expect(ehCorpoDeModelo("Olá {{nome}}, tudo bem? [promoção]")).toBe(false);
    expect(valoresDoCorpo("Olá Ana")).toEqual({});
  });

  it("o parâmetro sai sem quebra de linha, sem tabulação e sem mais de três espaços seguidos", () => {
    expect(normalizarParametro("  a\n\nb\tc      d  ")).toBe("a b c   d");
  });
});

describe("conferir o mapa contra as vagas do modelo", () => {
  const vagas = [vaga("header:1", "image", "cabeçalho"), vaga("1"), vaga("2")];

  it("vaga de mídia sem valor usa o link salvo no modelo; chave que o modelo não tem sai", () => {
    const r = conferirMapa(
      vagas,
      { "1": "{{nome}}", "2": "fixo", "9": "sobra" },
      { "header:1": "https://cdn.exemplo.com.br/a.jpg" },
    );
    expect(r).toEqual({
      ok: true,
      mapa: { "header:1": "https://cdn.exemplo.com.br/a.jpg", "1": "{{nome}}", "2": "fixo" },
    });
  });

  it("vaga sem valor e mídia sem https são recusadas, nomeadas", () => {
    const r = conferirMapa(vagas, { "header:1": "http://inseguro.com/a.jpg", "1": " " }, {});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.faltando.map((v) => v.chave)).toEqual(["1", "2"]);
    expect(r.linkInvalido.map((v) => v.chave)).toEqual(["header:1"]);
  });
});

describe("a escolha da tela", () => {
  it("origem e valor fazem a volta, e o que não é variável conhecida é valor fixo", () => {
    for (const valor of [
      "{{primeiro_nome}}",
      "{{nome}}",
      "{{saudacao}}",
      "{{contato.cpf}}",
      "{{lead.cidade}}",
    ]) {
      expect(valorDaOrigem(origemDoValor(valor))).toBe(valor);
    }
    expect(origemDoValor("Promoção de {{x}}")).toEqual({
      fonte: "fixo",
      campo: "",
      fixo: "Promoção de {{x}}",
    });
    expect(valorDaOrigem({ fonte: "contato", campo: "com espaço", fixo: "" })).toBe("");
  });

  const modelos: ModeloParaEscolha[] = [
    {
      name: "promo_novembro",
      language: "pt_BR",
      category: "MARKETING",
      previa: "Olá {{1}}",
      vagas: [vaga("header:1", "image", "cabeçalho"), vaga("1")],
      valores_salvos: { "header:1": "https://cdn.exemplo.com.br/a.jpg" },
    },
  ];

  it("sem mexer em nada, a vaga de texto começa no primeiro nome e a de mídia no link salvo", () => {
    const r = pedidoDaEscolha({ chave: "promo_novembro|pt_BR", origens: {}, envios: "" }, modelos);
    expect(r?.modelo).toEqual({
      template_name: "promo_novembro",
      template_language: "pt_BR",
      variable_map: { "header:1": "https://cdn.exemplo.com.br/a.jpg", "1": "{{primeiro_nome}}" },
      envios_por_rodada: null,
    });
    expect(r?.corpo.split("\n")[0]).toBe("Modelo aprovado: promo_novembro (pt_BR)");
  });

  it("envios por rodada fora de 1 a 60, ou sem modelo escolhido, não deixam salvar", () => {
    expect(
      pedidoDaEscolha({ chave: "promo_novembro|pt_BR", origens: {}, envios: "61" }, modelos),
    ).toBeNull();
    expect(
      pedidoDaEscolha({ chave: "promo_novembro|pt_BR", origens: {}, envios: "2.5" }, modelos),
    ).toBeNull();
    expect(pedidoDaEscolha({ chave: "", origens: {}, envios: "" }, modelos)).toBeNull();
    expect(
      pedidoDaEscolha({ chave: "promo_novembro|pt_BR", origens: {}, envios: "20" }, modelos)?.modelo
        .envios_por_rodada,
    ).toBe(20);
  });

  it("a escolha salva volta para a tela de editar", () => {
    expect(
      escolhaDoModelo({
        template_name: "promo_novembro",
        template_language: "pt_BR",
        variable_map: { "1": "{{lead.cidade}}" },
        envios_por_rodada: 15,
      }),
    ).toEqual({
      chave: "promo_novembro|pt_BR",
      origens: { "1": { fonte: "lead", campo: "cidade", fixo: "" } },
      envios: "15",
    });
  });
});
