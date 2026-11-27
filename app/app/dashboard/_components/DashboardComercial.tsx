"use client";

/**
 * Dashboard comercial — estrutura do mockup da gestão comercial da Inochi
 * (cards com variação, funil, canais, campanhas, oportunidades e a faixa de
 * ticket/pipeline/previsão/meta), no tema da instalação. Tudo vem de
 * `fn_dashboard_comercial` (0695); nada aqui é dado de exemplo.
 *
 * Regras de leitura que a tela mantém:
 *  - o funil é POR SAFRA (dos leads do período, até onde cada um chegou);
 *  - "Vendas" e "Faturamento" contam o que FECHOU no período;
 *  - vendido ≠ recebido; ROI e custo por lead ficam "—" até o gasto de
 *    anúncio estar ligado ao painel (não se inventa número).
 */
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDashboardComercial, type RespostaDashboard } from "@/hooks/metrics/useDashboardComercial";
import {
  ArrowDown,
  ArrowUp,
  CalendarBlank,
  CalendarCheck,
  CurrencyCircleDollar,
  Funnel,
  ShoppingBag,
  UserCheck,
  UsersThree,
} from "@/lib/ui/icons";

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
const reais = (c: number | null | undefined) => (c == null ? "—" : BRL.format(c / 100));
function pct(n: number | null | undefined, d: number | null | undefined, casas = 1): string {
  if (n == null || !d) return "—";
  return `${((n / d) * 100).toLocaleString("pt-BR", { maximumFractionDigits: casas })}%`;
}
function ddmm(iso: string): string {
  const d = iso.slice(0, 10).split("-");
  return `${d[2]}/${d[1]}`;
}
/** Dia civil de São Paulo de um instante ISO (o fim da janela anterior é exclusivo). */
function diaSP(iso: string, menosUmSegundo = false): string {
  const t = new Date(iso).getTime() - (menosUmSegundo ? 1000 : 0);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(t));
}

const CORES_CANAL: Record<string, string> = {
  "Meta Ads": "#2a6ae9",
  "WhatsApp (orgânico)": "#1f9254",
  "Vitaminas Brasil": "#c6a16a",
  "Google Ads": "#e0a100",
  Site: "#7a5af8",
  Indicação: "#e5487a",
  "Base importada": "#8a8d93",
};
const corDoCanal = (c: string) => CORES_CANAL[c] ?? "#b4b7bd";

/* ── peças ─────────────────────────────────────────────────────────────── */

function Variacao({ atual, anterior }: { atual: number | null; anterior: number | null }) {
  if (atual == null || anterior == null) return null;
  if (anterior === 0) {
    return atual > 0 ? <span className="text-xs font-medium text-text-subtle">novo</span> : null;
  }
  const v = (atual - anterior) / anterior;
  const sobe = v >= 0;
  const Icone = sobe ? ArrowUp : ArrowDown;
  return (
    <span
      className={`inline-flex items-center gap-0.5 whitespace-nowrap text-xs font-medium tabular-nums ${
        sobe ? "text-success-fg" : "text-error-fg"
      }`}
    >
      <Icone size={11} weight="bold" />
      {Math.abs(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
    </span>
  );
}

function CardKpi({
  rotulo,
  valor,
  icone: Icone,
  atual,
  anterior,
  anteriorTexto,
  rotuloAnterior,
  comparar,
}: {
  rotulo: string;
  valor: string;
  icone: React.ComponentType<{ size?: number; weight?: "regular" | "bold" }>;
  atual: number | null;
  anterior: number | null;
  anteriorTexto: string;
  rotuloAnterior: string;
  comparar: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="truncate pt-0.5 text-[11px] font-medium uppercase tracking-wide text-text-muted" title={rotulo}>
          {rotulo}
        </p>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border bg-surface-elevated text-text-muted">
          <Icone size={18} />
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <p className="whitespace-nowrap text-[1.75rem] font-semibold leading-none tabular-nums tracking-tight text-text">
          {valor}
        </p>
        {comparar ? <Variacao atual={atual} anterior={anterior} /> : null}
      </div>
      {comparar ? (
        <p className="mt-3 truncate text-xs text-text-subtle" title={`${rotuloAnterior} | ${anteriorTexto}`}>
          vs {rotuloAnterior} <span className="text-border-strong">|</span> {anteriorTexto}
        </p>
      ) : null}
    </div>
  );
}

function Cartao({
  titulo,
  acao,
  rodape,
  children,
}: {
  titulo: string;
  acao?: React.ReactNode;
  rodape?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col rounded-lg border border-border bg-surface">
      <header className="flex min-h-12 items-center justify-between gap-3 px-4 pt-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-text">{titulo}</h2>
        {acao}
      </header>
      <div className="flex flex-1 flex-col pb-2">{children}</div>
      {rodape ? <div className="border-t border-border px-4 py-2.5 text-xs">{rodape}</div> : null}
    </section>
  );
}

const TH = "px-2 py-2 text-[11px] font-medium text-text-muted first:pl-4 last:pr-4";
const TD = "px-2 py-2.5 first:pl-4 last:pr-4";

/** Funil em trapézio: faixas com afunilamento fixo (forma), números reais na lista ao lado. */
function FunilVisual({ etapas }: { etapas: RespostaDashboard["funil"] }) {
  const n = etapas.length || 1;
  const altura = 26;
  const h = n * altura;
  const larg = 220;
  const tons = ["#e4e5e8", "#d3d5d9", "#b9bcc2", "#9da0a7", "#7e8189", "#5f626a", "#40434a", "#2a2c30"];
  return (
    <div className="grid grid-cols-[minmax(0,13rem)_minmax(0,1fr)] items-center gap-4 px-4">
      <svg viewBox={`0 0 ${larg} ${h}`} className="h-auto w-full" role="img" aria-label="Funil comercial">
        {etapas.map((e, i) => {
          const topo = 8 + (i / n) * (larg / 2 - 34);
          const base = 8 + ((i + 1) / n) * (larg / 2 - 34);
          const y = i * altura;
          const cor = e.ganho ? "var(--color-success)" : (tons[Math.min(i, tons.length - 1)] ?? "#2a2c30");
          return (
            <polygon
              key={e.etapa_id}
              points={`${topo},${y + 1} ${larg - topo},${y + 1} ${larg - base},${y + altura - 1} ${base},${y + altura - 1}`}
              fill={cor}
            />
          );
        })}
      </svg>
      <ul className="min-w-0 text-sm">
        {etapas.map((e) => (
          <li key={e.etapa_id} className="grid h-[26px] grid-cols-[minmax(0,1fr)_3rem_3.25rem] items-center gap-2">
            <span className="truncate text-text" title={e.nome}>
              {e.nome}
            </span>
            <span className="text-right font-semibold tabular-nums text-text">{INT.format(e.chegaram)}</span>
            <span className="text-right text-xs tabular-nums text-text-muted">{pct(e.chegaram, etapas[0]?.chegaram)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Iniciais({ nome }: { nome: string }) {
  const partes = nome.replace(/[^\p{L}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  const ini = ((partes[0]?.[0] ?? "") + (partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? "") : "")).toUpperCase() || "·";
  return (
    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-elevated text-[11px] font-semibold text-text-muted">
      {ini}
    </span>
  );
}

function Chance({ p }: { p: number | null }) {
  if (p == null) return <span className="text-text-subtle">—</span>;
  const variant = p >= 70 ? "success" : p >= 40 ? "info" : p >= 20 ? "warning" : "neutral";
  return <Badge variant={variant}>{p}%</Badge>;
}

/* ── tela ──────────────────────────────────────────────────────────────── */

export function DashboardComercial() {
  const [atalho, setAtalho] = useState<Atalho>("mes");
  const [livre, setLivre] = useState(() => janelaDoAtalho("30d"));
  const [pipeline, setPipeline] = useState<string | null>(null);
  const [comparar, setComparar] = useState(true);
  const [verFiltros, setVerFiltros] = useState(false);
  const janela = atalho === "livre" ? livre : janelaDoAtalho(atalho);
  const { data, isLoading, isError, refetch, isFetching } = useDashboardComercial({ ...janela, pipeline });
  const r = data?.data;

  const rotuloAnterior = useMemo(
    () => (r ? `${ddmm(diaSP(r.anterior.inicio))} - ${ddmm(diaSP(r.anterior.fim, true))}` : ""),
    [r],
  );
  const ticket = r && r.kpis.vendas_com_valor > 0 ? r.kpis.faturamento_cents / r.kpis.vendas_com_valor : null;
  const ticketAnt =
    r && r.anterior.kpis.vendas_com_valor > 0 ? r.anterior.kpis.faturamento_cents / r.anterior.kpis.vendas_com_valor : null;
  const topo = r?.funil[0]?.chegaram ?? 0;
  const fim = r?.funil[r.funil.length - 1]?.chegaram ?? 0;
  const meta = r?.extra.meta_mensal_cents ?? null;
  const progressoMeta = meta && r ? Math.min(100, (r.extra.vendas_mes.valor_cents / meta) * 100) : null;

  const ATALHOS: Array<[Atalho, string]> = [
    ["mes", "Este mês"],
    ["7d", "7 dias"],
    ["30d", "30 dias"],
    ["90d", "90 dias"],
    ["livre", "Período"],
  ];

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">Dashboard comercial</h1>
          <p className="mt-0.5 text-sm text-text-muted">
            Visão geral do desempenho comercial
            {r ? ` · funil ${r.pipeline.nome}` : ""}
            {isFetching && r ? " · atualizando" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-9 items-center gap-1 rounded-md border border-border bg-surface pl-2.5 pr-1">
            <CalendarBlank size={15} className="text-text-muted" />
            <span className="px-1 text-xs tabular-nums text-text">
              {janela.inicio.split("-").reverse().join("/")} - {janela.fim.split("-").reverse().join("/")}
            </span>
            <div className="ml-1 flex h-7 items-center rounded bg-surface-elevated p-0.5">
              {ATALHOS.map(([k, rot]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setAtalho(k)}
                  aria-pressed={atalho === k}
                  className={`h-full rounded px-2 text-[11px] font-medium transition-colors ${
                    atalho === k ? "bg-surface text-text shadow-xs" : "text-text-muted hover:text-text"
                  }`}
                >
                  {rot}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setComparar((v) => !v)}
            aria-pressed={comparar}
            className={`h-9 rounded-md border px-3 text-xs font-medium transition-colors ${
              comparar ? "border-border-strong bg-surface text-text" : "border-border bg-surface text-text-muted"
            }`}
          >
            {comparar ? "✓ " : ""}Comparar com período anterior
          </button>
          <button
            type="button"
            onClick={() => setVerFiltros((v) => !v)}
            aria-expanded={verFiltros}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-xs font-medium text-text"
          >
            <Funnel size={14} />
            Filtros{pipeline ? " · 1" : ""}
          </button>
        </div>
      </div>

      {verFiltros || atalho === "livre" ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs text-text-muted">
          <label className="flex items-center gap-2">
            Funil
            <select
              className="h-8 rounded-md border border-border bg-surface px-2 text-sm text-text"
              value={pipeline ?? ""}
              onChange={(e) => setPipeline(e.target.value || null)}
            >
              <option value="">Funil padrão</option>
              {r?.pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </label>
          {atalho === "livre" ? (
            <label className="flex items-center gap-2">
              De
              <input
                type="date"
                className="h-8 rounded-md border border-border bg-surface px-2 text-sm text-text"
                value={livre.inicio}
                max={livre.fim}
                onChange={(e) => setLivre((v) => ({ ...v, inicio: e.target.value }))}
              />
              até
              <input
                type="date"
                className="h-8 rounded-md border border-border bg-surface px-2 text-sm text-text"
                value={livre.fim}
                min={livre.inicio}
                onChange={(e) => setLivre((v) => ({ ...v, fim: e.target.value }))}
              />
            </label>
          ) : null}
        </div>
      ) : null}

      {isError ? (
        <div className="flex items-center gap-3 rounded-lg border border-border p-4 text-sm">
          Não consegui carregar o dashboard.
          <Button size="sm" variant="secondary" onClick={() => void refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : isLoading || !r ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="ds-esqueleto h-32 rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            <CardKpi
              rotulo="Leads recebidos"
              valor={INT.format(r.kpis.leads)}
              icone={UsersThree}
              atual={r.kpis.leads}
              anterior={r.anterior.kpis.leads}
              anteriorTexto={INT.format(r.anterior.kpis.leads)}
              rotuloAnterior={rotuloAnterior}
              comparar={comparar}
            />
            <CardKpi
              rotulo="Agendamentos"
              valor={r.kpis.agendamentos == null ? "—" : INT.format(r.kpis.agendamentos)}
              icone={CalendarCheck}
              atual={r.kpis.agendamentos}
              anterior={r.anterior.kpis.agendamentos}
              anteriorTexto={r.anterior.kpis.agendamentos == null ? "—" : INT.format(r.anterior.kpis.agendamentos)}
              rotuloAnterior={rotuloAnterior}
              comparar={comparar}
            />
            <CardKpi
              rotulo="Comparecimentos"
              valor={r.kpis.comparecimentos == null ? "—" : INT.format(r.kpis.comparecimentos)}
              icone={UserCheck}
              atual={r.kpis.comparecimentos}
              anterior={r.anterior.kpis.comparecimentos}
              anteriorTexto={r.anterior.kpis.comparecimentos == null ? "—" : INT.format(r.anterior.kpis.comparecimentos)}
              rotuloAnterior={rotuloAnterior}
              comparar={comparar}
            />
            <CardKpi
              rotulo="Vendas"
              valor={INT.format(r.kpis.vendas)}
              icone={ShoppingBag}
              atual={r.kpis.vendas}
              anterior={r.anterior.kpis.vendas}
              anteriorTexto={INT.format(r.anterior.kpis.vendas)}
              rotuloAnterior={rotuloAnterior}
              comparar={comparar}
            />
            <CardKpi
              rotulo="Faturamento"
              valor={reais(r.kpis.faturamento_cents)}
              icone={CurrencyCircleDollar}
              atual={r.kpis.faturamento_cents}
              anterior={r.anterior.kpis.faturamento_cents}
              anteriorTexto={reais(r.anterior.kpis.faturamento_cents)}
              rotuloAnterior={rotuloAnterior}
              comparar={comparar}
            />
          </div>

          {r.kpis.abertos_sem_responsavel > 0 || r.kpis.abertos_com_valor < r.kpis.abertos ? (
            <p className="text-xs text-warning-fg">
              <strong className="font-semibold">Qualidade do dado:</strong>{" "}
              {INT.format(r.kpis.abertos_sem_responsavel)} de {INT.format(r.kpis.abertos)} oportunidades abertas sem
              responsável e {INT.format(r.kpis.abertos - r.kpis.abertos_com_valor)} sem valor; pipeline e previsão ficam
              incompletos.{" "}
              <Link href={`/app/pipelines/${r.pipeline.id}`} className="font-medium underline underline-offset-2">
                Abrir o funil
              </Link>
            </p>
          ) : null}

          <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <Cartao titulo="Funil comercial">
              <div className="grid h-full grid-cols-1 items-center gap-4 pb-2 md:grid-cols-[minmax(0,1fr)_11rem] md:pr-4">
                <FunilVisual etapas={r.funil} />
                <div className="mx-4 flex flex-col justify-center gap-4 rounded-lg bg-surface-elevated p-4 md:mx-0">
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-text-muted">Taxa de conversão</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums text-text">{pct(fim, topo)}</p>
                    <p className="text-[11px] text-text-subtle">lead → venda</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-text-muted">Tempo médio do ciclo</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums text-text">
                      {r.extra.ciclo_medio_dias == null
                        ? "—"
                        : `${r.extra.ciclo_medio_dias.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dias`}
                    </p>
                    <p className="text-[11px] text-text-subtle">do primeiro contato até a venda</p>
                  </div>
                </div>
              </div>
            </Cartao>

            <Cartao titulo="Leads por canal de origem">
              <table className="w-full table-fixed text-sm">
                <colgroup>
                  <col />
                  <col className="w-14" />
                  <col className="w-16" />
                  <col className="w-[5.5rem]" />
                  <col className="w-14" />
                  <col className="w-[4.75rem]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className={TH}>Canal</th>
                    <th className={`${TH} text-right`}>Leads</th>
                    <th className={`${TH} text-right`}>%</th>
                    <th className={`${TH} text-right`}>Agendam.</th>
                    <th className={`${TH} text-right`}>Vendas</th>
                    <th className={`${TH} text-right`}>Conversão</th>
                  </tr>
                </thead>
                <tbody>
                  {r.canais.map((c) => (
                    <tr key={c.canal} className="border-b border-border/60">
                      <td className={TD}>
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: corDoCanal(c.canal) }} />
                          <span className="truncate text-text" title={c.canal}>
                            {c.canal}
                          </span>
                        </span>
                      </td>
                      <td className={`${TD} text-right tabular-nums`}>{INT.format(c.leads)}</td>
                      <td className={`${TD} text-right tabular-nums text-text-muted`}>{pct(c.leads, r.kpis.leads)}</td>
                      <td className={`${TD} text-right tabular-nums`}>{c.agendamentos ?? "—"}</td>
                      <td className={`${TD} text-right tabular-nums`}>{c.vendas}</td>
                      <td className={`${TD} text-right tabular-nums`}>{pct(c.vendas, c.leads)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="text-sm font-medium text-text">
                    <td className={TD}>Total</td>
                    <td className={`${TD} text-right tabular-nums`}>{INT.format(r.kpis.leads)}</td>
                    <td className={`${TD} text-right`}>100%</td>
                    <td className={`${TD} text-right tabular-nums`}>{r.kpis.agendamentos ?? "—"}</td>
                    <td className={`${TD} text-right tabular-nums`}>{r.canais.reduce((s, c) => s + c.vendas, 0)}</td>
                    <td className={`${TD} text-right tabular-nums`}>
                      {pct(r.canais.reduce((s, c) => s + c.vendas, 0), r.kpis.leads)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </Cartao>
          </div>

          <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <Cartao
              titulo="Desempenho por campanha"
              rodape={
                <span className="text-text-muted">
                  {INT.format(r.sem_anuncio)} leads sem campanha identificada · ROI aparece quando o gasto do Meta for ligado
                  ao painel
                </span>
              }
            >
              <table className="w-full table-fixed text-sm">
                <colgroup>
                  <col />
                  <col className="w-[5.5rem]" />
                  <col className="w-12" />
                  <col className="w-[4.25rem]" />
                  <col className="w-14" />
                  <col className="w-[5.5rem]" />
                  <col className="w-12" />
                </colgroup>
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className={TH}>Campanha</th>
                    <th className={TH}>Canal</th>
                    <th className={`${TH} text-right`}>Leads</th>
                    <th className={`${TH} text-right`}>Agend.</th>
                    <th className={`${TH} text-right`}>Vendas</th>
                    <th className={`${TH} text-right`}>Faturamento</th>
                    <th className={`${TH} text-right`} title="Ligar o gasto do Meta ao painel">
                      ROI
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {r.anuncios.length === 0 ? (
                    <tr>
                      <td className={`${TD} text-text-muted`} colSpan={7}>
                        Nenhum lead com campanha no período.
                      </td>
                    </tr>
                  ) : (
                    r.anuncios.slice(0, 8).map((a) => {
                      const nome = a.anuncio.replace(/^Anúncio: /, "");
                      return (
                        <tr key={a.anuncio} className="border-b border-border/60 last:border-0">
                          <td className={`${TD} truncate text-text`} title={nome}>
                            {nome}
                          </td>
                          <td className={`${TD} truncate text-text-muted`} title={a.canal}>
                            {a.canal}
                          </td>
                          <td className={`${TD} text-right tabular-nums`}>{a.leads}</td>
                          <td className={`${TD} text-right tabular-nums`}>{a.agendamentos ?? "—"}</td>
                          <td className={`${TD} text-right tabular-nums`}>{a.vendas}</td>
                          <td className={`${TD} text-right tabular-nums`}>{a.valor_cents ? reais(a.valor_cents) : "—"}</td>
                          <td className={`${TD} text-right text-text-subtle`} title="Ligar o gasto do Meta ao painel">
                            —
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </Cartao>

            <Cartao
              titulo="Oportunidades com maior chance de fechamento"
              rodape={
                <Link href={`/app/pipelines/${r.pipeline.id}`} className="font-medium text-text underline-offset-2 hover:underline">
                  Ver todas as oportunidades →
                </Link>
              }
            >
              <table className="w-full table-fixed text-sm">
                <colgroup>
                  <col />
                  <col className="w-[5.5rem]" />
                  <col className="w-[4.5rem]" />
                  <col className="w-[3.75rem]" />
                  <col className="w-[9.5rem]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className={TH}>Lead</th>
                    <th className={TH}>Interesse</th>
                    <th className={`${TH} text-right`}>Valor</th>
                    <th className={TH}>Chance</th>
                    <th className={TH}>Próxima ação</th>
                  </tr>
                </thead>
                <tbody>
                  {r.prioridades.slice(0, 6).map((o) => {
                    const nome = o.contato ?? o.titulo ?? "—";
                    const acao = o.proxima_tarefa?.titulo ?? null;
                    const quando = o.proxima_tarefa?.quando ? ddmm(o.proxima_tarefa.quando) : null;
                    return (
                      <tr key={o.lead_id} className="border-b border-border/60 last:border-0">
                        <td className={TD}>
                          <span className="flex min-w-0 items-center gap-2">
                            <Iniciais nome={nome} />
                            <span className="min-w-0">
                              <span className="block truncate text-text" title={nome}>
                                {nome}
                              </span>
                              <span className="block truncate text-[11px] text-text-subtle">{o.etapa ?? "—"}</span>
                            </span>
                          </span>
                        </td>
                        <td className={`${TD} truncate text-text-muted`} title={o.interesse ?? ""}>
                          {o.interesse ?? "—"}
                        </td>
                        <td className={`${TD} text-right tabular-nums`}>{o.valor_cents ? reais(o.valor_cents) : "—"}</td>
                        <td className={TD}>
                          <Chance p={o.probabilidade} />
                        </td>
                        <td className={TD}>
                          <span className="flex min-w-0 items-start gap-1.5">
                            <CalendarBlank size={14} className="mt-0.5 shrink-0 text-text-subtle" />
                            <span className="min-w-0">
                              <span className="block truncate text-xs text-text" title={acao ?? "Sem tarefa"}>
                                {acao ?? "Sem tarefa"}
                              </span>
                              <span className="block truncate text-[11px] text-text-subtle">
                                {quando ?? (o.dias_sem_contato != null ? `sem contato há ${o.dias_sem_contato}d` : "")}
                              </span>
                            </span>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Cartao>
          </div>

          <div className="grid grid-cols-2 divide-border overflow-hidden rounded-lg border border-border bg-surface md:grid-cols-3 md:divide-x xl:grid-cols-6">
            {[
              { r: "Ticket médio", v: ticket == null ? "—" : reais(ticket), s: comparar && ticketAnt != null ? `vs ${reais(ticketAnt)}` : "vendas com valor" },
              { r: "Pipeline (valor total)", v: reais(r.kpis.pipeline_aberto_cents), s: `${r.kpis.abertos_com_valor} com valor` },
              { r: "Previsão de fechamento", v: reais(r.kpis.previsao_cents), s: "valor × chance da etapa" },
              { r: "Oportunidades abertas", v: INT.format(r.kpis.abertos), s: `${INT.format(r.kpis.abertos_sem_responsavel)} sem responsável` },
              {
                r: "Vendas este mês (até hoje)",
                v: reais(r.extra.vendas_mes.valor_cents),
                s: `${r.extra.vendas_mes.quantidade} vendas`,
              },
            ].map((c) => (
              <div key={c.r} className="min-w-0 border-b border-border px-4 py-3 text-center xl:border-b-0">
                <p className="truncate text-[10px] font-medium uppercase tracking-wide text-text-muted" title={c.r}>
                  {c.r}
                </p>
                <p className="mt-1 whitespace-nowrap text-xl font-semibold tabular-nums text-text">{c.v}</p>
                <p className="truncate text-[11px] text-text-subtle">{c.s}</p>
              </div>
            ))}
            <div className="min-w-0 px-4 py-3">
              <p className="truncate text-[10px] font-medium uppercase tracking-wide text-text-muted">Meta mensal</p>
              {meta ? (
                <>
                  <p className="mt-1 whitespace-nowrap text-sm font-semibold tabular-nums text-text">{reais(meta)}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded-full bg-surface-elevated">
                      <div className="h-1.5 rounded-full" style={{ width: `${progressoMeta ?? 0}%`, background: "var(--inochi-ouro, var(--color-accent))" }} />
                    </div>
                    <span className="text-[11px] tabular-nums text-text-muted">
                      {(progressoMeta ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <p className="mt-1 text-sm font-semibold text-text-muted">Não definida</p>
                  <Link href="/app/painel" className="text-[11px] text-text underline underline-offset-2">
                    Definir no Painel
                  </Link>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
