/**
 * A tela dos sinais do site (Fase 3 do fork da Genuine): cada sinal aparece com
 * a prova ao alcance (o trecho no title, o link da página), a empresa na fila
 * diz que está na fila, e o botão "Analisar sites" conta quantas faltam e some
 * quando não há nada a pedir. Regras em `lib/prospecting/sinais/`.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AnaliseDaCampanha,
  BuscaNoMapsDaEmpresa,
  SinaisDaEmpresa,
  contarAnalises,
  contarBuscasNoMaps,
  contarLeiturasIa,
} from "@/app/app/prospecting/_sinais";
import { leituraIaPendente } from "@/lib/prospecting/sinais/ia";
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

describe("leitura por IA (Fase 3b)", () => {
  const lida = {
    ...leituraIaPendente(new Date("2026-10-18T00:00:00Z")),
    status: "ok" as const,
    resumo: "Fabrica queijos e iogurtes artesanais.",
    produtos: ["Queijos", "Iogurtes"],
    sinais_novos: 1,
  };

  it("o sinal da IA vem marcado, e o resumo, os produtos e a Receita aparecem", () => {
    render(
      <SinaisDaEmpresa
        analise={{
          ...ok,
          sinais: [
            ...ok.sinais,
            {
              tipo: "vende_em_varejo",
              evidencia: "Encontre nos supermercados da região",
              link: "https://www.serra.com.br/",
              fonte: "ia",
            },
          ],
          receita: {
            cnpj: "22222222000102",
            razao_social: "LATICINIOS SERRA LTDA",
            porte: "EPP",
            criterio: "telefone",
          },
          ia: lida,
        }}
      />,
    );
    expect(screen.getByRole("link", { name: "Vende no varejo · IA" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Procura distribuidores" })).toBeTruthy();
    expect(screen.getByText("Fabrica queijos e iogurtes artesanais.")).toBeTruthy();
    expect(screen.getByText(/Queijos, Iogurtes/)).toBeTruthy();
    expect(screen.getByText(/LATICINIOS SERRA LTDA/).textContent).toContain("achada pelo telefone");
  });

  it("leitura que falhou ou parou no teto mostra o porquê", () => {
    render(
      <SinaisDaEmpresa
        analise={{ ...ok, ia: { ...lida, status: "teto", observacao: "O teto foi atingido." } }}
      />,
    );
    expect(screen.getByText("O teto foi atingido.")).toBeTruthy();
  });

  const comSite = { status: "new", data: { analise: ok } };
  const candidatos = [
    comSite,
    comSite,
    { status: "new", data: { analise: { ...ok, ia: lida } } },
    { status: "new", data: { analise: { ...ok, ia: { ...lida, status: "pendente" as const } } } },
    { status: "new", data: { analise: { ...ok, ia: { ...lida, status: "falhou" as const } } } },
    // sem site lido não tem o que a IA ler
    { status: "new", data: { analise: { ...ok, status: "sem_site" as const } } },
    { status: "skipped", data: { analise: ok } },
  ];

  it("conta lidas, na fila e as que dá para pedir (a que falhou pode de novo)", () => {
    expect(contarLeiturasIa(candidatos)).toEqual({ lidas: 1, naFila: 1, aPedir: 3 });
  });

  it("o botão mostra quantas, o gasto e o teto, e pede a leitura", async () => {
    const onLerComIa = vi.fn(async () => true);
    render(
      <AnaliseDaCampanha
        candidates={candidatos}
        busy={false}
        onAnalisar={vi.fn()}
        gastoIaCentavos={12.5}
        onLerComIa={onLerComIa}
      />,
    );
    expect(screen.getByText(/Gasto: US\$ 0,13 de US\$ 1,00/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ler com IA (3)" }));
    await waitFor(() => expect(onLerComIa).toHaveBeenCalledTimes(1));
  });

  it("no teto da campanha, o botão desliga e diz por quê", () => {
    render(
      <AnaliseDaCampanha
        candidates={candidatos}
        busy={false}
        onAnalisar={vi.fn()}
        gastoIaCentavos={98}
        onLerComIa={vi.fn()}
      />,
    );
    expect(
      (screen.getByRole("button", { name: "Ler com IA (3)" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText("O teto de gasto com IA desta campanha foi atingido.")).toBeTruthy();
  });
});

describe("busca no Maps das empresas do Mercado (Fase 3b)", () => {
  const semSite = { ...ok, status: "sem_site" as const, site: null };
  const busca = {
    status: "achada" as const,
    run_id: "r",
    termo: "MASSAS SERRA TOLEDO PR",
    teto_usd: 0.1,
    pedida_em: "2026-10-18T00:00:00Z",
    concluida_em: "2026-10-18T00:05:00Z",
    titulo: "Massas Serra",
    observacao: null,
  };
  const candidatos = [
    { status: "new", data: { fonte: "mercado" as const, analise: semSite } },
    { status: "new", data: { fonte: "mercado" as const, analise: semSite } },
    { status: "new", data: { fonte: "mercado" as const, analise: semSite, maps_busca: busca } },
    {
      status: "new",
      data: {
        fonte: "mercado" as const,
        analise: semSite,
        maps_busca: { ...busca, status: "buscando" as const },
      },
    },
    // ainda sem análise grátis: primeiro analisar
    { status: "new", data: { fonte: "mercado" as const } },
    // do Maps, não do Mercado
    { status: "new", data: { analise: semSite } },
  ];

  it("conta achadas, procurando e as que dá para procurar", () => {
    expect(contarBuscasNoMaps(candidatos)).toEqual({
      doMercado: 5,
      achadas: 1,
      procurando: 1,
      aProcurar: 2,
    });
  });

  it("o botão aparece só com empresas do Mercado, e mostra o gasto e o teto", async () => {
    const onProcurarNoMaps = vi.fn(async () => true);
    render(
      <AnaliseDaCampanha
        candidates={candidatos}
        busy={false}
        onAnalisar={vi.fn()}
        gastoMapsUsd={0.14}
        onProcurarNoMaps={onProcurarNoMaps}
      />,
    );
    expect(
      screen.getByText(/Achadas no Maps: 1 · 1 procurando · Gasto: US\$ 0,14 de US\$ 1,00/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Procurar no Maps (2)" }));
    await waitFor(() => expect(onProcurarNoMaps).toHaveBeenCalledTimes(1));
    cleanup();
    render(
      <AnaliseDaCampanha
        candidates={[{ status: "new", data: { analise: semSite } }]}
        busy={false}
        onAnalisar={vi.fn()}
        onProcurarNoMaps={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /Procurar no Maps/ })).toBeNull();
  });

  it("na empresa: procurando, achada, ou outra empresa no Maps", () => {
    render(<BuscaNoMapsDaEmpresa busca={{ ...busca, status: "buscando" }} />);
    expect(screen.getByText("Procurando no Maps")).toBeTruthy();
    cleanup();
    render(<BuscaNoMapsDaEmpresa busca={busca} />);
    expect(screen.getByText(/Achada no Maps: Massas Serra/)).toBeTruthy();
    cleanup();
    render(
      <BuscaNoMapsDaEmpresa
        busca={{
          ...busca,
          status: "nao_confere",
          titulo: "Padaria do Zé",
          observacao: "No Maps aparece outra empresa.",
        }}
      />,
    );
    expect(screen.getByText(/No Maps aparece outra empresa. \(Padaria do Zé\)/)).toBeTruthy();
  });
});
