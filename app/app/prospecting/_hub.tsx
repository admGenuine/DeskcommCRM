"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiClient } from "@/lib/api/client";
import { useT } from "@/hooks/i18n/useT";
import { ETAPAS, NUMERO_DA_ETAPA, etapaParaContinuar, hrefDaEtapa, type Etapa } from "./_etapas";
import { descricaoDaEtapa, nomeDaEtapa } from "./_etapas-ui";

type CampanhaDaPorta = {
  id: string;
  name: string;
  status: string;
  search_status: string;
  config: unknown;
  result_count: number;
};
type EstadoDaPorta = {
  configured: boolean;
  campaigns: CampanhaDaPorta[];
  candidates: { campaign_id: string; status: string }[];
};

const RESUMO_DA_SITUACAO: Record<string, string> = {
  draft: "campanha ainda não preparada",
  running: "abordagens em andamento",
  paused: "abordagens pausadas",
  completed: "abordagens concluídas",
};
const RESUMO_DA_BUSCA: Record<string, string> = {
  starting: "busca em andamento",
  succeeded: "busca concluída",
  failed: "busca com falha",
  unknown: "busca sem confirmação",
};

/** Os blocos de cada etapa, como a porta os anuncia. São os títulos das seções de cada tela. */
function blocosDaEtapa(t: (texto: string) => string, etapa: Etapa): string[] {
  switch (etapa) {
    case "empresas":
      return [
        t("Encontrar empresas"),
        t("O que a prospecção aprendeu com você"),
        t("Decisor pelo quadro de sócios"),
        t("Acompanhar resultados"),
      ];
    case "campanhas":
      return [t("Suas campanhas"), t("Preparar a campanha"), t("Acompanhar resultados")];
    case "abordagem":
      return [t("Preparar a abordagem")];
  }
}

function resumoDaEtapa(t: (texto: string) => string, etapa: Etapa): string {
  switch (etapa) {
    case "empresas":
      return t("Escolha o público e a região, encontre empresas e veja quem foi aprovado.");
    case "campanhas":
      return t("Organize as empresas aprovadas em campanhas e acompanhe a fila e as respostas.");
    case "abordagem":
      return t("Escolha o agente, o que ele precisa confirmar, e inicie as abordagens com IA.");
  }
}

function rotuloDoBotao(t: (texto: string) => string, etapa: Etapa): string {
  switch (etapa) {
    case "empresas":
      return t("Abrir prospecção");
    case "campanhas":
      return t("Abrir campanhas");
    case "abordagem":
      return t("Abrir abordagem");
  }
}

/**
 * A porta de entrada da Prospecção: um texto curto e três botões, um por etapa.
 *
 * A faixa "Onde você parou" lê a mesma consulta das etapas e aponta para a
 * etapa em que a campanha mais recente está (`etapaParaContinuar`). Sem
 * campanha, ela manda começar pela etapa 1; sem chave de busca, diz onde a
 * chave se configura.
 */
export function HubDaProspeccao() {
  const t = useT();
  const query = useQuery({
    queryKey: ["prospecting"],
    queryFn: async () => (await apiClient.get<{ data: EstadoDaPorta }>("/api/v1/prospecting")).data,
  });
  const data = query.data;
  const ultima = data?.campaigns[0];
  const aprovadas = ultima
    ? data.candidates.filter((c) => c.campaign_id === ultima.id && c.status !== "skipped").length
    : 0;
  const continuarEm = etapaParaContinuar(ultima);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-10 p-4 md:p-8 lg:pt-12">
      <header className="flex max-w-2xl flex-col gap-3">
        <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
          {t("CRM")}
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">{t("Prospecção")}</h1>
        <p className="text-base text-muted-foreground">
          {t(
            "Encontre empresas, prepare a campanha e deixe a IA abrir a conversa. São três etapas, nesta ordem. Cada uma tem a sua tela, e você volta para cá quando quiser.",
          )}
        </p>
      </header>

      <div className="grid gap-5 md:grid-cols-3">
        {ETAPAS.map((etapa) => {
          const blocos = blocosDaEtapa(t, etapa);
          return (
            <Card key={etapa} className="flex flex-col gap-4 rounded-xl p-6">
              <div className="flex items-center justify-between">
                <span
                  aria-hidden="true"
                  className="inline-flex size-8 items-center justify-center rounded-full border border-border-strong bg-surface-elevated text-sm font-semibold"
                >
                  {NUMERO_DA_ETAPA[etapa]}
                </span>
                <span className="text-xs text-text-subtle">
                  {blocos.length} {blocos.length === 1 ? t("bloco") : t("blocos")}
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                <h2 className="text-xl font-semibold tracking-tight">{nomeDaEtapa(t, etapa)}</h2>
                <p className="text-sm text-muted-foreground">{resumoDaEtapa(t, etapa)}</p>
              </div>
              <ul className="flex flex-col gap-2 text-sm">
                {blocos.map((bloco) => (
                  <li key={bloco} className="flex items-start gap-2.5">
                    <span
                      aria-hidden="true"
                      className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground"
                    />
                    {bloco}
                  </li>
                ))}
              </ul>
              <div className="flex-1" />
              <Button asChild className="w-full">
                <Link href={hrefDaEtapa(etapa, ultima?.id ?? null)}>
                  {rotuloDoBotao(t, etapa)}
                  <ArrowRight size={16} aria-hidden />
                </Link>
              </Button>
            </Card>
          );
        })}
      </div>

      <section
        aria-label={t("Onde você parou")}
        className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-surface-elevated px-6 py-4"
      >
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium tracking-widest text-text-subtle uppercase">
            {t("Onde você parou")}
          </span>
          {query.error && (
            <span role="alert" className="text-sm text-destructive">
              {t("Falha ao carregar a prospecção.")}
            </span>
          )}
          {!data && !query.error && (
            <span role="status" className="text-sm text-muted-foreground">
              {t("Carregando campanhas…")}
            </span>
          )}
          {data && !ultima && (
            <span className="text-sm">
              {data.configured
                ? t("Nenhuma campanha ainda. Comece pela etapa 1.")
                : t("Nenhuma campanha ainda. A chave de busca se configura na etapa 1.")}
            </span>
          )}
          {data && ultima && (
            <span className="text-sm">
              {ultima.name}
              <span className="text-muted-foreground">
                {" · "}
                {t(RESUMO_DA_BUSCA[ultima.search_status] ?? ultima.search_status)}
                {ultima.search_status === "succeeded" && (
                  <>
                    {" · "}
                    {aprovadas} {aprovadas === 1 ? t("aprovada") : t("aprovadas")}
                  </>
                )}
                {" · "}
                {t(RESUMO_DA_SITUACAO[ultima.status] ?? ultima.status)}
              </span>
            </span>
          )}
        </div>
        <Button asChild variant="outline">
          <Link href={hrefDaEtapa(continuarEm, ultima?.id ?? null)}>
            {t("Continuar na etapa")} {NUMERO_DA_ETAPA[continuarEm]}
          </Link>
        </Button>
      </section>
    </main>
  );
}
