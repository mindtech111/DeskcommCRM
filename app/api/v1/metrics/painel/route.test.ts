/**
 * GET /api/v1/metrics/painel — período, organização da sessão e comparação.
 *
 * Sem banco: a RPC é mockada. A régua das janelas mora em
 * `lib/metrics/painel-periodo.test.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import type { AuthUser } from "@/lib/auth/types";
import { comercialVazio, type ComercialDoPainel } from "@/lib/metrics/painel-comercial";
import { retratoVazio, type RetratoDoPainel } from "@/lib/metrics/painel";
import { createClient } from "@/lib/supabase/server";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/users/nome-do-atendente", () => ({
  nomesDosAtendentes: vi.fn(async () => new Map<string, string | null>()),
}));

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";

function usuario(): AuthUser {
  return {
    id: USER_ID,
    email: "a@example.com",
    full_name: null,
    avatar_url: null,
    is_platform_admin: false,
    idioma: "pt-BR",
    organizations: [{ organization_id: ORG_ID, organization_name: "Org", role: "manager" }],
  } as AuthUser;
}

function retrato(parcial: Partial<RetratoDoPainel> = {}): RetratoDoPainel {
  return {
    ...retratoVazio(),
    ...parcial,
    leads_novos: { ...retratoVazio().leads_novos, ...parcial.leads_novos },
    conversas: { ...retratoVazio().conversas, ...parcial.conversas },
    consultas: { ...retratoVazio().consultas, ...parcial.consultas },
    vendas: { ...retratoVazio().vendas, ...parcial.vendas },
    resposta: { ...retratoVazio().resposta, ...parcial.resposta },
    rastreio: { ...retratoVazio().rastreio, ...parcial.rastreio },
    meta: { ...retratoVazio().meta, ...parcial.meta },
  };
}

function fakeSupabase(
  respostas: Array<{ data: unknown; error: { message: string } | null }>,
  comercial: ComercialDoPainel = comercialVazio(),
) {
  const chamadas: Array<{ nome: string; args: Record<string, unknown> }> = [];
  let i = 0;
  const consulta = {
    select() {
      return consulta;
    },
    eq() {
      return consulta;
    },
    maybeSingle() {
      return Promise.resolve({ data: null, error: null });
    },
  };
  const client = {
    rpc(nome: string, args: Record<string, unknown>) {
      chamadas.push({ nome, args });
      if (nome === "fn_painel_comercial") {
        return Promise.resolve({ data: comercial, error: null });
      }
      const resposta = respostas[i] ?? respostas[respostas.length - 1];
      i += 1;
      return Promise.resolve(resposta);
    },
    from(tabela: string) {
      if (tabela !== "painel_metas") throw new Error(`tabela inesperada: ${tabela}`);
      return consulta;
    },
  };
  return { chamadas, client };
}

function chamadasDoRetrato(chamadas: Array<{ nome: string; args: Record<string, unknown> }>) {
  return chamadas.filter((c) => c.nome === "fn_painel_diario");
}

async function chamar(url: string): Promise<Response> {
  const { GET } = await import("./route");
  return GET(new NextRequest(url));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: usuario(),
    org: { orgId: ORG_ID, name: "Org", role: "manager" },
  } as never);
});

describe("GET /api/v1/metrics/painel", () => {
  it("sem período usa hoje e chama a RPC duas vezes com a organização da sessão", async () => {
    const atual = retrato({
      leads_novos: { ...retratoVazio().leads_novos, total: 4 },
    });
    const anterior = retrato({
      leads_novos: { ...retratoVazio().leads_novos, total: 2 },
    });
    const { chamadas, client } = fakeSupabase([
      { data: atual, error: null },
      { data: anterior, error: null },
    ]);
    vi.mocked(createClient).mockResolvedValue(client as never);

    const res = await chamar("http://localhost/api/v1/metrics/painel");
    expect(res.status).toBe(200);
    const corpo = ((await res.json()) as { data: Record<string, unknown> }).data;

    expect(requireRole).toHaveBeenCalledWith(
      "manager",
      expect.objectContaining({ allowPlatformAdmin: true, resource: "metrics" }),
    );
    expect(corpo.periodo).toBe("hoje");
    expect(corpo.fuso).toBe("America/Sao_Paulo");
    const doDiario = chamadasDoRetrato(chamadas);
    expect(doDiario).toHaveLength(2);
    expect(chamadas.filter((c) => c.nome === "fn_painel_comercial")).toHaveLength(1);
    expect(chamadas.every((c) => c.args.p_org === ORG_ID)).toBe(true);
    expect(corpo.metas).toMatchObject({ definida: false });
    expect(corpo.funil).toMatchObject({
      etapas: expect.arrayContaining([{ id: "lead_novo", total: 0 }]),
    });
    const ordenadas = [...doDiario].sort(
      (a, b) => Date.parse(String(a.args.p_inicio)) - Date.parse(String(b.args.p_inicio)),
    );
    const antes = ordenadas[0]?.args as { p_inicio: string; p_fim: string };
    const depois = ordenadas[1]?.args as { p_inicio: string; p_fim: string };
    expect(Date.parse(antes.p_fim) - Date.parse(antes.p_inicio)).toBe(
      Date.parse(depois.p_fim) - Date.parse(depois.p_inicio),
    );
    // Hoje e ontem começam com 24 h de distância: o fim de ontem é o mesmo
    // relógio, não a meia-noite de hoje.
    expect(Date.parse(depois.p_inicio) - Date.parse(antes.p_inicio)).toBe(86_400_000);

    const comparacao = corpo.comparacao as { leads: { absoluto: number; percentual: number } };
    expect(comparacao.leads).toMatchObject({ atual: 4, anterior: 2, absoluto: 2, percentual: 1 });
  });

  it("7d pede a janela de sete dias e preserva null da taxa", async () => {
    const vazio = retrato();
    const { chamadas, client } = fakeSupabase([{ data: vazio, error: null }]);
    vi.mocked(createClient).mockResolvedValue(client as never);

    const res = await chamar("http://localhost/api/v1/metrics/painel?periodo=7d");
    expect(res.status).toBe(200);
    const corpo = ((await res.json()) as { data: { atual: RetratoDoPainel; periodo: string } })
      .data;
    expect(corpo.periodo).toBe("7d");
    expect(corpo.atual.resposta.taxa).toBeNull();
    expect(corpo.atual.resposta.p50_segundos).toBeNull();
    expect(corpo.atual.meta).toMatchObject({
      conectado: false,
      gasto_cents: null,
      custo_por_lead_cents: null,
      motivo: "sem_conexao",
    });
    const atual = [...chamadasDoRetrato(chamadas)].sort(
      (a, b) => Date.parse(String(b.args.p_inicio)) - Date.parse(String(a.args.p_inicio)),
    )[0]?.args as { p_inicio: string; p_fim: string };
    const tamanho = Date.parse(atual.p_fim) - Date.parse(atual.p_inicio);
    expect(tamanho).toBeGreaterThanOrEqual(6 * 86_400_000);
    expect(tamanho).toBeLessThan(7 * 86_400_000);
  });

  it("período desconhecido é 422 e a RPC não roda", async () => {
    const { chamadas, client } = fakeSupabase([{ data: retratoVazio(), error: null }]);
    vi.mocked(createClient).mockResolvedValue(client as never);

    const res = await chamar("http://localhost/api/v1/metrics/painel?periodo=90d");
    expect(res.status).toBe(422);
    expect(chamadas).toHaveLength(0);
  });

  it("sem papel devolve a recusa do guard", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: new Response(
        JSON.stringify({ error: { code: "forbidden_role", message: "não" } }),
        {
          status: 403,
        },
      ),
    } as never);
    const res = await chamar("http://localhost/api/v1/metrics/painel");
    expect(res.status).toBe(403);
  });

  it("falha da RPC vira 500 sem vazar o detalhe do banco no corpo", async () => {
    const { client } = fakeSupabase([
      { data: null, error: { message: "relation secret exploded" } },
    ]);
    vi.mocked(createClient).mockResolvedValue(client as never);
    const res = await chamar("http://localhost/api/v1/metrics/painel");
    expect(res.status).toBe(500);
    const texto = await res.text();
    expect(texto).not.toContain("secret exploded");
  });

  it("o comparativo repete as pessoas que a RPC devolveu e o nome que o resolvedor achou", async () => {
    const ana = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const bia = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const base = comercialVazio();
    const comercial: ComercialDoPainel = {
      ...base,
      equipe: {
        ...base.equipe,
        pessoas: [ana, bia].map((user_id, i) => ({
          user_id,
          papel: "agent",
          leads_recebidos: i + 1,
          por_dia: [{ dia: "2026-11-26", total: i + 1 }],
          mensagens_enviadas: 2,
          p50_segundos: 40,
          amostra_resposta: 1,
          agendamentos: 0,
          consultas_realizadas: 0,
          vendas: 0,
          valor_por_moeda: [],
          conversao: 0,
        })),
      },
    };
    vi.mocked(nomesDosAtendentes).mockResolvedValue(
      new Map([
        [ana, "Ana"],
        [bia, "Bia"],
      ]),
    );
    const { client } = fakeSupabase([{ data: retratoVazio(), error: null }], comercial);
    vi.mocked(createClient).mockResolvedValue(client as never);

    const res = await chamar("http://localhost/api/v1/metrics/painel");
    expect(res.status).toBe(200);
    const corpo = (
      (await res.json()) as {
        data: { equipe: { pessoas: Array<{ user_id: string; nome: string | null }> } };
      }
    ).data;
    expect(corpo.equipe.pessoas.map((p) => p.nome).sort()).toEqual(["Ana", "Bia"]);
    expect(JSON.stringify(corpo.equipe)).not.toMatch(/Isabela|Fernanda/);
  });

  it("a rota é leitura: não importa audit nem client de service role", () => {
    const fonte = readFileSync(join(__dirname, "route.ts"), "utf8");
    expect(fonte).not.toContain("lib/audit");
    expect(fonte).not.toContain("createAdminClient");
    expect(fonte).toContain('requireRole("manager"');
  });
});
