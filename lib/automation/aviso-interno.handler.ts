/**
 * Consome `automation.internal_whatsapp` — a fila própria do aviso.
 *
 * Devolve `retry` enquanto ainda cabe no prazo e no teto de tentativas. O
 * evento da regra que pediu o aviso já terminou; isto não segura etiqueta,
 * tarefa nem outra regra.
 */
import type { EventHandler, HandlerResult } from "@/lib/event-log/dispatcher";
import { enviarAvisoInterno, type DepsDoAvisoInterno } from "@/lib/automation/actions/send-internal-whatsapp";
import { deveDesistir, lerFilaDoAviso } from "@/lib/automation/aviso-interno-fila";
import type { ActionCtx } from "@/lib/automation/types";
import { createAdminClient } from "@/lib/supabase/admin";

export const AVISO_INTERNO_HANDLER_KEY = "automation-aviso-interno.v1";

const ESPERA_PADRAO_MS = 5 * 60 * 1000;

const PERMANENTE = new Set([
  "aviso_remetente_arquivado",
  "canal_desativado",
  "canal_nao_aceita_aviso_livre",
  "variavel_nao_permitida",
  "missing_config",
  "destino_invalido",
  "no_target",
  "sem_endereco_publico",
]);

export async function tratarFilaDoAviso(
  deps: DepsDoAvisoInterno,
  row: ActionCtx["event"],
  contexto: Record<string, unknown>,
  gravarTentativa: (proxima: number) => Promise<void>,
): Promise<HandlerResult> {
  const fila = lerFilaDoAviso(row.payload);
  if (!fila) {
    return { consumer_key: AVISO_INTERNO_HANDLER_KEY, status: "skipped", detail: "payload_incompleto" };
  }
  const agora = deps.clock();
  const desistir = (codigo: string, tentativas: number) => {
    deps.audita({
      action: "automation.internal_whatsapp_failed",
      organizationId: row.organization_id,
      ruleId: fila.rule_id,
      leadId: fila.lead_id,
      metadata: { codigo, tentativas, canal: fila.channel_session_id },
    });
    return { consumer_key: AVISO_INTERNO_HANDLER_KEY, status: "skipped" as const, detail: codigo };
  };
  if (deveDesistir({ agora, prazoEm: fila.prazo_em, tentativas: fila.tentativas })) {
    return desistir("prazo", fila.tentativas);
  }

  const ctx: ActionCtx = {
    admin: {} as ActionCtx["admin"],
    organizationId: row.organization_id,
    ruleId: fila.rule_id,
    ruleName: "Aviso interno",
    requestId: row.id,
    event: row,
    context: contexto,
  };
  const resultado = await enviarAvisoInterno(
    deps,
    ctx,
    {
      channel_session_id: fila.channel_session_id,
      telefone_destino: fila.telefone_destino,
      template: fila.template,
    },
    { naFila: true },
  );

  if (resultado.status === "success") {
    return { consumer_key: AVISO_INTERNO_HANDLER_KEY, status: "ok", detail: "enviado" };
  }
  const motivo = typeof resultado.detail?.reason === "string" ? resultado.detail.reason : (resultado.error ?? "falha");
  if (PERMANENTE.has(motivo) || resultado.status === "failed") {
    return desistir(motivo, fila.tentativas);
  }
  const proxima = fila.tentativas + 1;
  const retryAt =
    typeof resultado.detail?.retry_at === "string"
      ? resultado.detail.retry_at
      : new Date(agora.getTime() + ESPERA_PADRAO_MS).toISOString();
  if (
    deveDesistir({ agora, prazoEm: fila.prazo_em, tentativas: proxima }) ||
    Date.parse(retryAt) > Date.parse(fila.prazo_em)
  ) {
    return desistir(motivo, proxima);
  }
  await gravarTentativa(proxima);
  return { consumer_key: AVISO_INTERNO_HANDLER_KEY, status: "retry", retry_at: retryAt, detail: motivo };
}

async function depsDeProducao(admin: ReturnType<typeof createAdminClient>): Promise<DepsDoAvisoInterno> {
  const { audit } = await import("@/lib/audit");
  const { env } = await import("@/lib/env");
  const { createSupabaseAvisoDb } = await import("@/lib/escalacao/aviso-ao-suporte");
  const { criarTransporteDoAviso } = await import("@/lib/escalacao/aviso-ao-suporte.handler");
  const { criarPacingDoCanal } = await import("@/lib/agent-engine/pacing/ledger-supabase");
  const db = createSupabaseAvisoDb(admin);
  return {
    carregaCanal: (orgId, channelSessionId) => db.carregaCanal(orgId, channelSessionId),
    async nomeDaFonte(orgId, fonteId) {
      const { data } = await admin
        .from("webhook_sources")
        .select("name")
        .eq("organization_id", orgId)
        .eq("id", fonteId)
        .maybeSingle();
      const nome = (data as { name?: string } | null)?.name;
      return typeof nome === "string" && nome.trim() ? nome.trim() : null;
    },
    transporte: await criarTransporteDoAviso(admin),
    pacing: await criarPacingDoCanal(admin),
    urlPublica: env.NEXT_PUBLIC_APP_URL,
    clock: () => new Date(),
    audita: (entrada) => {
      void audit({
        action: entrada.action,
        organizationId: entrada.organizationId,
        resourceType: "automation_rule",
        resourceId: entrada.ruleId,
        bypassedRls: true,
        metadata: { ...entrada.metadata, lead_id: entrada.leadId },
      });
    },
    async enfileirar() {
      /* o evento que está rodando já é a fila */
    },
  };
}

export const avisoInternoHandler: EventHandler = {
  key: AVISO_INTERNO_HANDLER_KEY,
  naOrgParada: "pula",
  events: ["automation.internal_whatsapp"],
  async handle(row): Promise<HandlerResult> {
    const admin = createAdminClient();
    const leadId = typeof row.payload.lead_id === "string" ? row.payload.lead_id : "";
    const { data: lead } = await admin
      .from("crm_leads")
      .select("id, title, tags, webhook_source_id, contact_id")
      .eq("organization_id", row.organization_id)
      .eq("id", leadId)
      .maybeSingle();
    const contactId = (lead as { contact_id?: string | null } | null)?.contact_id;
    let contact: Record<string, unknown> | null = null;
    if (contactId) {
      const lido = await admin
        .from("contacts")
        .select("id, name, display_name")
        .eq("organization_id", row.organization_id)
        .eq("id", contactId)
        .maybeSingle();
      contact = (lido.data as Record<string, unknown> | null) ?? null;
    }
    return tratarFilaDoAviso(
      await depsDeProducao(admin),
      row,
      { lead: lead ?? { id: leadId }, contact },
      async (proxima) => {
        const { error } = await admin
          .from("event_log")
          .update({ payload: { ...row.payload, tentativas: proxima } })
          .eq("id", row.id)
          .eq("organization_id", row.organization_id);
        if (error) throw new Error(error.message);
      },
    );
  },
};
