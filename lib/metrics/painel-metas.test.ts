import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseReaisToCents } from "@/lib/money";
import { retratoVazio } from "@/lib/metrics/painel";
import { comercialVazio } from "@/lib/metrics/painel-comercial";
import { FUSO_DO_PAINEL } from "@/lib/metrics/painel-periodo";
import {
  alvoProporcional,
  blocoDeMetas,
  progresso,
  textoDaMeta,
  textoDeCents,
  type MetasGravadas,
} from "@/lib/metrics/painel-metas";

const DIA = 86_400_000;
const MES = 30 * DIA;

function metas(parcial: Partial<MetasGravadas> = {}): MetasGravadas {
  return {
    leads_atendidos_dia: null,
    agendamentos_dia: null,
    consultas_realizadas_dia: null,
    vendas_dia: null,
    valor_cents_dia: null,
    leads_atendidos_mes: null,
    agendamentos_mes: null,
    consultas_realizadas_mes: null,
    vendas_mes: null,
    valor_cents_mes: null,
    moeda: null,
    ...parcial,
  };
}

describe("alvo proporcional", () => {
  it("hoje usa a fração do dia já decorrida, não a meta do dia inteiro", () => {
    expect(alvoProporcional(20, 400, "hoje", DIA / 2, MES)).toBe(10);
  });

  it("7 dias escala a diária pela duração real da janela", () => {
    const janela = 6 * DIA + DIA / 2;
    expect(alvoProporcional(10, 300, "7d", janela, MES)).toBe(10 * (janela / DIA));
  });

  it("30 dias prefere a meta do mês, na proporção da janela sobre o mês", () => {
    // 10 por dia daria 300 no mês. A mensal é outra conta: se o teste
    // aceitasse as duas, a preferência da mensal não estaria vigiada.
    expect(alvoProporcional(10, 100, "30d", MES, MES)).toBe(100);
    expect(alvoProporcional(10, 62, "30d", 30 * DIA, 31 * DIA)).toBeCloseTo(60, 5);
  });

  it("sem diária, a mensal vale também em hoje e em 7 dias", () => {
    expect(alvoProporcional(null, 300, "hoje", DIA, MES)).toBe(10);
    expect(alvoProporcional(null, null, "7d", 7 * DIA, MES)).toBeNull();
  });

  it("meia-noite deixa o alvo de hoje em zero, que não é ausência de meta", () => {
    expect(alvoProporcional(20, null, "hoje", 0, MES)).toBe(0);
    expect(progresso(0, 0)).toBeNull();
    expect(progresso(5, 10)).toBe(0.5);
  });
});

describe("bloco de metas", () => {
  it("sem linha gravada mostra o realizado e nenhum alvo", () => {
    const retrato = retratoVazio();
    retrato.leads_novos.total = 4;
    retrato.consultas.agendadas = 2;
    const bloco = blocoDeMetas(null, retrato, "hoje", DIA, MES);
    expect(bloco.definida).toBe(false);
    expect(bloco.indicadores.find((i) => i.id === "leads_atendidos")).toMatchObject({
      realizado: 4,
      alvo: null,
    });
    expect(bloco.indicadores.find((i) => i.id === "agendamentos")?.realizado).toBe(2);
  });

  it("o valor não soma moedas diferentes quando a meta não escolheu uma", () => {
    const retrato = retratoVazio();
    retrato.vendas.por_moeda = [
      { moeda: "BRL", quantidade: 1, valor_cents: 1000 },
      { moeda: "USD", quantidade: 1, valor_cents: 2000 },
    ];
    const bloco = blocoDeMetas(metas({ valor_cents_dia: 5000 }), retrato, "hoje", DIA, MES);
    expect(bloco.indicadores.find((i) => i.id === "valor")).toMatchObject({
      alvo: null,
      moeda: null,
      aviso: "moedas",
    });
  });

  it("com moeda na meta, o realizado é só dessa moeda", () => {
    const retrato = retratoVazio();
    retrato.vendas.por_moeda = [
      { moeda: "BRL", quantidade: 1, valor_cents: 1000 },
      { moeda: "USD", quantidade: 1, valor_cents: 2000 },
    ];
    const bloco = blocoDeMetas(
      metas({ valor_cents_dia: 4000, moeda: "BRL" }),
      retrato,
      "hoje",
      DIA,
      MES,
    );
    expect(bloco.indicadores.find((i) => i.id === "valor")).toMatchObject({
      realizado: 1000,
      alvo: 4000,
      moeda: "BRL",
    });
  });
});

describe("texto da meta e do valor", () => {
  it("arredonda a fração do dia para uma casa e o inteiro fica limpo", () => {
    expect(textoDaMeta(10)).toBe("10");
    expect(textoDaMeta(10.04)).toBe("10");
    expect(textoDaMeta(10.25)).toBe("10,3");
  });

  it("o campo de valor volta no formato que o leitor de centavos aceita", () => {
    expect(parseReaisToCents(textoDeCents(150050))).toBe(150050);
    expect(parseReaisToCents(textoDeCents(150000))).toBe(150000);
    expect(textoDeCents(null)).toBe("");
  });
});

describe("a cerca da RPC e do painel", () => {
  it("a função nova é security invoker, sem grant para anon, e nasce antes da varredura", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/20261126210000_0693_painel_metas_funil_equipe.sql"),
      "utf8",
    );
    const baseline = readFileSync(join(process.cwd(), "supabase/baseline.sql"), "utf8");
    expect(migration).toContain("security invoker");
    expect(migration).toMatch(
      /revoke all on function public\.fn_painel_comercial\([^)]*\) from public, anon/,
    );
    expect(migration).not.toMatch(
      /grant execute on function public\.fn_painel_comercial[^;]*\banon\b/,
    );
    expect(migration).not.toMatch(/Isabela|Fernanda/);
    expect(baseline).not.toMatch(/Isabela|Fernanda/);

    const fn = baseline.lastIndexOf("create or replace function public.fn_painel_comercial");
    const varredura = baseline.search(/^-- ---- VARREDURA anon:/m);
    expect(fn).toBeGreaterThan(0);
    expect(varredura).toBeGreaterThan(fn);
    expect(FUSO_DO_PAINEL).toBe("America/Sao_Paulo");
    expect(migration).toContain("'America/Sao_Paulo'");
  });

  it("o retrato vazio do comercial tem as cinco etapas e não traz nome", () => {
    const vazio = comercialVazio();
    expect(vazio.funil.etapas.map((e) => e.id)).toEqual([
      "lead_novo",
      "em_atendimento",
      "consulta_agendada",
      "consulta_realizada",
      "ganho",
    ]);
    expect(JSON.stringify(vazio)).not.toContain("nome");
  });
});
