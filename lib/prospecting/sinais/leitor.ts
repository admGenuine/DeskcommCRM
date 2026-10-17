/**
 * Lê uma página pública da internet com as guardas de saída da casa.
 *
 * O endereço vem de fora (o site que o Maps devolveu, o domínio de um e-mail da
 * Receita), então a leitura é tratada como a de um webhook de saída:
 *
 *   - só http e https, só nas portas 80 e 443, sem usuário e senha na URL;
 *   - o nome é resolvido ANTES da conexão e recusado se QUALQUER endereço for
 *     privado, de rede interna ou especial (`ipEhEspecial`, a mesma régua dos
 *     webhooks);
 *   - a conexão usa SÓ os endereços conferidos (`lookup` fixado), o que fecha a
 *     janela de rebinding entre a conferência e a conexão — mesma técnica de
 *     `lib/extensions/download.ts`. O nome continua indo no SNI e no Host;
 *   - redirecionamento é seguido à mão, até 4, e cada salto passa por tudo de novo;
 *   - teto de tamanho (já descompactado) e de tempo, e só HTML.
 *
 * Nada aqui lança: o resultado diz o que houve, para a análise registrar o motivo.
 */
import http from "node:http";
import https from "node:https";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { isIP } from "node:net";
import zlib from "node:zlib";

import { ipEhEspecial } from "@/lib/automation/outbound-ip";

export type MotivoDaFalha =
  | "url_invalida"
  | "destino_bloqueado"
  | "dns"
  | "tempo"
  | "conexao"
  | "status_http"
  | "nao_html"
  | "grande_demais"
  | "redirecionamentos";

export type Leitura =
  | { ok: true; url: string; status: number; html: string }
  | { ok: false; url: string; motivo: MotivoDaFalha; status?: number };

export interface OpcoesDeLeitura {
  timeoutMs?: number;
  maxBytes?: number;
  /** Resolve e CONFERE o nome; lança `destino_bloqueado` ou `dns`. Trocável no teste. */
  resolver?: (host: string) => Promise<LookupAddress[]>;
  /** Portas aceitas. Só o teste muda (servidor local em porta alta). */
  portas?: number[];
}

const PADRAO = { timeoutMs: 8000, maxBytes: 1_500_000, portas: [80, 443] };
const MAX_REDIRECIONAMENTOS = 4;
const AGENTE =
  "Mozilla/5.0 (compatible; ProspeccaoB2B/1.0; leitura de site institucional para prospecção comercial)";

class FalhaDeLeitura extends Error {
  constructor(
    readonly motivo: MotivoDaFalha,
    readonly status?: number,
  ) {
    super(motivo);
  }
}

/** A régua padrão: resolve tudo e recusa se algum endereço for especial. */
export async function resolverPublico(host: string): Promise<LookupAddress[]> {
  if (isIP(host)) {
    if (ipEhEspecial(host)) throw new FalhaDeLeitura("destino_bloqueado");
    return [{ address: host, family: isIP(host) }];
  }
  const enderecos = await new Promise<LookupAddress[]>((resolve, reject) =>
    dnsLookup(host, { all: true, verbatim: true }, (err, addrs) =>
      err ? reject(new FalhaDeLeitura("dns")) : resolve(addrs),
    ),
  );
  if (!enderecos.length) throw new FalhaDeLeitura("dns");
  if (enderecos.some((e) => ipEhEspecial(e.address))) throw new FalhaDeLeitura("destino_bloqueado");
  return enderecos;
}

function lookupFixado(esperado: string, enderecos: LookupAddress[]) {
  return (
    hostname: string,
    options: { all?: boolean },
    callback: (
      err: NodeJS.ErrnoException | null,
      address: string | LookupAddress[],
      family?: number,
    ) => void,
  ) => {
    if (hostname !== esperado) {
      callback(Object.assign(new Error("Hostname inesperado."), { code: "EHOSTUNREACH" }), "", 0);
      return;
    }
    if (options.all) {
      callback(null, enderecos);
      return;
    }
    const primeiro = enderecos[0]!;
    callback(null, primeiro.address, primeiro.family);
  };
}

function conferirUrl(bruta: string, portas: number[]): URL {
  let u: URL;
  try {
    u = new URL(bruta);
  } catch {
    throw new FalhaDeLeitura("url_invalida");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new FalhaDeLeitura("url_invalida");
  if (u.username || u.password) throw new FalhaDeLeitura("url_invalida");
  const porta = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
  if (!portas.includes(porta)) throw new FalhaDeLeitura("destino_bloqueado");
  return u;
}

function charsetDe(contentType: string, inicio: Uint8Array): string {
  const doCabecalho = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  if (doCabecalho) return doCabecalho.toLowerCase();
  const ascii = new TextDecoder("latin1").decode(inicio.subarray(0, 4096));
  return /<meta[^>]+charset=["']?([\w-]+)/i.exec(ascii)?.[1]?.toLowerCase() ?? "utf-8";
}

function decodificar(corpo: Uint8Array, contentType: string): string {
  const charset = charsetDe(contentType, corpo);
  try {
    return new TextDecoder(charset === "iso-8859-1" ? "latin1" : charset).decode(corpo);
  } catch {
    return new TextDecoder("utf-8").decode(corpo);
  }
}

function umPedido(
  u: URL,
  enderecos: LookupAddress[],
  opcoes: Required<Omit<OpcoesDeLeitura, "resolver">>,
  sinal: AbortSignal,
): Promise<{ status: number; location?: string; contentType: string; corpo?: Uint8Array }> {
  return new Promise((resolve, reject) => {
    const modulo = u.protocol === "https:" ? https : http;
    const req = modulo.request(
      u,
      {
        method: "GET",
        signal: sinal,
        lookup: lookupFixado(u.hostname.replace(/^\[|\]$/g, ""), enderecos) as never,
        headers: {
          "user-agent": AGENTE,
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
          "accept-encoding": "gzip, deflate, br",
          "accept-language": "pt-BR,pt;q=0.9",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const contentType = String(res.headers["content-type"] ?? "");
        if (status >= 300 && status < 400) {
          res.resume();
          resolve({ status, location: res.headers.location, contentType });
          return;
        }
        if (status !== 200) {
          res.resume();
          resolve({ status, contentType });
          return;
        }
        if (contentType && !/text\/html|application\/xhtml/i.test(contentType)) {
          res.destroy();
          reject(new FalhaDeLeitura("nao_html", status));
          return;
        }
        const codificacao = String(res.headers["content-encoding"] ?? "identity").toLowerCase();
        const fluxo =
          codificacao === "gzip" || codificacao === "x-gzip"
            ? res.pipe(zlib.createGunzip())
            : codificacao === "deflate"
              ? res.pipe(zlib.createInflate())
              : codificacao === "br"
                ? res.pipe(zlib.createBrotliDecompress())
                : res;
        const pedacos: Buffer[] = [];
        let total = 0;
        fluxo.on("data", (chunk: Buffer) => {
          total += chunk.byteLength;
          if (total > opcoes.maxBytes) {
            res.destroy();
            fluxo.destroy();
            reject(new FalhaDeLeitura("grande_demais", status));
            return;
          }
          pedacos.push(chunk);
        });
        fluxo.on("end", () =>
          resolve({ status, contentType, corpo: new Uint8Array(Buffer.concat(pedacos)) }),
        );
        fluxo.on("error", () => reject(new FalhaDeLeitura("conexao", status)));
      },
    );
    req.on("error", (err: NodeJS.ErrnoException) => {
      if (err instanceof FalhaDeLeitura) reject(err);
      else if (sinal.aborted || err.name === "AbortError") reject(new FalhaDeLeitura("tempo"));
      else reject(new FalhaDeLeitura("conexao"));
    });
    req.end();
  });
}

export async function lerPagina(url: string, opcoesIn: OpcoesDeLeitura = {}): Promise<Leitura> {
  const opcoes = {
    timeoutMs: opcoesIn.timeoutMs ?? PADRAO.timeoutMs,
    maxBytes: opcoesIn.maxBytes ?? PADRAO.maxBytes,
    portas: opcoesIn.portas ?? PADRAO.portas,
  };
  const resolver = opcoesIn.resolver ?? resolverPublico;
  const sinal = AbortSignal.timeout(opcoes.timeoutMs);
  let atual = url;
  try {
    for (let salto = 0; salto <= MAX_REDIRECIONAMENTOS; salto++) {
      const u = conferirUrl(atual, opcoes.portas);
      const enderecos = await resolver(u.hostname.replace(/^\[|\]$/g, ""));
      const r = await umPedido(u, enderecos, opcoes, sinal);
      if (r.status >= 300 && r.status < 400) {
        if (!r.location) return { ok: false, url: atual, motivo: "status_http", status: r.status };
        atual = new URL(r.location, u).toString();
        continue;
      }
      if (r.status !== 200 || !r.corpo)
        return { ok: false, url: atual, motivo: "status_http", status: r.status };
      return {
        ok: true,
        url: u.toString(),
        status: r.status,
        html: decodificar(r.corpo, r.contentType),
      };
    }
    return { ok: false, url: atual, motivo: "redirecionamentos" };
  } catch (err) {
    if (err instanceof FalhaDeLeitura)
      return { ok: false, url: atual, motivo: err.motivo, status: err.status };
    if (sinal.aborted) return { ok: false, url: atual, motivo: "tempo" };
    return { ok: false, url: atual, motivo: "conexao" };
  }
}
