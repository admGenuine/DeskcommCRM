/**
 * A tela da nota (Fase 4 do fork da Genuine): a nota aparece com o porquê de
 * cada ponto, e "Ficar só com as melhores" muda a seleção só onde precisa
 * (marca quem fica e estava desmarcada, desmarca quem sai e estava marcada).
 * Regras em `lib/prospecting/score.ts`.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FicarComAsMelhores,
  NotaDaEmpresa,
  ajusteDaSelecao,
  type NaDisputa,
} from "@/app/app/prospecting/_score";
import { MOTIVOS_DO_SCORE } from "@/lib/prospecting/score";

afterEach(cleanup);

describe("a nota de uma empresa", () => {
  it("mostra a nota e cada ponto com o motivo e o detalhe", () => {
    render(
      <NotaDaEmpresa
        score={{
          nota: 25,
          semAnaliseDoSite: false,
          anuncio: "nao_anuncia",
          itens: [
            { pontos: 20, motivo: MOTIVOS_DO_SCORE.porte_DEMAIS },
            { pontos: 5, motivo: MOTIVOS_DO_SCORE.avaliacoes_no_maps, detalhe: "48" },
          ],
        }}
      />,
    );
    expect(screen.getByLabelText("Nota 25")).toBeTruthy();
    expect(screen.getByText(/Porte médio ou grande na Receita\./)).toBeTruthy();
    expect(screen.getByText(/20 ou mais avaliações no Maps\. \(48\)/)).toBeTruthy();
    expect(screen.queryByText("sem análise do site")).toBeNull();
    // o pixel aparece ao lado da nota, com a observação de que não pontua por enquanto
    expect(screen.getByText("Sem pixel de anúncio")).toBeTruthy();
    expect(screen.getByText(/só informa e não entra na nota/)).toBeTruthy();
  });

  it("sem análise do site, avisa que a nota pode subir", () => {
    render(<NotaDaEmpresa score={{ nota: 0, itens: [], anuncio: null, semAnaliseDoSite: true }} />);
    expect(screen.getByText("sem análise do site")).toBeTruthy();
    expect(screen.getByText("Nenhum ponto ainda.")).toBeTruthy();
    expect(screen.queryByText(/pixel/i)).toBeNull();
  });
});

describe("ficar só com as melhores", () => {
  const disputa: NaDisputa[] = [
    { id: "a", nota: 80, semAnaliseDoSite: false },
    { id: "b", nota: 30, semAnaliseDoSite: false },
    { id: "c", nota: 60, selected: false, semAnaliseDoSite: true },
    { id: "d", nota: 10, selected: false, semAnaliseDoSite: false },
  ];

  it("marca quem fica e estava desmarcada; desmarca quem sai e estava marcada", () => {
    expect(ajusteDaSelecao(disputa, { notaMinima: 50 })).toEqual({
      ficam: 2,
      entram: ["c"],
      saem: ["b"],
    });
  });

  it("o botão aplica a regra, diz quantas ficam e avisa das sem análise", async () => {
    const onAplicar = vi.fn(async () => true);
    render(<FicarComAsMelhores disputa={disputa} busy={false} onAplicar={onAplicar} />);
    const botao = screen.getByRole("button", { name: "Ficar só com as melhores" });
    expect((botao as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/1 ainda sem análise do site/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("No máximo"), { target: { value: "1" } });
    expect(screen.getByText("Ficam marcadas: 1 de 4")).toBeTruthy();
    fireEvent.click(botao);
    await waitFor(() => expect(onAplicar).toHaveBeenCalledWith([], ["b"]));
  });

  it("quando a regra não muda nada, o botão fica desligado", () => {
    render(
      <FicarComAsMelhores
        disputa={[
          { id: "x", nota: 90, semAnaliseDoSite: false },
          { id: "y", nota: 20, selected: false, semAnaliseDoSite: false },
        ]}
        busy={false}
        onAplicar={vi.fn()}
      />,
    );
    const botao = () =>
      screen.getByRole("button", { name: "Ficar só com as melhores" }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText("Nota mínima"), { target: { value: "50" } });
    // "x" já está marcada e "y" já está desmarcada: nada a mudar
    expect(screen.getByText("Ficam marcadas: 1 de 2")).toBeTruthy();
    expect(botao().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Nota mínima"), { target: { value: "10" } });
    expect(botao().disabled).toBe(false);
  });

  it("sem empresa na disputa, a ferramenta não aparece", () => {
    const { container } = render(
      <FicarComAsMelhores disputa={[]} busy={false} onAplicar={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });
});
