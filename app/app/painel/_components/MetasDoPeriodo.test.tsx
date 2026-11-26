import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { blocoDeMetas, type MetasGravadas } from "@/lib/metrics/painel-metas";
import { retratoVazio } from "@/lib/metrics/painel";

import { EquipeDoPeriodo } from "./EquipeDoPeriodo";
import { MetasDoPeriodo } from "./MetasDoPeriodo";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));

const DIA = 86_400_000;

function gravadas(parcial: Partial<MetasGravadas> = {}): MetasGravadas {
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

describe("meta do painel na tela", () => {
  it("sem meta mostra o realizado e o convite, sem barra", () => {
    const retrato = retratoVazio();
    retrato.leads_novos.total = 7;
    render(
      <MetasDoPeriodo
        bloco={blocoDeMetas(null, retrato, "hoje", DIA, 30 * DIA)}
        aoGravar={vi.fn()}
      />,
    );
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Definir a meta da clínica" })).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(
      screen.getByText("Ainda não há meta. O número abaixo é o que aconteceu."),
    ).toBeInTheDocument();
  });

  it("com meta diária desenha a barra do realizado contra o alvo", () => {
    const retrato = retratoVazio();
    retrato.leads_novos.total = 5;
    render(
      <MetasDoPeriodo
        bloco={blocoDeMetas(gravadas({ leads_atendidos_dia: 10 }), retrato, "hoje", DIA, 30 * DIA)}
        aoGravar={vi.fn()}
      />,
    );
    const barra = screen.getByRole("progressbar", { name: "Leads atendidos" });
    expect(barra).toHaveAttribute("aria-valuenow", "5");
    expect(screen.getByRole("button", { name: "Editar a meta" })).toBeInTheDocument();
  });
});

describe("comparativo de quem vende", () => {
  it("mostra os nomes que chegaram nos dados, não um par fixo", () => {
    render(
      <EquipeDoPeriodo
        equipe={{
          truncada: false,
          sem_responsavel: {
            leads_recebidos: 0,
            agendamentos: 0,
            consultas_realizadas: 0,
            vendas: 0,
            valor_por_moeda: [],
          },
          pessoas: [
            {
              user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              nome: "Ana",
              papel: "agent",
              leads_recebidos: 3,
              por_dia: [
                { dia: "2026-11-25", total: 1 },
                { dia: "2026-11-26", total: 2 },
              ],
              mensagens_enviadas: 4,
              p50_segundos: 90,
              amostra_resposta: 2,
              agendamentos: 1,
              consultas_realizadas: 0,
              vendas: 1,
              valor_por_moeda: [{ moeda: "BRL", quantidade: 1, valor_cents: 10000 }],
              conversao: 1 / 3,
            },
            {
              user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              nome: null,
              papel: "manager",
              leads_recebidos: 1,
              por_dia: [{ dia: "2026-11-26", total: 1 }],
              mensagens_enviadas: 0,
              p50_segundos: null,
              amostra_resposta: 0,
              agendamentos: 0,
              consultas_realizadas: 0,
              vendas: 0,
              valor_por_moeda: [],
              conversao: 0,
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Ana")).toBeInTheDocument();
    expect(screen.getByText("Sem nome bbbbbbbb")).toBeInTheDocument();
    expect(screen.getByText("Papel de vendas")).toBeInTheDocument();
    expect(screen.queryByText("Isabela")).not.toBeInTheDocument();
    expect(screen.queryByText("Fernanda")).not.toBeInTheDocument();
  });
});
