/**
 * AS REGRAS DA META PARA UM MODELO (fork da Genuine, 2026-11-13).
 *
 * Cada caso é uma regra da documentação da Cloud API (ver o cabeçalho de
 * `lib/channels/regras-do-modelo.ts`), medida dos dois lados: o pedido que a
 * Meta aceita passa sem problema, e o que ela recusa trava com o código certo.
 */
import { describe, expect, it } from "vitest";

import {
  comBotoesDoFormulario,
  lerAutenticacao,
  montarAutenticacao,
  podeApagar,
  podeEditar,
  podeTrocarCategoria,
  textoDaAutenticacao,
  TEXTO_DO_PROBLEMA,
  travaOEnvio,
  validarModelo,
  type PedidoDeModelo,
} from "@/lib/channels/regras-do-modelo";
import { montarComponents, type BotaoDaDefinicao } from "@/lib/channels/template-conteudo";

/** Um modelo de utilidade completo e válido, com variável, cabeçalho, rodapé e botões. */
function valido(extra: Partial<PedidoDeModelo> = {}): PedidoDeModelo {
  return {
    name: "pedido_enviado_v2",
    language: "pt_BR",
    category: "UTILITY",
    components: montarComponents({
      body: "Olá {{1}}, seu pedido {{2}} saiu para entrega.",
      exemplos: ["Maria", "12345"],
      footer: "Loja Exemplo",
      cabecalho: { texto: "Pedido {{1}}", exemplo: "12345" },
      botoes: [
        {
          tipo: "url",
          texto: "Rastrear",
          url: "https://loja.com.br/rastreio/{{1}}",
          exemplo: "12345",
        },
        { tipo: "phone_number", texto: "Falar com a loja", telefone: "+5541999990000" },
        { tipo: "quick_reply", texto: "Recebi" },
      ],
    }),
    ...extra,
  };
}

const codigos = (p: PedidoDeModelo) => validarModelo(p).map((x) => x.codigo);

/** O pedido válido com os botões trocados, exatamente como digitados na tela. */
const comBotoes = (botoes: BotaoDaDefinicao[]) =>
  valido({ components: comBotoesDoFormulario(valido().components, botoes) });

describe("o pedido que a Meta aceita passa sem problema", () => {
  it("utilidade com variáveis, exemplos, cabeçalho, rodapé e os três tipos de botão", () => {
    expect(validarModelo(valido())).toEqual([]);
  });

  it("cada problema tem frase para a tela", () => {
    for (const [codigo, frase] of Object.entries(TEXTO_DO_PROBLEMA))
      expect(frase, codigo).toBeTruthy();
  });
});

describe("nome, idioma e categoria", () => {
  it("nome só com minúsculas, números e _, até 512", () => {
    expect(codigos(valido({ name: "" }))).toContain("nome_vazio");
    expect(codigos(valido({ name: "Pedido Enviado" }))).toContain("nome_formato");
    expect(codigos(valido({ name: "pedido-enviado" }))).toContain("nome_formato");
    expect(codigos(valido({ name: "promoção" }))).toContain("nome_formato");
    expect(codigos(valido({ name: "a".repeat(513) }))).toContain("nome_longo");
    expect(codigos(valido({ name: "a".repeat(512) }))).toEqual([]);
  });

  it("idioma e categoria obrigatórios, e só as três categorias", () => {
    expect(codigos(valido({ language: "" }))).toContain("idioma_vazio");
    expect(codigos(valido({ category: "SERVICE" }))).toContain("categoria_invalida");
  });
});

describe("corpo e variáveis", () => {
  const corpo = (texto: string, exemplos: string[]) =>
    valido({ components: montarComponents({ body: texto, exemplos }) });

  it("corpo obrigatório e até 1.024 caracteres", () => {
    expect(codigos(corpo("", []))).toContain("corpo_vazio");
    expect(codigos(corpo("a".repeat(1025), []))).toContain("corpo_longo");
    expect(codigos(corpo("a".repeat(1024), []))).toEqual([]);
  });

  it("variáveis numeradas, começando em 1 e sem buraco", () => {
    expect(codigos(corpo("Olá {{nome}}, tudo bem?", ["Ana"]))).toContain("variavel_formato");
    expect(codigos(corpo("Olá {{1}} e {{3}}, tudo bem?", ["a", "b", "c"]))).toContain(
      "variavel_fora_de_ordem",
    );
    expect(codigos(corpo("Olá {{2}}, tudo bem?", ["a", "b"]))).toContain("variavel_fora_de_ordem");
    // Repetir a mesma variável é permitido.
    expect(codigos(corpo("Olá {{1}}, {{1}} de novo, tudo bem?", ["Ana"]))).toEqual([]);
  });

  it("toda variável precisa de exemplo: vazio trava", () => {
    expect(codigos(corpo("Olá {{1}}, seu código é {{2}}.", ["Ana", ""]))).toContain(
      "exemplo_vazio",
    );
    expect(codigos(corpo("Olá {{1}}, seu código é {{2}}.", ["Ana"]))).toContain("exemplo_vazio");
  });

  it("variável no começo ou no fim só AVISA: a documentação não confirma a regra", () => {
    const comeco = validarModelo(corpo("{{1}}, seu pedido saiu.", ["Ana"]));
    expect(comeco).toEqual([{ codigo: "variavel_nas_pontas", aviso: true }]);
    expect(travaOEnvio(comeco)).toBe(false);
    expect(codigos(corpo("Seu código é {{1}}.", ["1234"]))).toEqual(["variavel_nas_pontas"]);
  });
});

describe("cabeçalho e rodapé", () => {
  const com = (cabecalho: { texto?: string; exemplo?: string; midiaUrl?: string }, footer = "") =>
    valido({
      components: montarComponents({ body: "Corpo fixo.", exemplos: [], cabecalho, footer }),
    });

  it("cabeçalho de texto: até 60 caracteres e no máximo a variável {{1}}, com exemplo", () => {
    expect(codigos(com({ texto: "a".repeat(61) }))).toContain("cabecalho_longo");
    expect(codigos(com({ texto: "Oi {{1}} e {{2}}", exemplo: "x" }))).toContain(
      "cabecalho_variaveis",
    );
    expect(codigos(com({ texto: "Pedido {{1}}", exemplo: "" }))).toContain(
      "cabecalho_exemplo_vazio",
    );
    expect(codigos(com({ texto: "Pedido {{1}}", exemplo: "123" }))).toEqual([]);
  });

  it("cabeçalho de imagem precisa da imagem", () => {
    const semImagem = valido({
      components: [
        { type: "HEADER", format: "IMAGE", example: { header_handle: [""] } },
        { type: "BODY", text: "Corpo fixo." },
      ],
    });
    expect(codigos(semImagem)).toContain("cabecalho_sem_imagem");
  });

  it("rodapé até 60 caracteres e sem variável", () => {
    expect(codigos(com({}, "a".repeat(61)))).toContain("rodape_longo");
    expect(codigos(com({}, "Válido até {{1}}"))).toContain("rodape_variavel");
  });
});

describe("botões", () => {
  const resposta = (texto: string): BotaoDaDefinicao => ({ tipo: "quick_reply", texto });
  const link = (url: string, exemplo?: string): BotaoDaDefinicao => ({
    tipo: "url",
    texto: "Ver",
    url,
    exemplo,
  });
  const ligar = (telefone: string): BotaoDaDefinicao => ({
    tipo: "phone_number",
    texto: "Ligar",
    telefone,
  });

  it("até 10 no total, 2 de link, 1 de ligação, 10 de resposta rápida", () => {
    expect(codigos(comBotoes(Array.from({ length: 10 }, (_, i) => resposta(`r${i}`))))).toEqual([]);
    expect(codigos(comBotoes(Array.from({ length: 11 }, (_, i) => resposta(`r${i}`))))).toContain(
      "botoes_demais",
    );
    expect(
      codigos(comBotoes([link("https://a.com"), link("https://b.com"), link("https://c.com")])),
    ).toContain("botoes_link_demais");
    expect(codigos(comBotoes([ligar("+5541999990000"), ligar("+5541999990001")]))).toContain(
      "botoes_ligacao_demais",
    );
  });

  it("respostas rápidas agrupadas, antes ou depois dos outros", () => {
    expect(
      codigos(
        comBotoes([resposta("a"), resposta("b"), link("https://a.com"), ligar("+5541999990000")]),
      ),
    ).toEqual([]);
    expect(
      codigos(
        comBotoes([link("https://a.com"), ligar("+5541999990000"), resposta("a"), resposta("b")]),
      ),
    ).toEqual([]);
    expect(codigos(comBotoes([resposta("a"), link("https://a.com"), resposta("b")]))).toContain(
      "botoes_misturados",
    );
    expect(
      codigos(comBotoes([link("https://a.com"), resposta("a"), link("https://b.com")])),
    ).toContain("botoes_misturados");
  });

  it("texto do botão obrigatório e até 25 caracteres; o botão vazio não some sem aviso", () => {
    expect(codigos(comBotoes([resposta("")]))).toContain("botao_texto_vazio");
    expect(codigos(comBotoes([resposta("a".repeat(26))]))).toContain("botao_texto_longo");
  });

  it("link completo, até 2.000, com no máximo {{1}} no final e exemplo", () => {
    expect(codigos(comBotoes([link("")]))).toContain("botao_link_invalido");
    expect(codigos(comBotoes([link("loja.com.br")]))).toContain("botao_link_invalido");
    expect(codigos(comBotoes([link(`https://a.com/${"a".repeat(2000)}`)]))).toContain(
      "botao_link_invalido",
    );
    expect(codigos(comBotoes([link("https://a.com/{{1}}/fim", "x")]))).toContain(
      "botao_link_variavel",
    );
    expect(codigos(comBotoes([link("https://a.com/{{1}}{{2}}", "x")]))).toContain(
      "botao_link_variavel",
    );
    expect(codigos(comBotoes([link("https://a.com/{{1}}", "")]))).toContain(
      "botao_link_exemplo_vazio",
    );
    expect(codigos(comBotoes([link("https://a.com/{{1}}", "abc")]))).toEqual([]);
  });

  it("telefone com código do país e até 20 caracteres", () => {
    expect(codigos(comBotoes([ligar("41999990000")]))).toContain("botao_telefone_invalido");
    expect(codigos(comBotoes([ligar("+55 (41) 99999-0000")]))).toEqual([]);
    expect(codigos(comBotoes([ligar(`+${"1".repeat(20)}`)]))).toContain("botao_telefone_invalido");
  });
});

describe("autenticação: o formato fixo da Meta", () => {
  const auth = (components: unknown[]) => ({
    name: "codigo_acesso",
    language: "pt_BR",
    category: "AUTHENTICATION",
    components,
  });

  it("monta texto fixo, aviso de segurança, validade e botão de copiar, e passa", () => {
    const components = montarAutenticacao({
      avisoDeSeguranca: true,
      validadeMinutos: 10,
      textoDoBotao: "Copiar",
    });
    expect(components).toEqual([
      { type: "BODY", add_security_recommendation: true },
      { type: "FOOTER", code_expiration_minutes: 10 },
      { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE", text: "Copiar" }] },
    ]);
    expect(validarModelo(auth(components))).toEqual([]);
    // E o caminho de volta, para editar.
    expect(lerAutenticacao(components)).toEqual({
      avisoDeSeguranca: true,
      validadeMinutos: 10,
      textoDoBotao: "Copiar",
    });
  });

  it("validade de 1 a 90 minutos", () => {
    expect(
      codigos(
        auth(
          montarAutenticacao({ avisoDeSeguranca: false, validadeMinutos: 91, textoDoBotao: "" }),
        ),
      ),
    ).toEqual(["autenticacao_validade"]);
    expect(
      codigos(
        auth(montarAutenticacao({ avisoDeSeguranca: false, validadeMinutos: 0, textoDoBotao: "" })),
      ),
    ).toEqual(["autenticacao_validade"]);
    expect(
      codigos(
        auth(
          montarAutenticacao({ avisoDeSeguranca: false, validadeMinutos: null, textoDoBotao: "" }),
        ),
      ),
    ).toEqual([]);
  });

  it("texto próprio, cabeçalho ou outro botão são recusados", () => {
    expect(codigos(auth([{ type: "BODY", text: "Seu código é {{1}}" }]))).toContain(
      "autenticacao_formato",
    );
    expect(
      codigos(
        auth([
          { type: "BODY", add_security_recommendation: true },
          { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Ok" }] },
        ]),
      ),
    ).toContain("autenticacao_formato");
  });

  it("a prévia mostra o texto fixo", () => {
    expect(
      textoDaAutenticacao({ avisoDeSeguranca: true, validadeMinutos: 5, textoDoBotao: "" }),
    ).toEqual({
      corpo: "{{1}} é seu código de verificação. Para sua segurança, não o compartilhe.",
      rodape: "Este código expira em 5 minutos.",
    });
  });
});

describe("o que a Meta deixa fazer com um modelo existente", () => {
  it("editar: aprovado, recusado ou pausado", () => {
    expect(["APPROVED", "REJECTED", "PAUSED"].every(podeEditar)).toBe(true);
    expect(["PENDING", "DISABLED", "IN_APPEAL", "PENDING_DELETION"].some(podeEditar)).toBe(false);
  });

  it("apagar: tudo menos desativado e o que já está sendo apagado", () => {
    expect(["APPROVED", "PENDING", "REJECTED", "PAUSED"].every(podeApagar)).toBe(true);
    expect(["DISABLED", "PENDING_DELETION"].some(podeApagar)).toBe(false);
  });

  it("a categoria só muda em modelo recusado", () => {
    expect(podeTrocarCategoria("REJECTED")).toBe(true);
    expect(podeTrocarCategoria("APPROVED")).toBe(false);
  });
});
