"use client";
/**
 * A ESCOLHA DOS MODELOS APROVADOS na campanha (fork da Genuine, 2026-11-12;
 * lista em rodízio com proporção em 2026-11-13).
 *
 * Aparece no lugar do texto quando o número escolhido só entrega modelo
 * aprovado (a API oficial do WhatsApp e os parceiros dela). O operador monta
 * uma lista de até cinco modelos aprovados daquele número, diz de onde sai cada
 * variável de cada um, a proporção entre eles e quantos envios a rodada faz por
 * vez. A categoria de cada modelo aparece ao lado do nome, porque a plataforma
 * cobra cada categoria por um preço; a lista é de uma categoria só.
 *
 * O componente é controlado: quem o usa guarda a `EscolhaDeModelo` e monta o
 * pedido com `pedidoDaEscolha` (`lib/campanhas/corpo-do-modelo.ts`), a mesma
 * regra que o servidor confere.
 */
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import {
  DESCRICAO_DA_FONTE,
  FONTES_DA_VAGA,
  ITEM_VAZIO,
  MODELOS_POR_CAMPANHA_MAXIMO,
  PESO_MAXIMO,
  ROTULO_DA_CATEGORIA,
  chaveDoModelo,
  modeloDaCampanhaSchema,
  origemInicial,
  problemaDaEscolha,
  type EscolhaDeModelo,
  type FonteDaVaga,
  type ItemDaEscolha,
  type ModeloDaCampanha,
  type ModeloParaEscolha,
  type OrigemDaVaga,
} from "@/lib/campanhas/corpo-do-modelo";
import type { MetricaDoModelo } from "@/lib/campanhas/metricas-por-modelo";
import type { SituacaoDoModelo } from "@/lib/campanhas/situacao-do-modelo";

export interface ModelosDaConexao {
  exige_modelo: boolean;
  envios_por_rodada: { padrao: number; maximo: number };
  modelos: ModeloParaEscolha[];
}

/** Se o número exige modelo, e os aprovados dele. Sem número, não consulta. */
export function useModelosDaConexao(canalId: string | null) {
  return useQuery({
    queryKey: ["campanha-modelos", canalId],
    enabled: !!canalId,
    queryFn: async () =>
      (
        await apiClient.get<{ data: ModelosDaConexao }>(
          `/api/v1/campaigns/modelos?channel_session_id=${encodeURIComponent(canalId ?? "")}`,
        )
      ).data,
  });
}

/**
 * Os modelos que `GET /api/v1/campaigns/[id]` devolve junto da campanha (fork).
 * Lidos à parte para o tipo da campanha, que é do original, não mudar.
 */
export function modeloDaDetalhada(c: unknown): ModeloDaCampanha | null {
  const r = modeloDaCampanhaSchema.safeParse((c as { modelo?: unknown } | null)?.modelo);
  return r.success ? r.data : null;
}

/** A categoria do modelo, em etiqueta: a plataforma cobra cada uma por um preço. */
export function CategoriaDoModelo({ categoria }: { readonly categoria: string | null }) {
  const t = useT();
  if (!categoria) return null;
  return (
    <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
      {t(ROTULO_DA_CATEGORIA[categoria.toUpperCase()] ?? categoria)}
    </span>
  );
}

const MIDIA = new Set(["image", "video", "document"]);

const CAMPO = "h-9 w-full rounded-md border border-border bg-surface px-2 text-sm";

export function EscolhaDoModelo({
  dados,
  escolha,
  onMudar,
}: {
  readonly dados: ModelosDaConexao;
  readonly escolha: EscolhaDeModelo;
  readonly onMudar: (nova: EscolhaDeModelo) => void;
}) {
  const t = useT();
  const itens = escolha.itens.length > 0 ? escolha.itens : [ITEM_VAZIO];

  function mudarItem(indice: number, item: ItemDaEscolha) {
    onMudar({ ...escolha, itens: itens.map((atual, i) => (i === indice ? item : atual)) });
  }

  const escolhidos = itens.map((i) => dados.modelos.find((m) => chaveDoModelo(m) === i.chave));
  const problema = itens.some((i) => i.chave !== "")
    ? problemaDaEscolha({ ...escolha, itens }, dados.modelos)
    : null;
  const pesos = itens.map((i) => Number(i.peso) || 1);
  const somaDosPesos = pesos.reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t(
          "Este número é da API oficial do WhatsApp: a campanha envia modelos aprovados pela plataforma, e não texto livre.",
        )}
      </p>

      {dados.modelos.length === 0 ? (
        <p role="status" className="rounded-md border border-dashed p-3 text-sm">
          {t("Nenhum modelo aprovado neste número.")}{" "}
          {t("Crie e aprove um modelo na plataforma e sincronize a lista em")}{" "}
          <Link href="/app/templates" className="underline">
            {t("Modelos")}
          </Link>
          .
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {t(
              "Com mais de um modelo, a campanha alterna entre eles a cada envio, na proporção escolhida. Modelo pausado pela plataforma é pulado, e o envio segue com os outros.",
            )}{" "}
            {t(
              "A plataforma cobra cada categoria de modelo por um preço diferente, e todos os modelos da lista precisam ser da mesma categoria.",
            )}
          </p>

          {itens.map((item, indice) => {
            const definicao = escolhidos[indice] ?? null;
            return (
              <fieldset key={indice} className="space-y-3 rounded-md border p-3">
                <legend className="px-1 text-sm font-medium">
                  {t("Modelo")} {indice + 1}
                </legend>
                <div className="space-y-2">
                  <Label htmlFor={`campanha-modelo-${indice}`}>{t("Modelo aprovado")}</Label>
                  <select
                    id={`campanha-modelo-${indice}`}
                    className={CAMPO}
                    value={item.chave}
                    onChange={(e) =>
                      mudarItem(indice, { ...item, chave: e.target.value, origens: {} })
                    }
                  >
                    <option value="">{t("Escolha um modelo")}</option>
                    {dados.modelos.map((m) => (
                      <option
                        key={chaveDoModelo(m)}
                        value={chaveDoModelo(m)}
                        disabled={
                          chaveDoModelo(m) !== item.chave &&
                          itens.some((outro) => outro.chave === chaveDoModelo(m))
                        }
                      >
                        {m.name} · {m.language}
                        {m.category
                          ? ` · ${t(ROTULO_DA_CATEGORIA[m.category.toUpperCase()] ?? m.category)}`
                          : ""}
                      </option>
                    ))}
                  </select>
                </div>

                {definicao && (
                  <>
                    <div className="space-y-1 rounded-md bg-surface-elevated p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs font-medium text-muted-foreground">
                          {t("Texto do modelo")}
                        </p>
                        <CategoriaDoModelo categoria={definicao.category} />
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{definicao.previa}</p>
                    </div>

                    {definicao.vagas.length > 0 && (
                      <div className="space-y-3">
                        <p className="text-sm font-medium">{t("De onde sai cada variável")}</p>
                        {definicao.vagas.map((vaga) => (
                          <VagaDaEscolha
                            key={vaga.chave}
                            vaga={vaga}
                            origem={
                              item.origens[vaga.chave] ??
                              origemInicial(vaga, definicao.valores_salvos)
                            }
                            onMudar={(origem) =>
                              mudarItem(indice, {
                                ...item,
                                origens: { ...item.origens, [vaga.chave]: origem },
                              })
                            }
                          />
                        ))}
                      </div>
                    )}

                    {itens.length > 1 && (
                      <div className="space-y-2">
                        <Label htmlFor={`campanha-peso-${indice}`}>{t("Proporção")}</Label>
                        <Input
                          id={`campanha-peso-${indice}`}
                          type="number"
                          min={1}
                          max={PESO_MAXIMO}
                          placeholder="1"
                          value={item.peso}
                          onChange={(e) => mudarItem(indice, { ...item, peso: e.target.value })}
                        />
                      </div>
                    )}
                  </>
                )}

                {itens.length > 1 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      onMudar({ ...escolha, itens: itens.filter((_, i) => i !== indice) })
                    }
                  >
                    {t("Tirar da lista")}
                  </Button>
                )}
              </fieldset>
            );
          })}

          {itens.length < Math.min(MODELOS_POR_CAMPANHA_MAXIMO, dados.modelos.length) && (
            <Button
              type="button"
              variant="outline"
              onClick={() => onMudar({ ...escolha, itens: [...itens, ITEM_VAZIO] })}
            >
              {t("Adicionar outro modelo")}
            </Button>
          )}

          {itens.length > 1 && escolhidos.every(Boolean) && !problema && (
            <p className="text-sm text-muted-foreground">
              {t("A cada")} {somaDosPesos} {t("envios")}:{" "}
              {itens.map((_, i) => `${pesos[i]} ${t("de")} ${escolhidos[i]!.name}`).join(", ")}.
            </p>
          )}

          {problema && (
            <p role="status" className="text-sm text-warning-fg">
              {problema === "sem_modelo"
                ? t("Escolha um modelo em cada linha da lista.")
                : problema === "repetido"
                  ? t("O mesmo modelo aparece duas vezes na lista.")
                  : problema === "categorias"
                    ? t("Todos os modelos da lista precisam ser da mesma categoria.")
                    : problema === "peso"
                      ? t("A proporção de cada modelo vai de 1 a 10.")
                      : t("Os envios por rodada vão de 1 a 60.")}
            </p>
          )}

          <p className="text-sm text-muted-foreground">
            {t("Quem não tiver o dado que uma variável usa fica de fora, com o motivo na lista.")}
          </p>

          <div className="space-y-2">
            <Label htmlFor="campanha-envios">{t("Envios por rodada")}</Label>
            <Input
              id="campanha-envios"
              type="number"
              min={1}
              max={dados.envios_por_rodada.maximo}
              placeholder={String(dados.envios_por_rodada.padrao)}
              value={escolha.envios}
              onChange={(e) => onMudar({ ...escolha, itens, envios: e.target.value })}
            />
            <p className="text-sm text-muted-foreground">
              {t(
                "Quantas mensagens a campanha manda a cada minuto, de 1 a 60. Os limites por dia e por hora continuam valendo.",
              )}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function VagaDaEscolha({
  vaga,
  origem,
  onMudar,
}: {
  readonly vaga: ModeloParaEscolha["vagas"][number];
  readonly origem: OrigemDaVaga;
  readonly onMudar: (origem: OrigemDaVaga) => void;
}) {
  const t = useT();
  const midia = MIDIA.has(vaga.espera);
  const rotulo = `${t(vaga.onde)} {{${vaga.chave.split(":").pop()}}}`;
  return (
    <div className="space-y-1.5 rounded-md border p-3">
      <p className="text-sm font-medium">{rotulo}</p>
      {(vaga.antes || vaga.depois) && (
        <p className="text-xs text-muted-foreground">
          …{vaga.antes} <strong>[{t("aqui")}]</strong> {vaga.depois}…
        </p>
      )}
      {midia ? (
        <Input
          aria-label={`${t("Link da mídia")} ${rotulo}`}
          placeholder="https://"
          value={origem.fixo}
          onChange={(e) => onMudar({ fonte: "fixo", campo: "", fixo: e.target.value })}
        />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <select
            aria-label={`${t("Origem de")} ${rotulo}`}
            className={CAMPO}
            value={origem.fonte}
            onChange={(e) => onMudar({ ...origem, fonte: e.target.value as FonteDaVaga })}
          >
            {FONTES_DA_VAGA.map((f) => (
              <option key={f} value={f}>
                {t(DESCRICAO_DA_FONTE[f])}
              </option>
            ))}
          </select>
          {(origem.fonte === "contato" || origem.fonte === "lead") && (
            <Input
              aria-label={`${t("Nome do campo")} ${rotulo}`}
              placeholder={t("nome_do_campo")}
              value={origem.campo}
              onChange={(e) => onMudar({ ...origem, campo: e.target.value })}
            />
          )}
          {origem.fonte === "fixo" && (
            <Input
              aria-label={`${t("Valor fixo")} ${rotulo}`}
              value={origem.fixo}
              onChange={(e) => onMudar({ ...origem, fixo: e.target.value })}
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * O conteúdo da campanha na tela de detalhe: os modelos, a proporção e de onde
 * sai cada variável, ou o texto de sempre.
 */
export function ConteudoDaCampanha({
  corpo,
  modelo,
}: {
  readonly corpo: string | null;
  readonly modelo?: ModeloDaCampanha | null;
}) {
  const t = useT();
  if (!modelo) return <p className="text-sm whitespace-pre-wrap">{corpo}</p>;
  const varios = modelo.itens.length > 1;
  return (
    <div className="space-y-3 text-sm">
      {modelo.itens.map((item) => (
        <div key={`${item.template_name}|${item.template_language}`} className="space-y-1">
          <p>
            {t("Modelo aprovado")}: <strong>{item.template_name}</strong> ({item.template_language})
            {varios ? ` · ${t("proporção")} ${item.peso}` : ""}
          </p>
          {Object.keys(item.variable_map).length > 0 && (
            <ul className="space-y-1 text-muted-foreground">
              {Object.entries(item.variable_map).map(([chave, valor]) => (
                <li key={chave}>
                  <span className="font-mono text-xs">{`{{${chave}}}`}</span>: {valor}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <p className="text-muted-foreground">
        {t("Envios por rodada")}: {modelo.envios_por_rodada ?? t("padrão")}
      </p>
    </div>
  );
}

type MetricaComCategoria = MetricaDoModelo & {
  categoria: string | null;
  status: string | null;
  peso: number | null;
  situacao?: SituacaoDoModelo;
};

/** Ativo ou pulado, com o motivo e as recusas desta campanha (`lib/campanhas/situacao-do-modelo.ts`). */
function SituacaoNaCampanha({ situacao }: { readonly situacao: SituacaoDoModelo | undefined }) {
  const t = useT();
  const idioma = useTagDeIdioma();
  if (!situacao) return null;
  const motivo = (() => {
    switch (situacao.motivo) {
      case "pausado":
        return t("pausado pela plataforma");
      case "desativado":
        return t("desativado pela plataforma");
      case "recusado":
        return t("recusado na análise da plataforma");
      case "em_analise":
        return t("em análise na plataforma");
      case "fora_do_numero":
        return t("não encontrado neste número");
      case "outro":
        return t("indisponível na plataforma");
      default:
        return null;
    }
  })();
  const recusa = (() => {
    switch (situacao.ultimaRecusa) {
      case "pausado":
        return t("modelo pausado");
      case "desativado":
        return t("modelo desativado");
      case "nao_aprovado":
        return t("modelo não aprovado ou sem este idioma");
      default:
        return null;
    }
  })();
  return (
    <span className="flex flex-col gap-0.5">
      <span
        className={situacao.ativo ? "font-medium text-success-fg" : "font-medium text-warning-fg"}
      >
        {situacao.ativo ? t("Ativo") : t("Pulado")}
      </span>
      {motivo && <span className="text-xs text-muted-foreground">{motivo}</span>}
      {situacao.qualidadeBaixa && (
        <span className="text-xs text-warning-fg">{t("qualidade baixa")}</span>
      )}
      {situacao.recusas > 0 && (
        <span className="text-xs text-muted-foreground">
          {situacao.recusas} {situacao.recusas === 1 ? t("envio recusado") : t("envios recusados")}
          {recusa ? ` (${recusa})` : ""}
          {situacao.ultimaRecusaEm
            ? ` · ${t("último em")} ${new Date(situacao.ultimaRecusaEm).toLocaleString(idioma, { dateStyle: "short", timeStyle: "short" })}`
            : ""}
        </span>
      )}
    </span>
  );
}

function porcento(valor: number | null): string {
  return valor === null ? "—" : `${Math.round(valor * 100)}%`;
}

/** Entregues, lidas e falhas de cada modelo da campanha. */
export function MetricasPorModelo({
  campanhaId,
  emAndamento,
}: {
  readonly campanhaId: string;
  readonly emAndamento: boolean;
}) {
  const t = useT();
  const consulta = useQuery({
    queryKey: ["campanha-metricas-por-modelo", campanhaId],
    refetchInterval: emAndamento ? 15_000 : false,
    queryFn: async () =>
      (
        await apiClient.get<{ data: { modelos: MetricaComCategoria[]; parcial: boolean } }>(
          `/api/v1/campaigns/${campanhaId}/metricas-por-modelo`,
        )
      ).data,
  });
  const modelos = consulta.data?.modelos ?? [];
  if (modelos.length === 0) return null;
  return (
    <Card className="space-y-3 p-4">
      <h2 className="font-medium">{t("Resultado por modelo")}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="py-2 pr-3">{t("Modelo")}</th>
              <th className="py-2 pr-3">{t("Situação")}</th>
              <th className="py-2 pr-3">{t("Enviadas")}</th>
              <th className="py-2 pr-3">{t("Entregues")}</th>
              <th className="py-2 pr-3">{t("Lidas")}</th>
              <th className="py-2 pr-3">{t("Falharam")}</th>
            </tr>
          </thead>
          <tbody>
            {modelos.map((m) => (
              <tr key={`${m.template_name}|${m.template_language}`} className="border-t align-top">
                <td className="py-2 pr-3">
                  <span className="font-medium">{m.template_name}</span>
                  <span className="ml-1 text-xs text-muted-foreground">{m.template_language}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    <CategoriaDoModelo categoria={m.categoria} />
                    {m.peso !== null && modelos.length > 1 && (
                      <span className="text-xs text-muted-foreground">
                        {t("proporção")} {m.peso}
                      </span>
                    )}
                  </span>
                </td>
                <td className="py-2 pr-3">
                  <SituacaoNaCampanha situacao={m.situacao} />
                </td>
                <td className="py-2 pr-3 tabular-nums">{m.enviados}</td>
                <td className="py-2 pr-3 tabular-nums">
                  {m.entregues}{" "}
                  <span className="text-xs text-muted-foreground">{porcento(m.taxas.entrega)}</span>
                </td>
                <td className="py-2 pr-3 tabular-nums">
                  {m.lidos}{" "}
                  <span className="text-xs text-muted-foreground">{porcento(m.taxas.leitura)}</span>
                </td>
                <td className="py-2 pr-3 tabular-nums">
                  {m.falharam}{" "}
                  <span className="text-xs text-muted-foreground">{porcento(m.taxas.falha)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        {t(
          "Modelo pausado ou recusado pela plataforma é pulado, e quem ele não alcançou volta à fila para outro modelo.",
        )}{" "}
        {t("Entregues sobre enviadas, lidas sobre entregues, falhas sobre tentadas.")}
        {consulta.data?.parcial
          ? ` ${t("Conta parcial: a campanha passou de 20.000 pessoas.")}`
          : ""}
      </p>
    </Card>
  );
}
