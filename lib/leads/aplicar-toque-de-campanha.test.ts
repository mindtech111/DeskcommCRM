import { beforeEach, describe, expect, it, vi } from "vitest";

import { montarToque } from "@/lib/leads/toque-de-campanha";

vi.mock("@/lib/leads/activity-emitter", () => ({
  emitLeadActivity: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import {
  gravarToqueNoContato,
  gravarToqueNoLeadAberto,
} from "@/lib/leads/aplicar-toque-de-campanha";

const TOQUE = montarToque({
  utm: { utm_source: "revi", utm_medium: "whatsapp", utm_campaign: "revi_vb" },
  trackingLinkId: "link-1",
  ref: "K7M2P9",
  at: "2026-11-26T12:00:00.000Z",
});

const estado = {
  contato: {
    source: "whatsapp",
    source_metadata: { utm_source: "organico", ad_platform: "site" },
    tags: ["vip"],
  } as Record<string, unknown> | null,
  lead: {
    id: "lead-1",
    source: "whatsapp",
    source_metadata: { utm_source: "organico" },
    tags: ["vip"],
  } as Record<string, unknown> | null,
  updates: [] as Array<{ tabela: string; payload: Record<string, unknown> }>,
};

function admin() {
  return {
    from(tabela: string) {
      const cadeia = {
        select() {
          return cadeia;
        },
        eq() {
          return cadeia;
        },
        order() {
          return cadeia;
        },
        limit() {
          return cadeia;
        },
        update(payload: Record<string, unknown>) {
          estado.updates.push({ tabela, payload });
          return cadeia;
        },
        async maybeSingle() {
          if (tabela === "contacts") return { data: estado.contato, error: null };
          if (tabela === "crm_leads") return { data: estado.lead, error: null };
          return { data: null, error: null };
        },
        then(resolve: (v: unknown) => unknown) {
          return Promise.resolve({ error: null }).then(resolve);
        },
      };
      return cadeia;
    },
  };
}

const alvo = {
  organizationId: "org-1",
  contactId: "contato-1",
  toque: TOQUE,
  utm: { utm_source: "revi", utm_medium: "whatsapp", utm_campaign: "revi_vb" },
};

beforeEach(() => {
  estado.contato = {
    source: "whatsapp",
    source_metadata: { utm_source: "organico", ad_platform: "site" },
    tags: ["vip"],
  };
  estado.lead = {
    id: "lead-1",
    source: "whatsapp",
    source_metadata: { utm_source: "organico" },
    tags: ["vip"],
  };
  estado.updates = [];
  vi.mocked(emitLeadActivity).mockClear();
});

describe("gravar o toque sem mexer na origem", () => {
  it("o contato ganha last_touch e etiquetas, e o source não vai no UPDATE", async () => {
    await gravarToqueNoContato(admin() as never, alvo);
    const gravado = estado.updates.find((item) => item.tabela === "contacts");
    expect(gravado?.payload).not.toHaveProperty("source");
    expect(gravado?.payload.tags).toEqual(["vip", "revi_vb", "revi/vb"]);
    const meta = gravado?.payload.source_metadata as {
      utm_source: string;
      last_touch: { ref: string };
    };
    expect(meta.utm_source).toBe("organico");
    expect(meta.last_touch.ref).toBe("K7M2P9");
  });

  it("o card aberto recebe o toque e uma nota; sem card, não inventa outro", async () => {
    await gravarToqueNoLeadAberto(admin() as never, alvo);
    expect(estado.updates.some((item) => item.tabela === "crm_leads")).toBe(true);
    expect(vi.mocked(emitLeadActivity)).toHaveBeenCalledOnce();
    expect(estado.updates.find((item) => item.tabela === "crm_leads")?.payload).not.toHaveProperty(
      "source",
    );

    estado.updates = [];
    estado.lead = null;
    vi.mocked(emitLeadActivity).mockClear();
    await gravarToqueNoLeadAberto(admin() as never, alvo);
    expect(estado.updates).toEqual([]);
    expect(vi.mocked(emitLeadActivity)).not.toHaveBeenCalled();
  });

  it("o mesmo ref não grava de novo", async () => {
    estado.contato = {
      source_metadata: { touches: [TOQUE], last_touch: TOQUE },
      tags: ["vip", "revi_vb", "revi/vb"],
    };
    const gravou = await gravarToqueNoContato(admin() as never, alvo);
    expect(gravou).toBe(false);
    expect(estado.updates).toEqual([]);
  });
});
