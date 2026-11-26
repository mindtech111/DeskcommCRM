/**
 * Reaproveitar o card aberto do contato, em vez de abrir outro.
 *
 * A captação já reencontrava a pessoa pelo telefone ou e-mail e, mesmo assim,
 * criava um segundo card. Esta opção da fonte — ligada nas fontes novas,
 * desligada nas que já existiam — funde etiquetas e UTMs no card que já está
 * aberto, anota a timeline e não cria demanda paralela.
 *
 * Não reescreve `source` do card: a origem do nascimento fica. O `external_id`
 * repetido continua sendo o caminho de idempotência de antes; aqui só entra
 * o envio que NÃO achou card por esse id.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { etiquetasDoToque, fundirEtiquetas, limparEtiqueta } from "@/lib/leads/toque-de-campanha";
import { logger } from "@/lib/logger";

const CHAVE_DOS_IDS = "external_ids_reaproveitados";
const TETO_DE_IDS = 50;

export function origemDaCaptacao(fonte: { capture_source?: string | null }): string {
  const bruto = fonte.capture_source?.trim() ?? "";
  if (/^[a-z][a-z0-9_]{0,31}$/.test(bruto)) return bruto;
  return "webhook";
}

/** Etiquetas do corpo mais as da campanha, quando o envio trouxe UTM. */
export function etiquetasDoEnvio(
  utm: Record<string, string>,
  payload: Record<string, unknown>,
): string[] {
  const temUtm = Object.keys(utm).some(
    (chave) => chave.startsWith("utm_") || chave === "gclid" || chave === "fbclid",
  );
  const daCampanha = temUtm ? etiquetasDoToque(utm) : [];
  return [...new Set([...etiquetasDoPayload(payload), ...daCampanha])];
}

export function etiquetasDoPayload(payload: Record<string, unknown>): string[] {
  const bruto = payload.tags ?? payload.etiquetas ?? payload.tag;
  const pedacos = Array.isArray(bruto)
    ? bruto
    : typeof bruto === "string"
      ? bruto.split(/[,;]/)
      : [];
  const tags: string[] = [];
  for (const pedaco of pedacos) {
    if (typeof pedaco !== "string") continue;
    const limpo = limparEtiqueta(pedaco);
    if (limpo && !tags.includes(limpo)) tags.push(limpo);
  }
  return tags;
}

function comoMapa(valor: unknown): Record<string, unknown> {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return {};
  return { ...(valor as Record<string, unknown>) };
}

/** UTMs novas entram; o resto do mapa fica. Chave ausente no envio não apaga a antiga. */
export function fundirUtm(metadata: unknown, utm: Record<string, string>): Record<string, unknown> {
  const proximo = comoMapa(metadata);
  for (const [chave, valor] of Object.entries(utm)) {
    if (chave.startsWith("utm_") || chave === "gclid" || chave === "fbclid") proximo[chave] = valor;
  }
  return proximo;
}

export function jaReaproveitou(metadata: unknown, externalId: string | null): boolean {
  if (!externalId) return false;
  const ids = comoMapa(metadata)[CHAVE_DOS_IDS];
  return Array.isArray(ids) && ids.includes(externalId);
}

export function marcarReaproveitado(
  metadata: Record<string, unknown>,
  externalId: string | null,
): Record<string, unknown> {
  if (!externalId) return metadata;
  const atuais = Array.isArray(metadata[CHAVE_DOS_IDS])
    ? metadata[CHAVE_DOS_IDS].filter((id): id is string => typeof id === "string")
    : [];
  if (atuais.includes(externalId)) return metadata;
  return { ...metadata, [CHAVE_DOS_IDS]: [...atuais, externalId].slice(-TETO_DE_IDS) };
}

export interface CardAberto {
  id: string;
  source: string;
  externalId: string | null;
  sourceMetadata: Record<string, unknown>;
  tags: string[];
  contactId: string;
}

export type ResultadoDoReuso =
  { reusado: false } | { reusado: true; leadId: string; repetido: boolean };

/**
 * O card aberto mais recente deste contato, nesta organização.
 * `null` quando não há — aí a rota cria no funil da fonte, como sempre.
 */
export async function cardAbertoDoContato(
  admin: SupabaseClient,
  organizationId: string,
  contactId: string,
): Promise<CardAberto | null> {
  const { data, error } = await admin
    .from("crm_leads")
    .select("id, source, external_id, source_metadata, tags, contact_id")
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .eq("status", "open")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const linha = data as {
    id: string;
    source: string | null;
    external_id: string | null;
    source_metadata: unknown;
    tags: unknown;
    contact_id: string | null;
  };
  return {
    id: linha.id,
    source: linha.source ?? "webhook",
    externalId: linha.external_id,
    sourceMetadata: comoMapa(linha.source_metadata),
    tags: Array.isArray(linha.tags)
      ? linha.tags.filter((t): t is string => typeof t === "string")
      : [],
    contactId: linha.contact_id ?? contactId,
  };
}

export async function contatoAceitaReuso(
  admin: SupabaseClient,
  organizationId: string,
  contactId: string,
): Promise<
  | { ok: true; tags: string[]; sourceMetadata: unknown }
  | { ok: false; motivo: "anonimizado" | "ilegivel" }
> {
  const { data, error } = await admin
    .from("contacts")
    .select("is_anonymized, tags, source_metadata")
    .eq("organization_id", organizationId)
    .eq("id", contactId)
    .maybeSingle();
  if (error || !data) return { ok: false, motivo: "ilegivel" };
  const linha = data as { is_anonymized?: boolean; tags: unknown; source_metadata: unknown };
  if (linha.is_anonymized === true) return { ok: false, motivo: "anonimizado" };
  return {
    ok: true,
    tags: Array.isArray(linha.tags) ? linha.tags : [],
    sourceMetadata: linha.source_metadata,
  };
}

export interface EnvioParaReuso {
  organizationId: string;
  webhookSourceId: string;
  contactId: string;
  externalId: string | null;
  utm: Record<string, string>;
  tags: string[];
  /** Nomes dos campos do envio, nunca os valores. A timeline não carrega PII. */
  campos: string[];
  captureSource: string;
  requestId: string;
}

/**
 * Funde o envio no card aberto. `repetido` é o mesmo `external_id` chegando
 * de novo: nada é reescrito, a rota responde 200 com o card que já existe.
 */
export async function reusarCardAberto(
  admin: SupabaseClient,
  card: CardAberto,
  envio: EnvioParaReuso,
): Promise<ResultadoDoReuso> {
  // Titular anonimizado não recebe dado de volta. A rota trata como reenvio
  // e não abre outro card com o nome que a cascata acabou de apagar.
  const contato = await contatoAceitaReuso(admin, envio.organizationId, envio.contactId);
  if (!contato.ok && contato.motivo === "anonimizado") {
    return { reusado: true, leadId: card.id, repetido: true };
  }

  if (jaReaproveitou(card.sourceMetadata, envio.externalId)) {
    return { reusado: true, leadId: card.id, repetido: true };
  }
  if (
    envio.externalId &&
    card.externalId === envio.externalId &&
    card.source === envio.captureSource
  ) {
    return { reusado: true, leadId: card.id, repetido: true };
  }

  const etiquetas = [
    ...envio.tags,
    ...(Object.keys(envio.utm).length > 0 ? etiquetasDoToque(envio.utm) : []),
  ];
  const tagsDoCard = fundirEtiquetas(card.tags, etiquetas);
  let metadata = fundirUtm(card.sourceMetadata, envio.utm);
  metadata = marcarReaproveitado(metadata, envio.externalId);

  const patch: Record<string, unknown> = {
    tags: tagsDoCard,
    source_metadata: metadata,
  };
  // Só carimba o external_id quando o card é desta origem e ainda não tem um.
  // Card de outro canal (WhatsApp, por exemplo) guarda o id no metadata: a
  // coluna única é por origem, e reescrevê-la mudaria a identidade do card.
  if (!card.externalId && card.source === envio.captureSource && envio.externalId) {
    patch.external_id = envio.externalId;
  }

  const { error } = await admin
    .from("crm_leads")
    .update(patch)
    .eq("organization_id", envio.organizationId)
    .eq("id", card.id);
  if (error) {
    logger.error("[webhooks.in] não reaproveitou o card aberto", {
      organizationId: envio.organizationId,
      leadId: card.id,
      detalhe: error.message.slice(0, 160),
    });
    return { reusado: false };
  }

  if (contato.ok) {
    await admin
      .from("contacts")
      .update({
        tags: fundirEtiquetas(contato.tags, etiquetas),
        source_metadata: fundirUtm(contato.sourceMetadata, envio.utm),
      })
      .eq("organization_id", envio.organizationId)
      .eq("id", envio.contactId);
  }

  await emitLeadActivity(admin, {
    organizationId: envio.organizationId,
    leadId: card.id,
    contactId: envio.contactId,
    type: "note",
    sourceModule: "webhook",
    sourceId: envio.webhookSourceId,
    actor: { type: "webhook_source", id: envio.webhookSourceId },
    reason: "Novo envio da captação reaproveitou o card aberto.",
    payload: {
      webhook_source_id: envio.webhookSourceId,
      campos: envio.campos.slice(0, 30),
      utm_source: envio.utm.utm_source ?? null,
      utm_medium: envio.utm.utm_medium ?? null,
      utm_campaign: envio.utm.utm_campaign ?? null,
    },
  });

  const { error: erroEvento } = await admin.rpc("emit_event", {
    p_event_type: "lead.updated",
    p_entity_kind: "crm_lead",
    p_entity_id: card.id,
    p_payload: { fields: ["tags", "source_metadata"], reaproveitado: true },
    p_metadata: { request_id: envio.requestId, webhook_source_id: envio.webhookSourceId },
    p_organization_id: envio.organizationId,
  });
  if (erroEvento) {
    logger.warn("[webhooks.in] lead.updated do reuso não saiu", {
      organizationId: envio.organizationId,
      leadId: card.id,
      detalhe: erroEvento.message.slice(0, 160),
    });
  }

  const acrescentadas = tagsDoCard.filter((tag) => !card.tags.includes(tag));
  if (acrescentadas.length > 0) {
    await admin.rpc("emit_event", {
      p_event_type: "lead.tag_added",
      p_entity_kind: "crm_lead",
      p_entity_id: card.id,
      p_payload: { added_tags: acrescentadas, tags: tagsDoCard },
      p_metadata: { request_id: envio.requestId, webhook_source_id: envio.webhookSourceId },
      p_organization_id: envio.organizationId,
    });
  }

  return { reusado: true, leadId: card.id, repetido: false };
}
