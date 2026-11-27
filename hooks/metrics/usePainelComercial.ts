"use client";

import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { FRESCURA_DA_TELA_MS } from "@/lib/query/frescura";

export interface EtapaDoFunil {
  etapa_id: string;
  nome: string;
  degrau: number;
  ganho: boolean;
  probabilidade: number | null;
  chegaram: number;
  agora: number;
}

export interface LinhaDeCanal {
  canal: string;
  leads: number;
  agendamentos: number | null;
  vendas: number;
  valor_cents: number;
}

export interface LinhaDeAnuncio extends LinhaDeCanal {
  anuncio: string;
}

export interface Oportunidade {
  lead_id: string;
  titulo: string | null;
  contato: string | null;
  etapa: string | null;
  probabilidade: number | null;
  valor_cents: number | null;
  responsavel: string | null;
  ultimo_contato: string | null;
  dias_sem_contato: number | null;
  proxima_tarefa: { titulo: string; quando: string | null } | null;
}

export interface RespostaComercial {
  janela: { inicio: string; fim: string; fuso: string };
  pipeline: { id: string; nome: string };
  pipelines: Array<{ id: string; nome: string; padrao: boolean }>;
  kpis: {
    leads: number;
    agendamentos: number | null;
    comparecimentos: number | null;
    vendas: number;
    vendas_da_safra: number;
    faturamento_cents: number;
    vendas_com_valor: number;
    pipeline_aberto_cents: number;
    abertos: number;
    abertos_com_valor: number;
    previsao_cents: number;
    abertos_sem_responsavel: number;
    perdidos: number;
  };
  funil: EtapaDoFunil[];
  laterais: Array<{ etapa_id: string; nome: string; perda: boolean; agora: number }>;
  canais: LinhaDeCanal[];
  anuncios: LinhaDeAnuncio[];
  sem_anuncio: number;
  diario: Array<{ dia: string; leads: number; agendamentos: number; vendas: number }>;
  prioridades: Oportunidade[];
  perdas: Array<{ motivo: string; total: number }>;
}

export interface FiltroComercial {
  inicio: string;
  fim: string;
  pipeline: string | null;
}

export function usePainelComercial(f: FiltroComercial) {
  return useQuery({
    queryKey: ["metrics", "painel", "comercial", f.inicio, f.fim, f.pipeline] as const,
    queryFn: () => {
      const q = new URLSearchParams({ inicio: f.inicio, fim: f.fim });
      if (f.pipeline) q.set("pipeline", f.pipeline);
      return apiClient.get<{ data: RespostaComercial }>(`/api/v1/metrics/painel/comercial?${q}`, {
        timeoutMs: 25_000,
      });
    },
    staleTime: FRESCURA_DA_TELA_MS,
    refetchInterval: 120_000,
    placeholderData: (anterior) => anterior,
  });
}
