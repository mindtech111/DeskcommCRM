import { describe, expect, it } from "vitest";

import {
  CONSULTAS_EM_PARALELO,
  ErroDeConsulta,
  IDS_POR_CONSULTA,
  consultarEmLotes,
  juntarPorId,
  lotesDeIds,
  mapEmLotes,
} from "./lotes-de-ids";

describe("lotes de ids do PostgREST", () => {
  it("parte em 100 e não deixa o resto para trás", () => {
    expect(lotesDeIds([])).toEqual([]);
    expect(lotesDeIds(["a"])).toEqual([["a"]]);
    const cem = Array.from({ length: IDS_POR_CONSULTA }, (_, i) => String(i));
    expect(lotesDeIds(cem)).toHaveLength(1);
    const centoEUm = [...cem, "extra"];
    const lotes = lotesDeIds(centoEUm);
    expect(lotes.map((l) => l.length)).toEqual([100, 1]);
    expect(lotes.flat()).toEqual(centoEUm);
  });

  it("recusa lote de tamanho zero — o laço não pode ficar parado", () => {
    expect(() => lotesDeIds(["a"], 0)).toThrow("lote_invalido");
  });

  it("não passa de 4 consultas vivas e devolve na ordem da entrada", async () => {
    let vivas = 0;
    let pico = 0;
    let soltar: () => void = () => {};
    const trava = new Promise<void>((resolve) => {
      soltar = resolve;
    });
    const ids = Array.from({ length: 500 }, (_, i) => String(i));
    const tarefa = mapEmLotes(ids, async (lote) => {
      vivas += 1;
      pico = Math.max(pico, vivas);
      await trava;
      vivas -= 1;
      return lote[0];
    });
    await viEspera(() => pico === CONSULTAS_EM_PARALELO);
    expect(vivas).toBe(CONSULTAS_EM_PARALELO);
    soltar();
    const primeiros = await tarefa;
    expect(pico).toBe(CONSULTAS_EM_PARALELO);
    expect(primeiros).toEqual(["0", "100", "200", "300", "400"]);
  });

  it("consulta em lotes e sobe o erro com a tabela e o código", async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `id-${i}`);
    const vistos: number[] = [];
    const linhas = await consultarEmLotes(ids, "cron_jobs", async (lote) => {
      vistos.push(lote.length);
      return { data: lote.map((id) => ({ id })), error: null };
    });
    expect(vistos).toEqual([100, 50]);
    expect(linhas).toHaveLength(150);

    await expect(
      consultarEmLotes(["a"], "cron_jobs", async () => ({
        data: null,
        error: { message: "URI too long", code: "PGRST100" },
      })),
    ).rejects.toEqual(expect.objectContaining({ step: "cron_jobs", code: "PGRST100" }));
    await expect(
      consultarEmLotes(["a"], "cron_jobs", async () => ({
        data: null,
        error: { message: "boom", code: "57014" },
      })),
    ).rejects.toBeInstanceOf(ErroDeConsulta);
  });

  it("junta páginas pelo id e fica com a primeira", () => {
    expect(
      juntarPorId([
        [{ id: "a", n: 1 }],
        [
          { id: "a", n: 2 },
          { id: "b", n: 3 },
        ],
      ]),
    ).toEqual([
      { id: "a", n: 1 },
      { id: "b", n: 3 },
    ]);
  });
});

async function viEspera(pronto: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (pronto()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("a concorrência não chegou no teto");
}
