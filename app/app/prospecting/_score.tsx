"use client";
/**
 * A nota de cada empresa (Fase 4 do fork da Genuine) e a ferramenta "ficar só
 * com as melhores". As regras moram em `lib/prospecting/score.ts`; aqui só se
 * mostra a nota com o porquê de cada ponto e se aplica a escolha pela seleção
 * que a campanha já tem (`select` na preparação, `select_in_queue` na fila
 * pausada).
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { ROTULO_DO_ANUNCIO, melhores, type Score } from "@/lib/prospecting/score";

/** A partir desta nota a empresa aparece em destaque. */
export const NOTA_EM_DESTAQUE = 50;

export function NotaDaEmpresa({ score }: { score: Score }) {
  const t = useT();
  return (
    <details className="max-w-56 text-xs">
      <summary className="cursor-pointer list-none">
        <span
          className={`inline-flex min-w-9 justify-center rounded-md px-1.5 py-0.5 text-sm font-semibold ${
            score.nota >= NOTA_EM_DESTAQUE
              ? "bg-primary text-primary-foreground"
              : "border text-foreground"
          }`}
          aria-label={`${t("Nota")} ${score.nota}`}
        >
          {score.nota}
        </span>
        {score.semAnaliseDoSite ? (
          <span className="ml-1 text-muted-foreground">{t("sem análise do site")}</span>
        ) : (
          score.anuncio && (
            <span className="ml-1 block pt-1 text-muted-foreground">
              {t(ROTULO_DO_ANUNCIO[score.anuncio])}
            </span>
          )
        )}
      </summary>
      <ul className="mt-2 flex flex-col gap-1 text-muted-foreground">
        {score.itens.length === 0 && <li>{t("Nenhum ponto ainda.")}</li>}
        {score.itens.map((i) => (
          <li key={i.motivo}>
            <span className="font-medium text-foreground">+{i.pontos}</span> {t(i.motivo)}
            {i.detalhe && ` (${i.detalhe})`}
          </li>
        ))}
      </ul>
      {score.anuncio && (
        <p className="mt-2 text-muted-foreground">
          {t("Observação: o pixel de anúncio, por enquanto, só informa e não entra na nota.")}
        </p>
      )}
    </details>
  );
}

export type NaDisputa = {
  id: string;
  selected?: boolean;
  nota: number;
  semAnaliseDoSite: boolean;
};

/** O que muda na seleção para ficar só com as melhores pela regra dada. */
export function ajusteDaSelecao(
  disputa: readonly NaDisputa[],
  regra: { notaMinima?: number | null; quantas?: number | null },
) {
  const ficam = new Set(
    melhores(
      disputa.map((c) => ({ item: c.id, nota: c.nota })),
      regra,
    ),
  );
  return {
    ficam: ficam.size,
    entram: disputa.filter((c) => ficam.has(c.id) && c.selected === false).map((c) => c.id),
    saem: disputa.filter((c) => !ficam.has(c.id) && c.selected !== false).map((c) => c.id),
  };
}

function numero(texto: string): number | null {
  const n = Number(texto);
  return texto.trim() && Number.isInteger(n) && n >= 0 ? n : null;
}

export function FicarComAsMelhores({
  disputa,
  busy,
  onAplicar,
}: {
  disputa: readonly NaDisputa[];
  busy: boolean;
  onAplicar: (entram: string[], saem: string[]) => Promise<boolean>;
}) {
  const t = useT();
  const [notaMinima, setNotaMinima] = useState("");
  const [quantas, setQuantas] = useState("");
  const regra = { notaMinima: numero(notaMinima), quantas: numero(quantas) };
  const temRegra = regra.notaMinima !== null || (regra.quantas ?? 0) > 0;
  const ajuste = ajusteDaSelecao(disputa, regra);
  const semAnalise = disputa.filter((c) => c.semAnaliseDoSite).length;
  const nadaMuda = ajuste.entram.length === 0 && ajuste.saem.length === 0;
  if (disputa.length === 0) return null;
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border p-3 text-xs">
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">{t("Nota mínima")}</span>
        <Input
          type="number"
          min={0}
          max={100}
          inputMode="numeric"
          className="h-8 w-24"
          value={notaMinima}
          onChange={(e) => setNotaMinima(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">{t("No máximo")}</span>
        <Input
          type="number"
          min={1}
          inputMode="numeric"
          className="h-8 w-24"
          value={quantas}
          onChange={(e) => setQuantas(e.target.value)}
        />
      </label>
      <Button
        type="button"
        size="sm"
        disabled={busy || !temRegra || nadaMuda}
        onClick={async () => {
          const aplicou = await onAplicar(ajuste.entram, ajuste.saem);
          if (aplicou) {
            setNotaMinima("");
            setQuantas("");
          }
        }}
      >
        {t("Ficar só com as melhores")}
      </Button>
      <span className="text-muted-foreground">
        {temRegra
          ? `${t("Ficam marcadas")}: ${ajuste.ficam} ${t("de")} ${disputa.length}`
          : t("Escolha a nota mínima, quantas empresas no máximo, ou as duas.")}
      </span>
      {semAnalise > 0 && (
        <span className="basis-full text-muted-foreground">
          {`${semAnalise} ${t("ainda sem análise do site: a nota delas pode subir depois de analisar os sites.")}`}
        </span>
      )}
    </div>
  );
}
