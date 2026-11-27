import type { QueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { FRESCURA_DA_TELA_MS } from "@/lib/query/frescura";

import type { Message } from "@/lib/types/messaging";

import type { ConversationWithContact } from "./useConversationsRealtime";

interface PaginaDeMensagens {
  data: Message[];
  meta?: { cursor?: string | null; has_more?: boolean };
}

/** A mesma primeira página que `useMessagesRealtime` pede, cursor inclusive. */
export function buscarPaginaDeMensagens(id: string, cursor?: string) {
  const qs = new URLSearchParams();
  if (cursor) qs.set("cursor", cursor);
  qs.set("limit", "50");
  return apiClient.get<PaginaDeMensagens>(`/api/v1/conversations/${id}/messages?${qs.toString()}`);
}

/**
 * Conversa e, se ainda não há histórico em cache, a primeira página de mensagens.
 *
 * Não re-prefetch da lista infinita quando ela já tem páginas. No TanStack
 * Query 5 um prefetch sem `getNextPageParam` tenta refazer TODAS as páginas
 * em cache e falha na segunda — e o fio aberto troca o histórico por
 * "Erro ao carregar mensagens". Quem já carregou o passado continua com ele;
 * a visita seguinte usa o `queryFn` do hook, que conhece o cursor.
 */
export function precarregarConversa(qc: QueryClient, id: string) {
  void qc.prefetchQuery({
    queryKey: ["conversation", id],
    staleTime: FRESCURA_DA_TELA_MS,
    queryFn: () =>
      apiClient
        .get<{ data: ConversationWithContact }>(`/api/v1/conversations/${id}`)
        .then((r) => r.data),
  });
  if (qc.getQueryData(["messages", id])) return;
  void qc.prefetchInfiniteQuery({
    queryKey: ["messages", id],
    staleTime: FRESCURA_DA_TELA_MS,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => buscarPaginaDeMensagens(id, pageParam),
    getNextPageParam: (last: PaginaDeMensagens) =>
      last.meta?.has_more && last.meta.cursor ? last.meta.cursor : undefined,
  });
}
