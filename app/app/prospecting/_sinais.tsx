"use client";
/**
 * Os sinais lidos do site de cada empresa (Fase 3 do fork da Genuine). As
 * regras moram em `lib/prospecting/sinais/`; aqui só se mostra o que a análise
 * gravou, sempre com a prova (o trecho no `title` e o link da página).
 */
import { Globe, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { ROTULO_DO_SINAL, type Analise } from "@/lib/prospecting/sinais/tipos";

type ComAnalise = { status: string; data: { analise?: Analise } };

const CONCLUIDAS = new Set(["ok", "sem_site", "fora_do_ar"]);

function hostDe(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function arrobaDoInstagram(url: string): string {
  const handle = /instagram\.com\/([a-z0-9_.]+)/i.exec(url)?.[1];
  return handle ? `@${handle}` : hostDe(url);
}

export function contarAnalises(candidates: ComAnalise[]) {
  let analisadas = 0;
  let naFila = 0;
  let semPedido = 0;
  for (const c of candidates) {
    const status = c.data.analise?.status;
    if (status && CONCLUIDAS.has(status)) analisadas++;
    else if (status) naFila++;
    else if (c.status !== "skipped") semPedido++;
  }
  return { analisadas, naFila, semPedido };
}

export function AnaliseDaCampanha({
  candidates,
  busy,
  onAnalisar,
}: {
  candidates: ComAnalise[];
  busy: boolean;
  onAnalisar: () => Promise<boolean>;
}) {
  const t = useT();
  const { analisadas, naFila, semPedido } = contarAnalises(candidates);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <Globe className="h-4 w-4" aria-hidden />
      <span>
        {t("Sites analisados")}: {analisadas}
        {naFila > 0 && ` · ${naFila} ${t("na fila da análise")}`}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy || semPedido === 0}
        onClick={() => void onAnalisar()}
        title={t("Lê o site de cada empresa e procura sinais de oportunidade, sem custo.")}
      >
        {semPedido > 0 ? `${t("Analisar sites")} (${semPedido})` : t("Analisar sites")}
      </Button>
    </div>
  );
}

export function SinaisDaEmpresa({ analise }: { analise: Analise | undefined }) {
  const t = useT();
  if (!analise) return <span className="text-xs text-muted-foreground">—</span>;
  if (analise.status === "pendente" || analise.status === "analisando")
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        {analise.status === "pendente" ? t("Na fila da análise") : t("Analisando o site")}
      </span>
    );
  return (
    <div className="flex max-w-64 flex-col gap-1">
      {analise.site && (
        <a
          className="text-xs break-all underline"
          href={analise.site.url}
          target="_blank"
          rel="noreferrer"
        >
          {hostDe(analise.site.url)}
        </a>
      )}
      <div className="flex flex-wrap gap-1">
        {analise.sinais.map((s) =>
          s.link ? (
            <a
              key={s.tipo}
              href={s.link}
              target="_blank"
              rel="noreferrer"
              title={s.evidencia}
              className="rounded-md border px-1.5 py-0.5 text-xs hover:bg-muted"
            >
              {t(ROTULO_DO_SINAL[s.tipo])}
            </a>
          ) : (
            <span
              key={s.tipo}
              title={s.evidencia}
              className="rounded-md border px-1.5 py-0.5 text-xs"
            >
              {t(ROTULO_DO_SINAL[s.tipo])}
            </span>
          ),
        )}
      </div>
      {analise.perfil.instagram && (
        <a
          className="text-xs underline"
          href={analise.perfil.instagram}
          target="_blank"
          rel="noreferrer"
        >
          {arrobaDoInstagram(analise.perfil.instagram)}
        </a>
      )}
      {analise.observacao && <p className="text-xs text-muted-foreground">{analise.observacao}</p>}
    </div>
  );
}
