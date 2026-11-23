/**
 * A regra não grava um remetente que não entrega aviso livre.
 *
 * A tela já esconde a opção. Esta é a mesma recusa na API, para quem grava
 * a regra sem passar pelo formulário.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { aceitaAvisoLivre } from "@/lib/channels/aviso-livre";

type Acao = { type: string; config?: Record<string, unknown> };

export function sessoesDeAvisoInterno(actions: readonly Acao[] | undefined): string[] {
  const ids: string[] = [];
  for (const acao of actions ?? []) {
    if (acao.type === "send_internal_whatsapp") {
      const id = acao.config?.channel_session_id;
      if (typeof id === "string" && id) ids.push(id);
    }
    if (acao.type === "ai_decide" && Array.isArray(acao.config?.opcoes)) {
      for (const opcao of acao.config.opcoes as Array<{ acao?: Acao }>) {
        ids.push(...sessoesDeAvisoInterno(opcao?.acao ? [opcao.acao] : []));
      }
    }
  }
  return [...new Set(ids)];
}

export async function remetenteDeAvisoRecusado(
  db: SupabaseClient,
  organizationId: string,
  actions: readonly Acao[] | undefined,
): Promise<boolean> {
  const ids = sessoesDeAvisoInterno(actions);
  if (ids.length === 0) return false;
  const { data, error } = await db
    .from("channel_sessions")
    .select("id, provider")
    .eq("organization_id", organizationId)
    .in("id", ids);
  if (error) throw new Error(error.message);
  const porId = new Map(
    ((data ?? []) as Array<{ id: string; provider: string | null }>).map((linha) => [linha.id, linha.provider]),
  );
  return ids.some((id) => !aceitaAvisoLivre(porId.get(id)));
}
