"""
Testes da leitura da listagem WebDAV do compartilhamento da Receita.

Rodar: python3 -m unittest discover -s scripts/genuine/mercado -v
"""
from __future__ import annotations

import unittest

import listar_receita as lr

RAIZ = b"""<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>/public.php/webdav/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
  <d:response><d:href>/public.php/webdav/2026-08/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
  <d:response><d:href>/public.php/webdav/2026-09/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
  <d:response><d:href>/public.php/webdav/LEIAME.pdf</d:href>
    <d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat></d:response>
  <d:response><d:href>/public.php/webdav/temp/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
</d:multistatus>"""

MES = b"""<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>/public.php/webdav/2026-09/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
  <d:response><d:href>/public.php/webdav/2026-09/Estabelecimentos0.zip</d:href>
    <d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat></d:response>
  <d:response><d:href>/public.php/webdav/2026-09/Empresas0.zip</d:href>
    <d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat></d:response>
  <d:response><d:href>/public.php/webdav/2026-09/Simples%20Nacional.zip</d:href>
    <d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat></d:response>
</d:multistatus>"""


INDICE_DO_ESPELHO = """<html><body><h1>Index of /arquivos</h1>
<a href="?C=N;O=D">Name</a> <a href="/">Parent Directory</a>
<a href="2026-08-10/">2026-08-10/</a> <a href="2026-09-14/">2026-09-14/</a>
<a href="2025-12-14/">2025-12-14/</a></body></html>"""

PASTA_DO_ESPELHO = """<html><body><h1>Index of /arquivos/2026-09-14</h1>
<a href="?C=M;O=A">Last modified</a> <a href="/arquivos/">Parent Directory</a>
<a href="Cnaes.zip">Cnaes.zip</a> <a href="Empresas0.zip">Empresas0.zip</a>
<a href="Estabelecimentos0.zip">Estabelecimentos0.zip</a> <a href="Simples.zip">Simples.zip</a>
</body></html>"""


class ListagemDaReceita(unittest.TestCase):
    def test_meses_do_mais_recente_para_o_mais_antigo_so_pastas_aaaa_mm(self):
        self.assertEqual(lr.meses(lr.itens_do_propfind(RAIZ)), ["2026-09", "2026-08"])

    def test_zips_da_pasta_sem_a_propria_pasta_e_com_nome_decodificado(self):
        self.assertEqual(
            lr.zips(lr.itens_do_propfind(MES)),
            ["Empresas0.zip", "Estabelecimentos0.zip", "Simples Nacional.zip"],
        )

    def test_a_raiz_nao_tem_zip(self):
        self.assertEqual(lr.zips(lr.itens_do_propfind(RAIZ)), [])

    def test_pastas_do_espelho_da_mais_recente_para_a_mais_antiga(self):
        self.assertEqual(
            lr.pastas_do_espelho(INDICE_DO_ESPELHO), ["2026-09-14", "2026-08-10", "2025-12-14"]
        )

    def test_zips_do_espelho_sem_links_de_ordenacao_nem_pasta_pai(self):
        self.assertEqual(
            lr.zips_do_espelho(PASTA_DO_ESPELHO),
            ["Cnaes.zip", "Empresas0.zip", "Estabelecimentos0.zip", "Simples.zip"],
        )

    def test_receita_fora_do_ar_cai_no_espelho_com_o_mes_da_pasta(self):
        def receita_recusa(_mes):
            raise SystemExit("Connection reset by peer")

        paginas = {lr.ESPELHO: INDICE_DO_ESPELHO, lr.ESPELHO + "2026-09-14/": PASTA_DO_ESPELHO}
        original = (lr.da_receita, lr.baixar_texto)
        lr.da_receita, lr.baixar_texto = receita_recusa, paginas.__getitem__
        try:
            import contextlib
            import io
            import json

            saida = io.StringIO()
            with contextlib.redirect_stdout(saida), contextlib.redirect_stderr(io.StringIO()):
                lr.main([])
            r = json.loads(saida.getvalue())
        finally:
            lr.da_receita, lr.baixar_texto = original
        self.assertEqual(r["fonte"], "espelho")
        self.assertEqual(r["mes"], "2026-09")
        self.assertEqual(r["url"], lr.ESPELHO + "2026-09-14/")
        self.assertIn("Estabelecimentos0.zip", r["arquivos"])


if __name__ == "__main__":
    unittest.main()
