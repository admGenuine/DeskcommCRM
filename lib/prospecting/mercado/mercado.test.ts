import { describe, expect, it } from "vitest";

import { descreverFiltros } from "./campanha";
import { filtrosDoMercadoSchema, ondeDoMercado } from "./filtros";
import { prospectDoMercado, vereditoDoMercado, type LinhaDoMercado } from "./prospect";

const f = (x: object = {}) => filtrosDoMercadoSchema.parse(x);

describe("filtros do mercado", () => {
  it("o padrão pede telefone e atividade principal, com todos os portes", () => {
    expect(f()).toEqual({
      portes: ["ME", "EPP", "DEMAIS", "NAO_INFORMADO"],
      idade_minima_anos: 0,
      com_telefone: true,
      so_principal: true,
      so_matriz: false,
    });
    const { onde, params } = ondeDoMercado(f());
    expect(onde).toBe(
      "m.recorte_pela_principal and m.porte = any($2::text[]) and (m.telefone1 is not null or m.telefone2 is not null)",
    );
    expect(params).toEqual([["ME", "EPP", "DEMAIS", "NAO_INFORMADO"]]);
  });

  it("cada filtro vira um parâmetro, na ordem, a partir de $2", () => {
    const { onde, params } = ondeDoMercado(
      f({
        uf: "PR",
        municipio: "Curitiba",
        grupo: "105",
        portes: ["DEMAIS"],
        idade_minima_anos: 5,
        so_matriz: true,
      }),
    );
    expect(onde).toContain("m.uf = $2");
    expect(onde).toContain("upper(m.municipio) = upper($3)");
    expect(onde).toContain("m.cnae_principal like $4");
    expect(onde).toContain("m.porte = any($5::text[])");
    expect(onde).toContain("make_interval(years => $6::int)");
    expect(onde).toContain("m.matriz");
    expect(params).toEqual(["PR", "Curitiba", "105%", ["DEMAIS"], 5]);
  });

  it("grupo com atividade secundária olha a lista de secundárias também", () => {
    const { onde } = ondeDoMercado(f({ grupo: "101", so_principal: false }));
    expect(onde).toContain("unnest(m.cnaes_secundarios)");
    expect(onde).not.toContain("recorte_pela_principal");
  });

  it("consulta sem a organização começa em $1", () => {
    expect(ondeDoMercado(f({ uf: "SC" }), 1).onde).toContain("m.uf = $1");
  });

  it.each([
    { uf: "pr" },
    { grupo: "111" },
    { portes: [] },
    { portes: ["MEI"] },
    { organization_id: "x" },
  ])("recusa %j", (x) => {
    expect(filtrosDoMercadoSchema.safeParse(x).success).toBe(false);
  });

  it("o nome da campanha descreve o filtro", () => {
    expect(descreverFiltros(f())).toEqual({
      segmento: "Indústrias de alimentos",
      local: "PR e SC",
    });
    expect(descreverFiltros(f({ grupo: "105", uf: "PR", municipio: "LONDRINA" }))).toEqual({
      segmento: "Laticínios",
      local: "LONDRINA, PR",
    });
  });
});

const linha = (x: Partial<LinhaDoMercado> = {}): LinhaDoMercado => ({
  cnpj: "19518682000157",
  razao_social: "PRESTO ALIMENTOS LTDA",
  nome_fantasia: "PRESTO ALIMENTOS",
  cnae_principal: "1099699",
  cnae_principal_descricao: "Fabricação de outros produtos alimentícios",
  uf: "SC",
  municipio: "PALHOCA",
  bairro: "CENTRO",
  cep: "88130000",
  endereco: "RUA DAS FLORES 100",
  telefone1: "4832860000",
  telefone2: "48999990000",
  email: "contato@presto.com.br",
  porte: "DEMAIS",
  capital_social_centavos: "9000000",
  ...x,
});

describe("empresa do mercado vira candidato", () => {
  it("chave por CNPJ, nome fantasia, celular antes de fixo, endereço montado", () => {
    const p = prospectDoMercado(linha());
    expect(p).toMatchObject({
      key: "cnpj:19518682000157",
      name: "PRESTO ALIMENTOS",
      phone: "+5548999990000",
      phone_kind: "celular",
      category: "Fabricação de outros produtos alimentícios",
      address: "RUA DAS FLORES 100, CENTRO, PALHOCA - SC, 88130000",
      state_code: "SC",
      country_code: "BR",
      emails: ["contato@presto.com.br"],
      fonte: "mercado",
      cnpj: "19518682000157",
      porte: "DEMAIS",
    });
    expect(vereditoDoMercado(p)).toEqual({ aprovado: true });
  });

  it("sem fantasia usa a razão social; só fixo vale", () => {
    const p = prospectDoMercado(linha({ nome_fantasia: null, telefone2: null }));
    expect(p.name).toBe("PRESTO ALIMENTOS LTDA");
    expect(p).toMatchObject({ phone: "+554832860000", phone_kind: "fixo" });
  });

  it("sem telefone, ou só telefone inválido, sai com o motivo", () => {
    const sem = prospectDoMercado(linha({ telefone1: null, telefone2: null }));
    expect(vereditoDoMercado(sem)).toEqual({ aprovado: false, motivo: "Sem telefone na Receita." });
    const invalido = prospectDoMercado(linha({ telefone1: "8001234567", telefone2: null }));
    expect(invalido.phone).toBeNull();
    expect(vereditoDoMercado(invalido)).toMatchObject({ aprovado: false });
  });
});
