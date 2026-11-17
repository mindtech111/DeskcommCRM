/**
 * A aritmética da seleção múltipla no quadro — pura, sem React.
 *
 * Mora aqui e não no componente porque é a parte que erra em silêncio: um
 * intervalo invertido (clicar de baixo para cima) devolve lista vazia, uma
 * âncora que saiu da coluna (filtro, card movido por outra pessoa) devolve
 * `undefined` no meio do slice, e nenhum dos dois aparece na tela como erro —
 * aparecem como "não selecionou nada", que se lê como clique perdido.
 */

/** Quanto o lote de UMA chamada à API pode levar (o handler recusa acima de 50). */
export const LEADS_POR_REQUISICAO = 50;

/**
 * Teto da troca de dono em lote (`assign`/`unassign`), que é UMA escrita só no
 * banco (`fn_atribuir_leads_em_lote`, migration 0689) — tudo ou nada.
 *
 * Não se quebra em lotes de 50 como as outras ações: quebrar é o que deixava
 * parte do funil reatribuída e parte não quando uma chamada do meio falhava
 * (incidente de 09/11/2026). 1000 é o `max_rows` do PostgREST deste produto, o
 * maior quadro que a tela consegue carregar — logo, a maior seleção possível.
 */
export const LEADS_POR_ATRIBUICAO = 1000;

/**
 * Quebra a seleção em lotes do tamanho que a API aceita.
 *
 * Extraído de `lib/kanban/bulk-action.ts` do PR #418 (@clinicacentrodosorrisosc-code):
 * com "selecionar a etapa inteira" na tela, passar de 50 deixou de ser hipótese
 * — uma etapa de 80 cards é uma tarde normal —, e sem a quebra a barra devolvia
 * `bulk_too_large` para o usuário como se ele tivesse feito algo errado.
 */
export function lotesDeIds<T>(ids: readonly T[], tamanho: number = LEADS_POR_REQUISICAO): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < ids.length; i += tamanho) {
    lotes.push(ids.slice(i, i + tamanho));
  }
  return lotes;
}

/**
 * Os ids entre a âncora e o alvo, inclusive, na ordem em que a coluna os mostra.
 *
 * `ordenados` é a coluna INTEIRA já filtrada e ordenada como o usuário a vê —
 * é o que faz o intervalo ser "o que está entre os dois na tela", e não "o que
 * está entre os dois no banco". Âncora ausente (ou igual ao alvo) devolve só o
 * alvo: é o comportamento previsível para shift+clique sem seleção anterior.
 */
export function intervaloDaColuna(
  ordenados: readonly string[],
  ancoraId: string | null,
  alvoId: string,
): string[] {
  const alvo = ordenados.indexOf(alvoId);
  if (alvo < 0) return [];
  const ancora = ancoraId == null ? -1 : ordenados.indexOf(ancoraId);
  if (ancora < 0) return [alvoId];
  const inicio = Math.min(ancora, alvo);
  const fim = Math.max(ancora, alvo);
  return ordenados.slice(inicio, fim + 1);
}
