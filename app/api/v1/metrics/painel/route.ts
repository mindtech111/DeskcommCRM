/**
 * GET /api/v1/metrics/painel?periodo=hoje|7d|30d
 *
 * Retrato do dia (ou dos últimos 7 / 30 dias civis em America/Sao_Paulo) e do
 * período anterior do mesmo tamanho. A conta é `fn_painel_diario` (0691),
 * chamada duas vezes com o client de sessão: a função é SECURITY INVOKER, a
 * RLS recorta, e a organização é a ativa — nunca a query.
 *
 * Read-only: sem audit. Piso `manager`, o mesmo de Meta Ads: cliques e a
 * conexão de anúncios não têm recorte por pessoa.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { logger } from "@/lib/logger";
import { compararRetratos, retratoSchema, type RetratoDoPainel } from "@/lib/metrics/painel";
import { FUSO_DO_PAINEL, janelasDoPainel, type PeriodoPainel } from "@/lib/metrics/painel-periodo";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  periodo: z.enum(["hoje", "7d", "30d"]).optional(),
});

function ehJanelaInvalida(data: unknown): boolean {
  return (
    !!data &&
    typeof data === "object" &&
    (data as { erro?: unknown }).erro === "janela_invalida" &&
    !("leads_novos" in (data as object))
  );
}

async function lerRetrato(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  inicio: string,
  fim: string,
): Promise<
  { ok: true; retrato: RetratoDoPainel } | { ok: false; message: string; invalida: boolean }
> {
  const { data, error } = await supabase.rpc("fn_painel_diario", {
    p_org: orgId,
    p_inicio: inicio,
    p_fim: fim,
  });
  if (error) return { ok: false, message: error.message, invalida: false };
  if (ehJanelaInvalida(data)) return { ok: false, message: "janela_invalida", invalida: true };
  const parsed = retratoSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, message: "retrato_ilegivel", invalida: false };
  }
  return { ok: true, retrato: parsed.data };
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "metrics" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { org: activeOrg } = authz;

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    periodo: url.searchParams.get("periodo") ?? undefined,
  });
  if (!parsed.success) {
    return fail("validation_failed", t("Período inválido."), 422, {
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
      requestId,
    });
  }

  const periodo: PeriodoPainel = parsed.data.periodo ?? "hoje";
  const janelas = janelasDoPainel(periodo, new Date(), FUSO_DO_PAINEL);
  const supabase = await createClient();

  const [atual, anterior] = await Promise.all([
    lerRetrato(supabase, activeOrg.orgId, janelas.atual.inicio, janelas.atual.fim),
    lerRetrato(supabase, activeOrg.orgId, janelas.anterior.inicio, janelas.anterior.fim),
  ]);

  if (!atual.ok || !anterior.ok) {
    const invalida =
      (atual.ok ? false : atual.invalida) || (anterior.ok ? false : anterior.invalida);
    if (invalida) {
      return fail("validation_failed", t("Janela inválida."), 422, { requestId });
    }
    logger.error("[metrics.painel] leitura falhou", {
      requestId,
      organization_id: activeOrg.orgId,
      atual: atual.ok ? null : atual.message,
      anterior: anterior.ok ? null : anterior.message,
    });
    return fail("internal_error", t("Não foi possível ler o painel agora."), 500, { requestId });
  }

  return ok(
    {
      periodo,
      fuso: janelas.fuso,
      atual: { ...janelas.atual, ...atual.retrato },
      anterior: { ...janelas.anterior, ...anterior.retrato },
      comparacao: compararRetratos(atual.retrato, anterior.retrato),
    },
    { requestId },
  );
}
