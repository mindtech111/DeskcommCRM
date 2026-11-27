import type { QueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { FRESCURA_DA_TELA_MS } from "@/lib/query/frescura";

import type { ConversationWithContact } from "./useConversationsRealtime";

/**
 * Conversa e primeira página de mensagens, no mesmo formato que os hooks leem.
 *
 * O `prefetch` não refaz o que ainda está fresco, e duas linhas apontadas em
 * sequência não disparam a mesma chave duas vezes.
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
  void qc.prefetchInfiniteQuery({
    queryKey: ["messages", id],
    staleTime: FRESCURA_DA_TELA_MS,
    initialPageParam: undefined as string | undefined,
    queryFn: () => {
      const qs = new URLSearchParams();
      qs.set("limit", "50");
      return apiClient.get(`/api/v1/conversations/${id}/messages?${qs.toString()}`);
    },
  });
}
