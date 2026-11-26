import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { ttlDaAutorizacaoMs } from "@/lib/ai/elegibilidade/gate";

/** Reservados: preserva os tipos do envio, sem converter privacidade em consentimento. */
export function camposDeAutorizacaoDoFormulario(payload: Record<string, unknown>) {
  return {
    ai_service_consent:
      typeof payload.ai_service_consent === "boolean" ? payload.ai_service_consent : null,
    submission_status: payload.submission_status === "completed" ? "completed" : "incomplete",
    ai_service_consent_version:
      typeof payload.ai_service_consent_version === "string" &&
      payload.ai_service_consent_version.length <= 120
        ? payload.ai_service_consent_version
        : "",
  };
}

/**
 * Os campos de autorização entram PRIMEIRO: `limitarCampos` guarda só os 60
 * iniciais, e um formulário grande cortaria o consentimento — ou a recusa,
 * que é o lado aberto da falha (a revogação não aconteceria).
 */
export function camposDaCaptacao(
  camposDoFormulario: Record<string, unknown>,
  payload: Record<string, unknown>,
  autorizaIA: boolean,
): Record<string, unknown> {
  return { ...(autorizaIA ? camposDeAutorizacaoDoFormulario(payload) : {}), ...camposDoFormulario };
}

/**
 * A decisão e a escrita são atômicas no banco; falha deixa a captação para humano.
 * A validade vai do servidor para o banco: a renovação de uma autorização vencida
 * usa a MESMA régua do gate (`AI_ALLOWLIST_TTL_DAYS`).
 */
/**
 * Recusa explícita num envio que REAPROVEITOU o card.
 *
 * `fn_authorize_ai_form_capture` só revoga quando a captação foi `criado`.
 * O reuso grava `atualizado`, então a recusa não passaria pela função e o
 * contato seguiria autorizado. Aqui a recusa zera a autorização e marca
 * atendimento humano — o mesmo efeito do ramo `revoked` da função.
 */
export async function revogarAutorizacaoSeRecusou(
  admin: SupabaseClient,
  input: { organizationId: string; contactId: string; sourceId: string; recusou: boolean },
): Promise<void> {
  if (!input.recusou) return;
  const { data } = await admin
    .from("contacts")
    .select("consent")
    .eq("organization_id", input.organizationId)
    .eq("id", input.contactId)
    .maybeSingle();
  const consent =
    data?.consent && typeof data.consent === "object" && !Array.isArray(data.consent)
      ? (data.consent as Record<string, unknown>)
      : {};
  const automated =
    consent.automated_service && typeof consent.automated_service === "object"
      ? (consent.automated_service as Record<string, unknown>)
      : {};
  const { error } = await admin
    .from("contacts")
    .update({
      ai_authorized_at: null,
      ai_authorized_reason: null,
      force_human: true,
      consent: {
        ...consent,
        automated_service: {
          ...automated,
          declined_at: new Date().toISOString(),
          source: `formulario:${input.sourceId}`,
        },
      },
    })
    .eq("organization_id", input.organizationId)
    .eq("id", input.contactId);
  if (error) {
    logger.warn("[elegibilidade] recusa do formulário não revogou a IA", {
      organization_id: input.organizationId,
      source_id: input.sourceId,
    });
  }
}

export async function autorizarCaptacaoParaIA(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    sourceId: string;
    leadId: string;
    contactId: string;
    requestId: string;
  },
): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc("fn_authorize_ai_form_capture", {
      p_organization_id: input.organizationId,
      p_source_id: input.sourceId,
      p_lead_id: input.leadId,
      p_contact_id: input.contactId,
      p_request_id: input.requestId,
      // `bigint` no banco: dia fracionário daria ms não inteiro, a RPC falharia
      // inteira e a RECUSA deixaria de revogar.
      p_ttl_ms: Math.round(ttlDaAutorizacaoMs(process.env)),
    });
    if (error) throw error;
    return data === true;
  } catch {
    logger.warn("[elegibilidade] autorização por formulário não gravada", {
      organization_id: input.organizationId,
      source_id: input.sourceId,
      request_id: input.requestId,
    });
    return false;
  }
}
