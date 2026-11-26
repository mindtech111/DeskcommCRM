/**
 * Grava o último toque no contato e no card aberto.
 *
 * O `source` da linha NÃO entra no UPDATE: primeiro toque fica onde está.
 * Falha vira log. A mensagem do cliente já está gravada quando isto roda.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import {
  etiquetasDoToque,
  fundirEtiquetas,
  fundirToque,
  type ToqueDeCampanha,
} from "@/lib/leads/toque-de-campanha";
import { logger } from "@/lib/logger";

export interface AlvoDoToque {
  organizationId: string;
  contactId: string;
  toque: ToqueDeCampanha;
  utm: Record<string, string>;
}

async function gravar(
  admin: SupabaseClient,
  tabela: "contacts" | "crm_leads",
  organizationId: string,
  id: string,
  metadata: Record<string, unknown>,
  tags: string[],
): Promise<boolean> {
  const { error } = await admin
    .from(tabela)
    .update({ source_metadata: metadata, tags })
    .eq("organization_id", organizationId)
    .eq("id", id);
  if (error) {
    logger.error("[toque-de-campanha] não gravou o último toque", {
      tabela,
      organizationId,
      detalhe: error.message.slice(0, 160),
    });
    return false;
  }
  return true;
}

/** O contato. Não cria card e não mexe em `source`. */
export async function gravarToqueNoContato(
  admin: SupabaseClient,
  alvo: AlvoDoToque,
): Promise<boolean> {
  const { data, error } = await admin
    .from("contacts")
    .select("source_metadata, tags")
    .eq("organization_id", alvo.organizationId)
    .eq("id", alvo.contactId)
    .maybeSingle();
  if (error || !data) {
    logger.warn("[toque-de-campanha] contato não lido; o toque fica para a próxima mensagem", {
      organizationId: alvo.organizationId,
      detalhe: error?.message?.slice(0, 160) ?? "sem linha",
    });
    return false;
  }
  const linha = data as { source_metadata: unknown; tags: unknown };
  const fundido = fundirToque(linha.source_metadata, alvo.toque);
  const tags = fundirEtiquetas(linha.tags, etiquetasDoToque(alvo.utm));
  const tagsMudaram = tags.length !== (Array.isArray(linha.tags) ? linha.tags.length : 0);
  if (!fundido.mudou && !tagsMudaram) return false;
  return gravar(admin, "contacts", alvo.organizationId, alvo.contactId, fundido.metadata, tags);
}

/**
 * O card ABERTO do contato, se houver. Card ganho ou perdido não é reaberto
 * aqui — quem cria o próximo é o nascimento do lead, no funil já configurado.
 */
export async function gravarToqueNoLeadAberto(
  admin: SupabaseClient,
  alvo: AlvoDoToque,
): Promise<boolean> {
  const { data, error } = await admin
    .from("crm_leads")
    .select("id, source_metadata, tags")
    .eq("organization_id", alvo.organizationId)
    .eq("contact_id", alvo.contactId)
    .eq("status", "open")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return false;
  const linha = data as { id: string; source_metadata: unknown; tags: unknown };
  const fundido = fundirToque(linha.source_metadata, alvo.toque);
  const tags = fundirEtiquetas(linha.tags, etiquetasDoToque(alvo.utm));
  const tagsMudaram = tags.length !== (Array.isArray(linha.tags) ? linha.tags.length : 0);
  if (!fundido.mudou && !tagsMudaram) return false;
  const gravou = await gravar(
    admin,
    "crm_leads",
    alvo.organizationId,
    linha.id,
    fundido.metadata,
    tags,
  );
  if (!gravou) return false;
  await emitLeadActivity(admin, {
    organizationId: alvo.organizationId,
    leadId: linha.id,
    contactId: alvo.contactId,
    type: "note",
    sourceModule: "rastreio",
    sourceId: alvo.toque.tracking_link_id,
    actor: { type: "webhook_source", id: "rastreio" },
    reason: "Toque de campanha registrado no card aberto.",
    payload: {
      ref: alvo.toque.ref,
      tracking_link_id: alvo.toque.tracking_link_id,
      utm_source: alvo.toque.utm_source ?? null,
      utm_medium: alvo.toque.utm_medium ?? null,
      utm_campaign: alvo.toque.utm_campaign ?? null,
    },
  });
  return true;
}
