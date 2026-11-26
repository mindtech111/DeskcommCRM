"use client";

import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { ComparacaoDoRetrato, RetratoDoPainel } from "@/lib/metrics/painel";
import type { JanelaPainel, PeriodoPainel } from "@/lib/metrics/painel-periodo";

export interface RespostaDoPainel {
  periodo: PeriodoPainel;
  fuso: string;
  atual: JanelaPainel & RetratoDoPainel;
  anterior: JanelaPainel & RetratoDoPainel;
  comparacao: ComparacaoDoRetrato;
}

/** Retrato do dia, refeito a cada minuto. A janela mora na rota. */
export function usePainel(periodo: PeriodoPainel) {
  return useQuery({
    queryKey: ["metrics", "painel", periodo],
    queryFn: () =>
      apiClient.get<{ data: RespostaDoPainel }>(`/api/v1/metrics/painel?periodo=${periodo}`, {
        timeoutMs: 20_000,
      }),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}
