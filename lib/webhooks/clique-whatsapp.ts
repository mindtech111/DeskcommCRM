/**
 * POST /api/v1/webhooks/in/[token]/clique-whatsapp
 *
 * O site avisa que a pessoa clicou para abrir o WhatsApp. O token da URL é a
 * fonte (a mesma da captação). O corpo só traz `lead_id`.
 *
 * Vale quando o lead é DESTA fonte e nasceu há menos de 48 h. A tag
 * `whatsapp:clicou` entra pela função que soma etiqueta (`fn_lead_adicionar_etiquetas`),
 * nunca por reescrita da lista. A segunda chamada, com a tag já lá, responde
 * a mesma coisa e não duplica timeline nem evento.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { logger } from "@/lib/logger";
import { verifyInboundSignature } from "@/lib/webhooks/inbound";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

export const TAG_CLIQUE_WHATSAPP = "whatsapp:clicou";
export const JANELA_DO_CLIQUE_MS = 48 * 60 * 60 * 1000;

export type RecusaDoClique =
  | "fonte_desconhecida"
  | "corpo_invalido"
  | "lead_fora_da_fonte"
  | "lead_expirado"
  | "assinatura_invalida"
  | "assinatura_indecifravel";

export type ResultadoDoClique = { ok: true } | { ok: false; recusa: RecusaDoClique };

interface Fonte {
  id: string;
  organization_id: string;
  is_active: boolean;
  secret_encrypted: string | null;
}

interface LeadDoClique {
  id: string;
  organization_id: string;
  webhook_source_id: string | null;
  created_at: string;
  contact_id: string | null;
}

async function registrarAssinaturaRecusada(
  fonte: { id: string; organization_id: string },
  requestId: string,
  reason: "assinatura_invalida" | "assinatura_indecifravel",
): Promise<void> {
  await audit({
    action: "webhook.inbound_invalid_signature",
    organizationId: fonte.organization_id,
    resourceType: "webhook_source",
    resourceId: fonte.id,
    requestId,
    bypassedRls: true,
    metadata: { reason, origem: "clique_whatsapp" },
  });
}

export function leadDentroDaJanela(criadoEm: string, agora: Date): boolean {
  const nascido = Date.parse(criadoEm);
  if (Number.isNaN(nascido)) return false;
  const idade = agora.getTime() - nascido;
  return idade >= 0 && idade < JANELA_DO_CLIQUE_MS;
}

export async function aplicarCliqueWhatsapp(
  admin: SupabaseClient,
  entrada: {
    token: string;
    leadId: string;
    agora: Date;
    requestId: string;
    /** Corpo cru, o mesmo byte que a assinatura cobre. */
    rawBody: string;
    assinatura: string | null;
  },
): Promise<ResultadoDoClique> {
  if (!entrada.token || entrada.token.length < 8)
    return { ok: false, recusa: "fonte_desconhecida" };

  const { data: fonteBruta, error: erroFonte } = await admin
    .from("webhook_sources")
    .select("id, organization_id, is_active, secret_encrypted")
    .eq("path_token", entrada.token)
    .maybeSingle();
  if (erroFonte) throw new Error(erroFonte.message);
  const fonte = fonteBruta as Fonte | null;
  if (!fonte || !fonte.is_active) return { ok: false, recusa: "fonte_desconhecida" };

  // A mesma regra do POST de captação: fonte COM segredo exige assinatura.
  // Sem segredo, o token do caminho continua sendo a credencial.
  if (fonte.secret_encrypted) {
    const segredo = await decryptWebhookSecret(admin, fonte.secret_encrypted);
    if (!segredo) {
      logger.error("[webhooks.clique] segredo da fonte não decifra — clique recusado", {
        organizationId: fonte.organization_id,
        webhookSourceId: fonte.id,
        requestId: entrada.requestId,
      });
      await registrarAssinaturaRecusada(fonte, entrada.requestId, "assinatura_indecifravel");
      return { ok: false, recusa: "assinatura_indecifravel" };
    }
    if (!verifyInboundSignature(entrada.rawBody, entrada.assinatura, segredo)) {
      await registrarAssinaturaRecusada(fonte, entrada.requestId, "assinatura_invalida");
      return { ok: false, recusa: "assinatura_invalida" };
    }
  }

  const { data: leadBruto, error: erroLead } = await admin
    .from("crm_leads")
    .select("id, organization_id, webhook_source_id, created_at, contact_id")
    .eq("organization_id", fonte.organization_id)
    .eq("id", entrada.leadId)
    .maybeSingle();
  if (erroLead) throw new Error(erroLead.message);
  const lead = leadBruto as LeadDoClique | null;
  if (!lead || lead.webhook_source_id !== fonte.id) {
    return { ok: false, recusa: "lead_fora_da_fonte" };
  }
  if (!leadDentroDaJanela(lead.created_at, entrada.agora)) {
    return { ok: false, recusa: "lead_expirado" };
  }

  const { data, error } = await admin.rpc("fn_lead_adicionar_etiquetas", {
    p_org: fonte.organization_id,
    p_lead: lead.id,
    p_etiquetas: [TAG_CLIQUE_WHATSAPP],
  });
  if (error) throw new Error(error.message);
  if (data === null || data === undefined) return { ok: false, recusa: "lead_fora_da_fonte" };

  const retorno = data as { tags?: unknown; adicionadas?: unknown };
  const adicionadas = Array.isArray(retorno.adicionadas) ? retorno.adicionadas.map(String) : [];
  const tags = Array.isArray(retorno.tags) ? retorno.tags.map(String) : [];
  const chave = `clique:${fonte.id}:${lead.id}`;

  // Tag já estava lá. Se o evento daquela vez não chegou, esta chamada publica
  // de novo. A atividade é a marca de "já publiquei": sem ela, o retry não
  // pode parar no "adicionadas vazio".
  if (adicionadas.length === 0) {
    const { data: marca, error: erroMarca } = await admin
      .from("crm_lead_activities")
      .select("id")
      .eq("organization_id", fonte.organization_id)
      .eq("lead_id", lead.id)
      .eq("type", "whatsapp_link_clicked")
      .eq("source_id", fonte.id)
      .limit(1);
    if (erroMarca) throw new Error(erroMarca.message);
    if (marca && marca.length > 0) return { ok: true };
  }

  const { data: jaPublicado, error: erroBusca } = await admin
    .from("event_log")
    .select("id")
    .eq("organization_id", fonte.organization_id)
    .eq("event_type", "lead.tag_added")
    .contains("metadata", { chave })
    .limit(1);
  if (erroBusca) throw new Error(erroBusca.message);

  if (!jaPublicado || jaPublicado.length === 0) {
    const { error: erroEvento } = await admin.rpc("emit_event", {
      p_event_type: "lead.tag_added",
      p_entity_kind: "crm_lead",
      p_entity_id: lead.id,
      p_payload: {
        added_tags: adicionadas.length ? adicionadas : [TAG_CLIQUE_WHATSAPP],
        tags,
        chave,
      },
      p_metadata: { webhook_source_id: fonte.id, origem: "clique_whatsapp", chave },
      p_organization_id: fonte.organization_id,
    });
    if (erroEvento) throw new Error(erroEvento.message);
  }

  const atividade = await emitLeadActivity(admin, {
    organizationId: fonte.organization_id,
    leadId: lead.id,
    contactId: lead.contact_id,
    type: "whatsapp_link_clicked",
    sourceModule: "webhook_clique_whatsapp",
    sourceId: fonte.id,
    actor: { type: "webhook_source", id: fonte.id },
    reason: "Clicou para falar no WhatsApp",
    payload: { tag: TAG_CLIQUE_WHATSAPP },
  });
  if (!atividade.ok) throw new Error(atividade.error ?? "timeline");

  void audit({
    action: "webhook.whatsapp_click",
    organizationId: fonte.organization_id,
    resourceType: "crm_lead",
    resourceId: lead.id,
    requestId: entrada.requestId,
    bypassedRls: true,
    metadata: { webhook_source_id: fonte.id, tag: TAG_CLIQUE_WHATSAPP },
  });

  return { ok: true };
}
