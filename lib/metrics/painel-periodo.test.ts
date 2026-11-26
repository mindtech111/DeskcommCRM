import { describe, expect, it } from "vitest";

import { comparar } from "@/lib/metrics/painel";
import { janelasDoPainel } from "@/lib/metrics/painel-periodo";

const FUSO = "America/Sao_Paulo";

function duracao(inicio: string, fim: string): number {
  return Date.parse(fim) - Date.parse(inicio);
}

describe("janelas do painel", () => {
  it("hoje à noite em São Paulo ainda é o dia civil de lá, não o dia UTC", () => {
    // 26/11 02:30 UTC = 25/11 23:30 em America/Sao_Paulo.
    const agora = new Date("2026-11-26T02:30:00.000Z");
    const j = janelasDoPainel("hoje", agora, FUSO);

    expect(j.fuso).toBe(FUSO);
    expect(j.atual.inicio).toBe("2026-11-25T03:00:00.000Z");
    expect(j.atual.fim).toBe(agora.toISOString());
    expect(j.anterior.inicio).toBe("2026-11-24T03:00:00.000Z");
    expect(duracao(j.anterior.inicio, j.anterior.fim)).toBe(duracao(j.atual.inicio, j.atual.fim));
    // O fim de ontem é o mesmo relógio: 23:30.
    expect(j.anterior.fim).toBe("2026-11-25T02:30:00.000Z");
  });

  it("meia-noite em São Paulo abre o dia novo e a janela de hoje nasce vazia", () => {
    const agora = new Date("2026-11-26T03:00:00.000Z");
    const j = janelasDoPainel("hoje", agora, FUSO);
    expect(j.atual.inicio).toBe(agora.toISOString());
    expect(duracao(j.atual.inicio, j.atual.fim)).toBe(0);
    expect(duracao(j.anterior.inicio, j.anterior.fim)).toBe(0);
    expect(j.anterior.inicio).toBe("2026-11-25T03:00:00.000Z");
  });

  it("7 dias e 30 dias comparam com um bloco anterior do mesmo tamanho", () => {
    const agora = new Date("2026-11-26T18:00:00.000Z"); // 15:00 em São Paulo
    for (const periodo of ["7d", "30d"] as const) {
      const j = janelasDoPainel(periodo, agora, FUSO);
      expect(duracao(j.anterior.inicio, j.anterior.fim)).toBe(duracao(j.atual.inicio, j.atual.fim));
      expect(j.anterior.fim).toBe(j.atual.inicio);
      expect(Date.parse(j.atual.fim)).toBe(agora.getTime());
    }

    const sete = janelasDoPainel("7d", agora, FUSO);
    // Primeiro dia civil incluso: hoje e os 6 anteriores → 20/11 00:00 BRT.
    expect(sete.atual.inicio).toBe("2026-11-20T03:00:00.000Z");

    const trinta = janelasDoPainel("30d", agora, FUSO);
    expect(trinta.atual.inicio).toBe("2026-10-28T03:00:00.000Z");
  });
});

describe("comparar", () => {
  it("mede a diferença e o percentual quando os dois lados existem", () => {
    expect(comparar(12, 8)).toEqual({
      atual: 12,
      anterior: 8,
      absoluto: 4,
      percentual: 0.5,
    });
  });

  it("não inventa percentual quando o período anterior é zero", () => {
    expect(comparar(3, 0)).toEqual({
      atual: 3,
      anterior: 0,
      absoluto: 3,
      percentual: null,
    });
  });

  it("não transforma ausência em zero", () => {
    expect(comparar(null, 4).absoluto).toBeNull();
    expect(comparar(4, null).percentual).toBeNull();
    expect(comparar(null, null)).toMatchObject({ absoluto: null, percentual: null });
  });
});
