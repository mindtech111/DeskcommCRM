/**
 * Ação `send_internal_whatsapp` — aviso para a EQUIPE, no WhatsApp.
 *
 * Reusa o transporte, o espaçamento e o teto diário do aviso de caso
 * (`lib/escalacao/aviso-ao-suporte.ts` + `criarPacingDoCanal`). Não abre
 * conversa, não grava mensagem de atendimento e não lê campo de formulário.
 *
 * A janela de horário NÃO entra, pelo mesmo motivo do aviso de caso: ela
 * protege o cliente. O que protege o NÚMERO — espaçamento e teto — continua.
 */
import { registerAction } from "@/lib/automation/actions";
import {
  dadosDoAvisoInterno,
  modeloDeAvisoInternoValido,
  renderAvisoInterno,
  telefoneDeAvisoInterno,
  variaveisCitadas,
} from "@/lib/automation/aviso-interno";
import type { ActionCtx, ActionResultDetail } from "@/lib/automation/types";
import {
  ADIAMENTO_DO_CANAL_MS,
  TETO_DE_TENTATIVAS_DO_CANAL,
  mascara,
  type CanalDoAviso,
  type PacingDoAviso,
  type TransporteDoAviso,
} from "@/lib/escalacao/aviso-ao-suporte";
import { urlPublicaUsavel } from "@/lib/escalacao/url-publica";

const TIPO = "send_internal_whatsapp";

export interface ConfigDoAvisoInterno {
  channelSessionId: string;
  telefone: string;
  modelo: string;
}

export function lerConfigDoAvisoInterno(
  config: Record<string, unknown>,
): ConfigDoAvisoInterno | null {
  const channelSessionId =
    typeof config.channel_session_id === "string" ? config.channel_session_id : "";
  const telefone = telefoneDeAvisoInterno(config.telefone_destino);
  const modelo = typeof config.template === "string" ? config.template : "";
  if (!channelSessionId || !telefone || !modelo.trim() || !modeloDeAvisoInternoValido(modelo)) {
    return null;
  }
  return { channelSessionId, telefone, modelo };
}

export interface DepsDoAvisoInterno {
  carregaCanal(orgId: string, channelSessionId: string): Promise<CanalDoAviso | null>;
  nomeDaFonte(orgId: string, fonteId: string): Promise<string | null>;
  transporte: TransporteDoAviso;
  pacing: PacingDoAviso;
  urlPublica: string;
  clock: () => Date;
  audita: (entrada: {
    action: "automation.internal_whatsapp_sent" | "automation.internal_whatsapp_failed";
    organizationId: string;
    ruleId: string;
    leadId: string | null;
    metadata: Record<string, unknown>;
  }) => void;
}

function pulada(reason: string, extra?: Record<string, unknown>): ActionResultDetail {
  return { type: TIPO, status: "skipped", detail: { reason, ...extra } };
}

function leadDoContexto(
  ctx: ActionCtx,
):
  | { id?: string; title?: string | null; tags?: unknown; webhook_source_id?: string | null }
  | undefined {
  return ctx.context.lead as
    | { id?: string; title?: string | null; tags?: unknown; webhook_source_id?: string | null }
    | undefined;
}

/**
 * Quando o evento inteiro deve esperar, antes de qualquer ação.
 *
 * Canal fora do ar e pacing fechado viram espera. Configuração torta devolve
 * `null`: quem recusa é o `execute`, com o motivo na linha da execução.
 */
export async function adiarAvisoInterno(
  deps: Pick<DepsDoAvisoInterno, "carregaCanal" | "pacing" | "clock">,
  ctx: ActionCtx,
  config: Record<string, unknown>,
): Promise<string | null> {
  const lido = lerConfigDoAvisoInterno(config);
  if (!lido) return null;
  const agora = deps.clock();
  const tentativas = ctx.event.attempts + 1;
  const canal = await deps.carregaCanal(ctx.organizationId, lido.channelSessionId);
  if (!canal || canal.archived_at || canal.desativado || !canal.aceitaMensagemLivre) return null;
  if (canal.status !== "WORKING") {
    if (tentativas >= TETO_DE_TENTATIVAS_DO_CANAL) return null;
    return new Date(agora.getTime() + ADIAMENTO_DO_CANAL_MS).toISOString();
  }
  const pacing = await deps.pacing.decide(ctx.organizationId, lido.channelSessionId, agora);
  if (!pacing.liberado) return pacing.liberaEm.toISOString();
  return null;
}

export async function enviarAvisoInterno(
  deps: DepsDoAvisoInterno,
  ctx: ActionCtx,
  config: Record<string, unknown>,
): Promise<ActionResultDetail> {
  const lido = lerConfigDoAvisoInterno(config);
  if (!lido) {
    const modelo = typeof config.template === "string" ? config.template : "";
    const proibida = variaveisCitadas(modelo).find(
      (nome) => !modeloDeAvisoInternoValido(`{{${nome}}}`),
    );
    return pulada(
      proibida ? "variavel_nao_permitida" : "missing_config",
      proibida ? { variavel: proibida } : undefined,
    );
  }

  const agora = deps.clock();
  const canal = await deps.carregaCanal(ctx.organizationId, lido.channelSessionId);
  if (!canal || canal.archived_at) return pulada("canal_arquivado");
  if (canal.desativado) return pulada("canal_desativado");
  if (!canal.aceitaMensagemLivre) return pulada("canal_nao_aceita_aviso_livre");
  if (canal.status !== "WORKING") return pulada("canal_desconectado");

  const precisaDeLink = variaveisCitadas(lido.modelo).includes("link");
  if (precisaDeLink && !urlPublicaUsavel(deps.urlPublica)) return pulada("sem_endereco_publico");

  if (!(await deps.transporte.configurado(ctx.organizationId, canal))) {
    return pulada("transporte_ausente");
  }

  const pacing = await deps.pacing.decide(ctx.organizationId, lido.channelSessionId, agora);
  if (!pacing.liberado) {
    // O adiar já deveria ter segurado o evento. Se o teto fechou no meio,
    // não enviar é o que protege o número — a execução registra o motivo.
    return {
      type: TIPO,
      status: "postponed",
      detail: { reason: pacing.motivo, retry_at: pacing.liberaEm.toISOString() },
    };
  }

  const to = await deps.transporte.resolveDestino(ctx.organizationId, canal, lido.telefone);
  if (!to) return pulada("destino_invalido");

  const lead = leadDoContexto(ctx);
  const fonteId = typeof lead?.webhook_source_id === "string" ? lead.webhook_source_id : null;
  const origemNome = fonteId ? await deps.nomeDaFonte(ctx.organizationId, fonteId) : null;
  const corpo = renderAvisoInterno(
    lido.modelo,
    dadosDoAvisoInterno({
      contact: ctx.context.contact as
        { name?: string | null; display_name?: string | null } | undefined,
      lead,
      origemNome,
      urlPublica: deps.urlPublica,
    }),
  );
  if (corpo === null) return pulada("variavel_nao_permitida");

  const leadId = typeof lead?.id === "string" ? lead.id : null;
  try {
    await deps.transporte.envia(ctx.organizationId, canal, to, corpo);
  } catch (err) {
    const causa = err instanceof Error ? err.message : String(err);
    deps.audita({
      action: "automation.internal_whatsapp_failed",
      organizationId: ctx.organizationId,
      ruleId: ctx.ruleId,
      leadId,
      metadata: { codigo: "falha_no_envio", canal: lido.channelSessionId },
    });
    return { type: TIPO, status: "failed", error: causa.slice(0, 300) };
  }

  try {
    await deps.pacing.registraEnvio(ctx.organizationId, lido.channelSessionId, agora);
  } catch {
    /* o ledger é best-effort depois do envio: lançar aqui reenviaria o aviso */
  }
  deps.audita({
    action: "automation.internal_whatsapp_sent",
    organizationId: ctx.organizationId,
    ruleId: ctx.ruleId,
    leadId,
    metadata: {
      canal: lido.channelSessionId,
      destino_mascarado: mascara(lido.telefone),
    },
  });
  return { type: TIPO, status: "success", detail: { destino_mascarado: mascara(lido.telefone) } };
}

async function depsDeProducao(ctx: ActionCtx): Promise<DepsDoAvisoInterno> {
  const { audit } = await import("@/lib/audit");
  const { env } = await import("@/lib/env");
  const { createSupabaseAvisoDb } = await import("@/lib/escalacao/aviso-ao-suporte");
  const { criarTransporteDoAviso } = await import("@/lib/escalacao/aviso-ao-suporte.handler");
  const { criarPacingDoCanal } = await import("@/lib/agent-engine/pacing/ledger-supabase");
  const db = createSupabaseAvisoDb(ctx.admin);
  const pacing = await criarPacingDoCanal(ctx.admin);
  return {
    carregaCanal: (orgId, channelSessionId) => db.carregaCanal(orgId, channelSessionId),
    async nomeDaFonte(orgId, fonteId) {
      const { data } = await ctx.admin
        .from("webhook_sources")
        .select("name")
        .eq("organization_id", orgId)
        .eq("id", fonteId)
        .maybeSingle();
      const nome = (data as { name?: string } | null)?.name;
      return typeof nome === "string" && nome.trim() ? nome.trim() : null;
    },
    transporte: await criarTransporteDoAviso(ctx.admin),
    pacing,
    urlPublica: env.NEXT_PUBLIC_APP_URL,
    clock: () => new Date(),
    audita: (entrada) => {
      void audit({
        action: entrada.action,
        organizationId: entrada.organizationId,
        resourceType: "automation_rule",
        resourceId: entrada.ruleId,
        bypassedRls: true,
        metadata: { ...entrada.metadata, lead_id: entrada.leadId },
      });
    },
  };
}

async function postponeUntil(
  ctx: ActionCtx,
  config: Record<string, unknown>,
): Promise<string | null> {
  return adiarAvisoInterno(await depsDeProducao(ctx), ctx, config);
}

async function execute(
  ctx: ActionCtx,
  config: Record<string, unknown>,
): Promise<ActionResultDetail> {
  return enviarAvisoInterno(await depsDeProducao(ctx), ctx, config);
}

registerAction({ type: TIPO, postponeUntil, execute });
