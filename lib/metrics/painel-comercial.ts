/**
 * Forma do funil e do comparativo que `fn_painel_comercial` devolve.
 * O nome da pessoa não vem do banco: a rota acrescenta `nome` depois.
 */
import { z } from "zod";

const inteiro = z.number().int().nonnegative();
const taxa = z.number().nullable();

const moeda = z.object({
  moeda: z.string().nullable(),
  quantidade: inteiro,
  valor_cents: z.number(),
});

const etapaId = z.enum([
  "lead_novo",
  "em_atendimento",
  "consulta_agendada",
  "consulta_realizada",
  "ganho",
]);

export const funilSchema = z.object({
  etapas: z.array(z.object({ id: etapaId, total: inteiro })).length(5),
  conversoes: z.array(z.object({ de: etapaId, para: etapaId, taxa })).length(4),
});

const dia = z.object({
  dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  total: inteiro,
});

export const pessoaSchema = z.object({
  user_id: z.string().uuid(),
  papel: z.string().nullable(),
  leads_recebidos: inteiro,
  por_dia: z.array(dia),
  mensagens_enviadas: inteiro,
  p50_segundos: z.number().nullable(),
  amostra_resposta: inteiro,
  agendamentos: inteiro,
  consultas_realizadas: inteiro,
  vendas: inteiro,
  valor_por_moeda: z.array(moeda),
  conversao: z.number().nullable(),
});

const semResponsavelSchema = z.object({
  leads_recebidos: inteiro,
  agendamentos: inteiro,
  consultas_realizadas: inteiro,
  vendas: inteiro,
  valor_por_moeda: z.array(moeda),
});

export const comercialSchema = z.object({
  funil: funilSchema,
  equipe: z.object({
    truncada: z.boolean(),
    pessoas: z.array(pessoaSchema),
    sem_responsavel: semResponsavelSchema,
  }),
});

export type FunilDoPainel = z.infer<typeof funilSchema>;
export type PessoaDaEquipe = z.infer<typeof pessoaSchema> & { nome: string | null };
export type ComercialDoPainel = z.infer<typeof comercialSchema>;

export function comercialVazio(): ComercialDoPainel {
  return {
    funil: {
      etapas: [
        { id: "lead_novo", total: 0 },
        { id: "em_atendimento", total: 0 },
        { id: "consulta_agendada", total: 0 },
        { id: "consulta_realizada", total: 0 },
        { id: "ganho", total: 0 },
      ],
      conversoes: [
        { de: "lead_novo", para: "em_atendimento", taxa: null },
        { de: "em_atendimento", para: "consulta_agendada", taxa: null },
        { de: "consulta_agendada", para: "consulta_realizada", taxa: null },
        { de: "consulta_realizada", para: "ganho", taxa: null },
      ],
    },
    equipe: {
      truncada: false,
      pessoas: [],
      sem_responsavel: {
        leads_recebidos: 0,
        agendamentos: 0,
        consultas_realizadas: 0,
        vendas: 0,
        valor_por_moeda: [],
      },
    },
  };
}
