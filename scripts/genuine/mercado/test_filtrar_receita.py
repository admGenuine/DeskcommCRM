"""
Testes do filtro da base da Receita, com arquivos montados no formato real
(';', aspas, latin-1, sem cabeçalho, dentro de .zip).

Rodar: python3 -m unittest discover -s scripts/genuine/mercado -v
"""
from __future__ import annotations

import csv
import io
import json
import os
import tempfile
import unittest
import zipfile

import filtrar_receita as fr


def estabelecimento(
    basico: str,
    *,
    ordem: str = "0001",
    dv: str = "00",
    matriz: str = "1",
    fantasia: str = "",
    situacao: str = "02",
    inicio: str = "20140113",
    cnae: str = "1099699",
    secundarios: str = "",
    uf: str = "SC",
    municipio: str = "8233",
    ddd1: str = "48",
    tel1: str = "32860000",
    email: str = "",
) -> list[str]:
    linha = [""] * fr.E_COLUNAS
    linha[fr.E_BASICO] = basico
    linha[fr.E_ORDEM] = ordem
    linha[fr.E_DV] = dv
    linha[fr.E_MATRIZ] = matriz
    linha[fr.E_FANTASIA] = fantasia
    linha[fr.E_SITUACAO] = situacao
    linha[fr.E_INICIO] = inicio
    linha[fr.E_CNAE] = cnae
    linha[fr.E_CNAES_SEC] = secundarios
    linha[fr.E_TIPO_LOGR] = "RUA"
    linha[fr.E_LOGR] = "DAS FLORES"
    linha[fr.E_NUMERO] = "100"
    linha[fr.E_BAIRRO] = "CENTRO"
    linha[fr.E_CEP] = "88130000"
    linha[fr.E_UF] = uf
    linha[fr.E_MUNICIPIO] = municipio
    linha[fr.E_DDD1] = ddd1
    linha[fr.E_TEL1] = tel1
    linha[fr.E_EMAIL] = email
    return linha


def empresa(basico: str, razao: str, porte: str = "05", capital: str = "90000,00") -> list[str]:
    return [basico, razao, "2062", "49", capital, porte, ""]


def simples(basico: str, opcao_simples: str = "N", mei: str = "N") -> list[str]:
    return [basico, opcao_simples, "", "", mei, "", ""]


def gravar_zip(pasta: str, nome: str, linhas: list[list[str]], *, nul: bool = False) -> None:
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";", quotechar='"', quoting=csv.QUOTE_ALL, lineterminator="\n")
    for linha in linhas:
        w.writerow(linha)
    texto = buf.getvalue()
    if nul:
        texto = texto.replace("CENTRO", "CEN\x00TRO", 1)
    with zipfile.ZipFile(os.path.join(pasta, nome), "w") as z:
        z.writestr(nome.replace(".zip", ".CSV"), texto.encode("latin-1"))


class FiltroDaReceita(unittest.TestCase):
    def montar(self, estabs, empresas, simples_, *, nul: bool = False):
        pasta = tempfile.mkdtemp()
        gravar_zip(pasta, "Estabelecimentos0.zip", estabs, nul=nul)
        gravar_zip(pasta, "Empresas0.zip", empresas)
        gravar_zip(pasta, "Simples.zip", simples_)
        gravar_zip(pasta, "Municipios.zip", [["8233", "PALHOCA"], ["7535", "CURITIBA"]])
        gravar_zip(pasta, "Cnaes.zip", [["1099699", "Fabricação de outros produtos alimentícios"]])
        return pasta

    def rodar(self, pasta, **kw):
        return fr.filtrar(
            pasta,
            "2026-09",
            kw.get("ufs", frozenset({"PR", "SC"})),
            kw.get("prefixos", ("10",)),
            kw.get("excluidos", frozenset({"1091102"})),
        )

    def test_a_industria_de_alimentos_ativa_entra_com_os_dados_da_empresa(self):
        pasta = self.montar(
            [estabelecimento("19518682", dv="57", fantasia="PRESTO ALIMENTOS", email="Contato@Presto.com.br")],
            [empresa("19518682", "PRESTO ALIMENTOS LTDA")],
            [simples("19518682")],
        )
        saida, resumo = self.rodar(pasta)
        self.assertEqual(len(saida), 1)
        e = saida[0]
        self.assertEqual(e["cnpj"], "19518682000157")
        self.assertEqual(e["razao_social"], "PRESTO ALIMENTOS LTDA")
        self.assertEqual(e["porte"], "DEMAIS")
        self.assertEqual(e["capital_social_centavos"], "9000000")
        self.assertEqual(e["municipio"], "PALHOCA")
        self.assertEqual(e["cnae_principal_descricao"], "Fabricação de outros produtos alimentícios")
        self.assertEqual(e["data_inicio"], "2014-01-13")
        self.assertEqual(e["telefone1"], "4832860000")
        self.assertEqual(e["email"], "contato@presto.com.br")
        self.assertEqual(e["endereco"], "RUA DAS FLORES 100")
        self.assertEqual(e["recorte_pela_principal"], "true")
        self.assertEqual(resumo["no_recorte"], 1)

    def test_fica_de_fora_quem_nao_esta_no_recorte(self):
        pasta = self.montar(
            [
                estabelecimento("00000001", situacao="08"),  # baixada
                estabelecimento("00000002", uf="RS"),  # outro estado
                estabelecimento("00000003", cnae="1091102"),  # padaria
                estabelecimento("00000004", cnae="4712100"),  # minimercado
                estabelecimento("00000005", cnae="4712100", secundarios="1091102,5611203"),
            ],
            [empresa(f"0000000{i}", f"EMPRESA {i}") for i in range(1, 6)],
            [],
        )
        saida, _ = self.rodar(pasta)
        self.assertEqual(saida, [])

    def test_entra_pela_atividade_secundaria_e_diz_que_foi_por_ela(self):
        pasta = self.montar(
            [estabelecimento("00000006", cnae="4639701", secundarios="4729699,1031700")],
            [empresa("00000006", "DISTRIBUIDORA E FABRICA DE CONSERVAS LTDA")],
            [],
        )
        saida, resumo = self.rodar(pasta)
        self.assertEqual(len(saida), 1)
        self.assertEqual(saida[0]["recorte_pela_principal"], "false")
        self.assertEqual(saida[0]["cnaes_secundarios"], "{4729699,1031700}")
        self.assertEqual(resumo["pela_principal"], 0)

    def test_mei_sai_pelo_arquivo_do_simples(self):
        pasta = self.montar(
            [estabelecimento("00000007"), estabelecimento("00000008")],
            [empresa("00000007", "FULANO ALIMENTOS", porte="01"), empresa("00000008", "BELTRANO ALIMENTOS", porte="01")],
            [simples("00000007", "S", mei="S"), simples("00000008", "S", mei="N")],
        )
        saida, resumo = self.rodar(pasta)
        self.assertEqual([s["cnpj_basico"] for s in saida], ["00000008"])
        self.assertEqual(saida[0]["porte"], "ME")
        self.assertEqual(saida[0]["opcao_simples"], "true")
        self.assertEqual(resumo["mei_removidos"], 1)

    def test_porte_desconhecido_e_nao_informado(self):
        pasta = self.montar([estabelecimento("00000009")], [empresa("00000009", "X LTDA", porte="00")], [])
        saida, _ = self.rodar(pasta)
        self.assertEqual(saida[0]["porte"], "NAO_INFORMADO")

    def test_filial_e_matriz_entram_as_duas(self):
        pasta = self.montar(
            [estabelecimento("00000010"), estabelecimento("00000010", ordem="0002", dv="11", matriz="2", uf="PR")],
            [empresa("00000010", "REDE LTDA")],
            [],
        )
        saida, resumo = self.rodar(pasta)
        self.assertEqual([s["matriz"] for s in saida], ["true", "false"])
        self.assertEqual(resumo["matrizes"], 1)

    def test_nul_perdido_no_meio_da_linha_nao_derruba_a_leitura(self):
        pasta = self.montar([estabelecimento("00000011")], [empresa("00000011", "Y LTDA")], [], nul=True)
        saida, _ = self.rodar(pasta)
        self.assertEqual(saida[0]["bairro"], "CENTRO")

    def test_empresa_sem_linha_no_arquivo_de_empresas_e_contada_e_nao_inventada(self):
        pasta = self.montar([estabelecimento("00000012")], [], [])
        saida, resumo = self.rodar(pasta)
        self.assertEqual(saida, [])
        self.assertEqual(resumo["sem_linha_de_empresa"], 1)

    def test_telefone_sem_ddd_ou_sem_numero_fica_vazio(self):
        self.assertEqual(fr.telefone("", "32860000"), "")
        self.assertEqual(fr.telefone("048", "32860000"), "4832860000")
        self.assertEqual(fr.telefone("41", ""), "")

    def test_capital_social(self):
        self.assertEqual(fr.capital_em_centavos("1000,00"), "100000")
        self.assertEqual(fr.capital_em_centavos("1.000.000,50"), "100000050")
        self.assertEqual(fr.capital_em_centavos(""), "")
        self.assertEqual(fr.capital_em_centavos("abc"), "")

    def test_main_grava_csv_com_cabecalho_e_resumo(self):
        pasta = self.montar([estabelecimento("19518682", dv="57")], [empresa("19518682", "PRESTO")], [])
        saida = os.path.join(pasta, "mercado.csv")
        resumo = os.path.join(pasta, "resumo.json")
        fr.main(["--dir", pasta, "--referencia", "2026-09", "--saida", saida, "--resumo", resumo])
        with open(saida, encoding="utf-8") as f:
            linhas = list(csv.DictReader(f))
        self.assertEqual(list(linhas[0].keys()), fr.COLUNAS_SAIDA)
        self.assertEqual(linhas[0]["referencia"], "2026-09")
        with open(resumo, encoding="utf-8") as f:
            self.assertEqual(json.load(f)["no_recorte"], 1)


if __name__ == "__main__":
    unittest.main()
