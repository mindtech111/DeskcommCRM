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
import { EVENTO_AVISO_INTERNO, prazoDoAviso } from "@/lib/automation/aviso-interno-fila";
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
  /**
   * Grava o evento próprio da fila. Quem chama já decidiu esperar. Não adia o
   * evento da regra — as outras ações seguem.
   */
  enfileirar(entrada: {
    organizationId: string;
    chave: string;
    ruleId: string;
    leadId: string;
    channelSessionId: string;
    telefone: string;
    template: string;
    prazoEm: string;
  }): Promise<void>;
  audita: (entrada: {
    action:
      | "automation.internal_whatsapp_sent"
      | "automation.internal_whatsapp_failed"
      | "automation.internal_whatsapp_queued";
    organizationId: string;
    ruleId: string;
    leadId: string | null;
    metadata: Record<string, unknown>;
  }) => void;
}

function recusa(reason: string, extra?: Record<string, unknown>): ActionResultDetail {
  return { type: TIPO, status: "skipped", detail: { reason: reason, ...extra } };
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

async function deixarParaAFila(
  deps: DepsDoAvisoInterno,
  ctx: ActionCtx,
  lido: ConfigDoAvisoInterno,
  motivo: string,
  liberaEm: Date,
): Promise<ActionResultDetail> {
  const lead = leadDoContexto(ctx);
  const leadId = typeof lead?.id === "string" ? lead.id : "";
  if (!leadId) return recusa("no_target");
  const prazoEm = prazoDoAviso(deps.clock());
  // O slot só volta depois do prazo: esperar não entrega. Registra e desiste.
  if (liberaEm.getTime() > Date.parse(prazoEm)) {
    deps.audita({
      action: "automation.internal_whatsapp_failed",
      organizationId: ctx.organizationId,
      ruleId: ctx.ruleId,
      leadId,
      metadata: { codigo: motivo, canal: lido.channelSessionId },
    });
    return recusa(motivo, { desistiu: true });
  }
  await deps.enfileirar({
    organizationId: ctx.organizationId,
    chave: `${ctx.ruleId}:${ctx.event.id}:${ctx.actionIndex ?? 0}`,
    ruleId: ctx.ruleId,
    leadId,
    channelSessionId: lido.channelSessionId,
    telefone: lido.telefone,
    template: lido.modelo,
    prazoEm,
  });
  deps.audita({
    action: "automation.internal_whatsapp_queued",
    organizationId: ctx.organizationId,
    ruleId: ctx.ruleId,
    leadId,
    metadata: { codigo: motivo, ate: prazoEm, canal: lido.channelSessionId },
  });
  // `postponed` aqui NÃO reagenda o evento da regra: o motor só faz isso no
  // `postponeUntil`, e esta ação não tem. O ícone de espera é o registro de
  // que a fila própria ainda vai tentar. As ações seguintes desta regra, e as
  // outras regras do mesmo evento, seguem agora.
  return {
    type: TIPO,
    status: "postponed",
    detail: {
      reason: "agendado",
      motivo,
      retry_at: liberaEm.toISOString(),
      explicacao:
        "O aviso entrou na fila dele e tenta sair sozinho por até seis horas, sem segurar as outras ações. Se não sair nesse prazo, a falha fica registrada na auditoria.",
    },
  };
}

export async function enviarAvisoInterno(
  deps: DepsDoAvisoInterno,
  ctx: ActionCtx,
  config: Record<string, unknown>,
  opts?: { naFila?: boolean },
): Promise<ActionResultDetail> {
  const lido = lerConfigDoAvisoInterno(config);
  if (!lido) {
    const modelo = typeof config.template === "string" ? config.template : "";
    const proibida = variaveisCitadas(modelo).find(
      (nome) => !modeloDeAvisoInternoValido(`{{${nome}}}`),
    );
    return recusa(
      proibida ? "variavel_nao_permitida" : "missing_config",
      proibida ? { variavel: proibida } : undefined,
    );
  }

  const agora = deps.clock();
  const canal = await deps.carregaCanal(ctx.organizationId, lido.channelSessionId);
  if (!canal || canal.archived_at) return recusa("aviso_remetente_arquivado");
  if (canal.desativado) return recusa("canal_desativado");
  if (!canal.aceitaMensagemLivre) return recusa("canal_nao_aceita_aviso_livre");
  if (canal.status !== "WORKING") {
    if (opts?.naFila) return recusa("canal_desconectado");
    return deixarParaAFila(
      deps,
      ctx,
      lido,
      "canal_desconectado",
      new Date(agora.getTime() + ADIAMENTO_DO_CANAL_MS),
    );
  }

  const precisaDeLink = variaveisCitadas(lido.modelo).includes("link");
  if (precisaDeLink && !urlPublicaUsavel(deps.urlPublica)) return recusa("sem_endereco_publico");

  if (!(await deps.transporte.configurado(ctx.organizationId, canal))) {
    if (opts?.naFila) return recusa("transporte_ausente");
    return deixarParaAFila(
      deps,
      ctx,
      lido,
      "transporte_ausente",
      new Date(agora.getTime() + ADIAMENTO_DO_CANAL_MS),
    );
  }

  const pacing = await deps.pacing.decide(ctx.organizationId, lido.channelSessionId, agora);
  if (!pacing.liberado) {
    if (opts?.naFila) {
      return {
        type: TIPO,
        status: "postponed",
        detail: { reason: pacing.motivo, retry_at: pacing.liberaEm.toISOString() },
      };
    }
    return deixarParaAFila(deps, ctx, lido, pacing.motivo, pacing.liberaEm);
  }

  const to = await deps.transporte.resolveDestino(ctx.organizationId, canal, lido.telefone);
  if (!to) return recusa("destino_invalido");

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
  if (corpo === null) return recusa("variavel_nao_permitida");

  const leadId = typeof lead?.id === "string" ? lead.id : null;
  try {
    await deps.transporte.envia(ctx.organizationId, canal, to, corpo);
  } catch {
    if (!opts?.naFila) {
      return deixarParaAFila(
        deps,
        ctx,
        lido,
        "falha_no_envio",
        new Date(agora.getTime() + ADIAMENTO_DO_CANAL_MS),
      );
    }
    // Já está na fila: uma falha de rede não encerra. Quem desiste é o prazo.
    return {
      type: TIPO,
      status: "postponed",
      detail: {
        reason: "falha_no_envio",
        retry_at: new Date(agora.getTime() + ADIAMENTO_DO_CANAL_MS).toISOString(),
      },
    };
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
    async enfileirar(entrada) {
      const { data: ja } = await ctx.admin
        .from("event_log")
        .select("id")
        .eq("organization_id", entrada.organizationId)
        .eq("event_type", EVENTO_AVISO_INTERNO)
        .contains("payload", { chave: entrada.chave })
        .limit(1);
      if (ja && ja.length > 0) return;
      const { error } = await ctx.admin.rpc("emit_event", {
        // Literal de propósito: a cerca de evento órfão só vê a string, não a constante.
        p_event_type: "automation.internal_whatsapp" satisfies typeof EVENTO_AVISO_INTERNO,
        p_entity_kind: "crm_lead",
        p_entity_id: entrada.leadId,
        p_payload: {
          chave: entrada.chave,
          rule_id: entrada.ruleId,
          lead_id: entrada.leadId,
          channel_session_id: entrada.channelSessionId,
          telefone_destino: entrada.telefone,
          template: entrada.template,
          prazo_em: entrada.prazoEm,
          tentativas: 0,
        },
        p_metadata: { caused_by_rule: entrada.ruleId },
        p_organization_id: entrada.organizationId,
      });
      if (error) throw new Error(error.message);
    },
  };
}

async function execute(
  ctx: ActionCtx,
  config: Record<string, unknown>,
): Promise<ActionResultDetail> {
  return enviarAvisoInterno(await depsDeProducao(ctx), ctx, config);
}

registerAction({ type: TIPO, execute });
