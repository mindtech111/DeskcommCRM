/**
 * PUT /api/v1/metrics/painel/metas — a organização é a da sessão.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import type { AuthUser } from "@/lib/auth/types";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/impersonate/support", () => ({
  requireSupportWrite: vi.fn(async () => null),
}));

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const OUTRA = "33333333-3333-4333-8333-333333333333";

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

function corpo(parcial: Record<string, unknown> = {}) {
  return {
    leads_atendidos_dia: 20,
    agendamentos_dia: 8,
    consultas_realizadas_dia: 5,
    vendas_dia: 2,
    valor_cents_dia: 150000,
    leads_atendidos_mes: null,
    agendamentos_mes: null,
    consultas_realizadas_mes: null,
    vendas_mes: null,
    valor_cents_mes: null,
    moeda: "BRL",
    ...parcial,
  };
}

function cliente() {
  const upsert = vi.fn(async (_row?: Record<string, unknown>, _opts?: unknown) => ({
    error: null,
  }));
  return {
    upsert,
    client: {
      from(tabela: string) {
        if (tabela !== "painel_metas") throw new Error(tabela);
        return { upsert };
      },
    },
  };
}

async function gravar(body: unknown): Promise<Response> {
  const { PUT } = await import("./route");
  return PUT(
    new NextRequest("http://localhost/api/v1/metrics/painel/metas", {
      method: "PUT",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: usuario(),
    org: { orgId: ORG_ID, name: "Org", role: "manager" },
  } as never);
  vi.mocked(requireSupportWrite).mockResolvedValue(null);
});

describe("PUT /api/v1/metrics/painel/metas", () => {
  it("grava na organização da sessão e audita, ignorando qualquer id no corpo", async () => {
    const { upsert, client } = cliente();
    vi.mocked(createAdminClient).mockReturnValue(client as never);

    const res = await gravar(corpo());
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: ORG_ID,
        leads_atendidos_dia: 20,
        updated_by: USER_ID,
      }),
      { onConflict: "organization_id" },
    );
    const gravado = upsert.mock.calls[0]?.[0] as { organization_id: string } | undefined;
    expect(gravado?.organization_id).toBe(ORG_ID);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "painel.metas_updated",
        organizationId: ORG_ID,
        actorUserId: USER_ID,
      }),
    );
  });

  it("corpo com organization_id é 422 e não grava", async () => {
    const { upsert, client } = cliente();
    vi.mocked(createAdminClient).mockReturnValue(client as never);
    const res = await gravar(corpo({ organization_id: OUTRA }));
    expect(res.status).toBe(422);
    expect(upsert).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("valor sem moeda é 422", async () => {
    const { upsert, client } = cliente();
    vi.mocked(createAdminClient).mockReturnValue(client as never);
    const res = await gravar(corpo({ moeda: null }));
    expect(res.status).toBe(422);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("número negativo é 422", async () => {
    const { client } = cliente();
    vi.mocked(createAdminClient).mockReturnValue(client as never);
    const res = await gravar(corpo({ vendas_dia: -1 }));
    expect(res.status).toBe(422);
  });

  it("acompanhamento só de leitura não grava", async () => {
    vi.mocked(requireSupportWrite).mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "forbidden", message: "somente leitura" } }), {
        status: 403,
      }) as never,
    );
    const { upsert, client } = cliente();
    vi.mocked(createAdminClient).mockReturnValue(client as never);
    const res = await gravar(corpo());
    expect(res.status).toBe(403);
    expect(upsert).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("sem papel de gerente devolve a recusa do guard", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: { code: "forbidden_role" } }), {
        status: 403,
      }),
    } as never);
    const res = await gravar(corpo());
    expect(res.status).toBe(403);
  });
});
