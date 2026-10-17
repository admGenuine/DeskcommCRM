import { describe, expect, it } from "vitest";

import { analisarEmpresa } from "./analisar";
import type { Leitura } from "./leitor";
import { analiseSchema } from "./tipos";

const PEDIDA = "2026-10-17T12:00:00.000Z";
const agora = () => new Date("2026-10-17T12:05:00.000Z");

function leitorFalso(paginas: Record<string, string | Leitura>) {
  const lidas: string[] = [];
  const ler = async (url: string): Promise<Leitura> => {
    lidas.push(url);
    const p = paginas[url];
    if (p === undefined) return { ok: false, url, motivo: "status_http", status: 404 };
    return typeof p === "string" ? { ok: true, url, status: 200, html: p } : p;
  };
  return { ler, lidas };
}

describe("análise de uma empresa", () => {
  it("sem site no Maps nem e-mail próprio: 'sem site', sem ler nada", async () => {
    const { ler, lidas } = leitorFalso({});
    const a = await analisarEmpresa(
      { name: "Massas X", website: null, emails: ["x@gmail.com"] },
      PEDIDA,
      { ler, agora },
    );
    expect(a.status).toBe("sem_site");
    expect(a.sinais.map((s) => s.tipo)).toEqual(["sem_site"]);
    expect(lidas).toEqual([]);
    expect(analiseSchema.parse(a)).toEqual(a);
  });

  it("site do Maps que não abre é 'site fora do ar', com o motivo", async () => {
    const { ler } = leitorFalso({
      "https://massasx.com.br/": { ok: false, url: "https://massasx.com.br/", motivo: "dns" },
    });
    const a = await analisarEmpresa(
      { name: "Massas X", website: "massasx.com.br", emails: [] },
      PEDIDA,
      { ler, agora },
    );
    expect(a.status).toBe("fora_do_ar");
    expect(a.sinais[0]).toMatchObject({ tipo: "site_fora_do_ar", link: "https://massasx.com.br/" });
    expect(a.sinais[0]?.evidencia).toContain("o domínio não existe ou não responde");
  });

  it("domínio de e-mail que abre o site do contador não é usado", async () => {
    const { ler, lidas } = leitorFalso({
      "https://contabil.com.br/": "<p>Escritório de contabilidade desde 1980</p>",
    });
    const a = await analisarEmpresa(
      {
        name: "Laticínios Serra",
        razao_social: "LATICINIOS SERRA LTDA",
        website: null,
        emails: ["fiscal@contabil.com.br"],
      },
      PEDIDA,
      { ler, agora },
    );
    expect(a).toMatchObject({ status: "sem_site", site: null, sinais: [] });
    expect(a.observacao).toContain("contador");
    expect(lidas).toEqual(["https://contabil.com.br/"]);
  });

  it("Instagram no lugar do site: vira perfil e 'sem site', sem tentar ler", async () => {
    const { ler, lidas } = leitorFalso({});
    const a = await analisarEmpresa(
      {
        name: "Fábrica do Queijo",
        website: "https://www.instagram.com/fabricadoqueijo/",
        emails: [],
      },
      PEDIDA,
      { ler, agora },
    );
    expect(a.status).toBe("sem_site");
    expect(a.perfil.instagram).toBe("https://www.instagram.com/fabricadoqueijo/");
    expect(a.sinais[0]).toMatchObject({
      tipo: "sem_site",
      link: "https://www.instagram.com/fabricadoqueijo/",
    });
    expect(a.sinais[0]?.evidencia).toContain("Instagram");
    expect(lidas).toEqual([]);
  });

  it("página de pedidos no lugar do site: 'sem site', com a plataforma na prova", async () => {
    const { ler } = leitorFalso({});
    const a = await analisarEmpresa(
      { name: "Top Massas", website: "https://toppaodequeijo.pedidoon.net/", emails: [] },
      PEDIDA,
      { ler, agora },
    );
    expect(a.status).toBe("sem_site");
    expect(a.sinais[0]?.evidencia).toContain("pedidoon.net");
  });

  it("http no Maps, mas o site tem cadeado: lê pelo https e não acusa 'sem cadeado'", async () => {
    const { ler, lidas } = leitorFalso({
      "https://galiza.com.br/":
        "<title>Galiza Distribuidora</title><p>Distribuição de alimentos</p>",
      "http://galiza.com.br/": "<p>Galiza</p>",
    });
    const a = await analisarEmpresa(
      { name: "Galiza Distribuidora", website: "http://galiza.com.br/", emails: [] },
      PEDIDA,
      { ler, agora },
    );
    expect(lidas[0]).toBe("https://galiza.com.br/");
    expect(a.site?.url).toBe("https://galiza.com.br/");
    expect(a.sinais.map((s) => s.tipo)).not.toContain("site_sem_https");
  });

  it("sem https que abra, o http lido é 'sem cadeado' de verdade", async () => {
    const { ler } = leitorFalso({
      "https://galiza.com.br/": { ok: false, url: "https://galiza.com.br/", motivo: "conexao" },
      "http://galiza.com.br/": "<title>Galiza</title><p>Distribuição de alimentos</p>",
    });
    const a = await analisarEmpresa(
      { name: "Galiza Distribuidora", website: "http://galiza.com.br/", emails: [] },
      PEDIDA,
      { ler, agora },
    );
    expect(a.sinais.map((s) => s.tipo)).toContain("site_sem_https");
  });

  it("site que abre só com um aviso de suspenso é 'site fora do ar'", async () => {
    const { ler } = leitorFalso({
      "https://massasx.com.br/": "<h1>Este site está temporariamente indisponível.</h1>",
    });
    const a = await analisarEmpresa(
      { name: "Massas X", website: "https://massasx.com.br/", emails: [] },
      PEDIDA,
      { ler, agora },
    );
    expect(a.status).toBe("fora_do_ar");
    expect(a.sinais[0]?.evidencia).toContain("temporariamente indisponível");
  });

  it("site conferido: lê a home e as páginas de interesse, e junta os sinais", async () => {
    const { ler, lidas } = leitorFalso({
      "https://serra.com.br/": `<title>Laticínios Serra</title>
        <a href="/seja-distribuidor">Seja um distribuidor</a>
        <a href="https://instagram.com/laticiniosserra">Instagram</a>
        <footer>S.I.F. 4321 · © 2020</footer>`,
      "https://serra.com.br/seja-distribuidor": `<p>Vagas: contratamos vendedores externos.</p>`,
    });
    const a = await analisarEmpresa(
      { name: "Laticínios Serra", website: null, emails: ["vendas@serra.com.br"] },
      PEDIDA,
      { ler, agora },
    );
    expect(a.status).toBe("ok");
    expect(a.site).toEqual({ url: "https://serra.com.br/", origem: "email" });
    expect(lidas).toEqual(["https://serra.com.br/", "https://serra.com.br/seja-distribuidor"]);
    expect(a.sinais.map((s) => s.tipo).sort()).toEqual(
      [
        "procura_distribuidor",
        "registro_sif",
        "sem_pixel_de_anuncio",
        "site_desatualizado",
        "vagas_comerciais",
      ].sort(),
    );
    expect(a.perfil.instagram).toBe("https://instagram.com/laticiniosserra");
    expect(a.paginas).toHaveLength(2);
    expect(analiseSchema.parse(a)).toEqual(a);
  });
});
