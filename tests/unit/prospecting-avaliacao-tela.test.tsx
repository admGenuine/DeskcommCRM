/**
 * A tela de avaliação da prospecção: o dono avalia a empresa com um motivo, marca
 * a campanha de referência e vê o que a prospecção aprendeu. Regras em
 * `lib/prospecting/aprendizado.ts`; aqui, que cada clique chega com o que foi
 * escrito e que a tela diz o efeito.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AprendizadoCard,
  AvaliacaoDaEmpresa,
  ReferenciaDaCampanha,
} from "@/app/app/prospecting/_avaliacao";
import { perfilAprendido } from "@/lib/prospecting/aprendizado";

afterEach(cleanup);

describe("avaliar a empresa", () => {
  it("não gostei pede o motivo e envia o que foi escrito", async () => {
    const onAvaliar = vi.fn(async () => true);
    render(<AvaliacaoDaEmpresa avaliacao={undefined} busy={false} onAvaliar={onAvaliar} />);
    fireEvent.click(screen.getByRole("button", { name: "Não gostei" }));
    fireEvent.change(screen.getByLabelText("Motivo da avaliação"), {
      target: { value: "só revende" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(onAvaliar).toHaveBeenCalledWith("nao_gostei", "só revende"));
    await waitFor(() => expect(screen.queryByLabelText("Motivo da avaliação")).toBeNull());
  });

  it("mostra a avaliação gravada, com o motivo", () => {
    render(
      <AvaliacaoDaEmpresa
        avaliacao={{
          nota: "gostei",
          motivo: "fábrica média",
          em: "2026-10-02T00:00:00Z",
          por: null,
        }}
        busy={false}
        onAvaliar={vi.fn()}
      />,
    );
    expect(screen.getByText("Gostei: fábrica média")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Gostei" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("falha ao salvar mantém o formulário aberto", async () => {
    const onAvaliar = vi.fn(async () => false);
    render(<AvaliacaoDaEmpresa avaliacao={undefined} busy={false} onAvaliar={onAvaliar} />);
    fireEvent.click(screen.getByRole("button", { name: "Gostei" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(onAvaliar).toHaveBeenCalledWith("gostei", ""));
    expect(screen.getByLabelText("Motivo da avaliação")).toBeTruthy();
  });
});

describe("campanha de referência", () => {
  it("marca com o motivo escrito", async () => {
    const onMarcar = vi.fn(async () => true);
    render(
      <ReferenciaDaCampanha referencia={false} motivo={null} busy={false} onMarcar={onMarcar} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Marcar como referência" }));
    fireEvent.change(screen.getByLabelText("Motivo da referência"), {
      target: { value: "fábricas médias" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Marcar como referência" }));
    await waitFor(() => expect(onMarcar).toHaveBeenCalledWith(true, "fábricas médias"));
  });

  it("desmarca", () => {
    const onMarcar = vi.fn(async () => true);
    render(
      <ReferenciaDaCampanha referencia motivo="fábricas médias" busy={false} onMarcar={onMarcar} />,
    );
    expect(screen.getByText("Referência do perfil ideal")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Desmarcar" }));
    expect(onMarcar).toHaveBeenCalledWith(false, "");
  });
});

describe("o que a prospecção aprendeu", () => {
  it("uma empresa avaliada fica no singular, e sem referência a contagem dela some", () => {
    render(
      <AprendizadoCard
        perfil={perfilAprendido([
          { categoria: "Fornecedor de bebidas", nota: "nao_gostei", origem: "avaliacao" },
        ])}
      />,
    );
    expect(screen.getByText(/^1 empresa avaliada por você$/)).toBeTruthy();
    expect(screen.queryByText(/campanha/)).toBeNull();
  });

  it("não aparece antes da primeira avaliação", () => {
    const { container } = render(<AprendizadoCard perfil={perfilAprendido([])} />);
    expect(container.innerHTML).toBe("");
  });

  it("diz quais categorias ficam de fora nas próximas buscas", () => {
    const nao = {
      categoria: "Loja de produtos naturais",
      nota: "nao_gostei" as const,
      origem: "avaliacao" as const,
    };
    render(
      <AprendizadoCard
        perfil={perfilAprendido([
          nao,
          nao,
          { categoria: "Fabricante de alimentos", nota: "gostei", origem: "referencia" },
        ])}
      />,
    );
    expect(screen.getByText("Fabricante de alimentos (1)")).toBeTruthy();
    expect(
      screen.getByText(/2 empresas avaliadas por você · 1 empresa de campanha de referência/),
    ).toBeTruthy();
    expect(
      screen.getByText(/Loja de produtos naturais \(2\) · as próximas ficam de fora/),
    ).toBeTruthy();
  });
});
