/**
 * A tela dos sinais do site (Fase 3 do fork da Genuine): cada sinal aparece com
 * a prova ao alcance (o trecho no title, o link da página), a empresa na fila
 * diz que está na fila, e o botão "Analisar sites" conta quantas faltam e some
 * quando não há nada a pedir. Regras em `lib/prospecting/sinais/`.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnaliseDaCampanha, SinaisDaEmpresa, contarAnalises } from "@/app/app/prospecting/_sinais";
import { analisePendente, type Analise } from "@/lib/prospecting/sinais/tipos";

afterEach(cleanup);

const ok: Analise = {
  ...analisePendente(new Date("2026-10-17T00:00:00Z")),
  status: "ok",
  analisada_em: "2026-10-17T00:01:00Z",
  site: { url: "https://www.serra.com.br/", origem: "email" },
  perfil: { instagram: "https://instagram.com/laticiniosserra", facebook: null, linkedin: null },
  sinais: [
    {
      tipo: "procura_distribuidor",
      evidencia: 'Link "Seja um distribuidor" no site.',
      link: "https://www.serra.com.br/seja-distribuidor",
    },
    { tipo: "registro_sif", evidencia: "S.I.F. 4321", link: "https://www.serra.com.br/" },
  ],
  paginas: ["https://www.serra.com.br/"],
};

describe("sinais de uma empresa", () => {
  it("cada sinal é um link para a página da prova, com o trecho no title", () => {
    render(<SinaisDaEmpresa analise={ok} />);
    const distribuidor = screen.getByRole("link", { name: "Procura distribuidores" });
    expect(distribuidor.getAttribute("href")).toBe("https://www.serra.com.br/seja-distribuidor");
    expect(distribuidor.getAttribute("title")).toBe('Link "Seja um distribuidor" no site.');
    expect(screen.getByRole("link", { name: "Tem SIF" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "serra.com.br" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "@laticiniosserra" })).toBeTruthy();
  });

  it("sem site, o sinal não tem link e a observação aparece", () => {
    render(
      <SinaisDaEmpresa
        analise={{
          ...ok,
          status: "sem_site",
          site: null,
          perfil: { instagram: null, facebook: null, linkedin: null },
          sinais: [],
          observacao: "O domínio do e-mail abre um site que não cita o nome da empresa.",
        }}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/não cita o nome da empresa/)).toBeTruthy();
  });

  it("na fila e sem análise", () => {
    render(<SinaisDaEmpresa analise={analisePendente(new Date())} />);
    expect(screen.getByText("Na fila da análise")).toBeTruthy();
    cleanup();
    render(<SinaisDaEmpresa analise={undefined} />);
    expect(screen.getByText("—")).toBeTruthy();
  });
});

describe("analisar os sites da campanha", () => {
  const candidatos = [
    { status: "new", data: { analise: ok } },
    { status: "new", data: { analise: analisePendente(new Date()) } },
    { status: "new", data: {} },
    { status: "new", data: {} },
    { status: "skipped", data: {} },
  ];

  it("conta analisadas, na fila e as que faltam pedir (recusada não conta)", () => {
    expect(contarAnalises(candidatos)).toEqual({ analisadas: 1, naFila: 1, semPedido: 2 });
  });

  it("análise feita por uma versão anterior das réguas conta como a pedir de novo", () => {
    expect(
      contarAnalises([
        { status: "new", data: { analise: { ...ok, versao: 1 } } },
        { status: "new", data: { analise: ok } },
      ]),
    ).toEqual({ analisadas: 1, naFila: 0, semPedido: 1 });
  });

  it("o botão pede a análise e diz quantas faltam", async () => {
    const onAnalisar = vi.fn(async () => true);
    render(<AnaliseDaCampanha candidates={candidatos} busy={false} onAnalisar={onAnalisar} />);
    expect(screen.getByText(/Sites analisados: 1 · 1 na fila da análise/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Analisar sites (2)" }));
    await waitFor(() => expect(onAnalisar).toHaveBeenCalledTimes(1));
  });

  it("sem nada a pedir, o botão fica desligado", () => {
    render(
      <AnaliseDaCampanha
        candidates={[{ status: "new", data: { analise: ok } }]}
        busy={false}
        onAnalisar={vi.fn()}
      />,
    );
    expect(
      (screen.getByRole("button", { name: "Analisar sites" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
