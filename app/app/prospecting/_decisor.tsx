"use client";
/**
 * O decisor pelo quadro de sócios da Receita (Fase 5 do fork da Genuine): o
 * cartão que liga e desliga o uso, com a referência do legítimo interesse, e o
 * decisor de cada empresa. As regras moram em `lib/prospecting/mercado/socios.ts`.
 */
import { useState } from "react";
import { UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import type { Decisor } from "@/lib/prospecting/mercado/socios";

export function DecisorDaEmpresa({ decisores }: { decisores: Decisor[] | undefined }) {
  const t = useT();
  const [principal, ...outros] = decisores ?? [];
  if (!principal) return null;
  const descrever = (d: Decisor) => `${d.cargo}${d.desde ? ` ${t("desde")} ${d.desde}` : ""}`;
  return (
    <div className="mt-2 text-xs">
      <p className="flex items-center gap-1">
        <UserRound className="h-3 w-3" aria-hidden />
        <span className="font-medium">{principal.nome}</span>
      </p>
      <p className="text-muted-foreground">{descrever(principal)}</p>
      {outros.length > 0 && (
        <p className="mt-1 text-muted-foreground">
          {t("Outros sócios")}: {outros.map((d) => `${d.nome} (${d.cargo})`).join(", ")}
        </p>
      )}
    </div>
  );
}

export function UsoDeSociosCard({
  estado,
  busy,
  onSalvar,
}: {
  estado: { ativo: boolean; base_legal_ref: string | null } | undefined;
  busy: boolean;
  onSalvar: (pedido: { ativo: boolean; base_legal_ref?: string }) => Promise<boolean>;
}) {
  const t = useT();
  const [referencia, setReferencia] = useState("");
  const ativo = !!estado?.ativo;
  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <UserRound className="h-4 w-4" aria-hidden />
        {t("Decisor pelo quadro de sócios")}
      </h2>
      <p className="mt-2 text-xs text-muted-foreground">
        {t(
          "Mostra o sócio-administrador de cada empresa, pela base pública da Receita. É dado de pessoa: só liga com a referência da avaliação de legítimo interesse que fundamenta a prospecção B2B.",
        )}
      </p>
      {ativo ? (
        <div className="mt-3 flex flex-col gap-2 text-xs">
          <p>
            <span className="font-medium">{t("Ligado.")}</span> {t("Referência")}:{" "}
            {estado?.base_legal_ref}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void onSalvar({ ativo: false })}
          >
            {t("Desligar")}
          </Button>
        </div>
      ) : (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await onSalvar({ ativo: true, base_legal_ref: referencia.trim() }))
              setReferencia("");
          }}
        >
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">
              {t("Avaliação de legítimo interesse do uso dos sócios (referência)")}
            </span>
            <Input
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              minLength={3}
              maxLength={500}
              required
              className="h-8"
            />
          </label>
          <Button type="submit" size="sm" disabled={busy || referencia.trim().length < 3}>
            {t("Ligar")}
          </Button>
        </form>
      )}
    </Card>
  );
}
