import { afterEach, describe, expect, it } from "vitest";

import {
  esperaAposFalha,
  fetchComRecuo,
  pausaDoAdminMs,
  reiniciarRecuoDoAdmin,
} from "./fetch-com-recuo";

afterEach(() => {
  reiniciarRecuoDoAdmin();
});

function relogio() {
  let t = 1_000_000;
  const esperas: number[] = [];
  return {
    esperas,
    agora: () => t,
    dormir: async (ms: number) => {
      esperas.push(ms);
      t += ms;
    },
  };
}

describe("fetch do admin recua em vez de martelar", () => {
  it("na suíte, sem relógio injetado, a falha volta na hora", async () => {
    let i = 0;
    const fetch = fetchComRecuo(async () => {
      i += 1;
      return new Response(null, { status: 500 });
    });
    expect((await fetch("https://db.exemplo/rest/v1/contacts")).status).toBe(500);
    expect(i).toBe(1);
  });

  it("GET 500 tenta de novo com espera e, ao esgotar, pausa a próxima consulta", async () => {
    const rel = relogio();
    const status = [500, 500, 500];
    let i = 0;
    const fetch = fetchComRecuo(
      async () => new Response("{}", { status: status[i++] ?? 500 }),
      { dormir: rel.dormir, agora: rel.agora, aleatorio: () => 0 },
    );

    const resposta = await fetch("https://db.exemplo/rest/v1/contacts", { method: "GET" });
    expect(resposta.status).toBe(500);
    expect(i).toBe(3);
    // 300 ms, depois 600 ms. A pausa do processo é a espera da PRÓXIMA consulta.
    expect(rel.esperas).toEqual([300, 600]);

    await fetch("https://db.exemplo/rest/v1/contacts", { method: "GET" });
    expect(rel.esperas[2]).toBeGreaterThan(0);
    expect(pausaDoAdminMs(rel.agora())).toBeGreaterThan(0);
  });

  it("GET que volta 200 zera a pausa", async () => {
    const rel = relogio();
    const status = [500, 200];
    let i = 0;
    const fetch = fetchComRecuo(
      async () => new Response("{}", { status: status[i++] ?? 200 }),
      { dormir: rel.dormir, agora: rel.agora, aleatorio: () => 0 },
    );
    const resposta = await fetch("https://db.exemplo/rest/v1/contacts");
    expect(resposta.status).toBe(200);
    expect(i).toBe(2);
    expect(pausaDoAdminMs(rel.agora())).toBe(0);
  });

  it("POST 500 não repete — a escrita pode ter acontecido — mas pausa o processo", async () => {
    const rel = relogio();
    let i = 0;
    const fetch = fetchComRecuo(async () => {
      i += 1;
      return new Response("{}", { status: 500 });
    }, { dormir: rel.dormir, agora: rel.agora, aleatorio: () => 0 });

    const resposta = await fetch("https://db.exemplo/rest/v1/contacts", { method: "POST" });
    expect(resposta.status).toBe(500);
    expect(i).toBe(1);
    expect(rel.esperas).toEqual([]);
    expect(pausaDoAdminMs(rel.agora())).toBeGreaterThan(0);
  });

  it("429 honra Retry-After e repete mesmo em POST", async () => {
    const rel = relogio();
    const status = [429, 200];
    let i = 0;
    const fetch = fetchComRecuo(
      async () =>
        new Response("{}", {
          status: status[i++] ?? 200,
          headers: i === 1 ? { "retry-after": "2" } : undefined,
        }),
      { dormir: rel.dormir, agora: rel.agora, aleatorio: () => 0 },
    );
    const resposta = await fetch("https://db.exemplo/rest/v1/contacts", { method: "POST" });
    expect(resposta.status).toBe(200);
    expect(rel.esperas).toEqual([2_000]);
  });

  it("400 de leitura não é retentado", async () => {
    let i = 0;
    const fetch = fetchComRecuo(async () => {
      i += 1;
      return new Response("{}", { status: 400 });
    }, { dormir: async () => {}, aleatorio: () => 0 });
    expect((await fetch("https://db.exemplo/rest/v1/contacts")).status).toBe(400);
    expect(i).toBe(1);
  });

  it("timeout de GET tenta de novo; AbortError do chamador não", async () => {
    let i = 0;
    const fetch = fetchComRecuo(
      async () => {
        i += 1;
        if (i === 1) throw new DOMException("estourou", "TimeoutError");
        return new Response("{}", { status: 200 });
      },
      { dormir: async () => {}, aleatorio: () => 0 },
    );
    expect((await fetch("https://db.exemplo/rest/v1/contacts")).status).toBe(200);
    expect(i).toBe(2);

    const abortado = fetchComRecuo(
      async () => {
        throw new DOMException("cancelado", "AbortError");
      },
      { dormir: async () => {}, aleatorio: () => 0 },
    );
    await expect(abortado("https://db.exemplo/rest/v1/contacts")).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});

describe("espera do laço depois de falha", () => {
  it("cresce e não fica abaixo do intervalo ocioso", () => {
    expect(esperaAposFalha(1, 0)).toBe(500);
    expect(esperaAposFalha(2, 0)).toBe(1_000);
    expect(esperaAposFalha(3, 0)).toBe(2_000);
    expect(esperaAposFalha(1, 30_000)).toBe(30_000);
    expect(esperaAposFalha(20, 0)).toBeLessThanOrEqual(30_000);
  });
});
