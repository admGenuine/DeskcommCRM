"use client";
/**
 * QUEM FOI ACHADO, E QUEM VAI SER ABORDADO (fork, 2026-11-03).
 *
 * O bloco de empresas da campanha aberta, no desenho do Radar Curitiba (a
 * ferramenta de prospecção por bairro da Genuine): à esquerda o mapa de bairros
 * pintado pela quantidade de empresas e o ranking de bairros; à direita a lista
 * agrupada por bairro, cada empresa com etiqueta, nome, nota, endereço, decisor,
 * sinais do site e da IA, os contatos em pílula, a conversa no Inbox e o botão
 * que decide se ela entra na fila ("Vai abordar" / "+ Abordar").
 *
 * O bairro é lido do endereço (`lib/prospecting/mapa/bairro.ts`); o desenho só
 * existe para Curitiba. Em outra cidade o mapa some e fica o ranking.
 *
 * Nada aqui grava: marcar, avaliar e abrir conversa são do `_client.tsx`, que
 * passa as funções e continua dono do estado da campanha.
 */
import { useState, type ComponentProps, type ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { safePublicLink, type Prospect } from "@/lib/prospecting/schema";
import type { Score } from "@/lib/prospecting/score";
import type { Decisor } from "@/lib/prospecting/mercado/socios";
import {
  ROTULOS_DAS_FAIXAS,
  SEM_BAIRRO,
  bairroDoEndereco,
  contarPorBairro,
  faixaDaContagem,
  mapaDaCidade,
  normalizarNome,
} from "@/lib/prospecting/mapa/bairro";
import type { MapaDeBairros } from "@/lib/prospecting/mapa/tipos";
import { AvaliacaoDaEmpresa } from "./_avaliacao";
import { DecisorDaEmpresa } from "./_decisor";
import { NOTA_EM_DESTAQUE, NotaDaEmpresa } from "./_score";
import { BuscaNoMapsDaEmpresa, SinaisDaEmpresa } from "./_sinais";

export type EmpresaDaCampanha = {
  readonly id: string;
  readonly campaign_id: string;
  readonly data: Prospect;
  readonly status: string;
  readonly selected?: boolean;
  readonly progress: string;
  readonly message_status: string | null;
  readonly error: string | null;
  readonly conversation_id: string | null;
  readonly decisores?: Decisor[];
};

type OnAvaliar = ComponentProps<typeof AvaliacaoDaEmpresa>["onAvaliar"];

/** A cidade da campanha: a mais comum entre as empresas; sem ela, a da busca ("Curitiba, PR"). */
export function cidadeDaCampanha(
  empresas: readonly { readonly data: { readonly city?: string | null } }[],
  cidadeDaBusca: string | null | undefined,
): string | null {
  const contagem = new Map<string, { nome: string; total: number }>();
  for (const e of empresas) {
    const nome = e.data.city?.trim();
    if (!nome) continue;
    const chave = normalizarNome(nome);
    const atual = contagem.get(chave);
    contagem.set(chave, { nome: atual?.nome ?? nome, total: (atual?.total ?? 0) + 1 });
  }
  const maisComum = [...contagem.values()].sort((a, b) => b.total - a.total)[0];
  if (maisComum) return maisComum.nome;
  const daBusca = cidadeDaBusca?.split(",")[0]?.trim();
  return daBusca || null;
}

/** O bairro de uma empresa, pelo endereço; a cidade dela vale mais que a da campanha. */
export function bairroDaEmpresa(
  empresa: { readonly data: { readonly address: string | null; readonly city?: string | null } },
  cidade: string | null,
): string | null {
  return bairroDoEndereco(empresa.data.address, empresa.data.city ?? cidade);
}

/** As cores das cinco faixas, dos tokens do tema: funcionam no claro e no escuro. */
const COR_DA_FAIXA = [
  "var(--color-surface-elevated)",
  "var(--color-border-strong)",
  "var(--color-text-subtle)",
  "var(--color-text-muted)",
  "var(--color-text)",
] as const;

function MapaDaCampanha({
  mapa,
  contagens,
  escolhido,
  onEscolher,
}: {
  readonly mapa: MapaDeBairros;
  readonly contagens: ReadonlyMap<string, number>;
  readonly escolhido: string | null;
  readonly onEscolher: (bairro: string | null) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-medium">{t("Mapa de bairros")}</h3>
        <span className="text-xs text-text-subtle">
          {escolhido ? t("Clique de novo para ver todos") : t("Clique num bairro para filtrar")}
        </span>
      </div>
      <svg
        role="img"
        aria-label={`${t("Mapa dos bairros de")} ${mapa.cidade}, ${t("colorido pela quantidade de empresas desta campanha")}`}
        viewBox={`-10 -10 ${mapa.largura + 20} ${mapa.altura + 20}`}
        className="block h-auto w-full"
      >
        {mapa.bairros.map((b) => {
          const total = contagens.get(b.nome) ?? 0;
          const ativo = escolhido === b.nome;
          return (
            <path
              key={b.nome}
              d={b.d}
              style={{
                fill: COR_DA_FAIXA[faixaDaContagem(total)],
                stroke: ativo ? "var(--color-accent)" : "var(--color-bg)",
                strokeWidth: ativo ? 5 : 2.5,
                cursor: total > 0 ? "pointer" : "default",
              }}
              onClick={() => total > 0 && onEscolher(ativo ? null : b.nome)}
            >
              <title>{`${b.nome} · ${total}`}</title>
            </path>
          );
        })}
      </svg>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span>{t("Empresas no bairro:")}</span>
        {ROTULOS_DAS_FAIXAS.map((rotulo, faixa) => (
          <span key={rotulo} className="inline-flex items-center gap-1">
            <i
              aria-hidden="true"
              className="inline-block h-2.5 w-4 rounded-sm border"
              style={{ background: COR_DA_FAIXA[faixa] }}
            />
            {rotulo}
          </span>
        ))}
      </div>
    </div>
  );
}

function RankingDeBairros({
  ranking,
  marcadasPorBairro,
  escolhido,
  onEscolher,
  total,
}: {
  readonly ranking: readonly { bairro: string; total: number }[];
  readonly marcadasPorBairro: ReadonlyMap<string, number>;
  readonly escolhido: string | null;
  readonly onEscolher: (bairro: string | null) => void;
  readonly total: number;
}) {
  const t = useT();
  const maximo = Math.max(1, ...ranking.map((r) => r.total));
  const comBairro = ranking.filter((r) => r.bairro !== SEM_BAIRRO);
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-medium">{t("Bairros com mais alvos")}</h3>
        <span className="text-xs text-text-subtle">
          {total} {t("em")} {comBairro.length} {comBairro.length === 1 ? t("bairro") : t("bairros")}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        {ranking.slice(0, 8).map((r) => {
          const marcadas = marcadasPorBairro.get(r.bairro) ?? 0;
          const ativo = escolhido === r.bairro;
          return (
            <button
              key={r.bairro}
              type="button"
              aria-pressed={ativo}
              onClick={() => onEscolher(ativo ? null : r.bairro)}
              className={`grid grid-cols-[minmax(0,1fr)_2.25rem] items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted ${ativo ? "bg-muted" : ""}`}
            >
              <span className="flex min-w-0 flex-col gap-1">
                <span className="truncate">{r.bairro}</span>
                <span
                  aria-hidden="true"
                  className="flex h-1.5 overflow-hidden rounded-full bg-surface-elevated"
                >
                  <i
                    className="block h-full bg-primary"
                    style={{ width: `${(marcadas / maximo) * 100}%` }}
                  />
                  <i
                    className="block h-full bg-border-strong"
                    style={{ width: `${((r.total - marcadas) / maximo) * 100}%` }}
                  />
                </span>
              </span>
              <span className="text-right font-medium tabular-nums">{r.total}</span>
            </button>
          );
        })}
        {ranking.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t("Nenhuma empresa com endereço ainda.")}
          </p>
        )}
      </div>
      <div className="flex gap-3.5 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <i aria-hidden="true" className="inline-block size-2.5 rounded-sm bg-primary" />
          {t("Vão ser abordadas")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i aria-hidden="true" className="inline-block size-2.5 rounded-sm bg-border-strong" />
          {t("Fora da fila")}
        </span>
      </div>
    </div>
  );
}

const PILULA = "inline-flex min-h-8 items-center rounded-full border px-3 text-xs hover:bg-muted";

function digitos(telefone: string): string {
  return telefone.replace(/\D/g, "");
}

function Chip({
  ativo,
  onClick,
  children,
}: {
  readonly ativo: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={onClick}
      className={`inline-flex min-h-9 items-center rounded-full border px-3.5 text-xs transition-colors ${
        ativo
          ? "border-primary bg-surface-elevated text-foreground"
          : "text-muted-foreground hover:bg-muted"
      }`}
    >
      {ativo ? "✓ " : ""}
      {children}
    </button>
  );
}

type Ordem = "bairro" | "nota" | "telefone";
const PAGINA = 24;

export function EmpresasDaCampanha({
  empresas,
  cidadeDaBusca,
  scores,
  busy,
  canSelect,
  marcavel,
  rotuloDoProgresso,
  onMarcar,
  onAvaliar,
}: {
  readonly empresas: readonly EmpresaDaCampanha[];
  readonly cidadeDaBusca: string | null | undefined;
  readonly scores: ReadonlyMap<string, Score>;
  readonly busy: boolean;
  readonly canSelect: boolean;
  readonly marcavel: (empresa: EmpresaDaCampanha) => boolean;
  readonly rotuloDoProgresso: (empresa: EmpresaDaCampanha) => string;
  readonly onMarcar: (empresa: EmpresaDaCampanha, selected: boolean) => Promise<void>;
  readonly onAvaliar: (
    empresa: EmpresaDaCampanha,
    ...resto: Parameters<OnAvaliar>
  ) => ReturnType<OnAvaliar>;
}) {
  const t = useT();
  const [bairroEscolhido, setBairroEscolhido] = useState<string | null>(null);
  const [soComTelefone, setSoComTelefone] = useState(false);
  const [soComSite, setSoComSite] = useState(false);
  const [soMarcadas, setSoMarcadas] = useState(false);
  const [soNotaAlta, setSoNotaAlta] = useState(false);
  const [ordem, setOrdem] = useState<Ordem>("bairro");
  const [limite, setLimite] = useState(PAGINA);

  const cidade = cidadeDaCampanha(empresas, cidadeDaBusca);
  const mapa = mapaDaCidade(cidade);
  const bairroDe = (e: EmpresaDaCampanha) => bairroDaEmpresa(e, cidade) ?? SEM_BAIRRO;
  const notaDe = (e: EmpresaDaCampanha) => scores.get(e.id)?.nota ?? 0;
  const marcada = (e: EmpresaDaCampanha) => e.status !== "skipped" && e.selected !== false;
  const temSite = (e: EmpresaDaCampanha) =>
    !!safePublicLink(e.data.website) || e.data.socials.length > 0;

  // Os chips valem para o mapa e para o ranking; o bairro escolhido só para a lista.
  const pelosChips = empresas.filter(
    (e) =>
      (!soComTelefone || !!e.data.phone) &&
      (!soComSite || temSite(e)) &&
      (!soMarcadas || marcada(e)) &&
      (!soNotaAlta || notaDe(e) >= NOTA_EM_DESTAQUE),
  );
  const ranking = contarPorBairro(pelosChips, bairroDe);
  const contagens = new Map(ranking.map((r) => [r.bairro, r.total]));
  const marcadasPorBairro = new Map(
    contarPorBairro(pelosChips.filter(marcada), bairroDe).map((r) => [r.bairro, r.total]),
  );
  const visiveis = pelosChips.filter((e) => !bairroEscolhido || bairroDe(e) === bairroEscolhido);
  const ordenadas = [...visiveis].sort((a, b) => {
    if (ordem === "telefone" && !!a.data.phone !== !!b.data.phone) return a.data.phone ? -1 : 1;
    if (ordem === "bairro") {
      const ba = bairroDe(a);
      const bb = bairroDe(b);
      if (ba !== bb) {
        if (ba === SEM_BAIRRO) return 1;
        if (bb === SEM_BAIRRO) return -1;
        return (contagens.get(bb) ?? 0) - (contagens.get(ba) ?? 0) || ba.localeCompare(bb, "pt");
      }
    }
    return notaDe(b) - notaDe(a) || a.data.name.localeCompare(b.data.name, "pt");
  });
  const mostradas = ordenadas.slice(0, limite);
  const totalMarcadas = empresas.filter(marcada).length;

  function escolherBairro(bairro: string | null) {
    setBairroEscolhido(bairro);
    setLimite(PAGINA);
  }

  return (
    <section aria-labelledby="empresas-da-campanha" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="empresas-da-campanha" className="text-2xl font-semibold tracking-tight">
            {t("Quem foi achado, e quem vai ser abordado")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {canSelect
              ? t(
                  "As empresas aprovadas na etapa 1, com o que o site, a Receita e o Maps contaram. Use o botão de cada uma para decidir se ela entra na fila.",
                )
              : t(
                  "As empresas aprovadas na etapa 1, com o que o site, a Receita e o Maps contaram. A fila só muda com a campanha pausada.",
                )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip ativo={soComTelefone} onClick={() => setSoComTelefone((v) => !v)}>
            {t("Com telefone")}
          </Chip>
          <Chip ativo={soComSite} onClick={() => setSoComSite((v) => !v)}>
            {t("Com site ou Instagram")}
          </Chip>
          <Chip ativo={soMarcadas} onClick={() => setSoMarcadas((v) => !v)}>
            {t("Vão ser abordadas")}
          </Chip>
          <Chip ativo={soNotaAlta} onClick={() => setSoNotaAlta((v) => !v)}>
            {t("Nota")} {NOTA_EM_DESTAQUE}+
          </Chip>
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,400px)_1fr]">
        <aside className="flex flex-col gap-4">
          {mapa ? (
            <MapaDaCampanha
              mapa={mapa}
              contagens={contagens}
              escolhido={bairroEscolhido}
              onEscolher={escolherBairro}
            />
          ) : (
            <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
              {cidade
                ? `${t("O desenho dos bairros de")} ${cidade} ${t("ainda não foi adicionado; por enquanto, o ranking ao lado é o mapa.")}`
                : t("Sem cidade conhecida nesta campanha, o mapa de bairros não aparece.")}
            </p>
          )}
          <RankingDeBairros
            ranking={ranking}
            marcadasPorBairro={marcadasPorBairro}
            escolhido={bairroEscolhido}
            onEscolher={escolherBairro}
            total={pelosChips.length}
          />
        </aside>

        <div className="flex min-w-0 flex-col gap-2">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">
              <b className="font-semibold text-foreground">{visiveis.length}</b>{" "}
              {visiveis.length === 1 ? t("empresa") : t("empresas")}
              {bairroEscolhido && ` ${t("em")} ${bairroEscolhido}`}
              {" · "}
              {totalMarcadas} {t("vão ser abordadas")}
              {" · "}
              {empresas.length - totalMarcadas} {t("fora da fila")}
              {bairroEscolhido && (
                <>
                  {" · "}
                  <button type="button" className="underline" onClick={() => escolherBairro(null)}>
                    {t("Ver todos os bairros")}
                  </button>
                </>
              )}
            </span>
            <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              {t("Ordenar")}
              <select
                className="h-10 rounded-full border border-input bg-background px-3 text-sm text-foreground"
                value={ordem}
                onChange={(e) => setOrdem(e.target.value as Ordem)}
              >
                <option value="bairro">{t("Agrupar por bairro")}</option>
                <option value="nota">{t("Pela nota")}</option>
                <option value="telefone">{t("Com telefone primeiro")}</option>
              </select>
            </label>
          </div>

          {mostradas.length === 0 && (
            <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              {t("Nenhuma empresa neste filtro.")}
            </p>
          )}

          {mostradas.map((e, indice) => {
            const bairro = bairroDe(e);
            const anterior = indice > 0 ? bairroDe(mostradas[indice - 1]!) : null;
            const cabecalho =
              ordem === "bairro" && bairro !== anterior ? (
                <div className="mt-2 mb-1 flex items-center justify-between border-b px-1 pb-2 text-xs tracking-widest text-text-subtle uppercase">
                  <span>
                    {bairro} · {contagens.get(bairro) ?? 0}
                  </span>
                  {bairro !== SEM_BAIRRO && bairroEscolhido !== bairro && (
                    <button
                      type="button"
                      className="text-xs tracking-normal text-muted-foreground normal-case underline"
                      onClick={() => escolherBairro(bairro)}
                    >
                      {t("Só este bairro")}
                    </button>
                  )}
                </div>
              ) : null;
            const selecionada = marcada(e);
            const podeMarcar = canSelect && marcavel(e);
            const site = safePublicLink(e.data.website);
            const instagram = e.data.socials.find((s) => /instagram\.com/i.test(s));
            const maps = safePublicLink(e.data.maps_url);
            const score = scores.get(e.id);
            return (
              <div key={e.id} className="flex flex-col gap-2">
                {cabecalho}
                <article
                  aria-label={e.data.name}
                  className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 rounded-xl border p-4 ${
                    selecionada ? "border-primary bg-surface-elevated" : "bg-card"
                  }`}
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {e.data.category && (
                      <span className="rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase">
                        {e.data.category}
                      </span>
                    )}
                    <span className="text-base font-medium break-words">{e.data.name}</span>
                    {score && <NotaDaEmpresa score={score} />}
                  </div>
                  {podeMarcar ? (
                    <Button
                      type="button"
                      size="sm"
                      variant={selecionada ? "default" : "outline"}
                      aria-pressed={selecionada}
                      disabled={busy}
                      className="col-start-2 row-span-2 self-start rounded-full"
                      onClick={() => void onMarcar(e, !selecionada)}
                    >
                      {selecionada ? t("Vai abordar") : t("+ Abordar")}
                    </Button>
                  ) : (
                    <span className="col-start-2 row-span-2 inline-flex min-h-8 items-center self-start rounded-full border px-3 text-xs text-muted-foreground">
                      {rotuloDoProgresso(e)}
                    </span>
                  )}
                  <div className="col-start-1 flex min-w-0 flex-col gap-1 text-sm text-muted-foreground">
                    <span className="break-words">
                      {e.data.address ?? t("Endereço não localizado")}
                      {e.data.rating !== null && (
                        <>
                          {" · "}
                          {e.data.rating} ★ · {e.data.reviews ?? 0} {t("avaliações")}
                        </>
                      )}
                    </span>
                    {(e.data.razao_social || e.data.porte) && (
                      <span>
                        {e.data.razao_social}
                        {e.data.porte && ` · ${t("porte")} ${e.data.porte}`}
                      </span>
                    )}
                    <DecisorDaEmpresa decisores={e.decisores} />
                    <SinaisDaEmpresa analise={e.data.analise} />
                    <BuscaNoMapsDaEmpresa busca={e.data.maps_busca} />
                    {e.error && podeMarcar === false && <span className="text-xs">{e.error}</span>}
                    {e.message_status && (
                      <span className="text-xs">
                        {t("Mensagem:")} {e.message_status}
                      </span>
                    )}
                  </div>
                  <div className="col-span-2 mt-1 flex flex-wrap items-center gap-1.5">
                    {e.data.phone ? (
                      <>
                        <a
                          href={`tel:${e.data.phone}`}
                          className={`${PILULA} font-medium tabular-nums`}
                        >
                          {e.data.phone}
                        </a>
                        <a
                          href={`https://wa.me/${digitos(e.data.phone)}`}
                          target="_blank"
                          rel="noreferrer"
                          className={PILULA}
                        >
                          {t("WhatsApp")}
                        </a>
                      </>
                    ) : (
                      <span className="px-1 text-xs text-text-subtle">{t("Sem telefone")}</span>
                    )}
                    {site && (
                      <a href={site} target="_blank" rel="noreferrer" className={PILULA}>
                        {t("Site")}
                      </a>
                    )}
                    {instagram && safePublicLink(instagram) && (
                      <a
                        href={safePublicLink(instagram)}
                        target="_blank"
                        rel="noreferrer"
                        className={PILULA}
                      >
                        {t("Instagram")}
                      </a>
                    )}
                    {maps && (
                      <a href={maps} target="_blank" rel="noreferrer" className={PILULA}>
                        {t("Google Maps")}
                      </a>
                    )}
                    {e.data.emails.map((email) => (
                      <a key={email} href={`mailto:${email}`} className={`${PILULA} break-all`}>
                        {email}
                      </a>
                    ))}
                    {e.conversation_id ? (
                      <Link
                        href={`/app/inbox?id=${e.conversation_id}`}
                        className={`${PILULA} border-primary bg-surface-elevated`}
                      >
                        {t("Conversa no Inbox")}
                      </Link>
                    ) : (
                      <span className="px-1 text-xs text-text-subtle">
                        {t("Sem conversa ainda")} · {rotuloDoProgresso(e)}
                      </span>
                    )}
                    <span className="ml-auto">
                      <AvaliacaoDaEmpresa
                        avaliacao={e.data.avaliacao}
                        busy={busy}
                        onAvaliar={(nota, motivo) => onAvaliar(e, nota, motivo)}
                      />
                    </span>
                  </div>
                </article>
              </div>
            );
          })}

          {ordenadas.length > mostradas.length && (
            <div className="flex justify-center py-3">
              <Button type="button" variant="outline" onClick={() => setLimite((l) => l + PAGINA)}>
                {t("Mostrar mais")} ({ordenadas.length - mostradas.length})
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
