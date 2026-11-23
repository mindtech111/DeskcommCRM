import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/leads/activity-emitter", () => ({
  emitLeadActivity: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/webhooks/secrets", () => ({
  decryptWebhookSecret: vi.fn(async (_admin: unknown, cifra: string) =>
    cifra === "cifra-boa" ? "segredo" : null,
  ),
}));

import { createHmac } from "node:crypto";

import { audit } from "@/lib/audit";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import {
  JANELA_DO_CLIQUE_MS,
  TAG_CLIQUE_WHATSAPP,
  aplicarCliqueWhatsapp,
  leadDentroDaJanela,
} from "@/lib/webhooks/clique-whatsapp";

const FONTE = "fonte-1";
const ORG = "org-1";
const LEAD = "22222222-2222-4222-8222-222222222222";
const TOKEN = "tok_site_contato_publico";
const AGORA = new Date("2026-11-23T15:00:00.000Z");

interface Estado {
  fonte: {
    id: string;
    organization_id: string;
    is_active: boolean;
    secret_encrypted: string | null;
  } | null;
  marca: Array<{ id: string }>;
  publicado: Array<{ id: string }>;
  lead: {
    id: string;
    organization_id: string;
    webhook_source_id: string | null;
    created_at: string;
    contact_id: string | null;
  } | null;
  juncao: { tags: string[]; adicionadas: string[] } | null;
  rpcs: Array<{ nome: string; args: Record<string, unknown> }>;
}

function adminDe(estado: Estado) {
  return {
    from(tabela: string) {
      const api = {
        select() {
          return api;
        },
        eq() {
          return api;
        },
        contains() {
          return api;
        },
        limit() {
          return Promise.resolve(
            tabela === "crm_lead_activities"
              ? { data: estado.marca, error: null }
              : tabela === "event_log"
                ? { data: estado.publicado, error: null }
                : { data: [], error: null },
          );
        },
        maybeSingle: async () => {
          if (tabela === "webhook_sources") return { data: estado.fonte, error: null };
          if (tabela === "crm_leads") return { data: estado.lead, error: null };
          return { data: null, error: null };
        },
      };
      return api;
    },
    rpc: async (nome: string, args: Record<string, unknown>) => {
      estado.rpcs.push({ nome, args });
      if (nome === "fn_lead_adicionar_etiquetas") return { data: estado.juncao, error: null };
      return { data: null, error: null };
    },
  };
}

function estado(sobre: Partial<Estado> = {}): Estado {
  return {
    fonte: { id: FONTE, organization_id: ORG, is_active: true, secret_encrypted: null },
    marca: [],
    publicado: [],
    lead: {
      id: LEAD,
      organization_id: ORG,
      webhook_source_id: FONTE,
      created_at: new Date(AGORA.getTime() - 60 * 60 * 1000).toISOString(),
      contact_id: "contato-1",
    },
    juncao: { tags: ["origem:site", TAG_CLIQUE_WHATSAPP], adicionadas: [TAG_CLIQUE_WHATSAPP] },
    rpcs: [],
    ...sobre,
  };
}

const CORPO = JSON.stringify({ lead_id: LEAD });

function pedido(extra: Record<string, unknown> = {}) {
  return {
    token: TOKEN,
    leadId: LEAD,
    agora: AGORA,
    requestId: "req",
    rawBody: CORPO,
    assinatura: null as string | null,
    ...extra,
  };
}

describe("janela de 48 h", () => {
  it("aceita o lead novo e recusa o de 48 h", () => {
    expect(
      leadDentroDaJanela(new Date(AGORA.getTime() - JANELA_DO_CLIQUE_MS + 1).toISOString(), AGORA),
    ).toBe(true);
    expect(
      leadDentroDaJanela(new Date(AGORA.getTime() - JANELA_DO_CLIQUE_MS).toISOString(), AGORA),
    ).toBe(false);
  });
});

describe("aplicarCliqueWhatsapp", () => {
  it("soma a tag sem reescrever as outras e registra a timeline", async () => {
    const e = estado();
    const r = await aplicarCliqueWhatsapp(adminDe(e) as never, pedido({ requestId: "req-1" }));
    expect(r).toEqual({ ok: true });
    const juncao = e.rpcs.find((c) => c.nome === "fn_lead_adicionar_etiquetas");
    expect(juncao?.args).toEqual({
      p_org: ORG,
      p_lead: LEAD,
      p_etiquetas: [TAG_CLIQUE_WHATSAPP],
    });
    expect(e.rpcs.some((c) => c.nome === "emit_event")).toBe(true);
    expect(emitLeadActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: "whatsapp_link_clicked",
        reason: "Clicou para falar no WhatsApp",
        payload: { tag: TAG_CLIQUE_WHATSAPP },
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "webhook.whatsapp_click" }),
    );
  });

  it("a segunda chamada, com tag e timeline, não duplica", async () => {
    vi.mocked(emitLeadActivity).mockClear();
    vi.mocked(audit).mockClear();
    const e = estado({
      juncao: { tags: ["origem:site", TAG_CLIQUE_WHATSAPP], adicionadas: [] },
      marca: [{ id: "ja" }],
    });
    const r = await aplicarCliqueWhatsapp(adminDe(e) as never, pedido({ requestId: "req-2" }));
    expect(r).toEqual({ ok: true });
    expect(e.rpcs.map((c) => c.nome)).toEqual(["fn_lead_adicionar_etiquetas"]);
    expect(emitLeadActivity).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("tag gravada sem evento: o retry publica de novo", async () => {
    vi.mocked(emitLeadActivity).mockClear();
    const e = estado({
      juncao: { tags: [TAG_CLIQUE_WHATSAPP], adicionadas: [] },
      marca: [],
      publicado: [],
    });
    const r = await aplicarCliqueWhatsapp(adminDe(e) as never, pedido());
    expect(r).toEqual({ ok: true });
    expect(e.rpcs.some((c) => c.nome === "emit_event")).toBe(true);
    expect(emitLeadActivity).toHaveBeenCalled();
  });

  it("fonte com segredo recusa corpo sem a assinatura do webhook", async () => {
    vi.mocked(audit).mockClear();
    const e = estado();
    e.fonte!.secret_encrypted = "cifra-boa";
    const r = await aplicarCliqueWhatsapp(adminDe(e) as never, pedido({ requestId: "req-sig" }));
    expect(r).toEqual({ ok: false, recusa: "assinatura_invalida" });
    expect(e.rpcs).toEqual([]);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "webhook.inbound_invalid_signature",
        organizationId: ORG,
        requestId: "req-sig",
        metadata: { reason: "assinatura_invalida", origem: "clique_whatsapp" },
      }),
    );
  });

  it("segredo que não decifra recusa o clique sem olhar o lead", async () => {
    const e = estado();
    e.fonte!.secret_encrypted = "cifra-ruim";
    const r = await aplicarCliqueWhatsapp(adminDe(e) as never, pedido());
    expect(r).toEqual({ ok: false, recusa: "assinatura_indecifravel" });
    expect(e.rpcs).toEqual([]);
  });

  it("a mesma assinatura do webhook de captação libera o clique", async () => {
    const e = estado();
    e.fonte!.secret_encrypted = "cifra-boa";
    const assinatura = createHmac("sha256", "segredo").update(CORPO).digest("hex");
    const r = await aplicarCliqueWhatsapp(adminDe(e) as never, pedido({ assinatura }));
    expect(r).toEqual({ ok: true });
  });

  it("lead de outra fonte não recebe a tag", async () => {
    const e = estado({
      lead: {
        id: LEAD,
        organization_id: ORG,
        webhook_source_id: "outra-fonte",
        created_at: AGORA.toISOString(),
        contact_id: null,
      },
    });
    const r = await aplicarCliqueWhatsapp(adminDe(e) as never, pedido({ requestId: "req-3" }));
    expect(r).toEqual({ ok: false, recusa: "lead_fora_da_fonte" });
    expect(e.rpcs).toEqual([]);
  });

  it("lead com mais de 48 h expira", async () => {
    const e = estado();
    e.lead!.created_at = new Date(AGORA.getTime() - JANELA_DO_CLIQUE_MS - 1000).toISOString();
    const r = await aplicarCliqueWhatsapp(adminDe(e) as never, pedido({ requestId: "req-4" }));
    expect(r).toEqual({ ok: false, recusa: "lead_expirado" });
    expect(e.rpcs).toEqual([]);
  });
});
