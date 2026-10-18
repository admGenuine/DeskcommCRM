/**
 * A tela do decisor pelo quadro de sócios (Fase 5 do fork da Genuine): o
 * decisor aparece na empresa com cargo e ano, e o uso só liga com a referência
 * da avaliação de legítimo interesse. Regras em `lib/prospecting/mercado/socios.ts`.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DecisorDaEmpresa, UsoDeSociosCard } from "@/app/app/prospecting/_decisor";

afterEach(cleanup);

describe("o decisor na empresa", () => {
  it("o primeiro com cargo e ano; os outros em uma linha", () => {
    render(
      <DecisorDaEmpresa
        decisores={[
          { nome: "Ana Lima", cargo: "Sócio-Administrador", desde: 2012 },
          { nome: "Maria Souza", cargo: "Sócio", desde: null },
        ]}
      />,
    );
    expect(screen.getByText("Ana Lima")).toBeTruthy();
    expect(screen.getByText("Sócio-Administrador desde 2012")).toBeTruthy();
    expect(screen.getByText(/Outros sócios: Maria Souza \(Sócio\)/)).toBeTruthy();
  });

  it("sem sócio (ou com o uso desligado), nada aparece", () => {
    const { container } = render(<DecisorDaEmpresa decisores={undefined} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("ligar e desligar o quadro de sócios", () => {
  it("só liga com a referência do legítimo interesse", async () => {
    const onSalvar = vi.fn(async () => true);
    render(
      <UsoDeSociosCard
        estado={{ ativo: false, base_legal_ref: null }}
        busy={false}
        onSalvar={onSalvar}
      />,
    );
    const ligar = screen.getByRole("button", { name: "Ligar" }) as HTMLButtonElement;
    expect(ligar.disabled).toBe(true);
    fireEvent.change(
      screen.getByLabelText("Avaliação de legítimo interesse do uso dos sócios (referência)"),
      {
        target: { value: "LIA-2026-10 (pasta Jurídico)" },
      },
    );
    expect(ligar.disabled).toBe(false);
    fireEvent.click(ligar);
    await waitFor(() =>
      expect(onSalvar).toHaveBeenCalledWith({
        ativo: true,
        base_legal_ref: "LIA-2026-10 (pasta Jurídico)",
      }),
    );
  });

  it("ligado: mostra a referência e desliga com um clique", async () => {
    const onSalvar = vi.fn(async () => true);
    render(
      <UsoDeSociosCard
        estado={{ ativo: true, base_legal_ref: "LIA-2026-10" }}
        busy={false}
        onSalvar={onSalvar}
      />,
    );
    expect(screen.getByText(/LIA-2026-10/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Desligar" }));
    await waitFor(() => expect(onSalvar).toHaveBeenCalledWith({ ativo: false }));
  });
});
