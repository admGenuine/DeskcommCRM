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


if __name__ == "__main__":
    unittest.main()
