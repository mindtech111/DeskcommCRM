import { describe, expect, it, vi } from "vitest";

import { getAction } from "@/lib/automation/actions";
import {
  enviarAvisoInterno,
  type DepsDoAvisoInterno,
} from "@/lib/automation/actions/send-internal-whatsapp";
import type { ActionCtx } from "@/lib/automation/types";
import type { CanalDoAviso } from "@/lib/escalacao/aviso-ao-suporte";

import "@/lib/automation/actions/send-internal-whatsapp";

const CANAL: CanalDoAviso = {
  id: "sess-8827",
  status: "WORKING",
  archived_at: null,
  aceitaMensagemLivre: true,
  desativado: false,
};

const CONFIG = {
  channel_session_id: "11111111-1111-4111-8111-111111111111",
  telefone_destino: "+55 11 92619-8917",
  template: "{{primeiro_nome}} · {{origem}}\n{{assunto}}\n{{link}}",
};

function ctx(extra?: Partial<ActionCtx["context"]>): ActionCtx {
  return {
    admin: {} as ActionCtx["admin"],
    organizationId: "org-1",
    ruleId: "rule-1",
    ruleName: "Aviso",
    requestId: "evt-1",
    event: {
      id: "evt-1",
      organization_id: "org-1",
      event_type: "lead.created",
      entity_kind: "crm_lead",
      entity_id: "lead-1",
      payload: {},
      metadata: {},
      consumed_by: [],
      attempts: 0,
    },
    context: {
      lead: {
        id: "lead-1",
        title: "Ana Paula",
        tags: ["origem:site"],
        webhook_source_id: "fonte-1",
        custom_fields: { queixa: "dor no joelho", score: "82 — longevidade alta" },
      },
      contact: { name: "Ana Paula", phone_number: "+5511988887777" },
      ...extra,
    },
  };
}

function deps(sobre: Partial<DepsDoAvisoInterno> = {}): DepsDoAvisoInterno & {
  enviados: string[];
  audits: string[];
  fila: unknown[];
} {
  const enviados: string[] = [];
  const audits: string[] = [];
  const fila: unknown[] = [];
  return {
    enviados,
    audits,
    fila,
    enfileirar: async (entrada) => {
      fila.push(entrada);
    },
    carregaCanal: async () => CANAL,
    nomeDaFonte: async () => "Site · contato",
    transporte: {
      configurado: async () => true,
      resolveDestino: async (_org, _canal, telefone) => `jid:${telefone}`,
      envia: async (_org, _canal, _to, body) => {
        enviados.push(body);
        return { externalId: "wamid" };
      },
    },
    pacing: {
      decide: async () => ({ liberado: true }),
      registraEnvio: async () => undefined,
    },
    urlPublica: "https://crm.exemplo.com",
    clock: () => new Date("2026-11-23T15:00:00.000Z"),
    audita: (entrada) => {
      audits.push(entrada.action);
    },
    ...sobre,
  };
}

describe("send_internal_whatsapp", () => {
  it("está registrada no motor e não adia o evento da regra", () => {
    const acao = getAction("send_internal_whatsapp");
    expect(acao).toBeDefined();
    expect(acao?.postponeUntil).toBeUndefined();
  });

  it("manda o recado curto e não o formulário", async () => {
    const d = deps();
    const r = await enviarAvisoInterno(d, ctx(), CONFIG);
    expect(r.status).toBe("success");
    expect(d.enviados).toEqual([
      "Ana · Site · contato\nAna Paula\nhttps://crm.exemplo.com/app/leads/lead-1",
    ]);
    expect(d.enviados[0]).not.toContain("joelho");
    expect(d.enviados[0]).not.toContain("longevidade alta");
    expect(d.enviados[0]).not.toContain("88887777");
    expect(d.audits).toEqual(["automation.internal_whatsapp_sent"]);
  });

  it("recusa o modelo que pede a resposta do score e não chama o transporte", async () => {
    const d = deps();
    const r = await enviarAvisoInterno(d, ctx(), {
      ...CONFIG,
      template: "Score: {{lead.custom_fields.score}}",
    });
    expect(r).toMatchObject({ status: "skipped", detail: { reason: "variavel_nao_permitida" } });
    expect(d.enviados).toEqual([]);
  });

  it("teto que só volta depois do prazo é descartado, com registro, e não prende a regra", async () => {
    const liberaEm = new Date("2026-11-24T03:00:00.000Z");
    const d = deps({
      pacing: {
        decide: async () => ({ liberado: false, motivo: "teto_diario", liberaEm }),
        registraEnvio: async () => undefined,
      },
    });
    const executado = await enviarAvisoInterno(d, ctx(), CONFIG);
    expect(executado.status).toBe("skipped");
    expect(executado.detail).toMatchObject({ reason: "teto_diario", desistiu: true });
    expect(d.enviados).toEqual([]);
    expect(d.fila).toEqual([]);
    expect(d.audits).toEqual(["automation.internal_whatsapp_failed"]);
  });

  it("espaçamento curto vai para a fila própria e a ação não fica adiada no motor", async () => {
    const liberaEm = new Date("2026-11-23T15:00:02.000Z");
    const d = deps({
      pacing: {
        decide: async () => ({ liberado: false, motivo: "espacamento", liberaEm }),
        registraEnvio: async () => undefined,
      },
    });
    const executado = await enviarAvisoInterno(d, ctx(), CONFIG);
    expect(executado.status).toBe("postponed");
    expect(executado.detail).toMatchObject({ reason: "agendado", motivo: "espacamento" });
    expect(d.fila).toHaveLength(1);
    expect(d.enviados).toEqual([]);
    expect(d.audits).toEqual(["automation.internal_whatsapp_queued"]);
  });

  it("sessão fora de WORKING enfileira e não chama o transporte", async () => {
    const d = deps({ carregaCanal: async () => ({ ...CANAL, status: "SCAN_QR_CODE" }) });
    const executado = await enviarAvisoInterno(d, ctx(), CONFIG);
    expect(executado.status).toBe("postponed");
    expect(executado.detail).toMatchObject({ reason: "agendado", motivo: "canal_desconectado" });
    expect(d.enviados).toEqual([]);
    expect(d.fila).toHaveLength(1);
  });

  it("canal que não manda texto livre nem entra na fila", async () => {
    const d = deps({ carregaCanal: async () => ({ ...CANAL, aceitaMensagemLivre: false }) });
    const executado = await enviarAvisoInterno(d, ctx(), CONFIG);
    expect(executado).toMatchObject({ status: "skipped", detail: { reason: "canal_nao_aceita_aviso_livre" } });
    expect(d.fila).toEqual([]);
    expect(d.enviados).toEqual([]);
  });
});
