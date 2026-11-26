/**
 * Janelas do painel diário, no fuso de quem opera no Brasil.
 *
 * "Hoje" não é o dia UTC: meia-noite em São Paulo é 03:00 UTC, e uma tela
 * aberta às 22h ainda é "hoje" lá e já é "amanhã" no relógio do servidor.
 *
 * As duas janelas têm o MESMO comprimento. Hoje vai de meia-noite até agora,
 * e ontem cobre o mesmo intervalo de relógio — comparar a manhã de hoje com
 * o dia inteiro de ontem faria o dia corrente parecer sempre pior. 7 e 30
 * dias começam na meia-noite do primeiro dia civil (hoje conta) e o período
 * anterior é o bloco imediatamente antes, do mesmo tamanho.
 *
 * Janela semiaberta: [inicio, fim).
 */

export const FUSO_DO_PAINEL = "America/Sao_Paulo";

export type PeriodoPainel = "hoje" | "7d" | "30d";

export interface JanelaPainel {
  inicio: string;
  fim: string;
}

export interface ComparacaoDePeriodo {
  periodo: PeriodoPainel;
  fuso: string;
  atual: JanelaPainel;
  anterior: JanelaPainel;
}

interface Civil {
  ano: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
}

function partesNoFuso(instante: Date, fuso: string): Civil {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const mapa = new Map(fmt.formatToParts(instante).map((p) => [p.type, p.value]));
  return {
    ano: Number(mapa.get("year")),
    mes: Number(mapa.get("month")),
    dia: Number(mapa.get("day")),
    hora: Number(mapa.get("hour")),
    minuto: Number(mapa.get("minute")),
    segundo: Number(mapa.get("second")),
  };
}

/** Meia-noite civil do instante, expressa em UTC. */
export function inicioDoDiaNoFuso(instante: Date, fuso: string): Date {
  const p = partesNoFuso(instante, fuso);
  const relogioComoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  const deslocamento = relogioComoUtc - instante.getTime();
  return new Date(Date.UTC(p.ano, p.mes - 1, p.dia, 0, 0, 0) - deslocamento);
}

function meiaNoiteCivil(ano: number, mes: number, dia: number, fuso: string): Date {
  // Meio-dia UTC cai no mesmo dia civil para fusos entre -12 e +12.
  const meioDia = new Date(Date.UTC(ano, mes - 1, dia, 12, 0, 0));
  return inicioDoDiaNoFuso(meioDia, fuso);
}

function civilMaisDias(ano: number, mes: number, dia: number, dias: number): Civil {
  const dt = new Date(Date.UTC(ano, mes - 1, dia + dias));
  return {
    ano: dt.getUTCFullYear(),
    mes: dt.getUTCMonth() + 1,
    dia: dt.getUTCDate(),
    hora: 0,
    minuto: 0,
    segundo: 0,
  };
}

function iso(instante: Date): string {
  return instante.toISOString();
}

/** Duração do mês civil que contém `agora`, no fuso. Serve à meta mensal proporcional. */
export function duracaoDoMesCivil(agora: Date, fuso: string): number {
  const civil = partesNoFuso(agora, fuso);
  const inicio = meiaNoiteCivil(civil.ano, civil.mes, 1, fuso);
  const proximo =
    civil.mes === 12
      ? meiaNoiteCivil(civil.ano + 1, 1, 1, fuso)
      : meiaNoiteCivil(civil.ano, civil.mes + 1, 1, fuso);
  return proximo.getTime() - inicio.getTime();
}

export function janelasDoPainel(
  periodo: PeriodoPainel,
  agora: Date,
  fuso: string = FUSO_DO_PAINEL,
): ComparacaoDePeriodo {
  const civil = partesNoFuso(agora, fuso);
  const inicioHoje = meiaNoiteCivil(civil.ano, civil.mes, civil.dia, fuso);

  if (periodo === "hoje") {
    const ontem = civilMaisDias(civil.ano, civil.mes, civil.dia, -1);
    const inicioOntem = meiaNoiteCivil(ontem.ano, ontem.mes, ontem.dia, fuso);
    const decorrido = agora.getTime() - inicioHoje.getTime();
    return {
      periodo,
      fuso,
      atual: { inicio: iso(inicioHoje), fim: iso(agora) },
      anterior: { inicio: iso(inicioOntem), fim: iso(new Date(inicioOntem.getTime() + decorrido)) },
    };
  }

  const dias = periodo === "7d" ? 7 : 30;
  const primeiro = civilMaisDias(civil.ano, civil.mes, civil.dia, -(dias - 1));
  const inicio = meiaNoiteCivil(primeiro.ano, primeiro.mes, primeiro.dia, fuso);
  const duracao = agora.getTime() - inicio.getTime();
  return {
    periodo,
    fuso,
    atual: { inicio: iso(inicio), fim: iso(agora) },
    anterior: { inicio: iso(new Date(inicio.getTime() - duracao)), fim: iso(inicio) },
  };
}
