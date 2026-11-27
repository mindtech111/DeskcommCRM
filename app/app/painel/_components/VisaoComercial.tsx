"use client";

/**
 * Visão comercial do painel — o pedido da gestão comercial da Inochi
 * ("Dashboard comercial e base de oportunidades"), em cima de
 * `fn_painel_comercial_v2` (0694).
 *
 * Regras que a tela mantém:
 *  - funil POR SAFRA: dos leads que entraram no período, quantos chegaram a
 *    cada etapa; a taxa nunca passa de 100%;
 *  - venda fechada ≠ dinheiro recebido: aqui só existe o vendido;
 *  - número sem base fica "—", nunca 0 fingindo medição.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  usePainelComercial,
  type EtapaDoFunil,
  type LinhaDeAnuncio,
  type LinhaDeCanal,
  type Oportunidade,
  type RespostaComercial,
} from "@/hooks/metrics/usePainelComercial";

type Atalho = "mes" | "7d" | "30d" | "90d" | "livre";

function hojeSP(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}
function menosDias(d: string, n: number): string {
  const dt = new Date(`${d}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() - n);
  return dt.toISOString().slice(0, 10);
}
function janelaDoAtalho(a: Exclude<Atalho, "livre">): { inicio: string; fim: string } {
  const hoje = hojeSP();
  if (a === "mes") return { inicio: `${hoje.slice(0, 7)}-01`, fim: hoje };
  const n = a === "7d" ? 6 : a === "30d" ? 29 : 89;
  return { inicio: menosDias(hoje, n), fim: hoje };
}

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const INT = new Intl.NumberFormat("pt-BR");
function reais(cents: number | null | undefined): string {
  return cents == null ? "—" : BRL.format(cents / 100);
}
function pct(num: number | null | undefined, den: number | null | undefined): string {
  if (num == null || !den) return "—";
  return `${((num / den) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}
function dataCurta(d: string): string {
  const [, m, dd] = d.split("-");
  return `${dd}/${m}`;
}

const MOTIVOS: Record<string, string> = {
  other: "Outro motivo",
  no_response: "Sem resposta",
  price: "Preço",
  competitor: "Escolheu concorrente",
  timing: "Momento",
  not_qualified: "Fora do perfil",
};

function Kpi({
  rotulo,
  valor,
  detalhe,
  destaque,
}: {
  rotulo: string;
  valor: string;
  detalhe?: string;
  destaque?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border border-border bg-surface p-4 shadow-xs ${destaque ? "ring-1 ring-border-strong" : ""}`}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">{rotulo}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-text">{valor}</p>
      {detalhe ? <p className="mt-1 text-xs text-text-subtle">{detalhe}</p> : null}
    </div>
  );
}

function Bloco({
  titulo,
  sub,
  acao,
  children,
  className = "",
}: {
  titulo: string;
  sub?: string;
  acao?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-border bg-surface shadow-xs ${className}`}>
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-text">{titulo}</h3>
          {sub ? <p className="mt-0.5 text-xs text-text-muted">{sub}</p> : null}
        </div>
        {acao}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Funil({ etapas, laterais }: { etapas: EtapaDoFunil[]; laterais: RespostaComercial["laterais"] }) {
  const topo = etapas[0]?.chegaram ?? 0;
  return (
    <div className="space-y-2">
      {etapas.map((e, i) => {
        const largura = topo ? Math.max(6, Math.round((e.chegaram / topo) * 100)) : 6;
        const anterior = i === 0 ? null : (etapas[i - 1]?.chegaram ?? null);
        return (
          <div key={e.etapa_id} className="grid grid-cols-[minmax(0,9.5rem)_1fr_4.5rem_4.5rem] items-center gap-3 text-sm">
            <span className="truncate text-text">{e.nome}</span>
            <div className="h-6 rounded bg-surface-elevated">
              <div
                className={`flex h-6 items-center rounded px-2 text-xs font-medium tabular-nums ${e.ganho ? "bg-success text-white" : "bg-text text-surface"}`}
                style={{ width: `${largura}%` }}
              >
                {INT.format(e.chegaram)}
              </div>
            </div>
            <span className="text-right text-xs tabular-nums text-text-muted">{pct(e.chegaram, topo)}</span>
            <span className="text-right text-xs tabular-nums text-text-subtle" title="Passagem da etapa anterior">
              {anterior == null ? "" : `↳ ${pct(e.chegaram, anterior)}`}
            </span>
          </div>
        );
      })}
      <p className="pt-2 text-xs text-text-subtle">
        Dos leads que entraram no período, quantos chegaram a cada etapa (pelo histórico de movimentação ou pela etapa
        atual). Agora no funil:{" "}
        {etapas.map((e) => `${e.nome} ${e.agora}`).join(" · ")}
        {laterais.some((l) => l.agora > 0)
          ? ` · Fora da escada: ${laterais
              .filter((l) => l.agora > 0)
              .map((l) => `${l.nome} ${l.agora}`)
              .join(" · ")}`
          : ""}
      </p>
    </div>
  );
}

function TabelaCanais({ linhas, rotulo }: { linhas: Array<LinhaDeCanal | LinhaDeAnuncio>; rotulo: string }) {
  const total = linhas.reduce(
    (s, l) => ({
      leads: s.leads + l.leads,
      agend: s.agend + (l.agendamentos ?? 0),
      vendas: s.vendas + l.vendas,
      valor: s.valor + l.valor_cents,
    }),
    { leads: 0, agend: 0, vendas: 0, valor: 0 },
  );
  if (linhas.length === 0) return <p className="text-sm text-text-muted">Nenhum lead no período.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-muted">
            <th className="py-2 pr-3 font-medium">{rotulo}</th>
            <th className="py-2 pr-3 text-right font-medium">Leads</th>
            <th className="py-2 pr-3 text-right font-medium">%</th>
            <th className="py-2 pr-3 text-right font-medium">Agend.</th>
            <th className="py-2 pr-3 text-right font-medium">Vendas</th>
            <th className="py-2 pr-3 text-right font-medium">Conversão</th>
            <th className="py-2 text-right font-medium">Valor</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => {
            const nome = "anuncio" in l ? l.anuncio : l.canal;
            return (
              <tr key={nome} className="border-b border-border/60 last:border-0">
                <td className="max-w-[16rem] truncate py-2 pr-3 text-text" title={nome}>
                  {nome}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{INT.format(l.leads)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-text-muted">{pct(l.leads, total.leads)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{l.agendamentos ?? "—"}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{l.vendas}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-text-muted">{pct(l.vendas, l.leads)}</td>
                <td className="py-2 text-right tabular-nums">{l.valor_cents ? reais(l.valor_cents) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="text-xs font-medium text-text-muted">
            <td className="pt-2 pr-3">Total</td>
            <td className="pt-2 pr-3 text-right tabular-nums">{INT.format(total.leads)}</td>
            <td className="pt-2 pr-3 text-right">100%</td>
            <td className="pt-2 pr-3 text-right tabular-nums">{total.agend}</td>
            <td className="pt-2 pr-3 text-right tabular-nums">{total.vendas}</td>
            <td className="pt-2 pr-3 text-right tabular-nums">{pct(total.vendas, total.leads)}</td>
            <td className="pt-2 text-right tabular-nums">{total.valor ? reais(total.valor) : "—"}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function chanceBadge(p: number | null) {
  if (p == null) return <Badge variant="neutral">—</Badge>;
  const variant = p >= 70 ? "success" : p >= 40 ? "info" : p >= 20 ? "warning" : "neutral";
  return <Badge variant={variant}>{p}%</Badge>;
}

function Prioridades({ linhas }: { linhas: Oportunidade[] }) {
  if (linhas.length === 0) return <p className="text-sm text-text-muted">Nenhuma oportunidade aberta.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-muted">
            <th className="py-2 pr-3 font-medium">Lead</th>
            <th className="py-2 pr-3 font-medium">Etapa</th>
            <th className="py-2 pr-3 text-right font-medium">Valor</th>
            <th className="py-2 pr-3 font-medium">Chance</th>
            <th className="py-2 pr-3 font-medium">Responsável</th>
            <th className="py-2 font-medium">Próxima ação</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((o) => {
            const parado = (o.dias_sem_contato ?? 0) >= 2 && (o.valor_cents ?? 0) > 0;
            return (
              <tr key={o.lead_id} className="border-b border-border/60 last:border-0">
                <td className="max-w-[14rem] truncate py-2 pr-3 text-text">{o.contato ?? o.titulo ?? "—"}</td>
                <td className="py-2 pr-3 text-text-muted">{o.etapa ?? "—"}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{o.valor_cents ? reais(o.valor_cents) : "—"}</td>
                <td className="py-2 pr-3">{chanceBadge(o.probabilidade)}</td>
                <td className="py-2 pr-3 text-text-muted">
                  {o.responsavel ?? <span className="text-warning-fg">Sem responsável</span>}
                </td>
                <td className="py-2 text-xs text-text-muted">
                  {o.proxima_tarefa ? (
                    <>
                      {o.proxima_tarefa.titulo}
                      {o.proxima_tarefa.quando ? ` · ${dataCurta(o.proxima_tarefa.quando.slice(0, 10))}` : ""}
                    </>
                  ) : (
                    <span className={parado ? "text-error-fg" : ""}>
                      {o.dias_sem_contato != null ? `Sem contato há ${o.dias_sem_contato}d` : "Sem tarefa"}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function VisaoComercial() {
  const [atalho, setAtalho] = useState<Atalho>("mes");
  const [livre, setLivre] = useState(() => janelaDoAtalho("30d"));
  const [pipeline, setPipeline] = useState<string | null>(null);
  const janela = atalho === "livre" ? livre : janelaDoAtalho(atalho);
  const { data, isLoading, isError, refetch, isFetching } = usePainelComercial({ ...janela, pipeline });
  const r = data?.data;

  const ticket = useMemo(
    () => (r && r.kpis.vendas_com_valor > 0 ? r.kpis.faturamento_cents / r.kpis.vendas_com_valor : null),
    [r],
  );

  const ATALHOS: Array<[Atalho, string]> = [
    ["mes", "Este mês"],
    ["7d", "7 dias"],
    ["30d", "30 dias"],
    ["90d", "90 dias"],
    ["livre", "Período"],
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-text">Visão comercial</h2>
          <p className="text-xs text-text-muted">
            {r
              ? `${dataCurta(r.janela.inicio)} a ${dataCurta(r.janela.fim)} · funil ${r.pipeline.nome}`
              : "Carregando…"}
            {isFetching && r ? " · atualizando" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-8 rounded-md border border-border bg-surface px-2 text-sm text-text"
            value={pipeline ?? ""}
            onChange={(e) => setPipeline(e.target.value || null)}
            aria-label="Funil"
          >
            <option value="">Funil padrão</option>
            {r?.pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
          <div className="flex rounded-md border border-border bg-surface-elevated p-0.5">
            {ATALHOS.map(([k, rot]) => (
              <button
                key={k}
                type="button"
                onClick={() => setAtalho(k)}
                aria-pressed={atalho === k}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  atalho === k ? "bg-surface text-text shadow-xs" : "text-text-muted hover:text-text"
                }`}
              >
                {rot}
              </button>
            ))}
          </div>
          {atalho === "livre" ? (
            <div className="flex items-center gap-1 text-xs text-text-muted">
              <input
                type="date"
                className="h-8 rounded-md border border-border bg-surface px-2 text-sm text-text"
                value={livre.inicio}
                max={livre.fim}
                onChange={(e) => setLivre((v) => ({ ...v, inicio: e.target.value }))}
                aria-label="Início"
              />
              a
              <input
                type="date"
                className="h-8 rounded-md border border-border bg-surface px-2 text-sm text-text"
                value={livre.fim}
                min={livre.inicio}
                onChange={(e) => setLivre((v) => ({ ...v, fim: e.target.value }))}
                aria-label="Fim"
              />
            </div>
          ) : null}
        </div>
      </div>

      {isError ? (
        <div className="rounded-lg border border-border p-4 text-sm">
          Não consegui carregar a visão comercial.{" "}
          <Button size="sm" variant="secondary" onClick={() => void refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : isLoading || !r ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="ds-esqueleto h-24 rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            <Kpi rotulo="Leads recebidos" valor={INT.format(r.kpis.leads)} detalhe="entraram no período" destaque />
            <Kpi
              rotulo="Agendamentos"
              valor={r.kpis.agendamentos == null ? "—" : INT.format(r.kpis.agendamentos)}
              detalhe={`${pct(r.kpis.agendamentos, r.kpis.leads)} dos leads`}
              destaque
            />
            <Kpi
              rotulo="Comparecimentos"
              valor={r.kpis.comparecimentos == null ? "—" : INT.format(r.kpis.comparecimentos)}
              detalhe={`${pct(r.kpis.comparecimentos, r.kpis.agendamentos)} dos agendados`}
            />
            <Kpi
              rotulo="Vendas"
              valor={INT.format(r.kpis.vendas)}
              detalhe={`fechadas no período · ${r.kpis.vendas - r.kpis.vendas_com_valor} sem valor`}
              destaque
            />
            <Kpi rotulo="Faturamento vendido" valor={reais(r.kpis.faturamento_cents)} detalhe="vendido ≠ recebido" />
            <Kpi rotulo="Ticket médio" valor={ticket == null ? "—" : reais(ticket)} detalhe="vendas com valor" />
            <Kpi
              rotulo="Pipeline aberto"
              valor={reais(r.kpis.pipeline_aberto_cents)}
              detalhe={`${r.kpis.abertos_com_valor} de ${INT.format(r.kpis.abertos)} com valor`}
            />
            <Kpi
              rotulo="Previsão de fechamento"
              valor={reais(r.kpis.previsao_cents)}
              detalhe="valor × chance da etapa"
            />
          </div>

          {r.kpis.abertos_sem_responsavel > 0 || r.kpis.abertos_com_valor < r.kpis.abertos ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning-bg bg-warning-bg/60 px-3 py-2 text-xs text-warning-fg">
              <strong className="font-semibold">Qualidade do dado:</strong>
              <span>
                {INT.format(r.kpis.abertos_sem_responsavel)} de {INT.format(r.kpis.abertos)} oportunidades abertas sem
                responsável · {INT.format(r.kpis.abertos - r.kpis.abertos_com_valor)} sem valor. Sem isso, pipeline,
                previsão e comparativo por vendedor ficam incompletos.
              </span>
              <Link href="/app/kanban" className="underline underline-offset-2">
                Abrir o funil
              </Link>
            </div>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <Bloco titulo="Funil comercial" sub="Por safra: dos leads do período, quantos chegaram a cada etapa">
              <Funil etapas={r.funil} laterais={r.laterais} />
            </Bloco>
            <Bloco titulo="Leads por canal de origem" sub="Conversão sobre os leads do mesmo canal">
              <TabelaCanais linhas={r.canais} rotulo="Canal" />
            </Bloco>
          </div>

          <Bloco titulo="Evolução diária" sub="Leads recebidos, agendamentos e vendas por dia (horário de Brasília)">
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={r.diario.map((d) => ({ ...d, rotulo: dataCurta(d.dia) }))} margin={{ left: -18, right: 8, top: 6 }}>
                  <CartesianGrid stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: "var(--color-text-muted)" }} tickLine={false} axisLine={false} minTickGap={16} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--color-text-muted)" }} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: "1px solid var(--color-border)", fontSize: 12, background: "var(--color-surface)" }}
                  />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="leads" name="Leads" stroke="var(--color-text)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="agendamentos" name="Agendamentos" stroke="var(--color-info)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="vendas" name="Vendas" stroke="var(--color-success)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Bloco>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <Bloco
              titulo="Desempenho por campanha / anúncio"
              sub={`Leads com campanha ou anúncio identificado · ${INT.format(r.sem_anuncio)} sem identificação`}
            >
              <TabelaCanais linhas={r.anuncios} rotulo="Campanha / anúncio" />
            </Bloco>
            <Bloco titulo="Oportunidades com maior chance" sub="Ordenadas por valor × chance da etapa">
              <Prioridades linhas={r.prioridades} />
            </Bloco>
          </div>

          <Bloco titulo="Perdas no período" sub={`${r.kpis.perdidos} oportunidades perdidas`}>
            {r.perdas.length === 0 ? (
              <p className="text-sm text-text-muted">Nenhuma perda no período.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {r.perdas.map((p) => (
                  <Badge key={p.motivo} variant="neutral">
                    {MOTIVOS[p.motivo] ?? p.motivo} · {p.total}
                  </Badge>
                ))}
              </div>
            )}
          </Bloco>
        </>
      )}
    </div>
  );
}
