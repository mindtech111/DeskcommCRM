"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { BulkLeadActionInput } from "@/lib/schemas/leads";
import { liberarEcoLocal, marcarEcoLocal } from "@/lib/kanban/local-echo";
import { LEADS_POR_ATRIBUICAO, lotesDeIds } from "@/lib/kanban/selecao";

export function useBulkAction(pipelineId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: BulkLeadActionInput) => {
      // O terceiro caminho de mutação — e o que eu tinha esquecido: sem marcar
      // aqui, a aba de quem executou a ação em massa pulsava junto com as
      // outras, como se a própria ação fosse novidade vinda de fora.
      for (const leadId of input.lead_ids) marcarEcoLocal(leadId);

      // A rota recusa acima de 50 ids por chamada, e "selecionar a etapa
      // inteira" passou a tornar isso comum: sem a quebra, uma etapa de 80
      // cards devolvia `bulk_too_large` — um erro sobre um limite que a tela
      // nunca mostrou. Quebrar no cliente mantém as MESMAS validações e o mesmo
      // gate de papel no servidor, uma vez por lote.
      //
      // O preço é honesto e está declarado na mensagem abaixo: cada lote é
      // atômico, o conjunto de lotes não. Um erro no terceiro de cinco deixa
      // dois aplicados — e quem executou fica sabendo QUANTOS, em vez de
      // receber só "deu erro" e ter de contar os cards na mão.
      //
      // Exceção: trocar o dono (`assign`/`unassign`) vai numa chamada SÓ, até
      // 1000 — o banco aplica tudo ou nada (migration 0689). Era exatamente o
      // "dois de cinco aplicados" acima que deixava um funil meio reatribuído.
      const trocaDeDono = input.action === "assign" || input.action === "unassign";
      const lotes = lotesDeIds(input.lead_ids, trocaDeDono ? LEADS_POR_ATRIBUICAO : undefined);
      let aplicados = 0;
      for (const lead_ids of lotes) {
        try {
          const resposta = await apiClient.post<{ data: { updated_count: number } }>(
            "/api/v1/leads/bulk",
            { ...input, lead_ids } as BulkLeadActionInput,
          );
          aplicados += resposta.data.updated_count;
        } catch (erro) {
          if (lotes.length > 1) {
            toast.warning(
              `${aplicados} de ${input.lead_ids.length} já haviam sido alterados — o restante não foi.`,
            );
          }
          throw erro;
        }
      }
      return { data: { updated_count: aplicados } };
    },
    onError: showApiError,
    onSettled: (_data, _err, input) => {
      for (const leadId of input.lead_ids) liberarEcoLocal(leadId);
      qc.invalidateQueries({ queryKey: ["board", pipelineId] });
    },
  });
}
