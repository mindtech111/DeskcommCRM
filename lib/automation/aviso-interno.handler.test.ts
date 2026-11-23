import { describe, expect, it, vi } from "vitest";

import { tratarFilaDoAviso } from "@/lib/automation/aviso-interno.handler";
import { prazoDoAviso, deveDesistir, MAX_TENTATIVAS_DO_AVISO } from "@/lib/automation/aviso-interno-fila";
import type { DepsDoAvisoInterno } from "@/lib/automation/actions/send-internal-whatsapp";
import type { CanalDoAviso } from "@/lib/escalacao/aviso-ao-suporte";
import type { EventRow } from "@/lib/event-log/dispatcher";

const AGORA = new Date("2026-11-23T15:00:00.000Z");
const CANAL: CanalDoAviso = {
  id: "sess",
  status: "SCAN_QR_CODE",
  archived_at: null,
  aceitaMensagemLivre: true,
  desativado: false,
};

function fila(sobre: Record<string, unknown> = {}): EventRow {
  return {
    id: "ev-fila",
    organization_id: "org-1",
    event_type: "automation.internal_whatsapp",
    entity_kind: "crm_lead",
    entity_id: "22222222-2222-4222-8222-222222222222",
    payload: {
      chave: "r:e:0",
      rule_id: "rule-1",
      lead_id: "22222222-2222-4222-8222-222222222222",
      channel_session_id: "11111111-1111-4111-8111-111111111111",
      telefone_destino: "+5511926198917",
      template: "Oi {{primeiro_nome}}",
      prazo_em: prazoDoAviso(AGORA),
      tentativas: 0,
      ...sobre,
    },
    metadata: {},
    consumed_by: [],
    attempts: 0,
    created_at: AGORA.toISOString(),
  };
}

function deps(canal: CanalDoAviso = CANAL): DepsDoAvisoInterno & { audits: string[] } {
  const audits: string[] = [];
  return {
    audits,
    carregaCanal: async () => canal,
    nomeDaFonte: async () => "Site · contato",
    transporte: {
      configurado: async () => true,
      resolveDestino: async () => "jid",
      envia: async () => ({ externalId: "1" }),
    },
    pacing: { decide: async () => ({ liberado: true }), registraEnvio: async () => undefined },
    urlPublica: "https://crm.exemplo.com",
    clock: () => AGORA,
    audita: (e) => audits.push(e.action),
    enfileirar: async () => undefined,
  };
}

describe("fila própria do aviso", () => {
  it("sessão fora do ar pede retry e soma a tentativa dela, sem usar attempts do dreno", async () => {
    const gravadas: number[] = [];
    const r = await tratarFilaDoAviso(deps(), fila(), { lead: { id: "x", title: "Ana" } }, async (n) => {
      gravadas.push(n);
    });
    expect(r.status).toBe("retry");
    expect(gravadas).toEqual([1]);
    expect(r.retry_at).toBeTruthy();
  });

  it("passado o prazo, desiste e registra", async () => {
    const d = deps();
    const r = await tratarFilaDoAviso(
      d,
      fila({ prazo_em: new Date(AGORA.getTime() - 1000).toISOString(), tentativas: 1 }),
      { lead: { id: "x" } },
      async () => undefined,
    );
    expect(r).toMatchObject({ status: "skipped", detail: "prazo" });
    expect(d.audits).toEqual(["automation.internal_whatsapp_failed"]);
  });

  it("o teto de tentativas também encerra", () => {
    expect(
      deveDesistir({
        agora: AGORA,
        prazoEm: prazoDoAviso(AGORA),
        tentativas: MAX_TENTATIVAS_DO_AVISO,
      }),
    ).toBe(true);
  });

  it("falha de envio na fila pede outra tentativa, sem encerrar", async () => {
    const d = deps({ ...CANAL, status: "WORKING" });
    d.transporte.envia = async () => {
      throw new Error("rede");
    };
    const gravadas: number[] = [];
    const r = await tratarFilaDoAviso(d, fila(), { lead: { id: "x", title: "Ana" } }, async (n) => {
      gravadas.push(n);
    });
    expect(r.status).toBe("retry");
    expect(gravadas).toEqual([1]);
    expect(d.audits).toEqual([]);
  });

  it("slot que só volta depois do prazo é descartado na fila, com registro", async () => {
    const d = deps({ ...CANAL, status: "WORKING" });
    d.pacing.decide = async () => ({
      liberado: false,
      motivo: "teto_diario",
      liberaEm: new Date(AGORA.getTime() + 24 * 60 * 60 * 1000),
    });
    const r = await tratarFilaDoAviso(d, fila(), { lead: { id: "x", title: "Ana" } }, vi.fn());
    expect(r).toMatchObject({ status: "skipped", detail: "teto_diario" });
    expect(d.audits).toEqual(["automation.internal_whatsapp_failed"]);
  });

  it("canal que não manda texto livre encerra sem retry", async () => {
    const d = deps({ ...CANAL, status: "WORKING", aceitaMensagemLivre: false });
    const r = await tratarFilaDoAviso(d, fila(), { lead: { id: "x", title: "Ana" } }, vi.fn());
    expect(r).toMatchObject({ status: "skipped", detail: "canal_nao_aceita_aviso_livre" });
    expect(d.audits).toEqual(["automation.internal_whatsapp_failed"]);
  });
});
