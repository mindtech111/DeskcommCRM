/**
 * Memo curto de processo para contexto que não muda a cada clique.
 *
 * `platform_admins`, `user_organizations` e `fn_support_context` são estáveis
 * durante uma navegação e caros quando o banco está no limite. O `cache()` do
 * React já deduplica DENTRO da requisição; isto cobre a requisição SEGUINTE,
 * por poucos segundos. `getUser()` não entra aqui: a identidade da sessão
 * continua sendo perguntada ao Auth em toda requisição que autoriza.
 *
 * Em teste (VITEST) o memo fica desligado, senão um caso que revoga o vínculo
 * e lê de novo veria o valor do caso anterior. O teste deste arquivo liga o
 * memo na mão.
 */

const TTL_PADRAO_MS = 10_000;
const TETO_DE_CHAVES = 500;

interface Entrada {
  expira: number;
  valor: unknown;
}

const memo = new Map<string, Entrada>();
const emVoo = new Map<string, Promise<unknown>>();

export const TTL_CONTEXTO_ESTAVEL_MS = TTL_PADRAO_MS;

export function memoCurtoLigado(): boolean {
  return process.env.VITEST !== "true";
}

export function limparMemoCurto(): void {
  memo.clear();
  emVoo.clear();
}

export async function memoCurto<T>(
  chave: string,
  ler: () => Promise<T>,
  opcoes?: { ttlMs?: number; agora?: () => number; ligado?: boolean },
): Promise<T> {
  const ligado = opcoes?.ligado ?? memoCurtoLigado();
  if (!ligado) return ler();

  const agora = opcoes?.agora ?? Date.now;
  const ttlMs = opcoes?.ttlMs ?? TTL_PADRAO_MS;
  const t = agora();
  const hit = memo.get(chave);
  if (hit && hit.expira > t) return hit.valor as T;

  const pendente = emVoo.get(chave);
  if (pendente) return pendente as Promise<T>;

  const promessa = ler()
    .then((valor) => {
      memo.set(chave, { expira: agora() + ttlMs, valor });
      if (memo.size > TETO_DE_CHAVES) {
        const corte = agora();
        for (const [k, v] of memo) {
          if (v.expira <= corte) memo.delete(k);
        }
      }
      return valor;
    })
    .finally(() => {
      emVoo.delete(chave);
    });
  emVoo.set(chave, promessa);
  return promessa;
}
