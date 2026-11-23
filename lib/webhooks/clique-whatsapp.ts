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

export const TAG_CLIQUE_WHATSAPP = "whatsapp:clicou";
export const JANELA_DO_CLIQUE_MS = 48 * 60 * 60 * 1000;

export type RecusaDoClique =
  "fonte_desconhecida" | "corpo_invalido" | "lead_fora_da_fonte" | "lead_expirado";

export type ResultadoDoClique = { ok: true } | { ok: false; recusa: RecusaDoClique };

interface Fonte {
  id: string;
  organization_id: string;
  is_active: boolean;
}

interface LeadDoClique {
  id: string;
  organization_id: string;
  webhook_source_id: string | null;
  created_at: string;
  contact_id: string | null;
}

export function leadDentroDaJanela(criadoEm: string, agora: Date): boolean {
  const nascido = Date.parse(criadoEm);
  if (Number.isNaN(nascido)) return false;
  const idade = agora.getTime() - nascido;
  return idade >= 0 && idade < JANELA_DO_CLIQUE_MS;
}

export async function aplicarCliqueWhatsapp(
  admin: SupabaseClient,
  entrada: { token: string; leadId: string; agora: Date; requestId: string },
): Promise<ResultadoDoClique> {
  if (!entrada.token || entrada.token.length < 8)
    return { ok: false, recusa: "fonte_desconhecida" };

  const { data: fonteBruta, error: erroFonte } = await admin
    .from("webhook_sources")
    .select("id, organization_id, is_active")
    .eq("path_token", entrada.token)
    .maybeSingle();
  if (erroFonte) throw new Error(erroFonte.message);
  const fonte = fonteBruta as Fonte | null;
  if (!fonte || !fonte.is_active) return { ok: false, recusa: "fonte_desconhecida" };

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
  if (adicionadas.length === 0) return { ok: true };

  const { error: erroEvento } = await admin.rpc("emit_event", {
    p_event_type: "lead.tag_added",
    p_entity_kind: "crm_lead",
    p_entity_id: lead.id,
    p_payload: { added_tags: adicionadas, tags },
    p_metadata: { webhook_source_id: fonte.id, origem: "clique_whatsapp" },
    p_organization_id: fonte.organization_id,
  });
  if (erroEvento) {
    logger.error("[webhooks.clique] a tag entrou e o evento não", {
      organizationId: fonte.organization_id,
      leadId: lead.id,
      error: erroEvento.message,
    });
  }

  await emitLeadActivity(admin, {
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
