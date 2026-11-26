import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Com a opção ligada, quem já tem card aberto não ganha outro.
 * Com a opção ausente ou desligada, o envio continua criando card — é o
 * comportamento das fontes que já existiam antes da coluna.
 */

const h = vi.hoisted(() => ({
  registrar: vi.fn(async () => undefined),
  criarLead: vi.fn(async (..._args: unknown[]) => ({ id: "lead-novo" })),
  leituras: new Map<string, Array<Record<string, unknown>>>(),
}));

function cadeia(tabela: string): unknown {
  const proxima = (): Record<string, unknown> => {
    const fila = h.leituras.get(tabela) ?? [];
    if (fila.length === 0) return { data: null, error: null };
    if (fila.length > 1) return fila.shift() as Record<string, unknown>;
    return fila[0] as Record<string, unknown>;
  };
  const proxy: unknown = new Proxy(() => undefined, {
    get(_alvo, prop) {
      if (prop === "then") return (ok: (v: unknown) => unknown) => ok(proxima());
      return () => proxy;
    },
  });
  return proxy;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: cadeia,
    rpc: async () => ({ data: {}, error: null }),
  }),
}));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({
  checkRateLimit: async () => ({ allowed: true }),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/webhooks/captacao", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  registrarCaptacao: h.registrar,
}));
vi.mock("@/app/api/v1/leads/_handler", () => ({
  createLeadHandler: h.criarLead,
  updateLeadHandler: vi.fn(),
  moveLeadHandler: vi.fn(),
}));
vi.mock("@/lib/dev/kick-local-pipeline", () => ({ kickLocalPipeline: async () => undefined }));

import { POST } from "@/app/api/v1/webhooks/in/[token]/route";

const FONTE = {
  id: "fonte-1",
  name: "Revi",
  organization_id: "org-1",
  secret_encrypted: null,
  default_pipeline_id: "pipe-1",
  default_stage_id: "stage-1",
  field_map: {},
  form_fields: [],
  redirect_to: null,
  is_active: true,
  authorize_ai_on_capture: false,
  update_existing_lead_on_capture: false,
  capture_source: "revi",
};

const CONTATO = [{ id: "contato-1", phone_number: "+5511999990000", name: "Ana" }];
const CONTATO_VIVO = {
  is_anonymized: false,
  tags: ["vip"],
  source_metadata: { utm_source: "organico" },
};
const CARD = {
  id: "lead-aberto",
  source: "whatsapp",
  external_id: null,
  source_metadata: { utm_source: "organico" },
  tags: ["vip"],
  contact_id: "contato-1",
};

async function enviar(corpo: Record<string, unknown>): Promise<Response> {
  const req = new NextRequest("http://localhost/api/v1/webhooks/in/token-da-fonte-0001", {
    method: "POST",
    body: JSON.stringify(corpo),
    headers: { "content-type": "application/json" },
  });
  return (await POST(req, {
    params: Promise.resolve({ token: "token-da-fonte-0001" }),
  })) as Response;
}

function desfecho(): string | undefined {
  const chamadas = h.registrar.mock.calls as unknown as Array<[unknown, { outcome?: string }]>;
  return chamadas.at(-1)?.[1]?.outcome;
}

beforeEach(() => {
  h.registrar.mockClear();
  h.criarLead.mockClear();
  h.leituras.clear();
});

const CORPO = {
  nome: "Ana",
  telefone: "+5511999990000",
  utm_source: "revi",
  utm_medium: "whatsapp",
  utm_campaign: "revi_vb",
};

describe("POST /api/v1/webhooks/in reaproveita o card aberto", () => {
  it("opção ligada: não cria card e devolve o que já estava aberto", async () => {
    h.leituras.set("webhook_sources", [{ data: { ...FONTE, reuse_open_lead: true }, error: null }]);
    h.leituras.set("contacts", [
      { data: CONTATO, error: null },
      { data: CONTATO_VIVO, error: null },
    ]);
    h.leituras.set("crm_leads", [{ data: CARD, error: null }]);

    const res = await enviar(CORPO);

    expect(h.criarLead).not.toHaveBeenCalled();
    expect(desfecho()).toBe("atualizado");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { lead_id: "lead-aberto" } });
  });

  it("opção desligada: o card aberto não impede um card novo", async () => {
    h.leituras.set("webhook_sources", [
      { data: { ...FONTE, reuse_open_lead: false }, error: null },
    ]);
    h.leituras.set("contacts", [{ data: CONTATO, error: null }]);
    h.leituras.set("crm_leads", [{ data: CARD, error: null }]);

    const res = await enviar(CORPO);

    expect(h.criarLead).toHaveBeenCalledOnce();
    const entrada = h.criarLead.mock.calls[0]?.[2] as unknown as {
      source?: string;
      tags?: string[];
      source_metadata?: { capture_source?: string };
    };
    expect(entrada?.source).toBe("webhook");
    expect(entrada?.source_metadata?.capture_source).toBe("revi");
    expect(entrada?.tags).toEqual(expect.arrayContaining(["revi_vb", "revi/vb"]));
    expect(entrada?.tags).not.toContain("revi/whatsapp");
    expect(desfecho()).toBe("criado");
    expect(res.status).toBe(200);
  });

  it("coluna ausente continua criando card", async () => {
    h.leituras.set("webhook_sources", [{ data: FONTE, error: null }]);
    h.leituras.set("contacts", [{ data: CONTATO, error: null }]);

    await enviar(CORPO);

    expect(h.criarLead).toHaveBeenCalledOnce();
  });

  it("external_id repetido não cria outro card, mesmo com a opção ligada", async () => {
    h.leituras.set("webhook_sources", [{ data: { ...FONTE, reuse_open_lead: true }, error: null }]);
    h.leituras.set("crm_leads", [
      {
        data: {
          id: "lead-ext",
          contact_id: "contato-1",
          webhook_source_id: "fonte-1",
          title: "Ana",
          custom_fields: {},
          pipeline_id: "pipe-1",
          stage_id: "stage-1",
        },
        error: null,
      },
    ]);

    const res = await enviar({ ...CORPO, external_id: "ext-1" });

    expect(h.criarLead).not.toHaveBeenCalled();
    expect(desfecho()).toBe("duplicado");
    expect(await res.json()).toEqual({ data: { lead_id: "lead-ext" } });
  });
});
