import { describe, expect, it } from "vitest";

import { criarPortaoDeRenovacao } from "./renovacao-unica";

describe("renovação única do browser", () => {
  it("duas chamadas sobrepostas fazem um refresh só", async () => {
    let t = 0;
    let chamadas = 0;
    const renovar = criarPortaoDeRenovacao({
      agora: () => t,
      intervaloMinimoMs: 60_000,
    });
    let soltar: () => void = () => {};
    const pendente = new Promise<void>((resolve) => {
      soltar = resolve;
    });
    const primeira = renovar(async () => {
      chamadas += 1;
      await pendente;
      return { error: null };
    });
    const segunda = renovar(async () => {
      chamadas += 1;
      return { error: null };
    });
    soltar();
    await Promise.all([primeira, segunda]);
    expect(chamadas).toBe(1);
  });

  it("não dispara de novo dentro do intervalo, e 429 empurra mais longe", async () => {
    let t = 0;
    let chamadas = 0;
    const renovar = criarPortaoDeRenovacao({
      agora: () => t,
      intervaloMinimoMs: 60_000,
      recuoDe429Ms: 300_000,
    });
    await renovar(async () => {
      chamadas += 1;
      return { error: null };
    });
    t = 30_000;
    expect(await renovar(async () => {
      chamadas += 1;
      return { error: null };
    })).toBeUndefined();
    expect(chamadas).toBe(1);

    t = 60_000;
    await renovar(async () => {
      chamadas += 1;
      return { error: { status: 429 } };
    });
    t = 200_000;
    expect(await renovar(async () => {
      chamadas += 1;
      return { error: null };
    })).toBeUndefined();
    expect(chamadas).toBe(2);
    t = 360_000;
    await renovar(async () => {
      chamadas += 1;
      return { error: null };
    });
    expect(chamadas).toBe(3);
  });
});
