/**
 * Adaptador da Revi — PENDENTE.
 *
 * A Revi (ferramenta de WhatsApp marketing usada pela Clínica Inochi) ainda
 * não tem, neste repositório, o contrato do payload real. Este arquivo não
 * chama endpoint, não inventa campo e não decide sozinho que um JSON é da
 * Revi: `isReviPayload` fica falso até o corpo verdadeiro ser medido.
 *
 * Enquanto isso, a captação genérica (`lib/webhooks/inbound.ts`) já aceita
 * `utm_campaign` e os aliases `campaign` / `campanha`, e a fonte pode gravar
 * `capture_source = "revi"` para o card novo nascer com essa origem.
 */
export const REVI_PAYLOAD_PENDENTE = true as const;

/** Reservado para a forma real do envio. Hoje não reconhece nada. */
export function isReviPayload(_payload: unknown): false {
  return false;
}
