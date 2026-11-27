/**
 * GET /api/v1/metrics/painel/comercial?inicio=YYYY-MM-DD&fim=YYYY-MM-DD&pipeline=<uuid>
 *
 * Visão comercial do painel (pedido da gestão comercial da Inochi): KPIs,
 * funil por safra seguindo as etapas do funil escolhido, canais, anúncios,
 * série diária, oportunidades prioritárias e perdas por motivo. A conta é
 * `fn_painel_comercial_v2` (0694), SECURITY INVOKER: a RLS recorta, e a
 * organização é a ativa da sessão — nunca a query.
 *
 * As datas são dias civis em America/Sao_Paulo (UTC−3, sem horário de verão
 * desde 2019); `fim` é inclusivo. Sem datas: o mês corrente até agora.
 * Read-only: sem audit. Piso `manager`, o mesmo do painel.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

export const dynamic = "force-dynamic";

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const querySchema = z.object({
  inicio: dia.optional(),
  fim: dia.optional(),
  pipeline: z.string().uuid().optional(),
});

const OFFSET_SP = "-03:00";

function hojeEmSaoPaulo(agora: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(agora);
}

function diaSeguinte(d: string): string {
  const dt = new Date(`${d}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

interface Prioridade {
  responsavel_id: string | null;
  [k: string]: unknown;
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", {
    requestId,
    resource: "metrics",
    allowPlatformAdmin: true,
  });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    inicio: url.searchParams.get("inicio") ?? undefined,
    fim: url.searchParams.get("fim") ?? undefined,
    pipeline: url.searchParams.get("pipeline") ?? undefined,
  });
  if (!parsed.success) {
    return fail("validation_failed", t("Período inválido."), 422, {
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
      requestId,
    });
  }

  const agora = new Date();
  const hoje = hojeEmSaoPaulo(agora);
  const inicioDia = parsed.data.inicio ?? `${hoje.slice(0, 7)}-01`;
  const fimDia = parsed.data.fim ?? hoje;
  if (fimDia < inicioDia) {
    return fail("validation_failed", t("O fim do período vem antes do início."), 422, { requestId });
  }
  const inicio = `${inicioDia}T00:00:00${OFFSET_SP}`;
  const fimExclusivo = `${diaSeguinte(fimDia)}T00:00:00${OFFSET_SP}`;
  const fim = Date.parse(fimExclusivo) > agora.getTime() ? agora.toISOString() : fimExclusivo;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_painel_comercial_v2", {
    p_org: authz.org.orgId,
    p_inicio: inicio,
    p_fim: fim,
    p_pipeline: parsed.data.pipeline ?? null,
  });
  if (error) {
    logger.error("[metrics.painel.comercial] leitura falhou", {
      requestId,
      organization_id: authz.org.orgId,
      message: error.message,
    });
    return fail("internal_error", t("Não foi possível ler o painel agora."), 500, { requestId });
  }
  const resposta = (data ?? {}) as Record<string, unknown>;
  if (resposta.erro === "janela_invalida") {
    return fail("validation_failed", t("Janela inválida (máximo de um ano)."), 422, { requestId });
  }
  if (resposta.erro === "funil_inexistente") {
    return fail("not_found", t("Funil não encontrado."), 404, { requestId });
  }

  const prioridades = (resposta.prioridades as Prioridade[] | undefined) ?? [];
  const ids = [...new Set(prioridades.map((p) => p.responsavel_id).filter((v): v is string => !!v))];
  const nomes = await nomesDosAtendentes(ids);

  return ok(
    {
      ...resposta,
      janela: { inicio: inicioDia, fim: fimDia, fuso: "America/Sao_Paulo" },
      prioridades: prioridades.map((p) => ({
        ...p,
        responsavel: p.responsavel_id ? (nomes.get(p.responsavel_id) ?? null) : null,
      })),
    },
    { requestId },
  );
}
