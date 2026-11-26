import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "@/lib/logger";
import { ErroDeConsulta } from "@/lib/postgrest/lotes-de-ids";

const falha = vi.hoisted(() => ({
  atual: null as { message: string; code?: string } | null,
}));

vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ({
    ok: true,
    user: { idioma: "pt-BR" },
    org: { orgId: "org-1", role: "admin" },
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        then: (ok: (v: unknown) => unknown) =>
          Promise.resolve({ data: null, error: falha.atual }).then(ok),
      };
      return q;
    },
  }),
}));

const { GET } = await import("@/app/api/v1/leads/at-risk/route");

describe("radar — o 500 continua igual e o erro deixa de ser mudo", () => {
  beforeEach(() => {
    falha.atual = { message: "statement timeout", code: "57014" };
  });

  it("responde Falha ao carregar o radar e registra tabela e código", async () => {
    const erro = vi.spyOn(logger, "error").mockImplementation(() => {});
    const req = { url: "http://x/api/v1/leads/at-risk" } as NextRequest;
    const res = await GET(req);
    expect(res.status).toBe(500);
    const corpo = (await res.json()) as { error: { message: string } };
    expect(corpo.error.message).toBe("Falha ao carregar o radar.");
    expect(erro).toHaveBeenCalledWith(
      "[radar] falha ao carregar",
      expect.objectContaining({
        subsystem: "radar",
        step: "crm_pipelines",
        code: "57014",
        message: expect.stringContaining("statement timeout"),
      }),
    );
    erro.mockRestore();
  });
});

describe("radar — cron_jobs com erro não vira 'sem follow-up'", () => {
  it("sobe ErroDeConsulta com a tabela e o código", async () => {
    const { carregaRadarDeRisco } = await import("@/lib/leads/radar-de-risco");
    const admin = {
      from(tabela: string) {
        const q = {
          select: () => q,
          eq: () => q,
          not: () => q,
          order: () => q,
          limit: () => q,
          is: () => q,
          in: () => q,
          gt: () => q,
          then: (ok: (v: unknown) => unknown) => {
            if (tabela === "crm_pipelines")
              return Promise.resolve({ data: [], error: null }).then(ok);
            if (tabela === "crm_leads") {
              return Promise.resolve({
                data: [
                  {
                    id: "l1",
                    title: "t",
                    contact_id: "c1",
                    owner_user_id: null,
                    owner_kind: null,
                    owner_agent_id: null,
                    stage_id: null,
                    last_activity_at: "2026-01-01T00:00:00Z",
                    created_at: "2026-01-01T00:00:00Z",
                    pipeline_id: "p1",
                  },
                ],
                error: null,
              }).then(ok);
            }
            if (tabela === "cron_jobs") {
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
    await expect(
      carregaRadarDeRisco(admin as never, { organizationId: "org-1" }),
    ).rejects.toBeInstanceOf(ErroDeConsulta);
    await expect(
      carregaRadarDeRisco(admin as never, { organizationId: "org-1" }),
    ).rejects.toMatchObject({ step: "cron_jobs", code: "PGRST100" });
  });
});
