import { scrubMessage } from "@/lib/sentry/scrub";
import { logger } from "@/lib/logger";

import { ErroDeConsulta } from "@/lib/postgrest/lotes-de-ids";

/**
 * O que vai para o log e para o Sentry quando uma leitura do PostgREST falha.
 *
 * A mensagem passa por `scrubMessage` antes dos dois destinos: o `beforeSend`
 * do Sentry é a segunda camada (`lib/sentry/scrub.ts`), não a única. Código
 * (`PGRST…`, `57014`) e o passo (a tabela) não são dado de pessoa. Telefone,
 * e-mail e token não entram no contexto.
 */
export function detalheDoErro(erro: unknown): { message: string; code?: string } {
  if (erro instanceof ErroDeConsulta) {
    return erro.code
      ? { message: scrubMessage(erro.message), code: erro.code }
      : { message: scrubMessage(erro.message) };
  }
  if (erro && typeof erro === "object") {
    const o = erro as { message?: unknown; code?: unknown };
    const bruto = typeof o.message === "string" ? o.message : String(erro);
    const message = scrubMessage(bruto);
    return typeof o.code === "string" ? { message, code: o.code } : { message };
  }
  return { message: scrubMessage(erro instanceof Error ? erro.message : String(erro)) };
}

export function registrarFalhaDeLeitura(
  msg: string,
  ctx: {
    subsystem: string;
    step?: string;
    organization_id?: string;
    requestId?: string;
    contatos?: number;
  },
  erro: unknown,
): void {
  const detalhe = detalheDoErro(erro);
  const step = erro instanceof ErroDeConsulta ? erro.step : ctx.step;
  logger.error(msg, {
    subsystem: ctx.subsystem,
    ...(step ? { step } : {}),
    message: detalhe.message,
    ...(detalhe.code ? { code: detalhe.code } : {}),
    ...(ctx.organization_id ? { organization_id: ctx.organization_id } : {}),
    ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
    ...(ctx.contatos !== undefined ? { contatos: ctx.contatos } : {}),
  });
  void import("@sentry/nextjs")
    .then((Sentry) => {
      try {
        Sentry.captureException(new Error(detalhe.message), {
          level: "error",
          tags: {
            subsystem: ctx.subsystem,
            ...(step ? { step } : {}),
            ...(detalhe.code ? { code: detalhe.code } : {}),
          },
          extra: {
            organization_id: ctx.organization_id,
            requestId: ctx.requestId,
          },
        });
      } catch {
        /* Sentry sem init (teste, boot) — o logger acima já registrou */
      }
    })
    .catch(() => {
      /* sem o pacote: o logger é o que resta */
    });
}
