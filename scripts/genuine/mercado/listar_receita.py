#!/usr/bin/env python3
"""
Onde está a base de CNPJ da Receita, e quais arquivos ela tem.

Desde fevereiro de 2026 a Receita publica os dados abertos do CNPJ num
compartilhamento público de Nextcloud em arquivos.receitafederal.gov.br, e não
mais numa pasta HTML: a página não lista os meses, quem lista é o WebDAV do
compartilhamento. A primeira execução da rotina (PR #9) caiu exatamente aí,
procurando links numa página que não tem nenhum.

O Nextcloud expõe compartilhamento público por mais de um caminho de WebDAV, e
de fora não dá para saber qual a instalação habilitou: tenta-se cada um, na
ordem, e vale o primeiro que responde 207 (Multi-Status).

E o servidor da Receita recusa conexão de fora do Brasil. Medido no runner do
GitHub (PR #9): "Connection reset by peer" em todos os caminhos, com qualquer
User-Agent, enquanto o espelho da Casa dos Dados (uma cópia mensal dos mesmos
arquivos, numa pasta HTML comum) respondeu 200. Por isso há duas fontes, na
ordem: a Receita, que é a origem, e o espelho, quando a Receita não atende.
Na VPS, que fica no Brasil, a Receita responde.

Saída (JSON na saída padrão): a fonte usada, o mês escolhido, a URL da pasta
dele, o usuário para autenticação básica (vazio quando não pede) e os .zip.

  python3 listar_receita.py                     # o mês mais recente
  python3 listar_receita.py --mes 2026-09
  python3 listar_receita.py --fonte espelho

Só biblioteca padrão.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from urllib.parse import unquote

HOST = os.environ.get("RECEITA_HOST", "https://arquivos.receitafederal.gov.br")
# O token do compartilhamento PÚBLICO da Receita (está no link que ela divulga).
TOKEN = os.environ.get("RECEITA_TOKEN", "YggdBLfdninEJX9")

VARIANTES = [
    ("/public.php/webdav/", True),
    ("/public.php/dav/files/{token}/", False),
    ("/remote.php/dav/public-files/{token}/", False),
]

PROPFIND = (
    b'<?xml version="1.0"?><d:propfind xmlns:d="DAV:">'
    b"<d:prop><d:resourcetype/></d:prop></d:propfind>"
)

MES = re.compile(r"^\d{4}-\d{2}$")

ESPELHO = os.environ.get(
    "RECEITA_ESPELHO", "https://dados-abertos-rf-cnpj.casadosdados.com.br/arquivos/"
)
PASTA_DO_ESPELHO = re.compile(r'href="(\d{4}-\d{2}-\d{2})/"')
ZIP_DO_ESPELHO = re.compile(r'href="([^"/?]+\.zip)"', re.IGNORECASE)


def itens_do_propfind(xml: bytes) -> list[tuple[str, bool]]:
    """(nome, é pasta) de cada item da resposta, sem a própria pasta consultada."""
    ns = {"d": "DAV:"}
    itens = []
    for i, r in enumerate(ET.fromstring(xml).findall("d:response", ns)):
        if i == 0:
            continue
        href = r.find("d:href", ns)
        if href is None or not href.text:
            continue
        nome = unquote(href.text).rstrip("/").split("/")[-1]
        pasta = r.find(".//d:resourcetype/d:collection", ns) is not None
        itens.append((nome, pasta))
    return itens


def meses(itens: list[tuple[str, bool]]) -> list[str]:
    return sorted({n for n, pasta in itens if pasta and MES.match(n)}, reverse=True)


def zips(itens: list[tuple[str, bool]]) -> list[str]:
    return sorted(n for n, pasta in itens if not pasta and n.lower().endswith(".zip"))


def propfind(url: str, usuario: str | None) -> bytes:
    req = urllib.request.Request(
        url,
        data=PROPFIND,
        method="PROPFIND",
        headers={"Depth": "1", "Content-Type": "text/xml", "User-Agent": "genuine-mercado"},
    )
    if usuario is not None:
        req.add_header("Authorization", "Basic " + base64.b64encode(f"{usuario}:".encode()).decode())
    with urllib.request.urlopen(req, timeout=60) as resp:
        if resp.status != 207:
            raise urllib.error.HTTPError(url, resp.status, "esperava 207", resp.headers, None)
        return resp.read()


def raiz() -> tuple[str, str | None, list[tuple[str, bool]]]:
    erros = []
    for caminho, com_usuario in VARIANTES:
        url = HOST + caminho.format(token=TOKEN)
        try:
            return url, (TOKEN if com_usuario else None), itens_do_propfind(
                propfind(url, TOKEN if com_usuario else None)
            )
        except Exception as e:  # noqa: BLE001 - qualquer falha passa para a próxima variante
            erros.append(f"{url}: {e}")
    raise SystemExit("Nenhum caminho de WebDAV da Receita respondeu: " + " ; ".join(erros))


def da_receita(mes_pedido: str) -> dict:
    url, usuario, itens = raiz()
    candidatos = [mes_pedido] if mes_pedido else meses(itens)
    if not candidatos:
        raise SystemExit(f"Não há pasta de mês em {url}: {itens[:20]}")
    for mes in candidatos:
        pasta = f"{url}{mes}/"
        arquivos = zips(itens_do_propfind(propfind(pasta, usuario)))
        if arquivos:
            return {"fonte": "receita", "mes": mes, "url": pasta, "usuario": usuario or "", "arquivos": arquivos}
    raise SystemExit(f"Nenhuma pasta de mês com .zip em {url} (tentei {candidatos[:3]}).")


def pastas_do_espelho(html: str) -> list[str]:
    """Pastas AAAA-MM-DD do índice do espelho, da mais recente para a mais antiga."""
    return sorted(set(PASTA_DO_ESPELHO.findall(html)), reverse=True)


def zips_do_espelho(html: str) -> list[str]:
    return sorted(set(ZIP_DO_ESPELHO.findall(html)))


def baixar_texto(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "genuine-mercado"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode("utf-8", errors="replace")


def do_espelho(mes_pedido: str) -> dict:
    pastas = pastas_do_espelho(baixar_texto(ESPELHO))
    if mes_pedido:
        pastas = [p for p in pastas if p.startswith(mes_pedido)]
    for pasta in pastas:
        url = f"{ESPELHO}{pasta}/"
        arquivos = zips_do_espelho(baixar_texto(url))
        if arquivos:
            return {"fonte": "espelho", "mes": pasta[:7], "url": url, "usuario": "", "arquivos": arquivos}
    raise SystemExit(f"Nenhuma pasta com .zip no espelho {ESPELHO} (mês pedido: {mes_pedido or 'o mais recente'}).")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--mes", default="", help="AAAA-MM; vazio = o mais recente com .zip")
    p.add_argument("--fonte", choices=["auto", "receita", "espelho"], default="auto")
    a = p.parse_args(argv)

    if a.fonte == "espelho":
        resultado = do_espelho(a.mes)
    else:
        try:
            resultado = da_receita(a.mes)
        except (SystemExit, Exception) as e:  # noqa: BLE001
            if a.fonte == "receita":
                raise
            print(f"A Receita não atendeu ({e}); usando o espelho.", file=sys.stderr)
            resultado = do_espelho(a.mes)
    print(json.dumps(resultado))
    return 0


if __name__ == "__main__":
    sys.exit(main())
