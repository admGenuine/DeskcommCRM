"use client";
/**
 * A aba Mercado da Prospecção (fork da Genuine, Fase 2): as indústrias de
 * alimentos da base pública da Receita, filtradas, viram uma campanha sem
 * busca paga. A prévia vem de `GET /api/v1/prospecting/market`; a criação, da
 * ação `market_campaign`. Filtros e ordem em `lib/prospecting/mercado/filtros.ts`.
 */
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { PreviaDoMercado } from "@/lib/prospecting/mercado/campanha";
import { GRUPOS_DE_ALIMENTO, type FiltrosDoMercado } from "@/lib/prospecting/mercado/filtros";
import { PORTES_DO_MERCADO, type PorteDoMercado } from "@/lib/prospecting/mercado/porte";
import { randomId } from "@/lib/random-id";

const selectClass = "mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

const FILTROS_INICIAIS: FiltrosDoMercado = {
  uf: null,
  municipio: null,
  grupo: null,
  portes: [...PORTES_DO_MERCADO],
  idade_minima_anos: 0,
  com_telefone: true,
  so_principal: true,
  so_matriz: false,
};

export function MercadoForm({
  busy,
  onCriar,
}: {
  busy: boolean;
  onCriar: (body: {
    request_id: string;
    filtros: FiltrosDoMercado;
    limite: number;
  }) => Promise<boolean>;
}) {
  const t = useT();
  const [filtros, setFiltros] = useState<FiltrosDoMercado>(FILTROS_INICIAIS);
  const [limite, setLimite] = useState(50);
  const tentativa = useRef<{ chave: string; id: string } | null>(null);
  const previa = useQuery({
    queryKey: ["prospecting-market", filtros],
    queryFn: async () =>
      (
        await apiClient.get<{ data: PreviaDoMercado }>(
          `/api/v1/prospecting/market?filtros=${encodeURIComponent(JSON.stringify(filtros))}`,
        )
      ).data,
  });
  const dados = previa.data;
  const mudar = (parcial: Partial<FiltrosDoMercado>) => setFiltros((f) => ({ ...f, ...parcial }));
  const rotulosDePorte: Record<PorteDoMercado, string> = {
    ME: t("Microempresa (ME)"),
    EPP: t("Pequeno porte (EPP)"),
    DEMAIS: t("Médio e grande"),
    NAO_INFORMADO: t("Porte não informado"),
  };
  const levar = Math.min(limite || 0, dados?.novas ?? 0);

  if (dados && !dados.referencia)
    return (
      <p role="status" className="mt-4 rounded-md border bg-muted/30 p-3 text-sm">
        {t(
          "A base da Receita ainda não foi importada nesta instalação. Rode a rotina do mercado no GitHub com a opção de gravar no banco.",
        )}
      </p>
    );

  return (
    <form
      className="mt-4 space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const chave = JSON.stringify([filtros, limite]);
        if (tentativa.current?.chave !== chave) tentativa.current = { chave, id: randomId() };
        if (await onCriar({ request_id: tentativa.current.id, filtros, limite })) {
          tentativa.current = null;
          await previa.refetch();
        }
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="mercado-uf">{t("Estado")}</Label>
          <select
            id="mercado-uf"
            className={selectClass}
            value={filtros.uf ?? ""}
            onChange={(e) => mudar({ uf: e.target.value || null, municipio: null })}
          >
            <option value="">{t("PR e SC")}</option>
            <option value="PR">PR</option>
            <option value="SC">SC</option>
          </select>
        </div>
        <div>
          <Label htmlFor="mercado-idade">{t("Aberta há pelo menos (anos)")}</Label>
          <Input
            id="mercado-idade"
            type="number"
            min={0}
            max={100}
            value={filtros.idade_minima_anos}
            onChange={(e) => mudar({ idade_minima_anos: Math.max(0, Number(e.target.value) || 0) })}
            className="mt-1"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="mercado-cidade">{t("Cidade")}</Label>
        <select
          id="mercado-cidade"
          className={selectClass}
          value={filtros.municipio ?? ""}
          onChange={(e) => mudar({ municipio: e.target.value || null })}
        >
          <option value="">{t("Todas as cidades")}</option>
          {(dados?.municipios ?? []).map((m) => (
            <option key={`${m.municipio}-${m.uf}`} value={m.municipio}>
              {m.municipio} ({m.uf}) · {m.empresas}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="mercado-grupo">{t("Tipo de alimento")}</Label>
        <select
          id="mercado-grupo"
          className={selectClass}
          value={filtros.grupo ?? ""}
          onChange={(e) => mudar({ grupo: e.target.value || null })}
        >
          <option value="">{t("Todos os tipos")}</option>
          {GRUPOS_DE_ALIMENTO.map((g) => (
            <option key={g.id} value={g.id}>
              {t(g.rotulo)}
            </option>
          ))}
        </select>
      </div>
      <fieldset>
        <legend className="text-sm font-medium">{t("Porte na Receita")}</legend>
        <div className="mt-1 grid grid-cols-2 gap-1">
          {PORTES_DO_MERCADO.map((porte) => (
            <label key={porte} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={filtros.portes.includes(porte)}
                onChange={(e) => {
                  const portes = e.target.checked
                    ? [...filtros.portes, porte]
                    : filtros.portes.filter((p) => p !== porte);
                  if (portes.length) mudar({ portes });
                }}
              />
              {rotulosDePorte[porte]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="space-y-1 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={filtros.com_telefone}
            onChange={(e) => mudar({ com_telefone: e.target.checked })}
          />
          {t("Só com telefone")}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={filtros.so_principal}
            onChange={(e) => mudar({ so_principal: e.target.checked })}
          />
          {t("Alimento como atividade principal")}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={filtros.so_matriz}
            onChange={(e) => mudar({ so_matriz: e.target.checked })}
          />
          {t("Só matrizes (sem filiais)")}
        </label>
      </div>

      <div role="status" className="rounded-md border bg-muted/30 p-3 text-sm">
        {previa.isLoading || !dados ? (
          t("Consultando o mercado…")
        ) : (
          <>
            <p>
              <span className="font-semibold tabular-nums">{dados.novas}</span>{" "}
              {t("empresas novas neste filtro")} ({dados.total} {t("no total")}).
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("Base da Receita de")} {dados.referencia}.
            </p>
            {dados.amostra.length > 0 && (
              <>
                <p className="mt-3 text-xs font-medium">{t("As primeiras que entram")}</p>
                <ul className="mt-1 space-y-1 text-xs">
                  {dados.amostra.map((a) => (
                    <li key={a.cnpj}>
                      <span className="font-medium">{a.nome}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {a.municipio}/{a.uf} ·{" "}
                        {rotulosDePorte[a.porte as PorteDoMercado] ?? a.porte}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>

      <div>
        <Label htmlFor="mercado-limite">{t("Quantas levar para a campanha")}</Label>
        <Input
          id="mercado-limite"
          type="number"
          min={1}
          max={200}
          value={limite}
          onChange={(e) => setLimite(Number(e.target.value))}
          required
          className="mt-1"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {t(
          "Sem custo de busca: as empresas vêm da base pública da Receita. As maiores entram primeiro. Nenhuma abordagem começa nesta etapa.",
        )}
      </p>
      <Button className="w-full" type="submit" disabled={busy || levar < 1}>
        {busy ? t("Aguarde…") : `${t("Criar campanha com")} ${levar} ${t("empresas")}`}
      </Button>
    </form>
  );
}
