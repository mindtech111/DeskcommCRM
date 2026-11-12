import { describe, expect, it } from "vitest";

import { limparMemoCurto, memoCurto } from "./memo-curto";

describe("memo curto do contexto de auth", () => {
  it("reaproveita dentro do prazo e lê de novo depois", async () => {
    limparMemoCurto();
    let t = 0;
    let leituras = 0;
    const ler = async () => {
      leituras += 1;
      return leituras;
    };
    const opcoes = { ttlMs: 10_000, agora: () => t, ligado: true };
    expect(await memoCurto("user-1", ler, opcoes)).toBe(1);
    t = 9_000;
    expect(await memoCurto("user-1", ler, opcoes)).toBe(1);
    expect(leituras).toBe(1);
    t = 10_001;
    expect(await memoCurto("user-1", ler, opcoes)).toBe(2);
    expect(leituras).toBe(2);
  });

  it("erro não fica gravado", async () => {
    limparMemoCurto();
    let falhar = true;
    const ler = async () => {
      if (falhar) throw new Error("banco fora");
      return "ok";
    };
    const opcoes = { ttlMs: 10_000, agora: () => 0, ligado: true };
    await expect(memoCurto("user-2", ler, opcoes)).rejects.toThrow("banco fora");
    falhar = false;
    expect(await memoCurto("user-2", ler, opcoes)).toBe("ok");
  });

  it("duas leituras ao mesmo tempo compartilham uma ida", async () => {
    limparMemoCurto();
    let leituras = 0;
    let soltar: () => void = () => {};
    const porta = new Promise<void>((resolve) => {
      soltar = resolve;
    });
    const ler = async () => {
      leituras += 1;
      await porta;
      return "mesmo";
    };
    const opcoes = { ttlMs: 10_000, agora: () => 0, ligado: true };
    const a = memoCurto("user-3", ler, opcoes);
    const b = memoCurto("user-3", ler, opcoes);
    soltar();
    expect(await Promise.all([a, b])).toEqual(["mesmo", "mesmo"]);
    expect(leituras).toBe(1);
  });

  it("chaves diferentes não se misturam", async () => {
    limparMemoCurto();
    const opcoes = { ttlMs: 10_000, agora: () => 0, ligado: true };
    expect(await memoCurto("a", async () => "A", opcoes)).toBe("A");
    expect(await memoCurto("b", async () => "B", opcoes)).toBe("B");
  });
});
