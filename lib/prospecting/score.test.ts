import { describe, expect, it } from "vitest";

import { perfilAprendido } from "./aprendizado";
import {
  MOTIVOS_DO_SCORE,
  PESOS_DO_SCORE,
  melhores,
  pontuar,
  type ProspectParaScore,
} from "./score";
import { analisePendente, type Analise, type Sinal } from "./sinais/tipos";

const analise = (sinais: Sinal["tipo"][], status: Analise["status"] = "ok"): Analise => ({
  ...analisePendente(new Date("2026-10-17T00:00:00Z")),
  status,
  analisada_em: "2026-10-17T00:01:00Z",
  sinais: sinais.map((tipo) => ({ tipo, evidencia: "prova", link: null })),
});

const base: ProspectParaScore = { category: null, reviews: null };

describe("a nota de uma empresa", () => {
  it("sem nada a favor, nota zero e o aviso de que o site não foi analisado", () => {
    expect(pontuar(base, null)).toEqual({
      nota: 0,
      itens: [],
      anuncio: null,
      semAnaliseDoSite: true,
    });
  });

  it("porte da Receita: DEMAIS 20, EPP 12, ME 6, e porte desconhecido não pontua", () => {
    expect(pontuar({ ...base, porte: "DEMAIS" }, null).nota).toBe(20);
    expect(pontuar({ ...base, porte: "EPP" }, null).nota).toBe(12);
    expect(pontuar({ ...base, porte: "ME" }, null).nota).toBe(6);
    expect(pontuar({ ...base, porte: "XYZ" }, null).itens).toEqual([]);
    expect(pontuar({ ...base, porte: "EPP" }, null).itens[0]?.motivo).toBe(
      MOTIVOS_DO_SCORE.porte_EPP,
    );
  });

  it("empresa do Maps achada na Receita ganha o porte, com a razão social de detalhe", () => {
    const receita = {
      cnpj: "22222222000102",
      razao_social: "IMPERIO DAS AVES LTDA",
      porte: "EPP",
      criterio: "telefone" as const,
    };
    expect(pontuar({ ...base, analise: { ...analise([]), receita } }, null).itens).toEqual([
      { pontos: 12, motivo: MOTIVOS_DO_SCORE.porte_EPP, detalhe: "IMPERIO DAS AVES LTDA" },
    ]);
    // o porte declarado (veio do Mercado) manda sobre o achado
    expect(
      pontuar({ ...base, porte: "DEMAIS", analise: { ...analise([]), receita } }, null).itens,
    ).toEqual([{ pontos: 20, motivo: MOTIVOS_DO_SCORE.porte_DEMAIS }]);
  });

  it("por enquanto o pixel só informa se a empresa anuncia: não soma nem tira ponto", () => {
    // Decisão do dono em 17/10/2026. Se o peso subir, este teste é o lembrete de rever a tela.
    expect(PESOS_DO_SCORE.sem_pixel_de_anuncio).toBe(0);
    expect(pontuar({ ...base, analise: analise(["sem_pixel_de_anuncio"]) }, null)).toMatchObject({
      nota: 0,
      itens: [],
      anuncio: "nao_anuncia",
    });
    expect(
      pontuar({ ...base, analise: analise(["anuncia_meta", "anuncia_google"]) }, null),
    ).toMatchObject({ nota: 0, anuncio: "anuncia" });
    // site lido sem pixel nem "sem pixel" (Gerenciador de Tags) ou sem site: não dá para afirmar
    expect(pontuar({ ...base, analise: analise([]) }, null).anuncio).toBe("indefinido");
    expect(pontuar({ ...base, analise: analise(["sem_site"], "sem_site") }, null).anuncio).toBe(
      "indefinido",
    );
  });

  it("SIF e SIE/SIM não somam: o SIF vale e o outro fica de fora", () => {
    const s = pontuar(
      { ...base, analise: analise(["registro_sif", "registro_estadual_municipal"]) },
      null,
    );
    expect(s.nota).toBe(10);
    expect(pontuar({ ...base, analise: analise(["registro_estadual_municipal"]) }, null).nota).toBe(
      5,
    );
  });

  it("site fraco conta uma vez só, venha de quantos sinais vier", () => {
    const s = pontuar(
      { ...base, analise: analise(["site_sem_https", "site_desatualizado"]) },
      null,
    );
    expect(s.itens).toEqual([{ pontos: 5, motivo: MOTIVOS_DO_SCORE.espaco_para_site }]);
    expect(pontuar({ ...base, analise: analise(["sem_site"], "sem_site") }, null).nota).toBe(5);
    expect(
      pontuar({ ...base, analise: analise(["site_fora_do_ar"], "fora_do_ar") }, null).nota,
    ).toBe(5);
  });

  it("análise na fila ainda não conta, e a empresa segue marcada como sem análise", () => {
    const s = pontuar({ ...base, analise: analise(["procura_distribuidor"], "pendente") }, null);
    expect(s).toMatchObject({ nota: 0, semAnaliseDoSite: true });
  });

  it("avaliações no Maps: a partir de 20, com o número como detalhe", () => {
    expect(pontuar({ ...base, reviews: 19 }, null).nota).toBe(0);
    expect(pontuar({ ...base, reviews: 20 }, null).itens).toEqual([
      { pontos: 5, motivo: MOTIVOS_DO_SCORE.avaliacoes_no_maps, detalhe: "20" },
    ]);
  });

  it("gosto: o Gostei da própria empresa, ou a categoria aprovada (sem acento e caixa)", () => {
    expect(
      pontuar({ ...base, avaliacao: { nota: "gostei", motivo: null, em: "x", por: null } }, null)
        .itens[0]?.motivo,
    ).toBe(MOTIVOS_DO_SCORE.gostei);
    const perfil = perfilAprendido([
      { categoria: "Fábrica de massas", nota: "gostei", origem: "avaliacao" },
      { categoria: "Padaria", nota: "gostei", origem: "avaliacao" },
      { categoria: "Padaria", nota: "nao_gostei", origem: "avaliacao" },
    ]);
    expect(pontuar({ ...base, category: "FABRICA DE MASSAS" }, perfil).itens).toEqual([
      { pontos: 10, motivo: MOTIVOS_DO_SCORE.categoria_aprovada, detalhe: "Fábrica de massas" },
    ]);
    // empate entre gostei e não gostei não é aprovação
    expect(pontuar({ ...base, category: "Padaria" }, perfil).nota).toBe(0);
    // quem o dono marcou como não gostei não ganha o ponto da categoria
    expect(
      pontuar(
        {
          ...base,
          category: "Fábrica de massas",
          avaliacao: { nota: "nao_gostei", motivo: null, em: "x", por: null },
        },
        perfil,
      ).nota,
    ).toBe(0);
  });

  it("com tudo a favor a nota é 85 (a soma da tabela aprovada), e nunca passa de 100", () => {
    const maximo =
      Math.max(...Object.values(PESOS_DO_SCORE.porte)) +
      PESOS_DO_SCORE.procura_distribuidor +
      PESOS_DO_SCORE.vagas_comerciais +
      PESOS_DO_SCORE.registro_sif +
      PESOS_DO_SCORE.vende_em_varejo +
      PESOS_DO_SCORE.sem_pixel_de_anuncio +
      PESOS_DO_SCORE.espaco_para_site +
      PESOS_DO_SCORE.avaliacoes_no_maps +
      PESOS_DO_SCORE.gosto;
    expect(maximo).toBe(85);
    const tudo = pontuar(
      {
        category: null,
        reviews: 300,
        porte: "DEMAIS",
        avaliacao: { nota: "gostei", motivo: null, em: "x", por: null },
        analise: analise([
          "procura_distribuidor",
          "vagas_comerciais",
          "registro_sif",
          "vende_em_varejo",
          "sem_pixel_de_anuncio",
          "site_desatualizado",
        ]),
      },
      null,
    );
    expect(tudo.nota).toBe(85);
    expect(tudo.itens.reduce((t, i) => t + i.pontos, 0)).toBe(85);
    expect(tudo.anuncio).toBe("nao_anuncia");
  });
});

describe("ficar só com as melhores", () => {
  const itens = [
    { item: "a", nota: 40 },
    { item: "b", nota: 80 },
    { item: "c", nota: 60 },
    { item: "d", nota: 60 },
  ];

  it("por nota mínima", () => {
    expect(melhores(itens, { notaMinima: 60 })).toEqual(["b", "c", "d"]);
  });

  it("as N primeiras, e o empate entra pela ordem recebida", () => {
    expect(melhores(itens, { quantas: 2 })).toEqual(["b", "c"]);
  });

  it("as duas regras juntas", () => {
    expect(melhores(itens, { notaMinima: 70, quantas: 2 })).toEqual(["b"]);
  });
});
