/**
 * Quanto tempo a tela quente reaproveita o que já leu ao trocar de rota.
 *
 * O realtime e a rede de segurança (`useRefetchDeSeguranca`) invalidam quando
 * chega fato novo. Esta janela só impede o refetch completo na volta: dentro
 * dela o cache ainda vale, e a troca de item da lista mostra o que o prefetch
 * já trouxe.
 *
 * Não cala o relógio do painel. No TanStack Query 5.104 o `refetchInterval`
 * chama `fetch()` direto (`queryObserver.ts`, `#updateRefetchInterval`), sem
 * olhar `staleTime`. staleTime segura montagem e foco; o intervalo segue.
 */
export const FRESCURA_DA_TELA_MS = 60_000;
