/**
 * A PROSPECÇÃO EM DUAS ETAPAS E A CAMPANHA ABERTA, PELA TELA (fork, 2026-11-02 e 2026-11-03).
 *
 * O dono do fork pediu a tela única dividida: uma porta de entrada com texto e
 * botões, e uma tela por etapa; depois, que cada campanha abrisse numa tela
 * própria com as abas Preparar a campanha e Abordagem. Esta spec faz o caminho
 * de quem chega pela primeira vez: abre a porta, confere os dois botões, entra
 * em cada etapa e vê o bloco que a nomeia; depois abre o endereço de uma
 * campanha que não existe e vê a tela dizer isso em vez de cair na mais
 * recente. Roda no tema escuro, que é o tema em que a divisão foi desenhada e
 * aprovada, e guarda as telas em `evidence/`.
 *
 * O que NÃO mede: a busca paga, a criação de agente, o envio e a campanha
 * aberta com empresas de verdade (o banco fresco do CI não tem campanha). Isso
 * continua com `tests/unit/prospeccao-em-etapas.test.tsx`,
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
] as const;

test("a porta da Prospecção tem texto e dois botões, e cada botão abre a sua etapa", async ({
  page,
}) => {
  await loginComoAdmin(page, creds);
  await page.goto("/app/prospecting");
  await noEscuro(page);

  await expect(page.getByRole("heading", { level: 1, name: "Prospecção" })).toBeVisible();
  await expect(page.getByText(/São duas etapas, nesta ordem/)).toBeVisible();
  for (const etapa of ETAPAS) {
    await expect(page.getByRole("link", { name: etapa.botao })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "Abrir abordagem" })).toHaveCount(0);
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
    // O seletor 1 · 2 marca a etapa atual e leva à outra.
    const seletor = page.getByRole("navigation", { name: "Etapas da prospecção" });
    await expect(seletor.getByRole("link")).toHaveCount(2);
    await expect(seletor.getByRole("link", { name: etapa.titulo })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("link", { name: "Voltar para Prospecção" })).toBeVisible();
    await page.screenshot({ path: evidencia(etapa.captura), fullPage: true });
  }
});

test("a campanha aberta tem rota própria, com as duas abas; endereço de campanha inexistente diz isso", async ({
  page,
}) => {
  await loginComoAdmin(page, creds);
  await page.goto("/app/prospecting/campanhas/00000000-0000-4000-8000-000000000000?aba=abordagem");
  await noEscuro(page);
  await expect(
    page.getByRole("heading", { level: 1, name: "Campanha não encontrada" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Ir para a etapa 2" })).toHaveAttribute(
    "href",
    "/app/prospecting/campanhas",
  );
  await expect(page.getByRole("link", { name: "Voltar para Campanha" })).toBeVisible();
  await page.screenshot({ path: evidencia("campanha-nao-encontrada.png"), fullPage: true });

  // A antiga etapa 3 só redireciona: sem campanha, para a etapa 2.
  await page.goto("/app/prospecting/abordagem");
  await expect(page).toHaveURL(/\/app\/prospecting\/campanhas(\?|$)/);
});

test("quem não é administrador da organização não entra em nenhuma das telas", async ({ page }) => {
  // A porta era uma tela só e já mandava quem não é admin para a Inbox; as
  // etapas e a campanha aberta herdam a mesma regra (`_porta.ts`). Sem login
  // nenhum, é o proxy quem barra: toda rota termina no /login.
  for (const rota of [
    "/app/prospecting",
    "/app/prospecting/empresas",
    "/app/prospecting/campanhas",
    "/app/prospecting/campanhas/00000000-0000-4000-8000-000000000000",
    "/app/prospecting/abordagem",
  ]) {
    await page.goto(rota);
    await expect(page).toHaveURL(/\/login/);
  }
});
