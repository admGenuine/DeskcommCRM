import { describe, expect, it, vi } from "vitest";

import {
  custoDaResposta,
  interpretarResposta,
  leituraIaPendente,
  lerComIa,
  montarEntrada,
  type ChamarModelo,
} from "./ia";
import type { Leitura } from "./leitor";
import { leituraIaSchema, sinalSchema } from "./tipos";

const paginas = [
  {
    url: "https://serra.com.br/",
    texto: "Laticínios Serra. Queijos e iogurtes artesanais desde 1990.",
  },
  {
    url: "https://serra.com.br/parceiros",
    texto:
      "Buscamos  parceiros comerciais em todo o Sul do Brasil. Produtos com registro no Serviço de Inspeção Federal.",
  },
];

const resposta = (obj: unknown) => "```json\n" + JSON.stringify(obj) + "\n```";

describe("o que a IA respondeu", () => {
  it("só fica o sinal com trecho LITERAL da página, com o link da página onde está", () => {
    const r = interpretarResposta(
      resposta({
        resumo: "Fabrica queijos e iogurtes.",
        produtos: ["Queijos", "Iogurtes", "Queijos"],
        sinais: [
          {
            tipo: "procura_distribuidor",
            trecho: "buscamos parceiros comerciais em todo o Sul",
            pagina: 2,
          },
          // inventado: não está escrito em página nenhuma
          { tipo: "vagas_comerciais", trecho: "Estamos contratando vendedores", pagina: 2 },
          // a IA errou o número da página, mas o trecho está na outra
          { tipo: "registro_sif", trecho: "registro no Serviço de Inspeção Federal", pagina: 1 },
          // tipo fora da lista que a IA pode afirmar
          { tipo: "anuncia_meta", trecho: "Laticínios Serra", pagina: 1 },
        ],
      }),
      paginas,
      new Set(),
    );
    expect(r?.sinais.map((s) => [s.tipo, s.link, s.fonte])).toEqual([
      ["procura_distribuidor", "https://serra.com.br/parceiros", "ia"],
      ["registro_sif", "https://serra.com.br/parceiros", "ia"],
    ]);
    expect(r?.produtos).toEqual(["Queijos", "Iogurtes"]);
    for (const s of r?.sinais ?? []) expect(sinalSchema.parse(s)).toEqual(s);
  });

  it("sinal que a leitura grátis já tinha não entra de novo", () => {
    const r = interpretarResposta(
      resposta({
        sinais: [{ tipo: "procura_distribuidor", trecho: "parceiros comerciais em todo o Sul" }],
      }),
      paginas,
      new Set(["procura_distribuidor"]),
    );
    expect(r?.sinais).toEqual([]);
  });

  it("resposta sem JSON no formato é null", () => {
    expect(interpretarResposta("Não consegui ler o site.", paginas, new Set())).toBeNull();
    expect(interpretarResposta(resposta({ sinais: "nenhum" }), paginas, new Set())).toBeNull();
  });

  it("o texto enviado tem teto por página e no total", () => {
    const grande = [
      { url: "https://a.com.br/", texto: "a".repeat(9000) },
      { url: "https://a.com.br/b", texto: "b".repeat(9000) },
      { url: "https://a.com.br/c", texto: "c".repeat(9000) },
    ];
    const entrada = montarEntrada("Empresa A", grande);
    expect(entrada.match(/a/g)!.length).toBeLessThanOrEqual(5_000 + 10);
    expect(entrada.length).toBeLessThan(14_000 + 200);
  });

  it("sem preço conhecido, o custo é estimado pela tarifa de um modelo médio", () => {
    const base = { texto: "", modelo: "x", tokensDeEntrada: 4000, tokensDeSaida: 400 };
    expect(custoDaResposta({ ...base, custoCentavos: 0.6 })).toBe(0.6);
    expect(custoDaResposta({ ...base, custoCentavos: null })).toBeCloseTo(1.8, 5);
  });
});

describe("ler uma empresa com IA", () => {
  const agora = () => new Date("2026-10-18T12:00:00Z");
  const pedida = leituraIaPendente(new Date("2026-10-18T11:59:00Z"));
  const analise = {
    paginas: ["https://serra.com.br/", "https://serra.com.br/parceiros"],
    sinais: [],
  };
  const ler = async (url: string): Promise<Leitura> => {
    const p = paginas.find((x) => x.url === url);
    return p
      ? { ok: true, url, status: 200, html: `<p>${p.texto}</p>` }
      : { ok: false, url, motivo: "dns" };
  };

  it("lê as páginas da análise, chama o modelo uma vez e grava resumo, produtos e sinais novos", async () => {
    const chamarModelo = vi.fn<ChamarModelo>(async () => ({
      texto: resposta({
        resumo: "Fabrica queijos e iogurtes artesanais.",
        produtos: ["Queijos"],
        sinais: [
          { tipo: "procura_distribuidor", trecho: "parceiros comerciais em todo o Sul", pagina: 2 },
        ],
      }),
      custoCentavos: 0.62,
      modelo: "claude-haiku-4-5",
      tokensDeEntrada: 900,
      tokensDeSaida: 120,
    }));
    const r = await lerComIa("org", { name: "Laticínios Serra" }, analise, pedida, {
      ler,
      chamarModelo,
      agora,
    });
    expect(chamarModelo).toHaveBeenCalledTimes(1);
    expect(chamarModelo.mock.calls[0]![0].usuario).toContain(
      "[Página 2] https://serra.com.br/parceiros",
    );
    expect(r.leitura).toMatchObject({
      status: "ok",
      resumo: "Fabrica queijos e iogurtes artesanais.",
      produtos: ["Queijos"],
      sinais_novos: 1,
      custo_centavos: 0.62,
      modelo: "claude-haiku-4-5",
    });
    expect(r.custoCentavos).toBe(0.62);
    expect(r.sinaisNovos[0]).toMatchObject({ tipo: "procura_distribuidor", fonte: "ia" });
    expect(leituraIaSchema.parse(r.leitura)).toEqual(r.leitura);
  });

  it("site que não abre agora: não chama o modelo e não custa nada", async () => {
    const chamarModelo = vi.fn<ChamarModelo>();
    const r = await lerComIa(
      "org",
      { name: "X" },
      { paginas: ["https://fora.com.br/"], sinais: [] },
      pedida,
      { ler, chamarModelo, agora },
    );
    expect(chamarModelo).not.toHaveBeenCalled();
    expect(r).toMatchObject({ custoCentavos: 0, leitura: { status: "sem_texto" } });
  });

  it("resposta fora do formato: falha, e o custo da chamada conta", async () => {
    const r = await lerComIa("org", { name: "X" }, analise, pedida, {
      ler,
      agora,
      chamarModelo: async () => ({
        texto: "desculpe",
        custoCentavos: 0.4,
        modelo: "m",
        tokensDeEntrada: 1,
        tokensDeSaida: 1,
      }),
    });
    expect(r).toMatchObject({ custoCentavos: 0.4, leitura: { status: "falhou" } });
  });
});
