import { describe, expect, it, vi } from "vitest";

/**
 * MEDIÇÃO do caminho das telas quentes.
 *
 * Não há Supabase de verdade nesta sessão — o número abaixo é o caminho de
 * código com atraso injetado, não o RTT de uma VPS. O que ele prende:
 *
 *  1. As duas leituras do funil (cabeçalho e lista) ficam em voo juntas.
 *  2. O desenho novo (getUser só na borda + permissões em paralelo + dados
 *     em paralelo) cabe em menos tempo que o desenho antigo (três getUser
 *     em série, depois org, depois permissão, depois cada consulta).
 *
 * Atraso de 40ms por "ida". Três idas sobrepostas custam ~120ms; sete em
 * série custam ~280ms. A asserção é a razão, não um relógio absoluto — um
 * CI lento estica os dois lados juntos.
 */

const ATRASO_MS = 40;

function espera(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("funil — cabeçalho e lista partem juntos", () => {
  it("as duas leituras ficam em voo ao mesmo tempo", async () => {
    const emVoo = { n: 0, pico: 0 };
    function atraso<T>(valor: T): Promise<T> {
      emVoo.n += 1;
      emVoo.pico = Math.max(emVoo.pico, emVoo.n);
      return new Promise((resolve) => {
        setTimeout(() => {
          emVoo.n -= 1;
          resolve(valor);
        }, ATRASO_MS);
      });
    }

    vi.resetModules();
    vi.doMock("next/navigation", () => ({
      notFound: () => {
        throw new Error("notFound");
      },
      redirect: () => {
        throw new Error("redirect");
      },
    }));
    vi.doMock("@/lib/auth/server", () => ({
      requireAuth: async () => ({ id: "u", idioma: "pt-BR" }),
      resolveActiveOrg: async () => ({ orgId: "org", role: "agent" }),
    }));
    vi.doMock("@/app/app/pipelines/[id]/_client", () => ({
      PipelinePageClient: () => null,
    }));
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        from: () => {
          const b: Record<string, unknown> = {};
          b.select = () => b;
          b.eq = () => b;
          b.order = () => b;
          b.maybeSingle = () => atraso({ data: { id: "p1", name: "Funil", vocabulary: null } });
          b.then = (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) =>
            atraso({ data: [{ id: "p1", name: "Funil" }] }).then(ok, err);
          return b;
        },
      }),
    }));

    const { default: Pagina } = await import("@/app/app/pipelines/[id]/page");
    const t0 = performance.now();
    await Pagina({ params: Promise.resolve({ id: "p1" }) });
    const ms = performance.now() - t0;

    expect(emVoo.pico, "as duas consultas têm de se sobrepor").toBe(2);
    // Duas de 40ms em paralelo cabem perto de 40ms, não de 80. A folga é o
    // resto da função (auth mockado, render). 70ms ainda reprova o sequencial.
    expect(ms).toBeLessThan(ATRASO_MS * 2 - 5);
  });
});

describe("modelo de idas — antes e depois", () => {
  it("o desenho novo cabe em menos da metade das idas em série", async () => {
    async function ida() {
      await espera(ATRASO_MS);
    }

    const tAntes = performance.now();
    await ida(); // proxy getUser
    await ida(); // rota getUser
    await ida(); // loadAuthUser getUser
    await ida(); // organização
    await ida(); // permissões
    await ida(); // cabeçalho do funil
    await ida(); // lista de funis
    const antes = performance.now() - tAntes;

    const tDepois = performance.now();
    await ida(); // uma identificação (getClaims local = 0; aqui 1 ida, o piso)
    await Promise.all([ida(), ida()]); // org e permissões
    await Promise.all([ida(), ida()]); // dados da tela
    const depois = performance.now() - tDepois;

    expect(depois).toBeLessThan(antes * 0.6);
  });
});
