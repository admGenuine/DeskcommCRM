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

Saída (JSON na saída padrão): o mês escolhido, a URL da pasta dele, o usuário
para autenticação básica (vazio quando o caminho não pede) e os .zip da pasta.

  python3 listar_receita.py               # o mês mais recente
  python3 listar_receita.py --mes 2026-09

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


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--mes", default="", help="AAAA-MM; vazio = o mais recente com .zip")
    a = p.parse_args(argv)

    url, usuario, itens = raiz()
    candidatos = [a.mes] if a.mes else meses(itens)
    if not candidatos:
        raise SystemExit(f"Não há pasta de mês em {url}: {itens[:20]}")
    for mes in candidatos:
        pasta = f"{url}{mes}/"
        arquivos = zips(itens_do_propfind(propfind(pasta, usuario)))
        if arquivos:
            print(json.dumps({"mes": mes, "url": pasta, "usuario": usuario or "", "arquivos": arquivos}))
            return 0
    raise SystemExit(f"Nenhuma pasta de mês com .zip em {url} (tentei {candidatos[:3]}).")


if __name__ == "__main__":
    sys.exit(main())
