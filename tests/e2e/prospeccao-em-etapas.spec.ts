/**
 * A PROSPECÇÃO EM TRÊS ETAPAS, PELA TELA (fork, 2026-11-02).
 *
 * O dono do fork pediu a tela única dividida: uma porta de entrada com texto e
 * três botões, e uma tela por etapa. Esta spec faz o caminho de quem chega pela
 * primeira vez: abre a porta, confere os três botões, entra em cada etapa e vê
 * o bloco que a nomeia. Roda no tema escuro, que é o tema em que a divisão foi
 * desenhada e aprovada, e guarda as quatro telas em `evidence/`.
 *
 * O que NÃO mede: a busca paga, a criação de agente e o envio. Isso continua com
 * `tests/unit/prospecting-agent-dialog.test.tsx` e os invariantes de prospecção.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { expect, test, type Page } from "./helpers/test";
import { lerCreds, loginComoAdmin } from "./helpers/login-admin";

const EVIDENCIA = path.join(process.cwd(), "evidence", "prospeccao-em-etapas");
function evidencia(nome: string): string {
  fs.mkdirSync(EVIDENCIA, { recursive: true });
  return path.join(EVIDENCIA, nome);
}

test.describe.configure({ timeout: 120_000 });
test.use({ viewport: { width: 1280, height: 860 }, colorScheme: "dark" });

const creds = lerCreds();

/** O tema escuro do produto é por atributo, não por `prefers-color-scheme`. */
async function noEscuro(page: Page): Promise<void> {
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim(),
      ),
    )
    .toBe("#0d0d0e");
}

const ETAPAS = [
  {
    botao: "Abrir prospecção",
    rota: "/app/prospecting/empresas",
    titulo: "Prospecção",
    bloco: "Encontrar empresas",
    captura: "etapa-1-prospeccao.png",
  },
  {
    botao: "Abrir campanhas",
    rota: "/app/prospecting/campanhas",
    titulo: "Campanha",
    bloco: "Suas campanhas",
    captura: "etapa-2-campanha.png",
  },
  {
    botao: "Abrir abordagem",
    rota: "/app/prospecting/abordagem",
    titulo: "Abordagem",
    // Sem campanha pronta, a etapa 3 explica o que falta em vez de mostrar o formulário.
    bloco: /Preparar a abordagem|Nenhuma campanha ainda|ainda não terminou|não tem empresas/,
    captura: "etapa-3-abordagem.png",
  },
] as const;

test("a porta da Prospecção tem texto e três botões, e cada botão abre a sua etapa", async ({
  page,
}) => {
  await loginComoAdmin(page, creds);
  await page.goto("/app/prospecting");
  await noEscuro(page);

  await expect(page.getByRole("heading", { level: 1, name: "Prospecção" })).toBeVisible();
  await expect(page.getByText(/São três etapas, nesta ordem/)).toBeVisible();
  for (const etapa of ETAPAS) {
    await expect(page.getByRole("link", { name: etapa.botao })).toBeVisible();
  }
  await expect(page.getByRole("region", { name: "Onde você parou" })).toBeVisible();
  await page.screenshot({ path: evidencia("porta.png"), fullPage: true });

  for (const etapa of ETAPAS) {
    await page.goto("/app/prospecting");
    await noEscuro(page);
    await page.getByRole("link", { name: etapa.botao }).click();
    await expect(page).toHaveURL(new RegExp(`${etapa.rota}(\\?|$)`));
    await noEscuro(page);
    await expect(page.getByRole("heading", { level: 1, name: etapa.titulo })).toBeVisible();
    await expect(page.getByRole("heading", { name: etapa.bloco }).first()).toBeVisible();
    // O seletor 1 · 2 · 3 marca a etapa atual e leva às outras.
    const seletor = page.getByRole("navigation", { name: "Etapas da prospecção" });
    await expect(seletor.getByRole("link", { name: etapa.titulo })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("link", { name: "Voltar para Prospecção" })).toBeVisible();
    await page.screenshot({ path: evidencia(etapa.captura), fullPage: true });
  }
});

test("quem não é administrador da organização não entra em nenhuma das quatro telas", async ({
  page,
}) => {
  // A porta era uma tela só e já mandava quem não é admin para a Inbox; as três
  // etapas herdam a mesma regra (`_porta.ts`). Sem login nenhum, é o proxy quem
  // barra: toda rota termina no /login.
  for (const rota of [
    "/app/prospecting",
    "/app/prospecting/empresas",
    "/app/prospecting/campanhas",
    "/app/prospecting/abordagem",
  ]) {
    await page.goto(rota);
    await expect(page).toHaveURL(/\/login/);
  }
});
