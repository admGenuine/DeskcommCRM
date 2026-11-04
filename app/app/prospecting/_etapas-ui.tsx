"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "@phosphor-icons/react";
import { useT } from "@/hooks/i18n/useT";
import { Label } from "@/components/ui/label";
import {
  ABAS_DA_CAMPANHA,
  ETAPAS,
  NUMERO_DA_ETAPA,
  hrefDaCampanha,
  hrefDaEtapa,
  type AbaDaCampanha,
  type Etapa,
} from "./_etapas";

/** O nome curto de cada etapa, como aparece no seletor 1 · 2 e no título da tela. */
export function nomeDaEtapa(t: (texto: string) => string, etapa: Etapa): string {
  switch (etapa) {
    case "empresas":
      return t("Prospecção");
    case "campanhas":
      return t("Campanha");
  }
}

/** A frase sob o título de cada etapa. */
export function descricaoDaEtapa(t: (texto: string) => string, etapa: Etapa): string {
  switch (etapa) {
    case "empresas":
      return t(
        "Escolha o público e a região, encontre empresas e separe quem vale a conversa. Nenhuma abordagem começa nesta etapa.",
      );
    case "campanhas":
      return t(
        "Cada busca aprovada vira uma campanha. Abra uma para preparar e configurar a abordagem; acompanhe aqui a fila, quem respondeu e quem qualificou.",
      );
  }
}

/** O nome de cada aba da campanha aberta. */
export function nomeDaAba(t: (texto: string) => string, aba: AbaDaCampanha): string {
  switch (aba) {
    case "preparar":
      return t("Preparar a campanha");
    case "abordagem":
      return t("Abordagem");
  }
}

function descricaoDaAba(t: (texto: string) => string, aba: AbaDaCampanha): string {
  switch (aba) {
    case "preparar":
      return t(
        "Nome, referência do perfil ideal e quem foi achado: marque quem vai ser abordado antes de configurar a abordagem.",
      );
    case "abordagem":
      return t(
        "A IA usa o agente escolhido para abrir a conversa e atender as respostas. As proteções do canal continuam valendo.",
      );
  }
}

const PILULA_ATIVA = "bg-primary text-primary-foreground";
const PILULA_INATIVA = "text-muted-foreground hover:bg-muted hover:text-foreground";
const NUMERO_ATIVO = "bg-primary-foreground text-primary";
const NUMERO_INATIVO = "border border-border-strong";

/** O seletor 1 · 2: pílula branca na etapa atual, a outra em cinza, as duas levando a campanha junto. */
export function SeletorDeEtapas({
  atual,
  campanhaId,
}: {
  readonly atual: Etapa;
  readonly campanhaId: string | null;
}) {
  const t = useT();
  return (
    <nav
      aria-label={t("Etapas da prospecção")}
      className="flex gap-1 rounded-full border bg-card p-1"
    >
      {ETAPAS.map((etapa) => {
        const ativa = etapa === atual;
        return (
          <Link
            key={etapa}
            href={hrefDaEtapa(etapa, campanhaId)}
            aria-current={ativa ? "page" : undefined}
            className={`inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors ${ativa ? PILULA_ATIVA : PILULA_INATIVA}`}
          >
            <span
              aria-hidden="true"
              className={`inline-flex size-5 items-center justify-center rounded-full text-[11px] font-semibold ${ativa ? NUMERO_ATIVO : NUMERO_INATIVO}`}
            >
              {NUMERO_DA_ETAPA[etapa]}
            </span>
            {nomeDaEtapa(t, etapa)}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * O cabeçalho de toda etapa: caminho de volta à porta, título, frase e o
 * seletor 1 · 2. `acao` é o botão do canto (Configurar busca na etapa 1).
 */
export function CabecalhoDaEtapa({
  etapa,
  campanhaId,
  acao,
}: {
  readonly etapa: Etapa;
  readonly campanhaId: string | null;
  readonly acao?: ReactNode;
}) {
  const t = useT();
  return (
    <header className="flex flex-wrap items-end justify-between gap-5">
      <div className="flex max-w-2xl flex-col gap-2">
        <Link
          href={hrefDaEtapa(null, campanhaId)}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={16} aria-hidden />
          {t("Voltar para Prospecção")}
        </Link>
        <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
          {t("CRM")} · {t("Prospecção")} · {t("Etapa")} {NUMERO_DA_ETAPA[etapa]} {t("de")} 2
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">{nomeDaEtapa(t, etapa)}</h1>
        <p className="text-sm text-muted-foreground">{descricaoDaEtapa(t, etapa)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {acao}
        <SeletorDeEtapas atual={etapa} campanhaId={campanhaId} />
      </div>
    </header>
  );
}

/** O que o cabeçalho da campanha aberta mostra em números, à direita do título. */
export type NumerosDaCampanha = {
  readonly aprovadas: number;
  readonly marcadas: number;
  readonly bairros: number;
};

/**
 * O cabeçalho da campanha aberta, no desenho do Radar: caminho de volta à
 * etapa 2, etiqueta com a situação, o nome grande, a frase da aba, três
 * números e, embaixo, as duas abas em pílula. Trocar de campanha é um seletor
 * (a lista mora na etapa 2), para a conversa de configuração de cada uma
 * continuar na mesma tela, com o texto ainda não salvo preservado.
 */
export function CabecalhoDaCampanha({
  campanha,
  campanhas,
  aba,
  situacao,
  busca,
  numeros,
  onTrocar,
}: {
  readonly campanha: { readonly id: string; readonly name: string } | null;
  readonly campanhas: readonly { readonly id: string; readonly name: string }[];
  readonly aba: AbaDaCampanha;
  readonly situacao: string;
  readonly busca: string;
  readonly numeros: NumerosDaCampanha;
  readonly onTrocar: (id: string) => void;
}) {
  const t = useT();
  return (
    <header className="flex flex-col gap-5">
      <Link
        href={hrefDaEtapa("campanhas", campanha?.id ?? null)}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={16} aria-hidden />
        {t("Voltar para Campanha")}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex max-w-2xl flex-col gap-3">
          <span className="inline-flex items-center gap-2 self-start rounded-full border px-3.5 py-1.5 text-xs">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-destructive" />
            {t("Campanha")}
            {campanha && (
              <>
                {" · "}
                {situacao}
                {" · "}
                {busca}
              </>
            )}
          </span>
          <h1 className="text-4xl font-semibold tracking-tight">
            {campanha?.name ?? t("Campanha não encontrada")}
          </h1>
          <p className="text-base text-muted-foreground">
            {campanha
              ? descricaoDaAba(t, aba)
              : t("Esta campanha não existe ou foi apagada. Volte à etapa 2 para escolher outra.")}
          </p>
        </div>
        {campanha && (
          <dl className="grid grid-cols-3 overflow-hidden rounded-xl border bg-card">
            {(
              [
                [numeros.aprovadas, t("aprovadas")],
                [numeros.marcadas, t("vão ser abordadas")],
                [numeros.bairros, t("bairros com alvos")],
              ] as const
            ).map(([valor, rotulo], indice) => (
              <div
                key={rotulo}
                className={`flex flex-col px-4 py-3 ${indice > 0 ? "border-l" : ""}`}
              >
                <dd className="text-3xl font-normal tracking-tight tabular-nums">{valor}</dd>
                <dt className="text-xs text-muted-foreground">{rotulo}</dt>
              </div>
            ))}
          </dl>
        )}
      </div>
      {campanha && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <nav
            aria-label={t("Abas da campanha")}
            className="flex gap-1 rounded-full border bg-card p-1"
          >
            {ABAS_DA_CAMPANHA.map((candidata, indice) => {
              const ativa = candidata === aba;
              return (
                <Link
                  key={candidata}
                  href={hrefDaCampanha(campanha.id, candidata)}
                  aria-current={ativa ? "page" : undefined}
                  className={`inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors ${ativa ? PILULA_ATIVA : PILULA_INATIVA}`}
                >
                  <span
                    aria-hidden="true"
                    className={`inline-flex size-5 items-center justify-center rounded-full text-[11px] font-semibold ${ativa ? NUMERO_ATIVO : NUMERO_INATIVO}`}
                  >
                    {indice + 1}
                  </span>
                  {nomeDaAba(t, candidata)}
                </Link>
              );
            })}
          </nav>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Label htmlFor="prospecting-campanha" className="text-sm text-muted-foreground">
                {t("Campanha")}
              </Label>
              <select
                id="prospecting-campanha"
                className="h-10 max-w-72 rounded-full border border-input bg-background px-3 text-sm"
                value={campanha.id}
                onChange={(e) => onTrocar(e.target.value)}
              >
                {campanhas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <Link
              href={hrefDaEtapa("campanhas", campanha.id)}
              className="inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-medium hover:bg-muted"
            >
              {t("Ver resultados")}
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}

/**
 * Situação de campanha ou de busca, em etiqueta de canto reto e fundo cheio.
 * Fork, 2026-11-04: a situação era um `Badge` de contorno, que neste desenho é
 * idêntico ao botão em pílula; o dono clicou em "Preparar campanha" esperando
 * uma ação. Botão é pílula com contorno; situação é esta etiqueta.
 */
export function Etiqueta({
  children,
  tom = "neutro",
}: {
  readonly children: ReactNode;
  readonly tom?: "neutro" | "forte";
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase ${
        tom === "forte" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
      }`}
    >
      {children}
    </span>
  );
}

/** A cor do ponto de cada andamento da abordagem (`prospecting_candidates.progress`). */
const COR_DO_ANDAMENTO: Record<string, string> = {
  queued: "bg-info",
  sending: "bg-info",
  sent: "bg-text-muted",
  replied: "bg-warning",
  qualified: "bg-success",
  skipped: "bg-border-strong",
  new: "bg-border-strong",
};

/** O andamento de uma empresa: ponto e texto, sem contorno, para não ser lido como botão. */
export function Andamento({
  progresso,
  rotulo,
}: {
  readonly progresso: string;
  readonly rotulo: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-foreground">
      <span
        aria-hidden="true"
        className={`size-2 shrink-0 rounded-full ${COR_DO_ANDAMENTO[progresso] ?? "bg-border-strong"}`}
      />
      {rotulo}
    </span>
  );
}
