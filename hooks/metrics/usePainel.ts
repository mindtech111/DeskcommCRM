"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { FRESCURA_DA_TELA_MS } from "@/lib/query/frescura";
import type { FunilDoPainel, PessoaDaEquipe } from "@/lib/metrics/painel-comercial";
import type { BlocoDeMetas } from "@/lib/metrics/painel-metas";
import type { ComparacaoDoRetrato, RetratoDoPainel } from "@/lib/metrics/painel";
import type { JanelaPainel, PeriodoPainel } from "@/lib/metrics/painel-periodo";

export interface RespostaDoPainel {
  periodo: PeriodoPainel;
  fuso: string;
  atual: JanelaPainel & RetratoDoPainel;
  anterior: JanelaPainel & RetratoDoPainel;
  comparacao: ComparacaoDoRetrato;
  funil: FunilDoPainel;
  equipe: {
    truncada: boolean;
    pessoas: PessoaDaEquipe[];
    sem_responsavel: {
      leads_recebidos: number;
      agendamentos: number;
      consultas_realizadas: number;
      vendas: number;
      valor_por_moeda: Array<{ moeda: string | null; quantidade: number; valor_cents: number }>;
    };
  };
  metas: BlocoDeMetas;
}

export function chaveDoPainel(periodo: PeriodoPainel) {
  return ["metrics", "painel", periodo] as const;
}

function consultaDoPainel(periodo: PeriodoPainel) {
  return apiClient.get<{ data: RespostaDoPainel }>(`/api/v1/metrics/painel?periodo=${periodo}`, {
    timeoutMs: 20_000,
  });
}

/** Ao apontar Hoje / 7 dias / 30 dias, a troca não espera a rede. */
export function precarregarPainel(qc: QueryClient, periodo: PeriodoPainel) {
  void qc.prefetchQuery({
    queryKey: chaveDoPainel(periodo),
    queryFn: () => consultaDoPainel(periodo),
    staleTime: FRESCURA_DA_TELA_MS,
  });
}

/**
 * Retrato do dia, refeito a cada minuto. A janela mora na rota.
 *
 * `staleTime` e `refetchInterval` não competem: o intervalo busca de novo
 * mesmo com o dado fresco (ver `lib/query/frescura.ts`). A frescura só evita
 * outra leitura ao sair e voltar para o painel dentro de um minuto.
 */
export function usePainel(periodo: PeriodoPainel) {
  return useQuery({
    queryKey: chaveDoPainel(periodo),
    queryFn: () => consultaDoPainel(periodo),
    staleTime: FRESCURA_DA_TELA_MS,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}
