/**
 * A fila do aviso interno é DELE, não do evento que disparou a regra.
 *
 * O motor adia o evento inteiro quando uma ação pede espera — e o dreno, ao
 * reagendar, não soma `attempts`. Uma sessão fora do ar seguraria para sempre
 * a etiqueta, a tarefa e qualquer outra regra do mesmo lead. Por isso a espera
 * mora num evento próprio (`automation.internal_whatsapp`), com prazo e teto
 * de tentativas contados aqui, não no dreno.
 */
export const EVENTO_AVISO_INTERNO = "automation.internal_whatsapp";

/** Seis horas. Depois disso o aviso é ruído, não recado. */
export const PRAZO_DO_AVISO_MS = 6 * 60 * 60 * 1000;

/**
 * Teto de retomadas do evento próprio. O dreno não incrementa `attempts` no
 * reagendamento; quem conta é o `tentativas` gravado no payload.
 */
export const MAX_TENTATIVAS_DO_AVISO = 36;

export interface FilaDoAviso {
  chave: string;
  rule_id: string;
  lead_id: string;
  channel_session_id: string;
  telefone_destino: string;
  template: string;
  prazo_em: string;
  tentativas: number;
}

export function prazoDoAviso(agora: Date): string {
  return new Date(agora.getTime() + PRAZO_DO_AVISO_MS).toISOString();
}

export function deveDesistir(entrada: { agora: Date; prazoEm: string; tentativas: number }): boolean {
  const prazo = Date.parse(entrada.prazoEm);
  if (Number.isNaN(prazo) || entrada.agora.getTime() > prazo) return true;
  return entrada.tentativas >= MAX_TENTATIVAS_DO_AVISO;
}

export function lerFilaDoAviso(payload: Record<string, unknown> | null | undefined): FilaDoAviso | null {
  if (!payload) return null;
  const leadId = typeof payload.lead_id === "string" ? payload.lead_id : "";
  const sessao = typeof payload.channel_session_id === "string" ? payload.channel_session_id : "";
  const telefone = typeof payload.telefone_destino === "string" ? payload.telefone_destino : "";
  const template = typeof payload.template === "string" ? payload.template : "";
  const prazoEm = typeof payload.prazo_em === "string" ? payload.prazo_em : "";
  const chave = typeof payload.chave === "string" ? payload.chave : "";
  const ruleId = typeof payload.rule_id === "string" ? payload.rule_id : "";
  const tentativas = typeof payload.tentativas === "number" && Number.isInteger(payload.tentativas) ? payload.tentativas : 0;
  if (!leadId || !sessao || !telefone || !template || !prazoEm || !chave || !ruleId) return null;
  return {
    chave,
    rule_id: ruleId,
    lead_id: leadId,
    channel_session_id: sessao,
    telefone_destino: telefone,
    template,
    prazo_em: prazoEm,
    tentativas,
  };
}
