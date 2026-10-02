"use client";
/**
 * O dono ensina o gosto dele à prospecção: avalia empresas ("gostei" / "não
 * gostei", com motivo) e marca campanhas como referência do perfil ideal. As
 * regras (o que a avaliação muda na fila, o que vira recusa aprendida) moram em
 * `lib/prospecting/aprendizado.ts`.
 */
import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import type { Avaliacao, Nota, PerfilAprendido } from "@/lib/prospecting/aprendizado";

export function AvaliacaoDaEmpresa({
  avaliacao,
  busy,
  onAvaliar,
}: {
  avaliacao: Avaliacao | undefined;
  busy: boolean;
  onAvaliar: (nota: Nota, motivo: string) => Promise<boolean>;
}) {
  const t = useT();
  const [editando, setEditando] = useState<{ nota: Nota; motivo: string } | null>(null);
  if (editando)
    return (
      <form
        className="flex min-w-48 flex-col gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await onAvaliar(editando.nota, editando.motivo)) setEditando(null);
        }}
      >
        <p className="text-xs font-medium">
          {editando.nota === "gostei" ? t("Gostei") : t("Não gostei")}
        </p>
        <Input
          autoFocus
          value={editando.motivo}
          maxLength={300}
          onChange={(e) => setEditando({ ...editando, motivo: e.target.value })}
          placeholder={t("Por quê? (opcional)")}
          aria-label={t("Motivo da avaliação")}
        />
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={busy}>
            {t("Salvar")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditando(null)}>
            {t("Cancelar")}
          </Button>
        </div>
      </form>
    );
  return (
    <div className="flex min-w-36 flex-col gap-2">
      <div className="flex gap-1">
        <Button
          type="button"
          size="sm"
          variant={avaliacao?.nota === "gostei" ? "default" : "outline"}
          aria-pressed={avaliacao?.nota === "gostei"}
          aria-label={t("Gostei")}
          title={t("Gostei")}
          disabled={busy}
          onClick={() =>
            setEditando({
              nota: "gostei",
              motivo: avaliacao?.nota === "gostei" ? (avaliacao.motivo ?? "") : "",
            })
          }
        >
          <ThumbsUp className="size-4" aria-hidden />
        </Button>
        <Button
          type="button"
          size="sm"
          variant={avaliacao?.nota === "nao_gostei" ? "default" : "outline"}
          aria-pressed={avaliacao?.nota === "nao_gostei"}
          aria-label={t("Não gostei")}
          title={t("Não gostei")}
          disabled={busy}
          onClick={() =>
            setEditando({
              nota: "nao_gostei",
              motivo: avaliacao?.nota === "nao_gostei" ? (avaliacao.motivo ?? "") : "",
            })
          }
        >
          <ThumbsDown className="size-4" aria-hidden />
        </Button>
      </div>
      {avaliacao && (
        <p className="text-xs text-muted-foreground">
          {avaliacao.nota === "gostei" ? t("Gostei") : t("Não gostei")}
          {avaliacao.motivo ? `: ${avaliacao.motivo}` : ""}
        </p>
      )}
    </div>
  );
}

export function ReferenciaDaCampanha({
  referencia,
  motivo,
  busy,
  onMarcar,
}: {
  referencia: boolean;
  motivo: string | null;
  busy: boolean;
  onMarcar: (ativa: boolean, motivo: string) => Promise<boolean>;
}) {
  const t = useT();
  const [editando, setEditando] = useState<string | null>(null);
  if (editando !== null)
    return (
      <form
        className="mt-4 flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await onMarcar(true, editando)) setEditando(null);
        }}
      >
        <Input
          autoFocus
          value={editando}
          maxLength={300}
          onChange={(e) => setEditando(e.target.value)}
          placeholder={t("O que esta campanha tem de ideal? (opcional)")}
          aria-label={t("Motivo da referência")}
          className="flex-1"
        />
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={busy}>
            {t("Marcar como referência")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditando(null)}>
            {t("Cancelar")}
          </Button>
        </div>
      </form>
    );
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
      {referencia ? (
        <>
          <span className="font-medium">{t("Referência do perfil ideal")}</span>
          {motivo && <span className="text-muted-foreground">{motivo}</span>}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => onMarcar(false, "")}
          >
            {t("Desmarcar")}
          </Button>
        </>
      ) : (
        <>
          <span className="text-muted-foreground">
            {t("As empresas aprovadas desta campanha são o perfil que você procura?")}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => setEditando("")}
          >
            {t("Marcar como referência")}
          </Button>
        </>
      )}
    </div>
  );
}

export function AprendizadoCard({ perfil }: { perfil: PerfilAprendido | undefined }) {
  const t = useT();
  if (!perfil || (!perfil.avaliadas && !perfil.de_referencia)) return null;
  const gosta = perfil.categorias.filter((c) => c.gostei > 0);
  const naoGosta = perfil.categorias.filter((c) => c.nao_gostei > 0);
  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold">{t("O que a prospecção aprendeu com você")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {perfil.avaliadas} {t("empresas avaliadas")} · {perfil.de_referencia}{" "}
        {t("de campanhas de referência")}
      </p>
      {gosta.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium">{t("Categorias que você aprova")}</p>
          <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
            {gosta.slice(0, 8).map((c) => (
              <li key={c.categoria}>
                {c.categoria} ({c.gostei})
              </li>
            ))}
          </ul>
        </div>
      )}
      {naoGosta.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium">{t("Categorias que você recusa")}</p>
          <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
            {naoGosta.slice(0, 8).map((c) => (
              <li key={c.categoria}>
                {c.categoria} ({c.nao_gostei})
                {c.recusa ? ` · ${t("as próximas ficam de fora")}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
