import { describe, expect, it } from "vitest";

import { extrairSinais, linksDoHtml, paginasParaLer, textoDoHtml } from "./extrair";

const ANO = 2026;
const tipos = (html: string, url = "https://www.fabrica.com.br/") =>
  extrairSinais([{ url, html }], ANO).sinais.map((s) => s.tipo);

describe("texto e links do HTML", () => {
  it("tira script, style e comentários, e decodifica entidades", () => {
    const html = `<html><head><style>.a{}</style><script>var x = "Seja um distribuidor";</script></head>
      <body><!-- seja um distribuidor --><p>F&aacute;brica de massas &amp; molhos</p></body></html>`;
    expect(textoDoHtml(html)).toBe("Fábrica de massas & molhos .");
  });

  it("resolve links relativos e usa o title quando o link é só imagem", () => {
    const links = linksDoHtml(
      `<a href="/contato">Contato</a><a href="mailto:x@y.com">e-mail</a>
       <a title="Instagram" href="https://instagram.com/fabrica"><img src="i.png"></a>`,
      "https://www.fabrica.com.br/produtos/",
    );
    expect(links).toEqual([
      { href: "https://www.fabrica.com.br/contato", texto: "Contato" },
      { href: "https://instagram.com/fabrica", texto: "Instagram" },
    ]);
  });
});

describe("sinais com prova", () => {
  it("chamada para distribuidor, pelo texto do link ou pelo caminho de cadastro", () => {
    expect(tipos(`<a href="/contato">Seja um Distribuidor</a>`)).toContain("procura_distribuidor");
    expect(tipos(`<a href="/seja-representante">Clique aqui</a>`)).toContain(
      "procura_distribuidor",
    );
    expect(tipos(`<p>Procuramos representantes em todo o Sul.</p>`)).toContain(
      "procura_distribuidor",
    );
  });

  it("lista de distribuidores não é chamada para ser distribuidor", () => {
    expect(tipos(`<a href="/distribuidores">Nossos distribuidores</a>`)).not.toContain(
      "procura_distribuidor",
    );
  });

  it("vaga comercial precisa do cargo, não só de 'trabalhe conosco'", () => {
    expect(tipos(`<p>Trabalhe conosco: envie seu currículo.</p>`)).not.toContain(
      "vagas_comerciais",
    );
    const s = extrairSinais(
      [
        {
          url: "https://www.fabrica.com.br/trabalhe-conosco",
          html: `<h2>Vagas abertas</h2><p>Estamos contratando Representante Comercial para SC.</p>`,
        },
      ],
      ANO,
    ).sinais.find((x) => x.tipo === "vagas_comerciais");
    expect(s?.evidencia).toContain("Representante Comercial");
    expect(s?.link).toBe("https://www.fabrica.com.br/trabalhe-conosco");
  });

  it("SIF com número, e o 'sim' da língua não vira SIM", () => {
    const sif = extrairSinais(
      [{ url: "https://x.com.br/", html: "<footer>Produto inspecionado S.I.F. nº 1234</footer>" }],
      ANO,
    ).sinais.find((x) => x.tipo === "registro_sif");
    expect(sif?.evidencia).toContain("S.I.F. nº 1234");
    expect(tipos("<p>Sim, entregamos em todo o estado.</p>")).not.toContain(
      "registro_estadual_municipal",
    );
    expect(tipos("<p>Registro no Serviço de Inspeção Municipal 045</p>")).toContain(
      "registro_estadual_municipal",
    );
  });

  it("varejo: link para marketplace ou supermercado, ou 'onde comprar'", () => {
    expect(tipos(`<a href="https://www.mercadolivre.com.br/loja/fabrica">Loja</a>`)).toContain(
      "vende_em_varejo",
    );
    expect(tipos(`<a href="/pdv">Onde comprar</a>`)).toContain("vende_em_varejo");
  });

  it("pixel da Meta e tag do Google Ads; sem nenhum dos dois, 'sem pixel'", () => {
    expect(tipos(`<script>fbq('init', '123456789');</script>`)).toEqual(
      expect.arrayContaining(["anuncia_meta"]),
    );
    expect(tipos(`<script>gtag('config', 'AW-987654321');</script>`)).toContain("anuncia_google");
    expect(tipos(`<p>Massas artesanais</p>`)).toContain("sem_pixel_de_anuncio");
  });

  it("com Gerenciador de Tags, não afirma que não há pixel", () => {
    expect(
      tipos(`<script src="https://www.googletagmanager.com/gtm.js?id=GTM-ABC123"></script>`),
    ).not.toContain("sem_pixel_de_anuncio");
  });

  it("site sem cadeado e rodapé antigo", () => {
    const s = tipos(`<footer>© 2019 Fábrica</footer>`, "http://fabrica.com.br/");
    expect(s).toEqual(expect.arrayContaining(["site_sem_https", "site_desatualizado"]));
    expect(tipos(`<footer>© 2015 - 2025 Fábrica</footer>`)).not.toContain("site_desatualizado");
  });

  it("perfil: Instagram, Facebook e LinkedIn; botão de compartilhar não conta", () => {
    const { perfil } = extrairSinais(
      [
        {
          url: "https://x.com.br/",
          html: `<a href="https://www.facebook.com/sharer/sharer.php?u=x">Compartilhar</a>
                 <a href="https://www.instagram.com/massas.x/">IG</a>
                 <a href="https://www.facebook.com/massasx">FB</a>`,
        },
      ],
      ANO,
    );
    expect(perfil).toEqual({
      instagram: "https://www.instagram.com/massas.x/",
      facebook: "https://www.facebook.com/massasx",
      linkedin: null,
    });
  });

  it("um sinal aparece uma vez só, com a primeira prova", () => {
    const s = extrairSinais(
      [
        { url: "https://x.com.br/", html: `<a href="/seja-distribuidor">Seja um distribuidor</a>` },
        { url: "https://x.com.br/b", html: `<a href="/seja-revendedor">Seja um revendedor</a>` },
      ],
      ANO,
    ).sinais.filter((x) => x.tipo === "procura_distribuidor");
    expect(s).toHaveLength(1);
    expect(s[0]?.link).toBe("https://x.com.br/seja-distribuidor");
  });
});

describe("quais páginas internas ler", () => {
  it("só do mesmo site, parceria e vagas antes de 'sobre', sem arquivos", () => {
    const home = {
      url: "https://www.fabrica.com.br/",
      html: `<a href="/sobre">Sobre nós</a>
             <a href="https://outro.com.br/seja-distribuidor">Outro</a>
             <a href="/catalogo.pdf">Catálogo</a>
             <a href="/trabalhe-conosco">Trabalhe conosco</a>
             <a href="/seja-distribuidor">Seja distribuidor</a>
             <a href="/onde-comprar">Onde comprar</a>`,
    };
    expect(paginasParaLer(home, 3)).toEqual([
      "https://www.fabrica.com.br/trabalhe-conosco",
      "https://www.fabrica.com.br/seja-distribuidor",
      "https://www.fabrica.com.br/onde-comprar",
    ]);
  });
});
