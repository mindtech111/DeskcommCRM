/**
 * GET /api/v1/metrics/painel?periodo=hoje|7d|30d
 *
 * Retrato do dia (ou dos últimos 7 / 30 dias civis em America/Sao_Paulo) e do
 * período anterior do mesmo tamanho, mais o funil, o comparativo de quem vende
 * e a meta proporcional. A conta é `fn_painel_diario` e `fn_painel_comercial`
 * (0692, 0693), com o client de sessão: as funções são SECURITY INVOKER, a RLS
 * recorta, e a organização é a ativa — nunca a query.
 *
 * Read-only: sem audit. Piso `manager`, o mesmo de Meta Ads.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { logger } from "@/lib/logger";
import { comercialSchema, type ComercialDoPainel } from "@/lib/metrics/painel-comercial";
import { blocoDeMetas, metasGravadasSchema, type MetasGravadas } from "@/lib/metrics/painel-metas";
import {
  duracaoDoMesCivil,
  FUSO_DO_PAINEL,
  janelasDoPainel,
  type PeriodoPainel,
} from "@/lib/metrics/painel-periodo";
import { compararRetratos, retratoSchema, type RetratoDoPainel } from "@/lib/metrics/painel";
import { createClient } from "@/lib/supabase/server";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  periodo: z.enum(["hoje", "7d", "30d"]).optional(),
});

const COLUNAS_DA_META =
  "leads_atendidos_dia, agendamentos_dia, consultas_realizadas_dia, vendas_dia, valor_cents_dia, leads_atendidos_mes, agendamentos_mes, consultas_realizadas_mes, vendas_mes, valor_cents_mes, moeda";

function ehJanelaInvalida(data: unknown): boolean {
  return (
    !!data &&
    typeof data === "object" &&
    (data as { erro?: unknown }).erro === "janela_invalida" &&
    !("leads_novos" in (data as object)) &&
    !("funil" in (data as object))
  );
}

type Cliente = Awaited<ReturnType<typeof createClient>>;

async function lerRetrato(
  supabase: Cliente,
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

async function lerComercial(
  supabase: Cliente,
  orgId: string,
  inicio: string,
  fim: string,
): Promise<
  { ok: true; comercial: ComercialDoPainel } | { ok: false; message: string; invalida: boolean }
> {
  const { data, error } = await supabase.rpc("fn_painel_comercial", {
    p_org: orgId,
    p_inicio: inicio,
    p_fim: fim,
  });
  if (error) return { ok: false, message: error.message, invalida: false };
  if (ehJanelaInvalida(data)) return { ok: false, message: "janela_invalida", invalida: true };
  const parsed = comercialSchema.safeParse(data);
  if (!parsed.success) return { ok: false, message: "comercial_ilegivel", invalida: false };
  return { ok: true, comercial: parsed.data };
}

async function lerMetas(
  supabase: Cliente,
  orgId: string,
): Promise<{ ok: true; metas: MetasGravadas | null } | { ok: false; message: string }> {
  const { data, error } = await supabase
    .from("painel_metas")
    .select(COLUNAS_DA_META)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) return { ok: false, message: error.message };
  if (!data) return { ok: true, metas: null };
  const parsed = metasGravadasSchema.safeParse(data);
  if (!parsed.success) return { ok: false, message: "metas_ilegiveis" };
  return { ok: true, metas: parsed.data };
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  // `true`, não `"leitura"`: o atalho de leitura pula o MFA. O escopo full
  // ainda prova o fator antes de entrar; suporte não usa o atalho.
  const authz = await requireRole("manager", {
    requestId,
    resource: "metrics",
    allowPlatformAdmin: true,
  });
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
  const agora = new Date();
  const janelas = janelasDoPainel(periodo, agora, FUSO_DO_PAINEL);
  const supabase = await createClient();

  const [atual, anterior, comercial, metas] = await Promise.all([
    lerRetrato(supabase, activeOrg.orgId, janelas.atual.inicio, janelas.atual.fim),
    lerRetrato(supabase, activeOrg.orgId, janelas.anterior.inicio, janelas.anterior.fim),
    lerComercial(supabase, activeOrg.orgId, janelas.atual.inicio, janelas.atual.fim),
    lerMetas(supabase, activeOrg.orgId),
  ]);

  const invalida =
    (!atual.ok && atual.invalida) ||
    (!anterior.ok && anterior.invalida) ||
    (!comercial.ok && comercial.invalida);
  if (!atual.ok || !anterior.ok || !comercial.ok || !metas.ok) {
    if (invalida) {
      return fail("validation_failed", t("Janela inválida."), 422, { requestId });
    }
    logger.error("[metrics.painel] leitura falhou", {
      requestId,
      organization_id: activeOrg.orgId,
      atual: atual.ok ? null : atual.message,
      anterior: anterior.ok ? null : anterior.message,
      comercial: comercial.ok ? null : comercial.message,
      metas: metas.ok ? null : metas.message,
    });
    return fail("internal_error", t("Não foi possível ler o painel agora."), 500, { requestId });
  }

  const nomes = await nomesDosAtendentes(comercial.comercial.equipe.pessoas.map((p) => p.user_id));
  const janelaMs = Date.parse(janelas.atual.fim) - Date.parse(janelas.atual.inicio);
  const pessoas = comercial.comercial.equipe.pessoas.map((pessoa) => ({
    ...pessoa,
    nome: nomes.get(pessoa.user_id) ?? null,
  }));

  return ok(
    {
      periodo,
      fuso: janelas.fuso,
      atual: { ...janelas.atual, ...atual.retrato },
      anterior: { ...janelas.anterior, ...anterior.retrato },
      comparacao: compararRetratos(atual.retrato, anterior.retrato),
      funil: comercial.comercial.funil,
      equipe: { ...comercial.comercial.equipe, pessoas },
      metas: blocoDeMetas(
        metas.metas,
        atual.retrato,
        periodo,
        janelaMs,
        duracaoDoMesCivil(agora, FUSO_DO_PAINEL),
      ),
    },
    { requestId },
  );
}
