"use client";
/**
 * A ESCOLHA DO MODELO APROVADO na campanha (fork da Genuine, 2026-11-12).
 *
 * Aparece no lugar do texto quando o número escolhido só entrega modelo
 * aprovado (a API oficial do WhatsApp e os parceiros dela). O operador escolhe
 * o modelo entre os aprovados daquele número, diz de onde sai cada variável e
 * quantos envios a rodada faz por vez.
 *
 * O componente é controlado: quem o usa guarda a `EscolhaDeModelo` e monta o
 * pedido com `pedidoDaEscolha` (`lib/campanhas/corpo-do-modelo.ts`), a mesma
 * regra que o servidor confere.
 */
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import {
  DESCRICAO_DA_FONTE,
  FONTES_DA_VAGA,
  chaveDoModelo,
  origemInicial,
  type EscolhaDeModelo,
  type FonteDaVaga,
  type ModeloParaEscolha,
  type ModeloDaCampanha,
  type OrigemDaVaga,
} from "@/lib/campanhas/corpo-do-modelo";

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
 * O modelo que `GET /api/v1/campaigns/[id]` devolve junto da campanha (fork).
 * Lido à parte para o tipo da campanha, que é do original, não mudar.
 */
export function modeloDaDetalhada(c: unknown): ModeloDaCampanha | null {
  const m = (c as { modelo?: unknown } | null)?.modelo;
  if (!m || typeof m !== "object") return null;
  const r = m as Partial<ModeloDaCampanha>;
  if (typeof r.template_name !== "string" || typeof r.template_language !== "string") return null;
  return {
    template_name: r.template_name,
    template_language: r.template_language,
    variable_map: (r.variable_map ?? {}) as Record<string, string>,
    envios_por_rodada: r.envios_por_rodada ?? null,
  };
}

const MIDIA = new Set(["image", "video", "document"]);

const ROTULO_DA_CATEGORIA: Record<string, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utilidade",
  AUTHENTICATION: "Autenticação",
};

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
  const definicao = dados.modelos.find((m) => chaveDoModelo(m) === escolha.chave) ?? null;

  function mudarOrigem(chave: string, origem: OrigemDaVaga) {
    onMudar({ ...escolha, origens: { ...escolha.origens, [chave]: origem } });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t(
          "Este número é da API oficial do WhatsApp: a campanha envia um modelo aprovado pela plataforma, e não texto livre.",
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
        <div className="space-y-2">
          <Label htmlFor="campanha-modelo">{t("Modelo aprovado")}</Label>
          <select
            id="campanha-modelo"
            className={CAMPO}
            value={escolha.chave}
            onChange={(e) => onMudar({ ...escolha, chave: e.target.value, origens: {} })}
          >
            <option value="">{t("Escolha um modelo")}</option>
            {dados.modelos.map((m) => (
              <option key={chaveDoModelo(m)} value={chaveDoModelo(m)}>
                {m.name} · {m.language}
                {m.category ? ` · ${t(ROTULO_DA_CATEGORIA[m.category] ?? m.category)}` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {definicao && (
        <>
          <div className="rounded-md bg-surface-elevated p-3">
            <p className="text-xs font-medium text-muted-foreground">{t("Texto do modelo")}</p>
            <p className="mt-1 text-sm whitespace-pre-wrap">{definicao.previa}</p>
          </div>

          {definicao.vagas.length > 0 && (
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">{t("De onde sai cada variável")}</legend>
              {definicao.vagas.map((vaga) => {
                const origem =
                  escolha.origens[vaga.chave] ?? origemInicial(vaga, definicao.valores_salvos);
                const midia = MIDIA.has(vaga.espera);
                const rotulo = `${t(vaga.onde)} {{${vaga.chave.split(":").pop()}}}`;
                return (
                  <div key={vaga.chave} className="space-y-1.5 rounded-md border p-3">
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
                        onChange={(e) =>
                          mudarOrigem(vaga.chave, {
                            fonte: "fixo",
                            campo: "",
                            fixo: e.target.value,
                          })
                        }
                      />
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <select
                          aria-label={`${t("Origem de")} ${rotulo}`}
                          className={CAMPO}
                          value={origem.fonte}
                          onChange={(e) =>
                            mudarOrigem(vaga.chave, {
                              ...origem,
                              fonte: e.target.value as FonteDaVaga,
                            })
                          }
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
                            onChange={(e) =>
                              mudarOrigem(vaga.chave, { ...origem, campo: e.target.value })
                            }
                          />
                        )}
                        {origem.fonte === "fixo" && (
                          <Input
                            aria-label={`${t("Valor fixo")} ${rotulo}`}
                            value={origem.fixo}
                            onChange={(e) =>
                              mudarOrigem(vaga.chave, { ...origem, fixo: e.target.value })
                            }
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              <p className="text-sm text-muted-foreground">
                {t(
                  "Quem não tiver o dado que uma variável usa fica de fora, com o motivo na lista.",
                )}
              </p>
            </fieldset>
          )}

          <div className="space-y-2">
            <Label htmlFor="campanha-envios">{t("Envios por rodada")}</Label>
            <Input
              id="campanha-envios"
              type="number"
              min={1}
              max={dados.envios_por_rodada.maximo}
              placeholder={String(dados.envios_por_rodada.padrao)}
              value={escolha.envios}
              onChange={(e) => onMudar({ ...escolha, envios: e.target.value })}
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

/**
 * O conteúdo da campanha na tela de detalhe: o modelo e de onde sai cada
 * variável, ou o texto de sempre.
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
  return (
    <div className="space-y-2 text-sm">
      <p>
        {t("Modelo aprovado")}: <strong>{modelo.template_name}</strong> ({modelo.template_language})
      </p>
      {Object.keys(modelo.variable_map).length > 0 && (
        <ul className="space-y-1 text-muted-foreground">
          {Object.entries(modelo.variable_map).map(([chave, valor]) => (
            <li key={chave}>
              <span className="font-mono text-xs">{`{{${chave}}}`}</span> → {valor}
            </li>
          ))}
        </ul>
      )}
      <p className="text-muted-foreground">
        {t("Envios por rodada")}: {modelo.envios_por_rodada ?? t("padrão")}
      </p>
    </div>
  );
}
