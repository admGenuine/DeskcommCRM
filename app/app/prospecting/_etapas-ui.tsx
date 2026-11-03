"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "@phosphor-icons/react";
import { useT } from "@/hooks/i18n/useT";
import { ETAPAS, NUMERO_DA_ETAPA, hrefDaEtapa, type Etapa } from "./_etapas";

/** O nome curto de cada etapa, como aparece no seletor 1 · 2 · 3 e no título da tela. */
export function nomeDaEtapa(t: (texto: string) => string, etapa: Etapa): string {
  switch (etapa) {
    case "empresas":
      return t("Prospecção");
    case "campanhas":
      return t("Campanha");
    case "abordagem":
      return t("Abordagem");
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
        "Cada busca aprovada vira uma campanha. Aqui você a prepara, acompanha a fila e vê quem respondeu e quem qualificou.",
      );
    case "abordagem":
      return t(
        "A IA usa o agente escolhido para abrir a conversa e atender as respostas. As proteções do canal continuam valendo.",
      );
  }
}

/** O seletor 1 · 2 · 3: pílula branca na etapa atual, as outras em cinza, todas levando a campanha junto. */
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
            className={`inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors ${
              ativa
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <span
              aria-hidden="true"
              className={`inline-flex size-5 items-center justify-center rounded-full text-[11px] font-semibold ${
                ativa ? "bg-primary-foreground text-primary" : "border border-border-strong"
              }`}
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
 * seletor 1 · 2 · 3. `acao` é o botão do canto (Configurar busca na etapa 1,
 * Trocar de campanha na 3).
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
          {t("CRM")} · {t("Prospecção")} · {t("Etapa")} {NUMERO_DA_ETAPA[etapa]} {t("de")} 3
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
