/**
 * O par token↔gclid: criado no clique da landing page, consumido quando a
 * mensagem do WhatsApp chega com o token no texto.
 *
 * Mora aqui — dentro de `lib/plataformas-de-anuncio/google/` — e não em
 * `lib/leads/`, porque o DADO é específico do Google: o `gclid` é o clique de
 * pesquisa paga, e a Meta não precisa dele (o clique-para-WhatsApp dela chega
 * com `ctwa_clid` nativo no `referral`/`contextInfo`). Nomear "google" aqui é
 * legítimo pela mesma razão que `meta/conversions.ts` nomeia "meta" — esta
 * pasta é a segunda fronteira que `lib/plataformas-de-anuncio/types.ts`
 * declara, e dentro dela nomear a plataforma é o ponto, não a exceção.
 *
 * O MECANISMO do token curto (alfabeto, tamanho, retentativa em colisão) não
 * mora mais aqui: ele é o mesmo para a captura de UTM da Meta e subiu para
 * `../captura-de-clique.ts`. O que fica neste arquivo é o que é do Google — o
 * `gclid` e o casamento dele com o contato.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { normalizarUtm } from "@/lib/leads/origem-do-site";
import { criarClickRef as criarClickRefNaTabela, type ClickRefCriado } from "../captura-de-clique";

import { lerIdentificadoresGoogle, type IdentificadoresGoogle } from "./identificadores";

export type { ClickRefCriado };

/** Cria o par token↔gclid. */
export async function criarClickRef(
  admin: SupabaseClient,
  organizationId: string,
  clique: string | IdentificadoresGoogle,
  queryRaw: Record<string, string>,
): Promise<ClickRefCriado | null> {
  const ids = lerIdentificadoresGoogle(typeof clique === "string" ? { gclid: clique } : clique);
  if (!ids) return null;
  return criarClickRefNaTabela(admin, "google_ads_click_refs", organizationId, {
    gclid: ids.gclid ?? null,
    gbraid: ids.gbraid ?? null,
    wbraid: ids.wbraid ?? null,
    query_raw: queryRaw,
  });
}

export type ClickRefCasado = IdentificadoresGoogle;

/**
 * Casa um token com um contato — a UPDATE condicional que garante que um
 * clique só é consumido UMA vez. `matched_at is null` no WHERE é a trava:
 * duas mensagens com o mesmo token (replay, ou o mesmo texto reencaminhado)
 * só uma ganha a linha, e a segunda simplesmente não encontra o que atualizar.
 */
export async function casarClickRef(
  admin: SupabaseClient,
  organizationId: string,
  token: string,
  contactId: string,
): Promise<ClickRefCasado | null> {
  const { data, error } = await admin
    .from("google_ads_click_refs")
    .update({ matched_at: new Date().toISOString(), contact_id: contactId })
    .eq("organization_id", organizationId)
    .eq("token", token)
    .is("matched_at", null)
    .select("gclid, gbraid, wbraid")
    .maybeSingle();

  if (error) {
    logger.error("[google-ads.captura-de-clique] update de match falhou", {
      organizationId,
      codigo: error.code,
      detalhe: error.message,
    });
    return null;
  }
  if (!data) return null;
  return lerIdentificadoresGoogle(
    Object.fromEntries(Object.entries(data).filter(([, v]) => v != null)),
  );
}

/**
 * O ref de um link rastreável que ESTE contato já consumiu.
 *
 * A ingestão do transporte por QR casa o ref do Google antes da pós-entrada.
 * A pós-entrada precisa das UTMs e do link para o último toque, sem consumir
 * o clique de novo — `matched_at` já está preenchido, e uma segunda UPDATE
 * não acharia a linha.
 *
 * Só devolve linha DESTE contato. Ref encaminhado para outra pessoa não casa
 * aqui: o `contact_id` é de quem consumiu.
 */
export async function lerRefDeLinkJaCasado(
  admin: SupabaseClient,
  organizationId: string,
  token: string,
  contactId: string,
): Promise<{ utm: Record<string, string>; tracking_link_id: string | null } | null> {
  const { data, error } = await admin
    .from("google_ads_click_refs")
    .select("tracking_link_id, query_raw")
    .eq("organization_id", organizationId)
    .eq("token", token)
    .eq("contact_id", contactId)
    .not("matched_at", "is", null)
    .maybeSingle();

  if (error || !data) return null;
  const linha = data as { tracking_link_id?: string | null; query_raw?: unknown };
  const utm = normalizarUtm(linha.query_raw);
  if (!linha.tracking_link_id && Object.keys(utm).length === 0) return null;
  return { utm, tracking_link_id: linha.tracking_link_id ?? null };
}

/**
 * Reclama um ref de link do Google que ainda está livre, ou lê o que ESTE
 * contato já reclamou.
 *
 * O transporte por QR reclama antes da pós-entrada. O WhatsApp oficial não
 * reclama: sem este UPDATE o clique ficava sem dono e o toque não entrava.
 * A UPDATE só casa `matched_at` nulo, então não toma o ref de outra pessoa.
 */
export async function casarOuLerRefDeLink(
  admin: SupabaseClient,
  organizationId: string,
  token: string,
  contactId: string,
): Promise<{ utm: Record<string, string>; tracking_link_id: string | null } | null> {
  const { data, error } = await admin
    .from("google_ads_click_refs")
    .update({ matched_at: new Date().toISOString(), contact_id: contactId })
    .eq("organization_id", organizationId)
    .eq("token", token)
    .is("matched_at", null)
    .select("tracking_link_id, query_raw")
    .maybeSingle();
  if (!error && data) {
    const linha = data as { tracking_link_id?: string | null; query_raw?: unknown };
    const utm = normalizarUtm(linha.query_raw);
    if (linha.tracking_link_id || Object.keys(utm).length > 0) {
      return { utm, tracking_link_id: linha.tracking_link_id ?? null };
    }
  }
  return lerRefDeLinkJaCasado(admin, organizationId, token, contactId);
}
