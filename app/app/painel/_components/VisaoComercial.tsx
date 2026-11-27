"use client";

/**
 * Visão comercial do painel — o pedido da gestão comercial da Inochi
 * ("Dashboard comercial e base de oportunidades"), em cima de
 * `fn_painel_comercial_v2` (0694).
 *
 * Regras que a tela mantém:
 *  - funil POR SAFRA: dos leads que entraram no período, quantos chegaram a
 *    cada etapa (cada lead conta até a maior etapa que alcançou);
 *  - venda fechada ≠ dinheiro recebido: aqui só existe o vendido;
 *  - número sem base fica "—", nunca 0 fingindo medição.
 *
 * Layout: cards de mesma altura e borda, número nunca quebra nem corta,
 * tabelas sem rolagem lateral na largura comum de notebook (1280–1440px).
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
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

/* ── peças ─────────────────────────────────────────────────────────────── */

function Kpi({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe?: string }) {
  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-border bg-surface px-4 py-3.5">
      <p className="truncate text-xs font-medium text-text-muted" title={rotulo}>
        {rotulo}
      </p>
      <p className="mt-1 whitespace-nowrap text-[1.625rem] font-semibold leading-tight tabular-nums tracking-tight text-text">
        {valor}
      </p>
      {detalhe ? (
        <p className="mt-auto truncate pt-1 text-xs text-text-subtle" title={detalhe}>
          {detalhe}
        </p>
      ) : null}
    </div>
  );
}

function Bloco({
  titulo,
  sub,
  acao,
  children,
  semRecuo,
}: {
  titulo: string;
  sub?: string;
  acao?: React.ReactNode;
  children: React.ReactNode;
  semRecuo?: boolean;
}) {
  return (
    <section className="min-w-0 rounded-lg border border-border bg-surface">
      <header className="flex items-start justify-between gap-3 px-4 pb-2 pt-3.5">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text">{titulo}</h3>
          {sub ? <p className="mt-0.5 text-xs text-text-muted">{sub}</p> : null}
        </div>
        {acao}
      </header>
      <div className={semRecuo ? "pb-2" : "px-4 pb-4 pt-1"}>{children}</div>
    </section>
  );
}

const TH = "px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-text-muted";
const TD = "px-4 py-2";

function Funil({ etapas }: { etapas: EtapaDoFunil[] }) {
  const topo = etapas[0]?.chegaram ?? 0;
  return (
    <table className="w-full table-fixed text-sm">
      <colgroup>
        <col className="w-[34%]" />
        <col />
        <col className="w-14" />
        <col className="w-14" />
        <col className="w-[5.25rem]" />
        <col className="w-14" />
      </colgroup>
      <thead>
        <tr className="border-y border-border text-left">
          <th className={TH}>Etapa</th>
          <th className={`${TH} px-0`} aria-label="Proporção" />
          <th className={`${TH} px-2 text-right`}>Leads</th>
          <th className={`${TH} px-2 text-right`}>%</th>
          <th className={`${TH} px-2 text-right`} title="Quantos passaram da etapa anterior para esta">
            Passagem
          </th>
          <th className={`${TH} pl-2 text-right`} title="Leads nesta etapa agora, de qualquer data">
            Hoje
          </th>
        </tr>
      </thead>
      <tbody>
        {etapas.map((e, i) => {
          const largura = topo ? (e.chegaram / topo) * 100 : 0;
          const anterior = i === 0 ? null : (etapas[i - 1]?.chegaram ?? null);
          return (
            <tr key={e.etapa_id} className="border-b border-border/60 last:border-0">
              <td className={`${TD} truncate text-text`} title={e.nome}>
                {e.nome}
              </td>
              <td className="py-2">
                <div className="h-2 w-full rounded-full bg-surface-elevated">
                  <div
                    className={`h-2 rounded-full ${e.ganho ? "bg-success" : "bg-text"}`}
                    style={{ width: `${Math.max(largura, e.chegaram > 0 ? 1.5 : 0)}%` }}
                  />
                </div>
              </td>
              <td className="px-2 py-2 text-right font-medium tabular-nums text-text">{INT.format(e.chegaram)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-text-muted">{pct(e.chegaram, topo)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-text-subtle">
                {anterior == null ? "" : pct(e.chegaram, anterior)}
              </td>
              <td className="py-2 pl-2 pr-4 text-right tabular-nums text-text-subtle">{e.agora}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function TabelaCanais({
  linhas,
  rotulo,
  mostrarParticipacao = true,
}: {
  linhas: Array<LinhaDeCanal | LinhaDeAnuncio>;
  rotulo: string;
  mostrarParticipacao?: boolean;
}) {
  const total = linhas.reduce(
    (s, l) => ({
      leads: s.leads + l.leads,
      agend: s.agend + (l.agendamentos ?? 0),
      vendas: s.vendas + l.vendas,
      valor: s.valor + l.valor_cents,
    }),
    { leads: 0, agend: 0, vendas: 0, valor: 0 },
  );
  const temValor = total.valor > 0;
  if (linhas.length === 0) return <p className="px-4 text-sm text-text-muted">Nenhum lead no período.</p>;
  return (
    <table className="w-full table-fixed text-sm">
      <colgroup>
        <col />
        <col className="w-14" />
        {mostrarParticipacao ? <col className="w-14" /> : null}
        <col className="w-16" />
        <col className="w-14" />
        <col className="w-[4.5rem]" />
        {temValor ? <col className="w-20" /> : null}
      </colgroup>
      <thead>
        <tr className="border-y border-border text-left">
          <th className={TH}>{rotulo}</th>
          <th className={`${TH} px-2 text-right`}>Leads</th>
          {mostrarParticipacao ? <th className={`${TH} px-2 text-right`}>%</th> : null}
          <th className={`${TH} px-2 text-right`}>Agend.</th>
          <th className={`${TH} px-2 text-right`}>Vendas</th>
          <th className={`${TH} px-2 text-right`} title="Vendas ÷ leads do mesmo canal">
            Conv.
          </th>
          {temValor ? <th className={`${TH} pl-2 text-right`}>Valor</th> : null}
        </tr>
      </thead>
      <tbody>
        {linhas.map((l) => {
          const nome = "anuncio" in l ? l.anuncio.replace(/^Anúncio: /, "") : l.canal;
          return (
            <tr key={"anuncio" in l ? l.anuncio : l.canal} className="border-b border-border/60 last:border-0">
              <td className={`${TD} truncate text-text`} title={nome}>
                {nome}
              </td>
              <td className="px-2 py-2 text-right font-medium tabular-nums">{INT.format(l.leads)}</td>
              {mostrarParticipacao ? (
                <td className="px-2 py-2 text-right tabular-nums text-text-muted">{pct(l.leads, total.leads)}</td>
              ) : null}
              <td className="px-2 py-2 text-right tabular-nums">{l.agendamentos ?? "—"}</td>
              <td className="px-2 py-2 text-right tabular-nums">{l.vendas}</td>
              <td className="px-2 py-2 text-right tabular-nums text-text-muted">{pct(l.vendas, l.leads)}</td>
              {temValor ? (
                <td className="py-2 pl-2 pr-4 text-right tabular-nums">{l.valor_cents ? reais(l.valor_cents) : "—"}</td>
              ) : null}
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr className="border-t border-border text-xs font-medium text-text-muted">
          <td className={TD}>Total</td>
          <td className="px-2 py-2 text-right tabular-nums">{INT.format(total.leads)}</td>
          {mostrarParticipacao ? <td className="px-2 py-2 text-right">100%</td> : null}
          <td className="px-2 py-2 text-right tabular-nums">{total.agend}</td>
          <td className="px-2 py-2 text-right tabular-nums">{total.vendas}</td>
          <td className="px-2 py-2 text-right tabular-nums">{pct(total.vendas, total.leads)}</td>
          {temValor ? <td className="py-2 pl-2 pr-4 text-right tabular-nums">{reais(total.valor)}</td> : null}
        </tr>
      </tfoot>
    </table>
  );
}

function Chance({ p }: { p: number | null }) {
  if (p == null) return <span className="text-text-subtle">—</span>;
  const variant = p >= 70 ? "success" : p >= 40 ? "info" : p >= 20 ? "warning" : "neutral";
  return <Badge variant={variant}>{p}%</Badge>;
}

function Prioridades({ linhas }: { linhas: Oportunidade[] }) {
  if (linhas.length === 0) return <p className="px-4 text-sm text-text-muted">Nenhuma oportunidade aberta.</p>;
  return (
    <table className="w-full table-fixed text-sm">
      <colgroup>
        <col className="w-[36%]" />
        <col className="w-20" />
        <col className="w-16" />
        <col />
      </colgroup>
      <thead>
        <tr className="border-y border-border text-left">
          <th className={TH}>Lead · etapa</th>
          <th className={`${TH} px-2 text-right`}>Valor</th>
          <th className={`${TH} px-2`}>Chance</th>
          <th className={`${TH} pl-2`}>Próxima ação · responsável</th>
        </tr>
      </thead>
      <tbody>
        {linhas.map((o) => {
          const acao = o.proxima_tarefa
            ? `${o.proxima_tarefa.titulo}${o.proxima_tarefa.quando ? ` · ${dataCurta(o.proxima_tarefa.quando.slice(0, 10))}` : ""}`
            : o.dias_sem_contato != null
              ? `Sem tarefa · sem contato há ${o.dias_sem_contato}d`
              : "Sem tarefa";
          const parado = !o.proxima_tarefa && (o.dias_sem_contato ?? 0) >= 2;
          return (
            <tr key={o.lead_id} className="border-b border-border/60 last:border-0 align-top">
              <td className={TD}>
                <p className="truncate font-medium text-text" title={o.contato ?? o.titulo ?? ""}>
                  {o.contato ?? o.titulo ?? "—"}
                </p>
                <p className="truncate text-xs text-text-subtle">{o.etapa ?? "—"}</p>
              </td>
              <td className="px-2 py-2 text-right tabular-nums">{o.valor_cents ? reais(o.valor_cents) : "—"}</td>
              <td className="px-2 py-2">
                <Chance p={o.probabilidade} />
              </td>
              <td className="py-2 pl-2 pr-4">
                <p className={`truncate text-xs ${parado ? "text-error-fg" : "text-text"}`} title={acao}>
                  {acao}
                </p>
                <p className="truncate text-xs text-text-subtle">{o.responsavel ?? "Sem responsável"}</p>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ── tela ──────────────────────────────────────────────────────────────── */

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
      <div className="flex flex-wrap items-end justify-between gap-3">
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
          <div className="flex h-8 items-center rounded-md border border-border bg-surface-elevated p-0.5">
            {ATALHOS.map(([k, rot]) => (
              <button
                key={k}
                type="button"
                onClick={() => setAtalho(k)}
                aria-pressed={atalho === k}
                className={`h-full rounded px-2.5 text-xs font-medium transition-colors ${
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
        <div className="flex items-center gap-3 rounded-lg border border-border p-4 text-sm">
          Não consegui carregar a visão comercial.
          <Button size="sm" variant="secondary" onClick={() => void refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : isLoading || !r ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="ds-esqueleto h-[6.25rem] rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-3">
            <Kpi rotulo="Leads" valor={INT.format(r.kpis.leads)} detalhe="entraram no período" />
            <Kpi
              rotulo="Agendamentos"
              valor={r.kpis.agendamentos == null ? "—" : INT.format(r.kpis.agendamentos)}
              detalhe={`${pct(r.kpis.agendamentos, r.kpis.leads)} dos leads`}
            />
            <Kpi
              rotulo="Comparecimentos"
              valor={r.kpis.comparecimentos == null ? "—" : INT.format(r.kpis.comparecimentos)}
              detalhe={`${pct(r.kpis.comparecimentos, r.kpis.agendamentos)} dos agendados`}
            />
            <Kpi
              rotulo="Vendas"
              valor={INT.format(r.kpis.vendas)}
              detalhe={
                r.kpis.vendas - r.kpis.vendas_com_valor > 0
                  ? `${r.kpis.vendas - r.kpis.vendas_com_valor} sem valor`
                  : "fechadas no período"
              }
            />
            <Kpi rotulo="Faturamento" valor={reais(r.kpis.faturamento_cents)} detalhe="vendido ≠ recebido" />
            <Kpi rotulo="Ticket médio" valor={ticket == null ? "—" : reais(ticket)} detalhe="vendas com valor" />
            <Kpi
              rotulo="Pipeline aberto"
              valor={reais(r.kpis.pipeline_aberto_cents)}
              detalhe={`${r.kpis.abertos_com_valor} de ${INT.format(r.kpis.abertos)} com valor`}
            />
            <Kpi rotulo="Previsão" valor={reais(r.kpis.previsao_cents)} detalhe="valor × chance" />
          </div>

          {r.kpis.abertos_sem_responsavel > 0 || r.kpis.abertos_com_valor < r.kpis.abertos ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-warning-bg bg-warning-bg/60 px-3 py-2 text-xs text-warning-fg">
              <strong className="font-semibold">Qualidade do dado</strong>
              <span>
                {INT.format(r.kpis.abertos_sem_responsavel)} de {INT.format(r.kpis.abertos)} oportunidades abertas sem
                responsável · {INT.format(r.kpis.abertos - r.kpis.abertos_com_valor)} sem valor. Sem isso, pipeline,
                previsão e comparativo por vendedor ficam incompletos.
              </span>
              <Link href={`/app/pipelines/${r.pipeline.id}`} className="font-medium underline underline-offset-2">
                Abrir o funil
              </Link>
            </div>
          ) : null}

          <div className="grid items-start gap-4 xl:grid-cols-2">
            <Bloco titulo="Funil comercial" sub="Dos leads que entraram no período, quantos chegaram a cada etapa" semRecuo>
              <Funil etapas={r.funil} />
            </Bloco>
            <Bloco titulo="Leads por canal de origem" sub="Conversão sobre os leads do mesmo canal" semRecuo>
              <TabelaCanais linhas={r.canais} rotulo="Canal" />
            </Bloco>
          </div>

          <Bloco titulo="Evolução diária" sub="Leads recebidos (barras), agendamentos e vendas por dia, horário de Brasília">
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={r.diario.map((d) => ({ ...d, rotulo: dataCurta(d.dia) }))}
                  margin={{ left: -20, right: 4, top: 8, bottom: 0 }}
                >
                  <CartesianGrid stroke="var(--color-border)" vertical={false} />
                  <XAxis
                    dataKey="rotulo"
                    tick={{ fontSize: 11, fill: "var(--color-text-muted)" }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={18}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: "var(--color-text-muted)" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: "var(--color-surface-elevated)" }}
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid var(--color-border)",
                      fontSize: 12,
                      background: "var(--color-surface)",
                    }}
                  />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="leads" name="Leads" fill="var(--color-neutral-300)" radius={[3, 3, 0, 0]} maxBarSize={18} />
                  <Line
                    type="linear"
                    dataKey="agendamentos"
                    name="Agendamentos"
                    stroke="var(--color-info)"
                    strokeWidth={2}
                    dot={{ r: 2.5 }}
                    activeDot={{ r: 4 }}
                  />
                  <Line
                    type="linear"
                    dataKey="vendas"
                    name="Vendas"
                    stroke="var(--color-success)"
                    strokeWidth={2}
                    dot={{ r: 2.5 }}
                    activeDot={{ r: 4 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Bloco>

          <div className="grid items-start gap-4 xl:grid-cols-2">
            <Bloco
              titulo="Desempenho por campanha / anúncio"
              sub={`Leads com campanha ou anúncio identificado · ${INT.format(r.sem_anuncio)} sem identificação`}
              semRecuo
            >
              <TabelaCanais linhas={r.anuncios} rotulo="Campanha / anúncio" mostrarParticipacao={false} />
            </Bloco>
            <Bloco titulo="Oportunidades com maior chance" sub="Ordenadas por valor × chance da etapa" semRecuo>
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
