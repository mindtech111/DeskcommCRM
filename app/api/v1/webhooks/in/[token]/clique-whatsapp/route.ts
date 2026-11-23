/**
 * POST /api/v1/webhooks/in/[token]/clique-whatsapp
 *
 * O site avisa o clique. Corpo: `{ "lead_id": "<uuid>" }`. Resposta curta.
 * O token do caminho é a fonte — o corpo não escolhe organização.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { aplicarCliqueWhatsapp, type RecusaDoClique } from "@/lib/webhooks/clique-whatsapp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RATE_LIMIT_PER_MIN = 60;

const corpoSchema = z
  .object({
    lead_id: z.string().uuid(),
  })
  .strict();

const RECUSA: Record<
  RecusaDoClique,
  { code: "not_found" | "state_conflict" | "invalid_request"; status: number; message: string }
> = {
  fonte_desconhecida: { code: "not_found", status: 404, message: "unknown webhook token" },
  corpo_invalido: { code: "invalid_request", status: 400, message: "invalid_body" },
  lead_fora_da_fonte: { code: "not_found", status: 404, message: "lead_fora_da_fonte" },
  lead_expirado: { code: "state_conflict", status: 409, message: "lead_expirado" },
};

interface RouteCtx {
  params: Promise<{ token: string }>;
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const requestId = randomUUID();
  const { token } = await ctx.params;
  if (!token || token.length < 8) {
    return fail("not_found", "unknown webhook token", 404, { requestId });
  }

  const rl = await checkRateLimit(`webhook_in_click:${token}`, RATE_LIMIT_PER_MIN, 60);
  if (!rl.allowed) {
    return fail("rate_limited", "Too many requests.", 429, {
      requestId,
      headers: { "Retry-After": "60" },
    });
  }

  let bruto: unknown;
  try {
    bruto = await req.json();
  } catch {
    return fail("invalid_request", "invalid_json", 400, { requestId });
  }
  const corpo = corpoSchema.safeParse(bruto);
  if (!corpo.success) {
    return fail("invalid_request", "invalid_body", 400, { requestId });
  }

  let resultado: Awaited<ReturnType<typeof aplicarCliqueWhatsapp>>;
  try {
    resultado = await aplicarCliqueWhatsapp(createAdminClient(), {
      token,
      leadId: corpo.data.lead_id,
      agora: new Date(),
      requestId,
    });
  } catch (err) {
    logger.error("[webhooks.clique] falha ao marcar o clique", {
      requestId,
      error: err instanceof Error ? err.message : String(err),
    });
    return fail("internal_error", "internal_error", 500, { requestId });
  }
  if (!resultado.ok) {
    const recusa = RECUSA[resultado.recusa];
    return fail(recusa.code, recusa.message, recusa.status, { requestId });
  }
  return ok({ ok: true }, { requestId });
}
