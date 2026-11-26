import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agenda/protecao-followup", () => ({
  protecaoAgendaSupabase: async (_db: unknown, _org: string, ids: string[]) =>
    new Map(
      ids.map((id) => [
        id,
        { adiar: false, motivo: "sem_compromisso", appointment_id: null, reavaliar_em: null },
      ]),
    ),
}));

import { calculaBucketsAtuais } from "@/lib/leads/risk-seed";
import { ErroDeConsulta } from "@/lib/postgrest/lotes-de-ids";

const ORG = "org-1";
const AGORA = new Date("2026-09-06T12:00:00Z");

function lead(n: number) {
  return {
    id: `l-${n}`,
    stage_id: "s1",
    contact_id: `c-${n}`,
    last_activity_at: "2026-09-01T12:00:00Z",
    created_at: "2026-08-01T12:00:00Z",
  };
}

function admin(opts: { erroNoCron?: boolean; quantos: number }) {
  const lotes: number[] = [];
  return {
    lotes,
    from(tabela: string) {
      const q = {
        select: () => q,
        eq: () => q,
        in: (_coluna: string, valores: string[]) => {
          if (tabela === "cron_jobs") lotes.push(valores.length);
          return q;
        },
        gt: () => q,
        then: (ok: (v: unknown) => unknown) => {
          if (tabela === "crm_leads") {
            return Promise.resolve({
              data: Array.from({ length: opts.quantos }, (_, i) => lead(i)),
              error: null,
            }).then(ok);
          }
          if (tabela === "crm_stages") {
            return Promise.resolve({
              data: [{ id: "s1", expected_duration_hours: null }],
              error: null,
            }).then(ok);
          }
          if (tabela === "cron_jobs" && opts.erroNoCron) {
            return Promise.resolve({
              data: null,
              error: { message: "URI too long", code: "PGRST100" },
            }).then(ok);
          }
          return Promise.resolve({ data: [], error: null }).then(ok);
        },
      };
      return q;
    },
  };
}

describe("risk-watcher — a lista de contatos não vai inteira na URL", () => {
  it("250 contatos em cron_jobs saem em lotes de no máximo 100", async () => {
    const db = admin({ quantos: 250 });
    const estados = await calculaBucketsAtuais(db as never, ORG, AGORA);
    expect(estados).toHaveLength(250);
    expect(db.lotes.length).toBeGreaterThan(1);
    expect(db.lotes.every((n) => n <= 100)).toBe(true);
    expect(db.lotes.reduce((s, n) => s + n, 0)).toBe(250);
  });

  it("erro de cron_jobs sobe com a tabela, em vez de classificar todo mundo sem retorno", async () => {
    const db = admin({ quantos: 3, erroNoCron: true });
    await expect(calculaBucketsAtuais(db as never, ORG, AGORA)).rejects.toMatchObject({
      name: "ErroDeConsulta",
      step: "cron_jobs",
      code: "PGRST100",
    });
    await expect(calculaBucketsAtuais(db as never, ORG, AGORA)).rejects.toBeInstanceOf(
      ErroDeConsulta,
    );
  });
});
