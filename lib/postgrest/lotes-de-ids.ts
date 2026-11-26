/**
 * Lista de ids dentro de `.in()` vai na querystring do PostgREST.
 *
 * Um uuid custa ~37 bytes. Medido em produção (imagem 1.85.0-mt.8): ~500 ids
 * (~20 KB) passam; ~1000 ids (~39 KB) voltam 400 em `cron_jobs` e
 * `calendar_appointments`. O lote de 100 é o mesmo teto que o radar já usava
 * para o funil das demandas (`IDS_POR_CONSULTA` local) e que
 * `TAMANHO_DO_LOTE` usa nos crons de data.
 */

export const IDS_POR_CONSULTA = 100;

/**
 * Quantas listas saem ao mesmo tempo. Cada uma ainda paga a RLS; dez em
 * paralelo disputam o mesmo `statement_timeout`.
 */
export const CONSULTAS_EM_PARALELO = 4;

export class ErroDeConsulta extends Error {
  readonly step: string;
  readonly code: string | undefined;

  constructor(step: string, message: string, code?: string) {
    super(`${step}: ${message}`);
    this.name = "ErroDeConsulta";
    this.step = step;
    this.code = code;
  }
}

export function lotesDeIds<T>(ids: readonly T[], tamanho = IDS_POR_CONSULTA): T[][] {
  if (tamanho < 1) throw new Error("lote_invalido");
  const lotes: T[][] = [];
  for (let i = 0; i < ids.length; i += tamanho) lotes.push(ids.slice(i, i + tamanho));
  return lotes;
}

/**
 * Roda `consultar` em lotes, com no máximo `paralelismo` chamadas vivas.
 * A posição de cada lote na resposta é a posição na entrada.
 */
export async function mapEmLotes<T, R>(
  ids: readonly T[],
  consultar: (lote: readonly T[]) => Promise<R>,
  opts?: { tamanho?: number; paralelismo?: number },
): Promise<R[]> {
  const lotes = lotesDeIds(ids, opts?.tamanho ?? IDS_POR_CONSULTA);
  if (lotes.length === 0) return [];
  const paralelismo = Math.min(
    lotes.length,
    Math.max(1, opts?.paralelismo ?? CONSULTAS_EM_PARALELO),
  );
  const saida: R[] = new Array(lotes.length);
  let proximo = 0;
  async function trabalhador(): Promise<void> {
    for (;;) {
      const indice = proximo;
      proximo += 1;
      if (indice >= lotes.length) return;
      saida[indice] = await consultar(lotes[indice]!);
    }
  }
  await Promise.all(Array.from({ length: paralelismo }, () => trabalhador()));
  return saida;
}

type RespostaDeLote<T> = {
  data: T[] | null;
  error: { message?: string; code?: string } | null;
};

/** Uma consulta `.in(ids)` fatiada. Erro de qualquer lote sobe com a tabela. */
export async function consultarEmLotes<T>(
  ids: readonly string[],
  step: string,
  consultar: (lote: readonly string[]) => PromiseLike<RespostaDeLote<T>>,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const paginas = await mapEmLotes(ids, async (lote) => {
    const { data, error } = await consultar(lote);
    if (error) throw new ErroDeConsulta(step, error.message ?? step, error.code);
    return data ?? [];
  });
  return paginas.flat();
}

/** Junta páginas de linhas com `id`, ficando com a primeira ocorrência. */
export function juntarPorId<T extends { id: string }>(paginas: readonly (readonly T[])[]): T[] {
  const vistos = new Map<string, T>();
  for (const pagina of paginas) {
    for (const item of pagina) {
      if (!vistos.has(item.id)) vistos.set(item.id, item);
    }
  }
  return [...vistos.values()];
}
