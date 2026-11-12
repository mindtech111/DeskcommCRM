/**
 * Uma renovação de sessão por vez, com intervalo mínimo.
 *
 * O cookie de sessão é httpOnly: o supabase-js do browser não enxerga o
 * refresh token, e o auto-refresh padrão dispara `/auth/v1/token` sem ele —
 * o GoTrue responde 400/429 e o cliente tenta de novo. Quem ainda precisa
 * renovar (aba aberta por horas) passa por ESTE portão: chamadas
 * sobrepostas compartilham a mesma promessa, e uma 429 empurra a próxima
 * para mais tarde em vez de martelar.
 */

export interface OpcoesDoPortao {
  agora?: () => number;
  /** Depois de uma renovação que não foi 429. */
  intervaloMinimoMs?: number;
  /** Depois de 429. Maior que o intervalo mínimo. */
  recuoDe429Ms?: number;
}

const INTERVALO_MINIMO_MS = 60_000;
const RECUO_DE_429_MS = 5 * 60_000;

export function criarPortaoDeRenovacao(opcoes: OpcoesDoPortao = {}) {
  const agora = opcoes.agora ?? Date.now;
  const intervaloMinimoMs = opcoes.intervaloMinimoMs ?? INTERVALO_MINIMO_MS;
  const recuoDe429Ms = opcoes.recuoDe429Ms ?? RECUO_DE_429_MS;
  let emVoo: Promise<unknown> | null = null;
  let liberarEm = 0;

  return function renovar<T>(fn: () => Promise<T>): Promise<T | undefined> {
    if (emVoo) return emVoo as Promise<T>;
    if (agora() < liberarEm) return Promise.resolve(undefined);
    const p = fn()
      .then((resultado) => {
        const status = (resultado as { error?: { status?: number } } | null)?.error?.status;
        liberarEm = agora() + (status === 429 ? recuoDe429Ms : intervaloMinimoMs);
        return resultado;
      })
      .finally(() => {
        emVoo = null;
      });
    emVoo = p;
    return p;
  };
}
