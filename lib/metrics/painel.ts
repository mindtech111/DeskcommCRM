/**
 * Forma do retrato que `fn_painel_diario` devolve, e a comparação entre as
 * duas janelas. A conta mora no banco; aqui só se lê o contrato e se mede a
 * diferença — ausência continua `null`, nunca 0 fingindo medição.
 */
import { z } from "zod";

const inteiro = z.number().int();

const linhaDeOrigem = z.object({
  origem: z.string(),
  total: inteiro,
});

const linhaDeCampanhaDeLead = z.object({
  campanha: z.string(),
  origem: z.string(),
  total: inteiro,
});

const linhaDeMoeda = z.object({
  moeda: z.string().nullable(),
  quantidade: inteiro,
  valor_cents: z.number(),
});

const linhaDeClique = z.object({
  campanha: z.string(),
  cliques: inteiro,
  casaram_contato: inteiro,
  casaram_lead: inteiro,
});

const linhaDeLink = z.object({
  id: z.string().uuid(),
  nome: z.string(),
  cliques: inteiro,
  casaram_contato: inteiro,
  casaram_lead: inteiro,
});

export const retratoSchema = z.object({
  leads_novos: z.object({
    total: inteiro,
    sem_campanha: inteiro,
    por_campanha_truncada: z.boolean(),
    por_origem: z.array(linhaDeOrigem),
    por_campanha: z.array(linhaDeCampanhaDeLead),
  }),
  conversas: z.object({
    com_mensagem_recebida: inteiro,
    mensagens_recebidas: inteiro,
  }),
  consultas: z.object({
    agendadas: inteiro,
    realizadas: inteiro,
  }),
  vendas: z.object({
    quantidade: inteiro,
    por_moeda: z.array(linhaDeMoeda),
  }),
  resposta: z.object({
    amostra: inteiro,
    respondidas: inteiro,
    taxa: z.number().nullable(),
    p50_segundos: z.number().nullable(),
  }),
  rastreio: z.object({
    cliques: inteiro,
    casaram_contato: inteiro,
    casaram_lead: inteiro,
    por_campanha_truncada: z.boolean(),
    por_campanha: z.array(linhaDeClique),
    por_link_truncada: z.boolean(),
    por_link: z.array(linhaDeLink),
  }),
  meta: z.object({
    conectado: z.boolean(),
    gasto_cents: z.number().nullable(),
    custo_por_lead_cents: z.number().nullable(),
    moeda: z.string().nullable(),
    motivo: z.string().nullable(),
  }),
});

export type RetratoDoPainel = z.infer<typeof retratoSchema>;

export interface Delta {
  atual: number | null;
  anterior: number | null;
  absoluto: number | null;
  /**
   * `null` quando não há base: um lado não foi medido, ou o anterior é 0
   * (o percentual seria infinito e a tela mostraria um salto que não existe).
   */
  percentual: number | null;
}

export function comparar(atual: number | null, anterior: number | null): Delta {
  if (atual == null || anterior == null) {
    return { atual, anterior, absoluto: null, percentual: null };
  }
  const absoluto = atual - anterior;
  const percentual = anterior === 0 ? null : absoluto / anterior;
  return { atual, anterior, absoluto, percentual };
}

export interface ComparacaoDoRetrato {
  leads: Delta;
  mensagens: Delta;
  conversas: Delta;
  consultas_agendadas: Delta;
  consultas_realizadas: Delta;
  vendas: Delta;
  taxa_resposta: Delta;
  p50_segundos: Delta;
  cliques: Delta;
  casaram_contato: Delta;
  casaram_lead: Delta;
}

export function compararRetratos(
  atual: RetratoDoPainel,
  anterior: RetratoDoPainel,
): ComparacaoDoRetrato {
  return {
    leads: comparar(atual.leads_novos.total, anterior.leads_novos.total),
    mensagens: comparar(
      atual.conversas.mensagens_recebidas,
      anterior.conversas.mensagens_recebidas,
    ),
    conversas: comparar(
      atual.conversas.com_mensagem_recebida,
      anterior.conversas.com_mensagem_recebida,
    ),
    consultas_agendadas: comparar(atual.consultas.agendadas, anterior.consultas.agendadas),
    consultas_realizadas: comparar(atual.consultas.realizadas, anterior.consultas.realizadas),
    vendas: comparar(atual.vendas.quantidade, anterior.vendas.quantidade),
    taxa_resposta: comparar(atual.resposta.taxa, anterior.resposta.taxa),
    p50_segundos: comparar(atual.resposta.p50_segundos, anterior.resposta.p50_segundos),
    cliques: comparar(atual.rastreio.cliques, anterior.rastreio.cliques),
    casaram_contato: comparar(atual.rastreio.casaram_contato, anterior.rastreio.casaram_contato),
    casaram_lead: comparar(atual.rastreio.casaram_lead, anterior.rastreio.casaram_lead),
  };
}

/** Retrato vazio medido — útil para o teste da rota e para um período sem linhas. */
export function retratoVazio(): RetratoDoPainel {
  return {
    leads_novos: {
      total: 0,
      sem_campanha: 0,
      por_campanha_truncada: false,
      por_origem: [],
      por_campanha: [],
    },
    conversas: { com_mensagem_recebida: 0, mensagens_recebidas: 0 },
    consultas: { agendadas: 0, realizadas: 0 },
    vendas: { quantidade: 0, por_moeda: [] },
    resposta: { amostra: 0, respondidas: 0, taxa: null, p50_segundos: null },
    rastreio: {
      cliques: 0,
      casaram_contato: 0,
      casaram_lead: 0,
      por_campanha_truncada: false,
      por_campanha: [],
      por_link_truncada: false,
      por_link: [],
    },
    meta: {
      conectado: false,
      gasto_cents: null,
      custo_por_lead_cents: null,
      moeda: null,
      motivo: "sem_conexao",
    },
  };
}
