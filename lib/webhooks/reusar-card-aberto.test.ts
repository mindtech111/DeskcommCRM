import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/leads/activity-emitter", () => ({
  emitLeadActivity: vi.fn(async () => ({ ok: true })),
}));

import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import {
  etiquetasDoEnvio,
  fundirUtm,
  jaReaproveitou,
  origemDaCaptacao,
  reusarCardAberto,
  type CardAberto,
} from "@/lib/webhooks/reusar-card-aberto";

const CARD: CardAberto = {
  id: "lead-1",
  source: "whatsapp",
  externalId: null,
  sourceMetadata: { utm_source: "organico" },
  tags: ["vip"],
  contactId: "contato-1",
};

const estado = {
  anonimizado: false,
  updates: [] as Array<{ tabela: string; payload: Record<string, unknown> }>,
  eventos: [] as string[],
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
        update(payload: Record<string, unknown>) {
          estado.updates.push({ tabela, payload });
          return cadeia;
        },
        async maybeSingle() {
          if (tabela === "contacts") {
            return {
              data: {
                is_anonymized: estado.anonimizado,
                tags: ["vip"],
                source_metadata: { utm_source: "organico" },
              },
              error: null,
            };
          }
          return { data: null, error: null };
        },
        then(resolve: (v: unknown) => unknown) {
          return Promise.resolve({ error: null }).then(resolve);
        },
      };
      return cadeia;
    },
    async rpc(nome: string, args: { p_event_type?: string }) {
      estado.eventos.push(args.p_event_type ?? nome);
      return { error: null };
    },
  };
}

const envio = {
  organizationId: "org-1",
  webhookSourceId: "fonte-1",
  contactId: "contato-1",
  externalId: "ext-1",
  utm: { utm_source: "revi", utm_medium: "whatsapp", utm_campaign: "revi_vb" },
  tags: ["lista"],
  campos: ["nome", "telefone", "utm_campaign"],
  captureSource: "revi",
  requestId: "req-1",
};

beforeEach(() => {
  estado.anonimizado = false;
  estado.updates = [];
  estado.eventos = [];
  vi.mocked(emitLeadActivity).mockClear();
});

describe("reuso do card aberto", () => {
  it("origem vazia continua webhook; revi é origem válida", () => {
    expect(origemDaCaptacao({})).toBe("webhook");
    expect(origemDaCaptacao({ capture_source: "revi" })).toBe("revi");
    expect(origemDaCaptacao({ capture_source: "Revi!" })).toBe("webhook");
  });

  it("funde utm sem apagar a origem antiga e marca o external_id", () => {
    const fundido = fundirUtm({ utm_source: "organico", cliente: "ana" }, envio.utm);
    expect(fundido.utm_source).toBe("revi");
    expect(fundido.cliente).toBe("ana");
    expect(fundido.utm_campaign).toBe("revi_vb");
  });

  it("não abre outro card: junta tag, anota e emite lead.updated", async () => {
    const resultado = await reusarCardAberto(admin() as never, CARD, envio);
    expect(resultado).toEqual({ reusado: true, leadId: "lead-1", repetido: false });
    const lead = estado.updates.find((item) => item.tabela === "crm_leads");
    expect(lead?.payload.tags).toEqual(["vip", "lista", "revi_vb", "revi/vb"]);
    expect(lead?.payload).not.toHaveProperty("source");
    expect(lead?.payload).not.toHaveProperty("external_id");
    const meta = lead?.payload.source_metadata as { external_ids_reaproveitados: string[] };
    expect(meta.external_ids_reaproveitados).toEqual(["fonte-1:ext-1"]);
    expect(jaReaproveitou(meta, "fonte-1", "ext-1")).toBe(true);
    expect(jaReaproveitou(meta, "outra-fonte", "ext-1")).toBe(false);
    expect(emitLeadActivity).toHaveBeenCalledOnce();
    expect(estado.eventos).toEqual(["lead.updated"]);
  });

  it("o mesmo external_id não anota de novo", async () => {
    const repetido = await reusarCardAberto(
      admin() as never,
      { ...CARD, sourceMetadata: { external_ids_reaproveitados: ["fonte-1:ext-1"] } },
      envio,
    );
    expect(repetido).toEqual({ reusado: true, leadId: "lead-1", repetido: true });
    expect(estado.updates).toEqual([]);
    expect(emitLeadActivity).not.toHaveBeenCalled();
  });

  it("contato anonimizado não recebe o envio de volta", async () => {
    estado.anonimizado = true;
    const resultado = await reusarCardAberto(admin() as never, CARD, envio);
    expect(resultado).toMatchObject({ reusado: true, repetido: true });
    expect(estado.updates).toEqual([]);
  });

  it("campanha e etiquetas do corpo entram juntas; sem utm não inventa rastreio", () => {
    expect(etiquetasDoEnvio(envio.utm, { tags: "vip, inverno" })).toEqual([
      "vip",
      "inverno",
      "revi_vb",
      "revi/vb",
    ]);
    expect(etiquetasDoEnvio({}, { etiquetas: "retorno" })).toEqual(["retorno"]);
  });
});
