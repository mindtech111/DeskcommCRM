import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EstadoCalculado } from "@/lib/leads/risk-seed";

/**
 * O lote de contatos deixou o risk-watcher CHEGAR na comparação de estado
 * nas organizações grandes. A leitura do estado gravado, se for uma consulta
 * só, para nas 1000 linhas do PostgREST — e negócio que ficou de fora vira
 * "nunca vi" e ganha outro esfriamento.
 */

const emitidos = vi.hoisted(() => [] as string[]);
const atuais = vi.hoisted(() => ({ valor: [] as EstadoCalculado[] }));

vi.mock("@/lib/leads/activity-emitter", () => ({
  emitLeadActivity: async (_admin: unknown, entrada: { leadId: string }) => {
    emitidos.push(entrada.leadId);
    return { ok: true };
  },
}));
vi.mock("@/lib/leads/reactivation", () => ({
  propoeReativacao: async () => null,
}));
vi.mock("@/lib/leads/risk-seed", () => ({
  calculaBucketsAtuais: async () => atuais.valor,
}));

import { observaTravessias } from "@/lib/leads/risk-worker";

const ORG = "org-1";
const AGORA = new Date("2026-09-06T12:00:00Z");
const ABERTO = "aberto-critico";
const NOVO = "aberto-novo";

const salvos = new Map<string, string>();

function estado(leadId: string): EstadoCalculado {
  return { leadId, contactId: null, bucket: "critico", since: AGORA, coldHours: 72 };
}

function admin() {
  return {
    from(tabela: string) {
      if (tabela !== "crm_lead_risk_states") throw new Error(`tabela inesperada: ${tabela}`);
      let filtro: readonly string[] | null = null;
      const leitura = {
        select: () => leitura,
        eq: () => leitura,
        in: (_coluna: string, ids: readonly string[]) => {
          filtro = ids;
          return leitura;
        },
        then: (ok: (v: unknown) => unknown) => {
          let linhas = [...salvos.entries()].map(([lead_id, bucket]) => ({ lead_id, bucket }));
          // Sem o `.in`, o PostgREST devolve no máximo 1000 — e os fechados
          // antigos, gravados primeiro, empurram o aberto para fora.
          if (filtro) linhas = linhas.filter((l) => filtro!.includes(l.lead_id));
          else linhas = linhas.slice(0, 1000);
          return Promise.resolve({ data: linhas, error: null }).then(ok);
        },
      };
      return {
        select: () => leitura,
        upsert: async () => ({ error: null }),
      };
    },
  };
}

describe("risk-watcher não regrava esfriamento que já estava gravado", () => {
  beforeEach(() => {
    emitidos.length = 0;
    salvos.clear();
    for (let i = 0; i < 1000; i += 1) salvos.set(`fechado-${i}`, "critico");
    salvos.set(ABERTO, "critico");
    atuais.valor = [estado(ABERTO), estado(NOVO)];
  });

  it("o crítico já gravado, além das 1000 linhas, não ganha outra linha; o novo ganha", async () => {
    const r = await observaTravessias(admin() as never, ORG, AGORA);
    expect(emitidos).toEqual([NOVO]);
    expect(r.esfriaram).toBe(1);
    expect(r.travessias).toBe(1);
  });
});
