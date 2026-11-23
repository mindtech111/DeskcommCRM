import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  permitido: true,
  resultado: { ok: true } as { ok: true } | { ok: false; recusa: string },
  chamadas: [] as Array<{ token: string; leadId: string }>,
}));

vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({
  checkRateLimit: async () => ({ allowed: h.permitido }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/webhooks/clique-whatsapp", async () => {
  const real = await vi.importActual<typeof import("@/lib/webhooks/clique-whatsapp")>(
    "@/lib/webhooks/clique-whatsapp",
  );
  return {
    ...real,
    aplicarCliqueWhatsapp: async (_admin: unknown, entrada: { token: string; leadId: string }) => {
      h.chamadas.push({ token: entrada.token, leadId: entrada.leadId });
      return h.resultado;
    },
  };
});

import { POST } from "./route";

const TOKEN = "tok_site_contato_publico";
const LEAD = "22222222-2222-4222-8222-222222222222";

function pedido(corpo: string, token = TOKEN) {
  return POST(
    new NextRequest(`http://localhost/api/v1/webhooks/in/${token}/clique-whatsapp`, {
      method: "POST",
      body: corpo,
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ token }) },
  );
}

describe("POST clique-whatsapp", () => {
  beforeEach(() => {
    h.permitido = true;
    h.resultado = { ok: true };
    h.chamadas = [];
  });

  it("responde curto e só repassa o lead_id", async () => {
    const res = await pedido(JSON.stringify({ lead_id: LEAD }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { ok: true } });
    expect(h.chamadas).toEqual([{ token: TOKEN, leadId: LEAD }]);
  });

  it("corpo com resposta de score ou dado de saúde é recusado e não segue", async () => {
    const res = await pedido(JSON.stringify({ lead_id: LEAD, score: "82", queixa: "dor" }));
    expect(res.status).toBe(400);
    expect(h.chamadas).toEqual([]);
  });

  it("corpo sem lead_id é 400 e não chama o banco", async () => {
    const res = await pedido(JSON.stringify({ nome: "Ana" }));
    expect(res.status).toBe(400);
    expect(h.chamadas).toEqual([]);
  });

  it("token curto é 404", async () => {
    const res = await pedido(JSON.stringify({ lead_id: LEAD }), "curto");
    expect(res.status).toBe(404);
    expect(h.chamadas).toEqual([]);
  });

  it("estouro de taxa é 429", async () => {
    h.permitido = false;
    const res = await pedido(JSON.stringify({ lead_id: LEAD }));
    expect(res.status).toBe(429);
  });

  it("lead expirado vira 409", async () => {
    h.resultado = { ok: false, recusa: "lead_expirado" };
    const res = await pedido(JSON.stringify({ lead_id: LEAD }));
    expect(res.status).toBe(409);
  });

  it("lead de outra fonte vira 404", async () => {
    h.resultado = { ok: false, recusa: "lead_fora_da_fonte" };
    const res = await pedido(JSON.stringify({ lead_id: LEAD }));
    expect(res.status).toBe(404);
  });
});
