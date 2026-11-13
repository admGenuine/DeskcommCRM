/**
 * A TELA DE MODELOS com as regras da Meta (fork da Genuine, 2026-11-13).
 *
 * Dirige o formulário como quem usa: digita, vê o que falta, corrige e envia.
 * A rota é dublada no `apiClient`; o que se mede é o que a tela mostra e o que
 * ela manda.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  posts: [] as Array<Record<string, unknown>>,
  resposta: { sincronizadas: 1, total: 1 } as Record<string, unknown>,
}));

vi.mock("@/lib/api/client", () => ({
  apiClient: {
    get: async () => ({
      data: {
        templates: [
          {
            name: "pedido_saiu",
            language: "pt_BR",
            status: "APPROVED",
            category: "MARKETING",
            categoriaPedida: "UTILITY",
            rejectedReason: null,
            syncedAt: "2026-11-13T12:00:00Z",
            components: [{ type: "BODY", text: "Seu pedido saiu." }],
          },
          {
            name: "boas_vindas",
            language: "pt_BR",
            status: "PENDING",
            category: "UTILITY",
            rejectedReason: null,
            syncedAt: "2026-11-13T12:00:00Z",
            components: [{ type: "BODY", text: "Bem-vindo." }],
          },
          {
            name: "promo_antiga",
            language: "pt_BR",
            status: "REJECTED",
            category: "MARKETING",
            rejectedReason: "Conteúdo promocional em modelo de utilidade.",
            syncedAt: "2026-11-13T12:00:00Z",
            components: [{ type: "BODY", text: "Promoção." }],
          },
          {
            name: "velho",
            language: "pt_BR",
            status: "DISABLED",
            category: "UTILITY",
            rejectedReason: null,
            syncedAt: "2026-11-13T12:00:00Z",
            components: [{ type: "BODY", text: "Velho." }],
          },
        ],
      },
    }),
    post: async (_rota: string, corpo: Record<string, unknown>) => {
      h.posts.push(corpo);
      return { data: h.resposta };
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { toast } from "sonner";

import { TemplatesParceiroClient } from "./TemplatesParceiroClient";

function abrir() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TemplatesParceiroClient rota="/api/v1/channels/templates" />
    </QueryClientProvider>,
  );
}

const problemas = () =>
  [...(document.querySelector("[data-problemas-do-modelo]")?.querySelectorAll("li") ?? [])].map(
    (li) => li.textContent,
  );

beforeEach(() => {
  h.posts = [];
  h.resposta = { sincronizadas: 1, total: 1 };
  vi.mocked(toast.warning).mockClear();
});

describe("a lista", () => {
  it("status em português, motivo da recusa à vista e a categoria que a Meta trocou", async () => {
    abrir();
    expect(await screen.findByText("Aprovado")).toBeTruthy();
    expect(screen.getByText("Pendente")).toBeTruthy();
    expect(screen.getByText("Recusado")).toBeTruthy();
    expect(screen.getByText("Conteúdo promocional em modelo de utilidade.")).toBeTruthy();
    const trocada = document.querySelector("[data-categoria-trocada]")!;
    expect(trocada.textContent).toBe(
      "Você escolheu Utilidade, mas a Meta classificou o modelo como Marketing. Marketing custa mais por mensagem.",
    );
  });

  it("Editar e Apagar só onde a Meta deixa", async () => {
    const user = userEvent.setup();
    abrir();
    const linha = async (nome: string) => {
      await user.click(await screen.findByText(nome));
      const item = screen.getByText(nome).closest("li")!;
      return {
        editar: within(item).queryByRole("button", { name: /Editar/ }),
        apagar: within(item).queryByRole("button", { name: /Apagar/ }),
      };
    };
    expect(await linha("pedido_saiu")).toMatchObject({
      editar: expect.anything(),
      apagar: expect.anything(),
    });
    const pendente = await linha("boas_vindas");
    expect(pendente.editar).toBeNull();
    expect(pendente.apagar).not.toBeNull();
    const desativado = await linha("velho");
    expect(desativado.editar).toBeNull();
    expect(desativado.apagar).toBeNull();
  });
});

describe("criar: a tela confere antes de enviar", () => {
  it("utilidade com botões: aponta o que falta, destrava quando está certo e manda no formato da Meta", async () => {
    const user = userEvent.setup();
    abrir();
    await user.click(await screen.findByRole("button", { name: "Criar modelo" }));
    const enviar = screen.getByRole("button", { name: "Enviar para revisão" });
    expect(enviar).toBeDisabled();
    expect(problemas()).toEqual(["Dê um nome ao modelo.", "Escreva o texto da mensagem."]);

    // O nome vira minúsculas com _ enquanto se digita.
    await user.type(screen.getByLabelText("Nome do modelo"), "Pedido Saiu");
    expect((screen.getByLabelText("Nome do modelo") as HTMLInputElement).value).toBe("pedido_saiu");
    await user.selectOptions(screen.getByLabelText("Idioma"), "pt_BR");

    await user.type(screen.getByLabelText("Conteúdo"), "Olá {{{{1}}, seu pedido saiu.");
    expect(problemas()).toContain(
      "Preencha o exemplo de cada variável do texto. A Meta exige o exemplo para aprovar.",
    );
    await user.type(screen.getByLabelText("Exemplo do valor 1"), "Maria");

    await user.click(screen.getByRole("button", { name: /Adicionar botão/ }));
    await user.selectOptions(screen.getByLabelText("Tipo do botão 1"), "url");
    await user.type(screen.getByLabelText("Texto do botão 1"), "Rastrear");
    await user.type(screen.getByLabelText("URL do botão 1"), "https://loja.com.br/r/{{{{1}}");
    expect(problemas()).toContain("Preencha o exemplo da variável do link.");
    await user.type(screen.getByLabelText("Exemplo do final do link 1"), "12345");

    await user.click(screen.getByRole("button", { name: /Adicionar botão/ }));
    await user.type(screen.getByLabelText("Texto do botão 2"), "Recebi");

    expect(problemas()).toEqual([]);
    expect(enviar).toBeEnabled();
    h.resposta = { sincronizadas: 1, total: 1, categoria: "MARKETING", categoriaPedida: "UTILITY" };
    await user.click(enviar);

    expect(h.posts).toEqual([
      {
        acao: "criar",
        name: "pedido_saiu",
        language: "pt_BR",
        category: "UTILITY",
        components: [
          {
            type: "BODY",
            text: "Olá {{1}}, seu pedido saiu.",
            example: { body_text: [["Maria"]] },
          },
          {
            type: "BUTTONS",
            buttons: [
              {
                type: "URL",
                text: "Rastrear",
                url: "https://loja.com.br/r/{{1}}",
                example: ["12345"],
              },
              { type: "QUICK_REPLY", text: "Recebi" },
            ],
          },
        ],
      },
    ]);
    // A Meta classificou em outra categoria: o aviso aparece logo depois de criar.
    expect(toast.warning).toHaveBeenCalledWith(
      "Você escolheu Utilidade, mas a Meta classificou o modelo como Marketing.",
    );
  });

  it("respostas rápidas separadas pelo link travam, com a regra escrita", async () => {
    const user = userEvent.setup();
    abrir();
    await user.click(await screen.findByRole("button", { name: "Criar modelo" }));
    await user.type(screen.getByLabelText("Nome do modelo"), "teste");
    await user.type(screen.getByLabelText("Conteúdo"), "Texto fixo.");
    for (const [i, tipo, texto] of [
      [1, "quick_reply", "Sim"],
      [2, "url", "Ver"],
      [3, "quick_reply", "Não"],
    ] as const) {
      await user.click(screen.getByRole("button", { name: /Adicionar botão/ }));
      await user.selectOptions(screen.getByLabelText(`Tipo do botão ${i}`), tipo);
      await user.type(screen.getByLabelText(`Texto do botão ${i}`), texto);
    }
    await user.type(screen.getByLabelText("URL do botão 2"), "https://a.com");
    expect(problemas()).toEqual([
      "Os botões de resposta rápida precisam ficar juntos, todos antes ou todos depois dos botões de link e de ligação.",
    ]);
    expect(screen.getByRole("button", { name: "Enviar para revisão" })).toBeDisabled();
  });

  it("autenticação troca o formulário pelo formato fixo da Meta", async () => {
    const user = userEvent.setup();
    abrir();
    await user.click(await screen.findByRole("button", { name: "Criar modelo" }));
    await user.type(screen.getByLabelText("Nome do modelo"), "codigo_acesso");
    await user.selectOptions(screen.getByLabelText("Categoria"), "AUTHENTICATION");
    expect(screen.queryByLabelText("Conteúdo")).toBeNull();
    expect(document.querySelector("[data-campos-de-autenticacao]")).not.toBeNull();
    await user.clear(screen.getByLabelText("Validade do código, em minutos"));
    await user.type(screen.getByLabelText("Validade do código, em minutos"), "120");
    expect(problemas()).toEqual(["A validade do código vai de 1 a 90 minutos."]);
    await user.clear(screen.getByLabelText("Validade do código, em minutos"));
    await user.type(screen.getByLabelText("Validade do código, em minutos"), "15");
    await user.click(screen.getByRole("button", { name: "Enviar para revisão" }));
    expect(h.posts[0]).toMatchObject({
      category: "AUTHENTICATION",
      components: [
        { type: "BODY", add_security_recommendation: true },
        { type: "FOOTER", code_expiration_minutes: 15 },
        { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE" }] },
      ],
    });
  });
});
