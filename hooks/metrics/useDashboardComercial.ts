"use client";

import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { FRESCURA_DA_TELA_MS } from "@/lib/query/frescura";

import type { FiltroComercial, Oportunidade, RespostaComercial } from "./usePainelComercial";

export interface RespostaDashboard extends Omit<RespostaComercial, "prioridades"> {
  prioridades: Array<Oportunidade & { interesse: string | null }>;
  anterior: {
    inicio: string;
    fim: string;
    kpis: RespostaComercial["kpis"];
    funil_topo: number | null;
    funil_fim: number | null;
  };
  extra: {
    ciclo_medio_dias: number | null;
    meta_mensal_cents: number | null;
    vendas_mes: { quantidade: number; valor_cents: number };
  };
}

export function useDashboardComercial(f: FiltroComercial) {
  return useQuery({
    queryKey: ["metrics", "dashboard", f.inicio, f.fim, f.pipeline] as const,
    queryFn: () => {
      const q = new URLSearchParams({ inicio: f.inicio, fim: f.fim });
      if (f.pipeline) q.set("pipeline", f.pipeline);
      return apiClient.get<{ data: RespostaDashboard }>(`/api/v1/metrics/dashboard?${q}`, { timeoutMs: 25_000 });
    },
    staleTime: FRESCURA_DA_TELA_MS,
    refetchInterval: 120_000,
    placeholderData: (anterior) => anterior,
  });
}
