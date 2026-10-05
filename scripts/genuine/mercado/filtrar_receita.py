#!/usr/bin/env python3
"""
Filtra a base pública de CNPJ da Receita Federal para o recorte de mercado da
Genuine e grava um CSV pronto para a tabela `prospecting_market_companies`.

Por que existe: a prospecção pelo Maps encontra o que o Maps mostra, na ordem
dele, e paga por cada lugar. A base da Receita tem TODAS as empresas ativas,
com atividade (CNAE), porte e capital declarados, sem custo. O plano está em
docs/genuine/PLANO-PROSPECCAO.md (Fase 2).

Só biblioteca padrão: roda no runner do GitHub sem instalar nada, e lê os
arquivos em fluxo (zip -> linha -> filtro), sem descompactar em disco nem
carregar a base em memória. O que fica em memória é só o recorte.

Recorte (decisões do dono, 01 e 05/10/2026), todos configuráveis por argumento:
  - estados: PR e SC;
  - situação cadastral ativa (02);
  - CNAE da divisão 10 (fabricação de alimentos), na atividade principal OU
    numa secundária, sem 1091-1/02 (padaria e confeitaria de produção própria);
  - sem MEI (faturamento acima de cerca de R$ 100 mil por ano). O MEI vem do
    arquivo do Simples, não do porte: o porte é autodeclarado e não distingue
    MEI de ME.

Layout dos arquivos (todos com ';' como separador, aspas, latin-1, sem
cabeçalho), conforme o dicionário de dados da Receita:
  Estabelecimentos: 30 colunas (cnpj_basico, ordem, dv, matriz/filial, ...)
  Empresas:          7 colunas (cnpj_basico, razão social, natureza, ...)
  Simples:           7 colunas (cnpj_basico, opção Simples, ..., opção MEI, ...)
  Municipios, Cnaes: 2 colunas (código, descrição)

Uso:
  python3 filtrar_receita.py --dir ./receita --referencia 2026-09 \
      --saida mercado.csv --resumo resumo.json
"""
from __future__ import annotations

import argparse
import csv
import glob
import io
import json
import os
import sys
import zipfile
from collections import Counter
from typing import Iterable, Iterator

csv.field_size_limit(10**7)

# Estabelecimentos: posição de cada coluna usada.
E_BASICO, E_ORDEM, E_DV, E_MATRIZ, E_FANTASIA, E_SITUACAO = 0, 1, 2, 3, 4, 5
E_INICIO, E_CNAE, E_CNAES_SEC = 10, 11, 12
E_TIPO_LOGR, E_LOGR, E_NUMERO, E_COMPL, E_BAIRRO, E_CEP, E_UF, E_MUNICIPIO = (
    13, 14, 15, 16, 17, 18, 19, 20,
)
E_DDD1, E_TEL1, E_DDD2, E_TEL2, E_EMAIL = 21, 22, 23, 24, 27
E_COLUNAS = 30

SITUACAO_ATIVA = "02"

PORTES = {"01": "ME", "03": "EPP", "05": "DEMAIS"}
PORTE_NAO_INFORMADO = "NAO_INFORMADO"

COLUNAS_SAIDA = [
    "cnpj",
    "cnpj_basico",
    "matriz",
    "razao_social",
    "nome_fantasia",
    "data_inicio",
    "cnae_principal",
    "cnae_principal_descricao",
    "cnaes_secundarios",
    "recorte_pela_principal",
    "uf",
    "municipio_codigo",
    "municipio",
    "bairro",
    "cep",
    "endereco",
    "telefone1",
    "telefone2",
    "email",
    "porte",
    "capital_social_centavos",
    "natureza_juridica",
    "opcao_simples",
    "referencia",
]


def codificacao(inicio: bytes) -> str:
    """A documentada é latin-1; depois da mudança de infraestrutura da Receita
    (fevereiro de 2026) alguns arquivos vieram com BOM de UTF-16 ou UTF-8.
    Decide-se pelo começo do arquivo em vez de supor."""
    if inicio.startswith((b"\xff\xfe", b"\xfe\xff")):
        return "utf-16"
    if inicio.startswith(b"\xef\xbb\xbf"):
        return "utf-8-sig"
    return "latin-1"


def linhas_do_zip(caminho: str) -> Iterator[list[str]]:
    """Cada linha de cada arquivo dentro do zip, já separada em colunas.

    A base tem NUL perdido no meio de algumas linhas, e o módulo csv do Python
    recusa a linha inteira por causa dele: sai antes de chegar ao csv.
    """
    with zipfile.ZipFile(caminho) as z:
        for nome in z.namelist():
            with z.open(nome) as espiar:
                inicio = espiar.read(4)
            with z.open(nome) as bruto:
                texto = io.TextIOWrapper(bruto, encoding=codificacao(inicio), newline="", errors="replace")
                yield from csv.reader(
                    (linha.replace("\x00", "") for linha in texto),
                    delimiter=";",
                    quotechar='"',
                )


def arquivos(diretorio: str, prefixo: str) -> list[str]:
    """Zips de um tipo, sem diferenciar maiúscula ("Estabelecimentos0.zip")."""
    achados = [
        p
        for p in glob.glob(os.path.join(diretorio, "*.zip"))
        if os.path.basename(p).lower().startswith(prefixo.lower())
    ]
    return sorted(achados)


def so_digitos(texto: str) -> str:
    return "".join(c for c in texto if c.isdigit())


def telefone(ddd: str, numero: str) -> str:
    """DDD + número, só dígitos; vazio quando falta um dos dois.

    A régua de telefone de verdade (DDD existente, 0800, celular ou fixo) roda
    no app, em `lib/prospecting/aceite/telefone.ts`, quando a empresa vai para
    uma campanha. Aqui só não se inventa nada.
    """
    d, n = so_digitos(ddd).lstrip("0"), so_digitos(numero)
    if not d or not n:
        return ""
    return d + n


def data_iso(aaaammdd: str) -> str:
    d = so_digitos(aaaammdd)
    if len(d) != 8 or d == "00000000":
        return ""
    return f"{d[0:4]}-{d[4:6]}-{d[6:8]}"


def capital_em_centavos(texto: str) -> str:
    """'1000,00' -> '100000'. Vazio quando não dá para ler."""
    t = texto.strip().replace(".", "").replace(",", ".")
    if not t:
        return ""
    try:
        return str(round(float(t) * 100))
    except ValueError:
        return ""


def no_recorte(cnae: str, prefixos: tuple[str, ...], excluidos: frozenset[str]) -> bool:
    return bool(cnae) and cnae.startswith(prefixos) and cnae not in excluidos


def filtrar_estabelecimento(
    linha: list[str],
    ufs: frozenset[str],
    prefixos: tuple[str, ...],
    excluidos: frozenset[str],
) -> dict | None:
    """O estabelecimento, já no formato de saída parcial, ou None se fica fora."""
    if len(linha) < E_COLUNAS:
        return None
    if linha[E_SITUACAO].strip() != SITUACAO_ATIVA:
        return None
    uf = linha[E_UF].strip().upper()
    if uf not in ufs:
        return None
    principal = linha[E_CNAE].strip()
    secundarios = [c.strip() for c in linha[E_CNAES_SEC].split(",") if c.strip()]
    pela_principal = no_recorte(principal, prefixos, excluidos)
    if not pela_principal and not any(no_recorte(c, prefixos, excluidos) for c in secundarios):
        return None
    basico = so_digitos(linha[E_BASICO]).zfill(8)
    cnpj = basico + so_digitos(linha[E_ORDEM]).zfill(4) + so_digitos(linha[E_DV]).zfill(2)
    endereco = " ".join(
        p
        for p in (
            linha[E_TIPO_LOGR].strip(),
            linha[E_LOGR].strip(),
            linha[E_NUMERO].strip(),
            linha[E_COMPL].strip(),
        )
        if p
    )
    return {
        "cnpj": cnpj,
        "cnpj_basico": basico,
        "matriz": "true" if linha[E_MATRIZ].strip() == "1" else "false",
        "nome_fantasia": linha[E_FANTASIA].strip(),
        "data_inicio": data_iso(linha[E_INICIO]),
        "cnae_principal": principal,
        "cnaes_secundarios": "{" + ",".join(secundarios) + "}",
        "recorte_pela_principal": "true" if pela_principal else "false",
        "uf": uf,
        "municipio_codigo": linha[E_MUNICIPIO].strip(),
        "bairro": linha[E_BAIRRO].strip(),
        "cep": so_digitos(linha[E_CEP]),
        "endereco": endereco,
        "telefone1": telefone(linha[E_DDD1], linha[E_TEL1]),
        "telefone2": telefone(linha[E_DDD2], linha[E_TEL2]),
        "email": linha[E_EMAIL].strip().lower(),
    }


def tabela_de_codigos(caminhos: Iterable[str]) -> dict[str, str]:
    tabela: dict[str, str] = {}
    for caminho in caminhos:
        for linha in linhas_do_zip(caminho):
            if len(linha) >= 2:
                tabela[linha[0].strip()] = linha[1].strip()
    return tabela


def filtrar(
    diretorio: str,
    referencia: str,
    ufs: frozenset[str],
    prefixos: tuple[str, ...],
    excluidos: frozenset[str],
) -> tuple[list[dict], dict]:
    resumo: dict = {"referencia": referencia, "ufs": sorted(ufs)}

    estab_zips = arquivos(diretorio, "Estabelecimento")
    empresas_zips = arquivos(diretorio, "Empresa")
    simples_zips = arquivos(diretorio, "Simples")
    if not estab_zips:
        raise SystemExit(f"Nenhum arquivo de Estabelecimentos em {diretorio}.")
    resumo["arquivos"] = {
        "estabelecimentos": [os.path.basename(p) for p in estab_zips],
        "empresas": [os.path.basename(p) for p in empresas_zips],
        "simples": [os.path.basename(p) for p in simples_zips],
    }

    # 1. Estabelecimentos no recorte.
    lidos = 0
    recorte: list[dict] = []
    for caminho in estab_zips:
        for linha in linhas_do_zip(caminho):
            lidos += 1
            e = filtrar_estabelecimento(linha, ufs, prefixos, excluidos)
            if e:
                recorte.append(e)
    resumo["estabelecimentos_lidos"] = lidos
    resumo["no_recorte_antes_do_mei"] = len(recorte)
    basicos = {e["cnpj_basico"] for e in recorte}

    # 2. Dados da empresa (razão social, porte, capital), só das que interessam.
    empresas: dict[str, list[str]] = {}
    for caminho in empresas_zips:
        for linha in linhas_do_zip(caminho):
            if len(linha) >= 6:
                b = so_digitos(linha[0]).zfill(8)
                if b in basicos:
                    empresas[b] = linha

    # 3. Simples e MEI.
    simples: dict[str, tuple[bool, bool]] = {}
    for caminho in simples_zips:
        for linha in linhas_do_zip(caminho):
            if len(linha) >= 5:
                b = so_digitos(linha[0]).zfill(8)
                if b in basicos:
                    simples[b] = (linha[1].strip().upper() == "S", linha[4].strip().upper() == "S")

    municipios = tabela_de_codigos(arquivos(diretorio, "Municipio"))
    cnaes = tabela_de_codigos(arquivos(diretorio, "Cnae"))

    saida: list[dict] = []
    mei = sem_empresa = 0
    for e in recorte:
        b = e["cnpj_basico"]
        opcao_simples, opcao_mei = simples.get(b, (False, False))
        if opcao_mei:
            mei += 1
            continue
        empresa = empresas.get(b)
        if empresa is None:
            # Sem a linha da empresa não há razão social nem porte: a base veio
            # incompleta (arquivo de Empresas faltando ou corrompido).
            sem_empresa += 1
            continue
        saida.append(
            {
                **e,
                "razao_social": empresa[1].strip(),
                "natureza_juridica": empresa[2].strip(),
                "capital_social_centavos": capital_em_centavos(empresa[4]),
                "porte": PORTES.get(empresa[5].strip(), PORTE_NAO_INFORMADO),
                "opcao_simples": "true" if opcao_simples else "false",
                "municipio": municipios.get(e["municipio_codigo"], ""),
                "cnae_principal_descricao": cnaes.get(e["cnae_principal"], ""),
                "referencia": referencia,
            }
        )

    resumo["mei_removidos"] = mei
    resumo["sem_linha_de_empresa"] = sem_empresa
    resumo["no_recorte"] = len(saida)
    resumo["pela_principal"] = sum(1 for s in saida if s["recorte_pela_principal"] == "true")
    resumo["por_uf"] = dict(Counter(s["uf"] for s in saida).most_common())
    resumo["por_porte"] = dict(Counter(s["porte"] for s in saida).most_common())
    resumo["com_telefone"] = sum(1 for s in saida if s["telefone1"] or s["telefone2"])
    resumo["com_email"] = sum(1 for s in saida if s["email"])
    resumo["matrizes"] = sum(1 for s in saida if s["matriz"] == "true")
    resumo["top_cnae_principal"] = [
        {"cnae": c, "descricao": cnaes.get(c, ""), "empresas": n}
        for c, n in Counter(
            s["cnae_principal"] for s in saida if s["recorte_pela_principal"] == "true"
        ).most_common(15)
    ]
    resumo["top_municipios"] = [
        {"municipio": m, "empresas": n}
        for m, n in Counter(f'{s["municipio"]}/{s["uf"]}' for s in saida).most_common(15)
    ]
    return saida, resumo


def gravar_csv(linhas: list[dict], caminho: str) -> None:
    with open(caminho, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUNAS_SAIDA, extrasaction="ignore", lineterminator="\n")
        w.writeheader()
        for linha in sorted(linhas, key=lambda x: x["cnpj"]):
            w.writerow(linha)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--dir", required=True, help="pasta com os .zip da Receita")
    p.add_argument("--referencia", required=True, help="mês da base, AAAA-MM")
    p.add_argument("--ufs", default="PR,SC")
    p.add_argument("--cnae-prefixos", default="10", help="prefixos de CNAE, separados por vírgula")
    p.add_argument("--cnae-excluidos", default="1091102")
    p.add_argument("--saida", required=True)
    p.add_argument("--resumo", required=True)
    a = p.parse_args(argv)

    ufs = frozenset(u.strip().upper() for u in a.ufs.split(",") if u.strip())
    prefixos = tuple(c.strip() for c in a.cnae_prefixos.split(",") if c.strip())
    excluidos = frozenset(c.strip() for c in a.cnae_excluidos.split(",") if c.strip())

    linhas, resumo = filtrar(a.dir, a.referencia, ufs, prefixos, excluidos)
    gravar_csv(linhas, a.saida)
    with open(a.resumo, "w", encoding="utf-8") as f:
        json.dump(resumo, f, ensure_ascii=False, indent=2)
    print(json.dumps({k: resumo[k] for k in ("estabelecimentos_lidos", "no_recorte", "mei_removidos")}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
