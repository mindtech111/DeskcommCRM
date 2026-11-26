"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { ApiError } from "@/lib/api/types";
import { formatValorDoNegocio, parseReaisToCents } from "@/lib/money";
import type { IndicadorDeMeta, MetasGravadas, CorpoDasMetas } from "@/lib/metrics/painel-metas";
import {
  progresso,
  textoDaMeta,
  textoDeCents,
  type BlocoDeMetas,
} from "@/lib/metrics/painel-metas";

function rotulo(id: IndicadorDeMeta["id"], t: (texto: string) => string): string {
  switch (id) {
    case "leads_atendidos":
      return t("Leads atendidos");
    case "agendamentos":
      return t("Agendamentos");
    case "consultas_realizadas":
      return t("Consultas realizadas");
    case "vendas":
      return t("Vendas");
    case "valor":
      return t("Valor ganho");
  }
}

function explicacao(id: IndicadorDeMeta["id"], t: (texto: string) => string): string {
  switch (id) {
    case "leads_atendidos":
      return t("Leads que chegaram no período. É o mesmo número de Leads novos.");
    case "agendamentos":
      return t("Entradas na etapa Consulta agendada.");
    case "consultas_realizadas":
      return t("Entradas na etapa Consulta realizada.");
    case "vendas":
      return t("Leads marcados como ganhos no período.");
    case "valor":
      return t("Valor ganho na moeda da meta.");
  }
}

function textoDoRealizado(indicador: IndicadorDeMeta): string {
  if (indicador.id === "valor" && indicador.moeda) {
    return formatValorDoNegocio(indicador.realizado, indicador.moeda);
  }
  return String(indicador.realizado);
}

function textoDoAlvo(indicador: IndicadorDeMeta): string {
  if (indicador.alvo == null) return "";
  if (indicador.id === "valor" && indicador.moeda) {
    return formatValorDoNegocio(indicador.alvo, indicador.moeda);
  }
  return textoDaMeta(indicador.alvo);
}

function Barra({ indicador }: { indicador: IndicadorDeMeta }) {
  const t = useT();
  const nome = rotulo(indicador.id, t);
  if (indicador.aviso === "moedas") {
    return (
      <p className="text-xs text-muted-foreground">
        {t("Defina a moeda da meta para comparar o valor quando há mais de uma.")}
      </p>
    );
  }
  if (indicador.alvo == null) {
    return <p className="text-xs text-muted-foreground">{t("Sem meta neste indicador.")}</p>;
  }
  const frac = progresso(indicador.realizado, indicador.alvo);
  const largura = frac == null ? 0 : Math.min(100, Math.round(frac * 100));
  const percentual = frac == null ? null : `${Math.round(frac * 100)}%`;
  return (
    <div>
      <div className="mb-1 flex justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {t("Meta do período")}: {textoDoAlvo(indicador)}
        </span>
        {percentual ? <span className="tabular-nums">{percentual}</span> : null}
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={Math.max(1, Math.round(indicador.alvo))}
        aria-valuenow={indicador.realizado}
        aria-label={nome}
      >
        <div className="h-full bg-accent" style={{ width: `${largura}%` }} />
      </div>
    </div>
  );
}

function CampoNumero({
  id,
  rotuloCampo,
  valor,
  onChange,
}: {
  id: string;
  rotuloCampo: string;
  valor: string;
  onChange: (valor: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm" htmlFor={id}>
      {rotuloCampo}
      <Input id={id} inputMode="numeric" value={valor} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function inteiroOuNulo(texto: string): number | null | "invalido" {
  const limpo = texto.trim();
  if (!limpo) return null;
  if (!/^\d+$/.test(limpo)) return "invalido";
  const n = Number(limpo);
  if (!Number.isSafeInteger(n)) return "invalido";
  return n;
}

interface Rascunho {
  leadsDia: string;
  agendamentosDia: string;
  consultasDia: string;
  vendasDia: string;
  valorDia: string;
  leadsMes: string;
  agendamentosMes: string;
  consultasMes: string;
  vendasMes: string;
  valorMes: string;
  moeda: string;
}

function rascunhoDe(gravadas: MetasGravadas | null): Rascunho {
  return {
    leadsDia: gravadas?.leads_atendidos_dia == null ? "" : String(gravadas.leads_atendidos_dia),
    agendamentosDia: gravadas?.agendamentos_dia == null ? "" : String(gravadas.agendamentos_dia),
    consultasDia:
      gravadas?.consultas_realizadas_dia == null ? "" : String(gravadas.consultas_realizadas_dia),
    vendasDia: gravadas?.vendas_dia == null ? "" : String(gravadas.vendas_dia),
    valorDia: textoDeCents(gravadas?.valor_cents_dia ?? null),
    leadsMes: gravadas?.leads_atendidos_mes == null ? "" : String(gravadas.leads_atendidos_mes),
    agendamentosMes: gravadas?.agendamentos_mes == null ? "" : String(gravadas.agendamentos_mes),
    consultasMes:
      gravadas?.consultas_realizadas_mes == null ? "" : String(gravadas.consultas_realizadas_mes),
    vendasMes: gravadas?.vendas_mes == null ? "" : String(gravadas.vendas_mes),
    valorMes: textoDeCents(gravadas?.valor_cents_mes ?? null),
    moeda: gravadas?.moeda ?? "",
  };
}

export function MetasDoPeriodo({
  bloco,
  aoGravar,
}: {
  bloco: BlocoDeMetas;
  aoGravar: (corpo: CorpoDasMetas) => Promise<void>;
}) {
  const t = useT();
  const [aberto, setAberto] = useState(false);
  const [rascunho, setRascunho] = useState<Rascunho>(() => rascunhoDe(bloco.gravadas));
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  function set<K extends keyof Rascunho>(chave: K, valor: string) {
    setRascunho((atual) => ({ ...atual, [chave]: valor }));
  }

  async function salvar() {
    const leadsDia = inteiroOuNulo(rascunho.leadsDia);
    const agendamentosDia = inteiroOuNulo(rascunho.agendamentosDia);
    const consultasDia = inteiroOuNulo(rascunho.consultasDia);
    const vendasDia = inteiroOuNulo(rascunho.vendasDia);
    const leadsMes = inteiroOuNulo(rascunho.leadsMes);
    const agendamentosMes = inteiroOuNulo(rascunho.agendamentosMes);
    const consultasMes = inteiroOuNulo(rascunho.consultasMes);
    const vendasMes = inteiroOuNulo(rascunho.vendasMes);
    const valorDia = rascunho.valorDia.trim() ? parseReaisToCents(rascunho.valorDia) : null;
    const valorMes = rascunho.valorMes.trim() ? parseReaisToCents(rascunho.valorMes) : null;
    const moeda = rascunho.moeda.trim().toUpperCase();
    if (
      [
        leadsDia,
        agendamentosDia,
        consultasDia,
        vendasDia,
        leadsMes,
        agendamentosMes,
        consultasMes,
        vendasMes,
      ].includes("invalido") ||
      (rascunho.valorDia.trim() && valorDia == null) ||
      (rascunho.valorMes.trim() && valorMes == null)
    ) {
      setErro(t("Valor inválido. Use 1500 ou 1500,50."));
      return;
    }
    if ((valorDia != null || valorMes != null) && !/^[A-Z]{3}$/.test(moeda)) {
      setErro(t("Informe a moeda do valor com três letras, por exemplo BRL."));
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      await aoGravar({
        leads_atendidos_dia: leadsDia as number | null,
        agendamentos_dia: agendamentosDia as number | null,
        consultas_realizadas_dia: consultasDia as number | null,
        vendas_dia: vendasDia as number | null,
        valor_cents_dia: valorDia,
        leads_atendidos_mes: leadsMes as number | null,
        agendamentos_mes: agendamentosMes as number | null,
        consultas_realizadas_mes: consultasMes as number | null,
        vendas_mes: vendasMes as number | null,
        valor_cents_mes: valorMes,
        moeda: moeda ? moeda : null,
      });
      setAberto(false);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : t("Não consegui salvar a meta."));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card className="md:col-span-2">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>{t("Meta e realizado")}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {bloco.definida
              ? t(
                  "A meta acompanha o tempo já decorrido nesta janela. Nos 30 dias, a meta do mês substitui a diária, na proporção do mês.",
                )
              : t("Ainda não há meta. O número abaixo é o que aconteceu.")}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setAberto((estaAberto) => {
              if (!estaAberto) {
                setRascunho(rascunhoDe(bloco.gravadas));
                setErro(null);
              }
              return !estaAberto;
            });
          }}
        >
          {aberto
            ? t("Fechar edição")
            : bloco.definida
              ? t("Editar a meta")
              : t("Definir a meta da clínica")}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {bloco.indicadores.map((indicador) => (
            <div key={indicador.id} className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">{rotulo(indicador.id, t)}</p>
              <p className="text-3xl font-semibold tracking-tight tabular-nums">
                {indicador.aviso === "moedas" ? "—" : textoDoRealizado(indicador)}
              </p>
              {bloco.definida ? <Barra indicador={indicador} /> : null}
              <p className="text-xs text-muted-foreground">{explicacao(indicador.id, t)}</p>
            </div>
          ))}
        </div>
        {aberto ? (
          <form
            className="flex flex-col gap-4 border-t border-border pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              void salvar();
            }}
          >
            <p className="text-sm font-medium">{t("Meta diária")}</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <CampoNumero
                id="meta-leads-dia"
                rotuloCampo={t("Leads atendidos")}
                valor={rascunho.leadsDia}
                onChange={(v) => set("leadsDia", v)}
              />
              <CampoNumero
                id="meta-agendamentos-dia"
                rotuloCampo={t("Agendamentos")}
                valor={rascunho.agendamentosDia}
                onChange={(v) => set("agendamentosDia", v)}
              />
              <CampoNumero
                id="meta-consultas-dia"
                rotuloCampo={t("Consultas realizadas")}
                valor={rascunho.consultasDia}
                onChange={(v) => set("consultasDia", v)}
              />
              <CampoNumero
                id="meta-vendas-dia"
                rotuloCampo={t("Vendas")}
                valor={rascunho.vendasDia}
                onChange={(v) => set("vendasDia", v)}
              />
              <CampoNumero
                id="meta-valor-dia"
                rotuloCampo={t("Valor ganho")}
                valor={rascunho.valorDia}
                onChange={(v) => set("valorDia", v)}
              />
              <label className="flex flex-col gap-1 text-sm" htmlFor="meta-moeda">
                {t("Moeda")}
                <Input
                  id="meta-moeda"
                  maxLength={3}
                  value={rascunho.moeda}
                  onChange={(e) => set("moeda", e.target.value.toUpperCase())}
                  placeholder="BRL"
                />
              </label>
            </div>
            <details>
              <summary className="cursor-pointer text-sm font-medium">{t("Meta do mês")}</summary>
              <p className="mt-1 mb-3 text-xs text-muted-foreground">
                {t("Opcional. Nos últimos 30 dias ela vale no lugar da diária.")}
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <CampoNumero
                  id="meta-leads-mes"
                  rotuloCampo={t("Leads atendidos")}
                  valor={rascunho.leadsMes}
                  onChange={(v) => set("leadsMes", v)}
                />
                <CampoNumero
                  id="meta-agendamentos-mes"
                  rotuloCampo={t("Agendamentos")}
                  valor={rascunho.agendamentosMes}
                  onChange={(v) => set("agendamentosMes", v)}
                />
                <CampoNumero
                  id="meta-consultas-mes"
                  rotuloCampo={t("Consultas realizadas")}
                  valor={rascunho.consultasMes}
                  onChange={(v) => set("consultasMes", v)}
                />
                <CampoNumero
                  id="meta-vendas-mes"
                  rotuloCampo={t("Vendas")}
                  valor={rascunho.vendasMes}
                  onChange={(v) => set("vendasMes", v)}
                />
                <CampoNumero
                  id="meta-valor-mes"
                  rotuloCampo={t("Valor ganho")}
                  valor={rascunho.valorMes}
                  onChange={(v) => set("valorMes", v)}
                />
              </div>
            </details>
            {erro ? <p className="text-sm text-destructive">{erro}</p> : null}
            <div>
              <Button type="submit" disabled={salvando}>
                {salvando ? t("Salvando…") : t("Salvar meta")}
              </Button>
            </div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
