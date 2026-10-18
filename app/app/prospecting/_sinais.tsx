"use client";
/**
 * Os sinais lidos do site de cada empresa (Fase 3 do fork da Genuine). As
 * regras moram em `lib/prospecting/sinais/`; aqui só se mostra o que a análise
 * gravou, sempre com a prova (o trecho no `title` e o link da página).
 */
import { Globe, Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import {
  RESERVA_POR_LEITURA_CENTAVOS,
  TETO_DA_IA_POR_CAMPANHA_CENTAVOS,
} from "@/lib/prospecting/sinais/teto-da-ia";
import { ROTULO_DO_SINAL, VERSAO_DA_ANALISE, type Analise } from "@/lib/prospecting/sinais/tipos";

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
    // Análise feita por uma versão anterior das réguas pode ser pedida de novo.
    const antiga = (c.data.analise?.versao ?? VERSAO_DA_ANALISE) < VERSAO_DA_ANALISE;
    if (status && CONCLUIDAS.has(status) && !antiga) analisadas++;
    else if (status && !CONCLUIDAS.has(status)) naFila++;
    else if (c.status !== "skipped") semPedido++;
  }
  return { analisadas, naFila, semPedido };
}

/**
 * A leitura por IA (Fase 3b): lidas, na fila e as que dá para pedir (site lido
 * pela análise atual, sem leitura por IA, ou com a que falhou ou parou no teto).
 */
export function contarLeiturasIa(candidates: ComAnalise[]) {
  let lidas = 0;
  let naFila = 0;
  let aPedir = 0;
  for (const c of candidates) {
    const a = c.data.analise;
    const ia = a?.ia?.status;
    if (ia === "ok" || ia === "sem_texto") lidas++;
    else if (ia === "pendente" || ia === "lendo") naFila++;
    else if (
      c.status !== "skipped" &&
      a?.status === "ok" &&
      (a.versao ?? 1) === VERSAO_DA_ANALISE &&
      (!ia || ia === "falhou" || ia === "teto")
    )
      aPedir++;
  }
  return { lidas, naFila, aPedir };
}

const dolares = (centavos: number) => `US$ ${(centavos / 100).toFixed(2).replace(".", ",")}`;

export function AnaliseDaCampanha({
  candidates,
  busy,
  onAnalisar,
  gastoIaCentavos = 0,
  onLerComIa,
}: {
  candidates: ComAnalise[];
  busy: boolean;
  onAnalisar: () => Promise<boolean>;
  gastoIaCentavos?: number;
  onLerComIa?: () => Promise<boolean>;
}) {
  const t = useT();
  const { analisadas, naFila, semPedido } = contarAnalises(candidates);
  const ia = contarLeiturasIa(candidates);
  const noTeto = gastoIaCentavos + RESERVA_POR_LEITURA_CENTAVOS > TETO_DA_IA_POR_CAMPANHA_CENTAVOS;
  return (
    <div className="flex flex-col gap-2">
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
      {onLerComIa && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="h-4 w-4" aria-hidden />
          <span>
            {t("Leitura por IA")}: {ia.lidas}
            {ia.naFila > 0 && ` · ${ia.naFila} ${t("na fila da IA")}`}
            {` · ${t("Gasto")}: ${dolares(gastoIaCentavos)} ${t("de")} ${dolares(TETO_DA_IA_POR_CAMPANHA_CENTAVOS)}`}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || ia.aPedir === 0 || noTeto}
            onClick={() => void onLerComIa()}
            title={t(
              "Lê o texto dos sites já analisados com a IA da sua organização e traz resumo, produtos e sinais que a leitura grátis não pega. Tem teto de gasto por campanha.",
            )}
          >
            {ia.aPedir > 0 ? `${t("Ler com IA")} (${ia.aPedir})` : t("Ler com IA")}
          </Button>
          {noTeto && <span>{t("O teto de gasto com IA desta campanha foi atingido.")}</span>}
        </div>
      )}
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
              {s.fonte === "ia" && ` · ${t("IA")}`}
            </a>
          ) : (
            <span
              key={s.tipo}
              title={s.evidencia}
              className="rounded-md border px-1.5 py-0.5 text-xs"
            >
              {t(ROTULO_DO_SINAL[s.tipo])}
              {s.fonte === "ia" && ` · ${t("IA")}`}
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
      {analise.receita && (
        <p className="text-xs text-muted-foreground" title={analise.receita.cnpj}>
          {t("Receita")}: {analise.receita.razao_social} · {t("porte")} {analise.receita.porte} (
          {analise.receita.criterio === "telefone"
            ? t("achada pelo telefone")
            : t("achada pelo nome")}
          )
        </p>
      )}
      <LeituraDaIa ia={analise.ia} />
    </div>
  );
}

function LeituraDaIa({ ia }: { ia: Analise["ia"] }) {
  const t = useT();
  if (!ia) return null;
  if (ia.status === "pendente" || ia.status === "lendo")
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        {ia.status === "pendente" ? t("Na fila da IA") : t("Lendo com IA")}
      </span>
    );
  if (ia.status !== "ok")
    return ia.observacao ? <p className="text-xs text-muted-foreground">{ia.observacao}</p> : null;
  return (
    <div className="flex flex-col gap-1 rounded-md bg-muted/50 p-2 text-xs">
      {ia.resumo && <p>{ia.resumo}</p>}
      {ia.produtos.length > 0 && (
        <p className="text-muted-foreground">
          {t("Produtos")}: {ia.produtos.join(", ")}
        </p>
      )}
      {!ia.resumo && !ia.produtos.length && (
        <p className="text-muted-foreground">{t("A IA não achou nada além da leitura grátis.")}</p>
      )}
    </div>
  );
}
