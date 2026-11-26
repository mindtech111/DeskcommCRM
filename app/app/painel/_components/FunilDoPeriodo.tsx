"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";
import type { FunilDoPainel } from "@/lib/metrics/painel-comercial";

function nomeDaEtapa(id: string, t: (texto: string) => string): string {
  switch (id) {
    case "lead_novo":
      return t("Lead novo");
    case "em_atendimento":
      return t("Em atendimento");
    case "consulta_agendada":
      return t("Consulta agendada");
    case "consulta_realizada":
      return t("Consulta realizada");
    case "ganho":
      return t("Ganho");
    default:
      return id;
  }
}

export function FunilDoPeriodo({ funil }: { funil: FunilDoPainel }) {
  const t = useT();
  const porId = new Map(funil.etapas.map((etapa) => [etapa.id, etapa.total]));
  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle>{t("Funil do período")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ol className="grid gap-3 sm:grid-cols-5">
          {funil.etapas.map((etapa) => (
            <li key={etapa.id} className="flex flex-col gap-1">
              <p className="text-sm text-muted-foreground">{nomeDaEtapa(etapa.id, t)}</p>
              <p className="text-2xl font-semibold tabular-nums">{etapa.total}</p>
            </li>
          ))}
        </ol>
        <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
          {funil.conversoes.map((passo) => {
            const de = porId.get(passo.de) ?? 0;
            const para = porId.get(passo.para) ?? 0;
            const taxa = passo.taxa == null ? "—" : `${Math.round(passo.taxa * 100)}%`;
            return (
              <li key={`${passo.de}-${passo.para}`}>
                {nomeDaEtapa(passo.de, t)} → {nomeDaEtapa(passo.para, t)}: {taxa}{" "}
                <span className="tabular-nums">
                  ({para}/{de})
                </span>
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted-foreground">
          {t(
            "Cada etapa conta o que entrou nela neste período. A taxa compara a etapa de baixo com a de cima e pode passar de 100% quando chega gente que entrou antes.",
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {t(
            "Em atendimento conta a etapa com esse nome. Consulta agendada e Consulta realizada usam a mesma conta dos cards.",
          )}
        </p>
      </CardContent>
    </Card>
  );
}
