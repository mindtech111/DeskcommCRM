/**
 * Meta da clínica contra o realizado do painel.
 *
 * A conta do realizado continua em `fn_painel_diario`. Aqui só se escolhe o
 * alvo proporcional e se casa o valor com a moeda. Sem meta, o alvo é `null`
 * — a tela mostra o realizado e convida a definir, em vez de desenhar barra
 * em cima de zero fingido.
 *
 * Leads atendidos = leads que chegaram na janela (`leads_novos.total`). É o
 * mesmo número do card Leads novos: a meta não inventa uma segunda contagem.
 * Agendamentos, consultas realizadas e vendas são os mesmos campos do retrato.
 *
 * Proporção: a meta diária vezes a duração real da janela (hoje é uma fração
 * do dia). Nos 30 dias, se existe meta do mês, ela substitui a diária e entra
 * na proporção da janela sobre o mês civil. Sem diária, a mensal vale em
 * qualquer período, do mesmo jeito.
 */
import { z } from "zod";

import type { RetratoDoPainel } from "@/lib/metrics/painel";
import type { PeriodoPainel } from "@/lib/metrics/painel-periodo";

const inteiroOuNulo = z
  .union([z.number().int().nonnegative(), z.null()])
  .nullable()
  .optional()
  .transform((v) => v ?? null);

const centsOuNulo = z
  .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)])
  .nullable()
  .optional()
  .transform((v) => {
    if (v == null) return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isSafeInteger(n) ? n : null;
  });

export const metasGravadasSchema = z.object({
  leads_atendidos_dia: inteiroOuNulo,
  agendamentos_dia: inteiroOuNulo,
  consultas_realizadas_dia: inteiroOuNulo,
  vendas_dia: inteiroOuNulo,
  valor_cents_dia: centsOuNulo,
  leads_atendidos_mes: inteiroOuNulo,
  agendamentos_mes: inteiroOuNulo,
  consultas_realizadas_mes: inteiroOuNulo,
  vendas_mes: inteiroOuNulo,
  valor_cents_mes: centsOuNulo,
  moeda: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});

export type MetasGravadas = z.infer<typeof metasGravadasSchema>;

const tetoContagem = 1_000_000;
const tetoCents = 9_000_000_000_000_00;

export const gravarMetasSchema = z
  .object({
    leads_atendidos_dia: z.number().int().nonnegative().max(tetoContagem).nullable(),
    agendamentos_dia: z.number().int().nonnegative().max(tetoContagem).nullable(),
    consultas_realizadas_dia: z.number().int().nonnegative().max(tetoContagem).nullable(),
    vendas_dia: z.number().int().nonnegative().max(tetoContagem).nullable(),
    valor_cents_dia: z.number().int().nonnegative().max(tetoCents).nullable(),
    leads_atendidos_mes: z.number().int().nonnegative().max(tetoContagem).nullable(),
    agendamentos_mes: z.number().int().nonnegative().max(tetoContagem).nullable(),
    consultas_realizadas_mes: z.number().int().nonnegative().max(tetoContagem).nullable(),
    vendas_mes: z.number().int().nonnegative().max(tetoContagem).nullable(),
    valor_cents_mes: z.number().int().nonnegative().max(tetoCents).nullable(),
    moeda: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
  })
  .strict()
  .superRefine((valor, ctx) => {
    const temValor = valor.valor_cents_dia != null || valor.valor_cents_mes != null;
    if (temValor && valor.moeda == null) {
      ctx.addIssue({ code: "custom", path: ["moeda"], message: "moeda" });
    }
  });

export type CorpoDasMetas = z.infer<typeof gravarMetasSchema>;

const DIA_MS = 86_400_000;

/**
 * Alvo da janela. `null` quando não há meta para escalar.
 * `janelaMs` é a duração real (hoje não é o dia inteiro).
 * `mesMs` é o mês civil corrente no fuso do painel.
 */
export function alvoProporcional(
  dia: number | null,
  mes: number | null,
  periodo: PeriodoPainel,
  janelaMs: number,
  mesMs: number,
): number | null {
  if (janelaMs < 0 || mesMs <= 0) return null;
  if (periodo === "30d" && mes != null) return mes * (janelaMs / mesMs);
  if (dia != null) return dia * (janelaMs / DIA_MS);
  if (mes != null) return mes * (janelaMs / mesMs);
  return null;
}

export function algumaMetaDefinida(metas: MetasGravadas | null): boolean {
  if (!metas) return false;
  return (
    metas.leads_atendidos_dia != null ||
    metas.agendamentos_dia != null ||
    metas.consultas_realizadas_dia != null ||
    metas.vendas_dia != null ||
    metas.valor_cents_dia != null ||
    metas.leads_atendidos_mes != null ||
    metas.agendamentos_mes != null ||
    metas.consultas_realizadas_mes != null ||
    metas.vendas_mes != null ||
    metas.valor_cents_mes != null
  );
}

export interface ValorComparavel {
  /** Centavos na moeda escolhida. 0 quando a moeda está definida e não houve venda nela. */
  realizado_cents: number;
  moeda: string | null;
  /**
   * Dá para pôr o realizado ao lado da meta. Falso quando há mais de uma moeda
   * no período e a meta não escolheu uma — somar misturaria unidades.
   */
  comparavel: boolean;
}

export function valorRealizado(
  retrato: RetratoDoPainel,
  moedaDaMeta: string | null,
): ValorComparavel {
  const linhas = retrato.vendas.por_moeda;
  if (moedaDaMeta) {
    const linha = linhas.find((l) => l.moeda === moedaDaMeta);
    return { realizado_cents: linha?.valor_cents ?? 0, moeda: moedaDaMeta, comparavel: true };
  }
  if (linhas.length === 1 && linhas[0]?.moeda) {
    return {
      realizado_cents: linhas[0].valor_cents,
      moeda: linhas[0].moeda,
      comparavel: true,
    };
  }
  if (linhas.length === 0) {
    return { realizado_cents: 0, moeda: null, comparavel: false };
  }
  return { realizado_cents: 0, moeda: null, comparavel: false };
}

export interface IndicadorDeMeta {
  id: "leads_atendidos" | "agendamentos" | "consultas_realizadas" | "vendas" | "valor";
  realizado: number;
  alvo: number | null;
  moeda: string | null;
  /** Há vendas em moedas diferentes e a meta não escolheu uma. */
  aviso: "moedas" | null;
}

export interface BlocoDeMetas {
  gravadas: MetasGravadas | null;
  definida: boolean;
  indicadores: IndicadorDeMeta[];
}

export function blocoDeMetas(
  gravadas: MetasGravadas | null,
  retrato: RetratoDoPainel,
  periodo: PeriodoPainel,
  janelaMs: number,
  mesMs: number,
): BlocoDeMetas {
  const g = gravadas;
  const temMetaDeValor =
    (g?.valor_cents_dia ?? null) != null || (g?.valor_cents_mes ?? null) != null;
  // Moeda gravada sem alvo de valor não filtra o realizado: senão uma venda
  // em outra moeda aparece como zero depois que a meta de valor foi apagada.
  const valor = valorRealizado(retrato, temMetaDeValor ? (g?.moeda ?? null) : null);
  const alvoDe = (dia: number | null, mes: number | null) =>
    alvoProporcional(dia, mes, periodo, janelaMs, mesMs);
  const base = {
    aviso: null,
  } as const;
  const indicadores: IndicadorDeMeta[] = [
    {
      ...base,
      id: "leads_atendidos",
      realizado: retrato.leads_novos.total,
      alvo: alvoDe(g?.leads_atendidos_dia ?? null, g?.leads_atendidos_mes ?? null),
      moeda: null,
    },
    {
      ...base,
      id: "agendamentos",
      realizado: retrato.consultas.agendadas,
      alvo: alvoDe(g?.agendamentos_dia ?? null, g?.agendamentos_mes ?? null),
      moeda: null,
    },
    {
      ...base,
      id: "consultas_realizadas",
      realizado: retrato.consultas.realizadas,
      alvo: alvoDe(g?.consultas_realizadas_dia ?? null, g?.consultas_realizadas_mes ?? null),
      moeda: null,
    },
    {
      ...base,
      id: "vendas",
      realizado: retrato.vendas.quantidade,
      alvo: alvoDe(g?.vendas_dia ?? null, g?.vendas_mes ?? null),
      moeda: null,
    },
    {
      id: "valor",
      realizado: valor.comparavel ? valor.realizado_cents : 0,
      alvo: valor.comparavel
        ? alvoDe(g?.valor_cents_dia ?? null, g?.valor_cents_mes ?? null)
        : null,
      moeda: valor.moeda,
      aviso:
        !valor.comparavel && (temMetaDeValor || retrato.vendas.por_moeda.length > 1)
          ? "moedas"
          : null,
    },
  ];
  return { gravadas: g, definida: algumaMetaDefinida(g), indicadores };
}

/** Fração realizado/alvo. `null` quando não há alvo positivo para dividir. */
export function progresso(realizado: number, alvo: number | null): number | null {
  if (alvo == null || alvo <= 0) return null;
  return realizado / alvo;
}

/** Meta fracionária (hoje ainda não acabou) com no máximo uma casa. */
export function textoDaMeta(n: number): string {
  const arred = Math.round(n * 10) / 10;
  if (Number.isInteger(arred)) return String(arred);
  return arred.toFixed(1).replace(".", ",");
}

/** Centavos de volta para o campo, no formato que `parseReaisToCents` lê. */
export function textoDeCents(cents: number | null): string {
  if (cents == null) return "";
  const inteiro = Math.trunc(cents / 100);
  const frac = Math.abs(cents % 100);
  if (frac === 0) return String(inteiro);
  return `${inteiro},${String(frac).padStart(2, "0")}`;
}
