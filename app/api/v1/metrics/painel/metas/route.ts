/**
 * PUT /api/v1/metrics/painel/metas
 *
 * Grava a meta diária e, se vier, a mensal da organização ativa. A organização
 * sai da sessão, nunca do corpo. Piso manager. A RLS repete o piso na tabela.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { gravarMetasSchema } from "@/lib/metrics/painel-metas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", {
    requestId,
    resource: "metrics",
    allowPlatformAdmin: true,
  });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { org: activeOrg, user } = authz;

  const supportDenied = await requireSupportWrite(activeOrg.orgId);
  if (supportDenied) return supportDenied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("validation_failed", t("Meta inválida."), 422, { requestId });
  }
  const parsed = gravarMetasSchema.safeParse(body);
  if (!parsed.success) {
    return fail("validation_failed", t("Meta inválida."), 422, {
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
      requestId,
    });
  }

  const supabase = await createClient();
  const { error } = await supabase.from("painel_metas").upsert(
    {
      organization_id: activeOrg.orgId,
      ...parsed.data,
      updated_by: user.id,
    },
    { onConflict: "organization_id" },
  );
  if (error) {
    logger.error("[metrics.painel.metas] gravação falhou", {
      requestId,
      organization_id: activeOrg.orgId,
      message: error.message,
    });
    return fail("internal_error", t("Não foi possível salvar a meta."), 500, { requestId });
  }

  await audit({
    action: "painel.metas_updated",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "painel_metas",
    resourceId: activeOrg.orgId,
    requestId,
    metadata: { ...parsed.data },
  });

  return ok({ organization_id: activeOrg.orgId, ...parsed.data }, { requestId });
}
