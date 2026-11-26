"use client";

import Link from "next/link";
import { useState } from "react";

import { EmptyState } from "@/components/empty/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { usePainel, type RespostaDoPainel } from "@/hooks/metrics/usePainel";
import type { Delta, RetratoDoPainel } from "@/lib/metrics/painel";
import { FUSO_DO_PAINEL, type PeriodoPainel } from "@/lib/metrics/painel-periodo";
import { formatarDuracao } from "@/lib/metrics/canais";
import { formatCents } from "@/lib/money";
import { Megaphone, WarningOctagon } from "@/lib/ui/icons";

function rotuloLivre(valor: string, t: (texto: string) => string): string {
  if (valor === "sem origem") return t("Sem origem");
  if (valor === "sem campanha") return t("Sem campanha");
  if (valor === "link removido") return t("Link removido");
  return valor;
}

function linhaAnterior(
  delta: Delta,
  t: (texto: string) => string,
  formato: (n: number) => string = (n) => String(n),
): string | null {
  if (delta.anterior == null) return null;
  const base = `${t("Período anterior")}: ${formato(delta.anterior)}`;
  if (delta.percentual == null) return base;
  const pct = Math.round(delta.percentual * 100);
  const sinal = pct > 0 ? "+" : "";
  return `${base} (${sinal}${pct}%)`;
}

function Numero({
  valor,
  delta,
  formato,
}: {
  valor: number;
  delta: Delta;
  formato?: (n: number) => string;
}) {
  const t = useT();
  const anterior = linhaAnterior(delta, t, formato);
  return (
    <div>
      <p className="text-3xl font-semibold tracking-tight tabular-nums">
        {formato ? formato(valor) : valor}
      </p>
      {anterior ? <p className="text-xs text-muted-foreground">{anterior}</p> : null}
    </div>
  );
}

function dinheiro(cents: number, moeda: string | null, t: (texto: string) => string): string {
  if (!moeda || !/^[A-Z]{3}$/.test(moeda)) return t("Sem moeda");
  return formatCents(cents, moeda);
}

function TabelaSimples({
  colunas,
  linhas,
}: {
  colunas: [string, string];
  linhas: Array<{ chave: string; a: string; b: string }>;
}) {
  if (linhas.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{colunas[0]}</TableHead>
            <TableHead className="text-right">{colunas[1]}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {linhas.map((linha) => (
            <TableRow key={linha.chave}>
              <TableCell>{linha.a}</TableCell>
              <TableCell className="text-right tabular-nums">{linha.b}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function BlocoMeta({ meta }: { meta: RetratoDoPainel["meta"] }) {
  const t = useT();
  if (!meta.conectado) {
    return (
      <EmptyState
        icon={Megaphone}
        headline={t("Conecte a conta de anúncios")}
        subcopy={t("O gasto e o custo por lead aparecem quando a conta está conectada.")}
        primary={{ label: t("Abrir conexão de anúncios"), href: "/app/settings/meta-ads" }}
      />
    );
  }
  if (meta.gasto_cents == null || !meta.moeda) {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p>{t("A conta está conectada. O gasto e o custo por lead ainda não são lidos daqui.")}</p>
        <Link
          href="/app/settings/meta-ads"
          className="text-sm text-accent underline underline-offset-2"
        >
          {t("Abrir conexão de anúncios")}
        </Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm text-muted-foreground">{t("Gasto no período")}</p>
        <p className="text-3xl font-semibold tabular-nums">
          {formatCents(meta.gasto_cents, meta.moeda)}
        </p>
      </div>
      <div>
        <p className="text-sm text-muted-foreground">{t("Custo por lead")}</p>
        <p className="text-2xl font-semibold tabular-nums">
          {meta.custo_por_lead_cents == null
            ? "—"
            : formatCents(meta.custo_por_lead_cents, meta.moeda)}
        </p>
      </div>
    </div>
  );
}

export function PainelClient() {
  const t = useT();
  const tag = useTagDeIdioma();
  const [periodo, setPeriodo] = useState<PeriodoPainel>("hoje");
  const { data, isLoading, isError, isFetching, dataUpdatedAt, refetch } = usePainel(periodo);

  const hora =
    dataUpdatedAt > 0
      ? new Intl.DateTimeFormat(tag, {
          timeZone: FUSO_DO_PAINEL,
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(new Date(dataUpdatedAt))
      : null;

  const subtitulo =
    periodo === "hoje"
      ? t("Hoje até agora, no mesmo horário de ontem.")
      : periodo === "7d"
        ? t("Os últimos 7 dias, contra os 7 dias anteriores.")
        : t("Os últimos 30 dias, contra os 30 dias anteriores.");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={periodo === "hoje" ? "default" : "secondary"}
            aria-pressed={periodo === "hoje"}
            onClick={() => setPeriodo("hoje")}
          >
            {t("Hoje")}
          </Button>
          <Button
            type="button"
            variant={periodo === "7d" ? "default" : "secondary"}
            aria-pressed={periodo === "7d"}
            onClick={() => setPeriodo("7d")}
          >
            {t("7 dias")}
          </Button>
          <Button
            type="button"
            variant={periodo === "30d" ? "default" : "secondary"}
            aria-pressed={periodo === "30d"}
            onClick={() => setPeriodo("30d")}
          >
            {t("30 dias")}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {hora ? (
            <>
              {t("Atualizado às")} {hora}
            </>
          ) : null}
          {isFetching && !isLoading ? ` · ${t("Atualizando…")}` : null}
        </p>
      </div>
      <p className="text-sm text-muted-foreground">{subtitulo}</p>

      {isLoading ? (
        <div
          className="grid gap-4 md:grid-cols-2"
          aria-busy="true"
          aria-label={t("Carregando o painel")}
        >
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : isError || !data ? (
        <EmptyState
          icon={WarningOctagon}
          headline={t("Não consegui carregar o painel")}
          subcopy={t("Pode ser uma falha de rede. Tente de novo em instantes.")}
          primary={{ label: t("Tentar de novo"), onClick: () => void refetch() }}
        />
      ) : (
        <Grade resposta={data.data} />
      )}
    </div>
  );
}

function Grade({ resposta }: { resposta: RespostaDoPainel }) {
  const t = useT();
  const { atual, anterior, comparacao } = resposta;
  const vendasPorMoeda = new Map<
    string,
    {
      atual?: (typeof atual.vendas.por_moeda)[number];
      anterior?: (typeof anterior.vendas.por_moeda)[number];
    }
  >();
  for (const linha of atual.vendas.por_moeda)
    vendasPorMoeda.set(linha.moeda ?? "", { atual: linha });
  for (const linha of anterior.vendas.por_moeda) {
    const chave = linha.moeda ?? "";
    const slot = vendasPorMoeda.get(chave) ?? {};
    slot.anterior = linha;
    vendasPorMoeda.set(chave, slot);
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <CardTitle>{t("Leads novos")}</CardTitle>
          <Link href="/app/kanban" className="text-sm text-accent underline underline-offset-2">
            {t("Ver no funil")}
          </Link>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Numero valor={atual.leads_novos.total} delta={comparacao.leads} />
          <div>
            <p className="mb-1 text-sm font-medium">{t("Por origem")}</p>
            {atual.leads_novos.por_origem.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("Nenhum lead novo neste período.")}
              </p>
            ) : (
              <TabelaSimples
                colunas={[t("Origem"), t("Leads")]}
                linhas={atual.leads_novos.por_origem.map((linha) => ({
                  chave: linha.origem,
                  a: rotuloLivre(linha.origem, t),
                  b: String(linha.total),
                }))}
              />
            )}
          </div>
          <div>
            <p className="mb-1 text-sm font-medium">{t("Por campanha")}</p>
            <p className="mb-2 text-xs text-muted-foreground">
              {t("Sem campanha no período")}: {atual.leads_novos.sem_campanha}
            </p>
            <TabelaSimples
              colunas={[t("Campanha"), t("Leads")]}
              linhas={atual.leads_novos.por_campanha.map((linha) => ({
                chave: `${linha.origem}:${linha.campanha}`,
                a: `${rotuloLivre(linha.campanha, t)} · ${rotuloLivre(linha.origem, t)}`,
                b: String(linha.total),
              }))}
            />
            {atual.leads_novos.por_campanha_truncada ? (
              <p className="mt-2 text-xs text-muted-foreground">{t("Mostrando as 40 maiores.")}</p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <CardTitle>{t("Conversas")}</CardTitle>
          <Link href="/app/inbox" className="text-sm text-accent underline underline-offset-2">
            {t("Ver na caixa de entrada")}
          </Link>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div>
            <p className="text-sm text-muted-foreground">{t("Mensagens recebidas")}</p>
            <Numero valor={atual.conversas.mensagens_recebidas} delta={comparacao.mensagens} />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{t("Conversas com mensagem recebida")}</p>
            <Numero valor={atual.conversas.com_mensagem_recebida} delta={comparacao.conversas} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("Primeira resposta")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div>
            <p className="text-sm text-muted-foreground">{t("Mediana (P50)")}</p>
            <p className="text-3xl font-semibold tracking-tight tabular-nums">
              {formatarDuracao(atual.resposta.p50_segundos)}
            </p>
            {linhaAnterior(comparacao.p50_segundos, t, (n) => formatarDuracao(n)) ? (
              <p className="text-xs text-muted-foreground">
                {linhaAnterior(comparacao.p50_segundos, t, (n) => formatarDuracao(n))}
              </p>
            ) : null}
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{t("Conversas respondidas")}</p>
            <p className="text-3xl font-semibold tracking-tight tabular-nums">
              {atual.resposta.taxa == null ? "—" : `${Math.round(atual.resposta.taxa * 100)}%`}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("Amostra")}: {atual.resposta.amostra}. {t("Respondidas")}:{" "}
              {atual.resposta.respondidas}.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            {t(
              "A mediana só entra entre as conversas que tiveram resposta. Sem amostra, o número fica em branco.",
            )}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("Consultas")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div>
            <p className="text-sm text-muted-foreground">{t("Consulta agendada")}</p>
            <Numero valor={atual.consultas.agendadas} delta={comparacao.consultas_agendadas} />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{t("Consulta realizada")}</p>
            <Numero valor={atual.consultas.realizadas} delta={comparacao.consultas_realizadas} />
          </div>
          <p className="text-xs text-muted-foreground">
            {t(
              "Conta as entradas nas etapas Consulta agendada e Consulta realizada. Um lead que já nasce na etapa, sem movimentação registrada, não entra.",
            )}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("Vendas")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div>
            <p className="text-sm text-muted-foreground">{t("Leads ganhos")}</p>
            <Numero valor={atual.vendas.quantidade} delta={comparacao.vendas} />
          </div>
          {vendasPorMoeda.size === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("Nenhum valor ganho neste período.")}
            </p>
          ) : (
            [...vendasPorMoeda.entries()].map(([chave, slot]) => (
              <div key={chave || "sem"}>
                <p className="text-sm text-muted-foreground">
                  {slot.atual?.moeda ?? slot.anterior?.moeda ?? t("Sem moeda")}
                </p>
                <p className="text-2xl font-semibold tabular-nums">
                  {slot.atual ? dinheiro(slot.atual.valor_cents, slot.atual.moeda, t) : "—"}
                </p>
                {slot.anterior ? (
                  <p className="text-xs text-muted-foreground">
                    {t("Período anterior")}:{" "}
                    {dinheiro(slot.anterior.valor_cents, slot.anterior.moeda, t)}
                  </p>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("Cliques nos links")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div>
            <p className="text-sm text-muted-foreground">{t("Cliques")}</p>
            <Numero valor={atual.rastreio.cliques} delta={comparacao.cliques} />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{t("Casaram com contato")}</p>
            <Numero valor={atual.rastreio.casaram_contato} delta={comparacao.casaram_contato} />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{t("Casaram com lead")}</p>
            <Numero valor={atual.rastreio.casaram_lead} delta={comparacao.casaram_lead} />
          </div>
          <TabelaSimples
            colunas={[t("Campanha"), t("Cliques")]}
            linhas={atual.rastreio.por_campanha.map((linha) => ({
              chave: linha.campanha,
              a: rotuloLivre(linha.campanha, t),
              b: String(linha.cliques),
            }))}
          />
          <div>
            <p className="mb-1 text-sm font-medium">{t("Por link")}</p>
            <TabelaSimples
              colunas={[t("Link"), t("Cliques")]}
              linhas={atual.rastreio.por_link.map((linha) => ({
                chave: linha.nome,
                a: rotuloLivre(linha.nome, t),
                b: String(linha.cliques),
              }))}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>{t("Anúncios")}</CardTitle>
        </CardHeader>
        <CardContent>
          <BlocoMeta meta={atual.meta} />
        </CardContent>
      </Card>
    </div>
  );
}
