import http from "node:http";
import type { AddressInfo } from "node:net";
import zlib from "node:zlib";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { lerPagina, resolverPublico } from "./leitor";

/**
 * O leitor contra um servidor HTTP de verdade, em 127.0.0.1. A régua padrão
 * recusa 127.0.0.1 (rede interna); por isso o teste troca o resolvedor por um
 * que só conhece "empresa.test" — e recusa "interno.test", que faz o papel de
 * um endereço interno para onde um site tenta redirecionar.
 */
let porta = 0;
const servidor = http.createServer((req, res) => {
  const url = req.url ?? "/";
  if (url === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<h1>Fábrica</h1>");
  } else if (url === "/gzip") {
    res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
    res.end(zlib.gzipSync("<p>compactado</p>"));
  } else if (url === "/latin1") {
    res.writeHead(200, { "content-type": "text/html; charset=iso-8859-1" });
    res.end(Buffer.from("<p>Inspeção</p>", "latin1"));
  } else if (url === "/grande") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("x".repeat(5000));
  } else if (url === "/pdf") {
    res.writeHead(200, { "content-type": "application/pdf" });
    res.end("%PDF");
  } else if (url === "/vai") {
    res.writeHead(302, { location: "/" });
    res.end();
  } else if (url === "/interno") {
    res.writeHead(302, { location: `http://interno.test:${porta}/` });
    res.end();
  } else if (url === "/loop") {
    res.writeHead(302, { location: "/loop" });
    res.end();
  } else {
    res.writeHead(404, { "content-type": "text/html" });
    res.end("nada");
  }
});

beforeAll(async () => {
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  porta = (servidor.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => servidor.close(() => r())));

const resolver = async (host: string) => {
  if (host === "empresa.test") return [{ address: "127.0.0.1", family: 4 }];
  throw Object.assign(new Error("destino_bloqueado"), {});
};
const ler = (caminho: string, extra: object = {}) =>
  lerPagina(`http://empresa.test:${porta}${caminho}`, { resolver, portas: [porta], ...extra });

describe("leitura de página", () => {
  it("lê HTML, descompacta gzip e respeita o charset", async () => {
    expect(await ler("/")).toMatchObject({ ok: true, status: 200, html: "<h1>Fábrica</h1>" });
    expect(await ler("/gzip")).toMatchObject({ ok: true, html: "<p>compactado</p>" });
    expect(await ler("/latin1")).toMatchObject({ ok: true, html: "<p>Inspeção</p>" });
  });

  it("segue redirecionamento e devolve a URL final", async () => {
    expect(await ler("/vai")).toMatchObject({ ok: true, url: `http://empresa.test:${porta}/` });
  });

  it("recusa o que não é página, o que passa do teto e o erro HTTP", async () => {
    expect(await ler("/pdf")).toMatchObject({ ok: false, motivo: "nao_html" });
    expect(await ler("/grande", { maxBytes: 1000 })).toMatchObject({
      ok: false,
      motivo: "grande_demais",
    });
    expect(await ler("/nao-existe")).toMatchObject({
      ok: false,
      motivo: "status_http",
      status: 404,
    });
    expect(await ler("/loop")).toMatchObject({ ok: false, motivo: "redirecionamentos" });
  });

  it("redirecionamento para um destino recusado não é seguido", async () => {
    expect(await ler("/interno")).toMatchObject({ ok: false });
  });

  it("porta fora da lista e esquema que não é http não saem", async () => {
    expect(
      await lerPagina(`http://empresa.test:${porta}/`, { resolver, portas: [80, 443] }),
    ).toMatchObject({ ok: false, motivo: "destino_bloqueado" });
    expect(await lerPagina("ftp://empresa.test/", { resolver })).toMatchObject({
      ok: false,
      motivo: "url_invalida",
    });
    expect(await lerPagina("http://user:senha@empresa.test/", { resolver })).toMatchObject({
      ok: false,
      motivo: "url_invalida",
    });
  });
});

describe("régua padrão de destino", () => {
  it("recusa IP de rede interna e de metadados, aceita IP público literal", async () => {
    await expect(resolverPublico("127.0.0.1")).rejects.toThrow("destino_bloqueado");
    await expect(resolverPublico("10.0.0.5")).rejects.toThrow("destino_bloqueado");
    await expect(resolverPublico("169.254.169.254")).rejects.toThrow("destino_bloqueado");
    await expect(resolverPublico("::1")).rejects.toThrow("destino_bloqueado");
    await expect(resolverPublico("8.8.8.8")).resolves.toEqual([{ address: "8.8.8.8", family: 4 }]);
  });

  it("a leitura padrão não alcança o servidor local", async () => {
    expect(await lerPagina(`http://127.0.0.1:${porta}/`, { portas: [porta] })).toMatchObject({
      ok: false,
      motivo: "destino_bloqueado",
    });
  });
});
