import { describe, expect, it, vi } from "vitest";

import { intervaloDeEspera, recuoDoRetry, rodarLoopDaFila } from "@/lib/agent-engine/queue/loop";
import { DB_POOL_IDLE_TIMEOUT_MS_PADRAO, idleTimeoutDoPool } from "@/lib/agent-engine/db/pool";
import type { Logger } from "@/lib/agent-engine/obs/logger";

/**
 * Recuo do ritmo curto (egress do Supabase, out/2026): job vencido que o claim
 * não consegue pegar (lane ocupada, cap cheio) não pode virar 4 transações de
 * claim por segundo para sempre.
 */
const INTERVALOS = { ociosoMs: 2_000, retryMs: 250 };
const log = { info: () => undefined, warn: () => undefined, error: () => undefined } as unknown as Logger;

describe("recuoDoRetry", () => {
  it("1º retry mantém o ritmo curto e dobra até o teto", () => {
    expect([0, 1, 2, 3, 4, 50].map((n) => recuoDoRetry(INTERVALOS, n))).toEqual([
      250, 500, 1_000, 2_000, 2_000, 2_000,
    ]);
  });

  it("intervaloDeEspera sem contador continua igual ao de antes", () => {
    expect(intervaloDeEspera(0, INTERVALOS)).toBe(250);
    expect(intervaloDeEspera(0, INTERVALOS, 2)).toBe(1_000);
    expect(intervaloDeEspera(null, INTERVALOS, 9)).toBe(2_000);
  });
});

describe("rodarLoopDaFila com job vencido e preso", () => {
  it("recua enquanto o claim volta vazio e zera quando traz trabalho", async () => {
    const respostas: string[][] = [[], [], [], [], ["job"], [], []];
    let i = 0;
    const claimar = vi.fn(async () => respostas[i] ?? []);
    const dormiu: number[] = [];
    await rodarLoopDaFila<string>({
      relogio: async () => 0,
      claimar,
      aoClaimar: () => void i++,
      dormir: async (ms) => void dormiu.push(ms),
      deveParar: () => i >= respostas.length,
      intervalos: INTERVALOS,
      log,
    });
    // rodada 5 trouxe trabalho (não dorme); depois recomeça do ritmo curto.
    expect(dormiu).toEqual([250, 500, 1_000, 2_000, 250, 500]);
  });
});

describe("idleTimeoutDoPool", () => {
  it("default de 60 s e override por env", () => {
    expect(idleTimeoutDoPool(undefined)).toBe(DB_POOL_IDLE_TIMEOUT_MS_PADRAO);
    expect(idleTimeoutDoPool("lixo")).toBe(60_000);
    expect(idleTimeoutDoPool("15000")).toBe(15_000);
  });
});
