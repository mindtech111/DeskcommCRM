import { describe, expect, it, vi } from "vitest";

import { precarregarConversa } from "./precarregarConversa";

function cliente(mensagens: unknown) {
  return {
    prefetchQuery: vi.fn(),
    prefetchInfiniteQuery: vi.fn(),
    getQueryData: vi.fn(() => mensagens),
  };
}

describe("precarregarConversa", () => {
  it("não refaz o histórico que já tem páginas — o prefetch sem cursor derruba o fio", () => {
    const qc = cliente({ pages: [{ data: [{}] }, { data: [{}] }] });
    precarregarConversa(qc as never, "conversa-1");
    expect(qc.prefetchQuery).toHaveBeenCalledOnce();
    expect(qc.prefetchInfiniteQuery).not.toHaveBeenCalled();
  });

  it("a primeira vez pede a página com cursor e com a próxima página", () => {
    const qc = cliente(undefined);
    precarregarConversa(qc as never, "conversa-1");
    const opcoes = qc.prefetchInfiniteQuery.mock.calls[0]?.[0] as {
      getNextPageParam: (pagina: { meta?: { has_more?: boolean; cursor?: string } }) => string | undefined;
      queryFn: (ctx: { pageParam?: string }) => unknown;
    };
    expect(opcoes.getNextPageParam({ meta: { has_more: true, cursor: "abc" } })).toBe("abc");
    expect(opcoes.getNextPageParam({ meta: { has_more: false, cursor: "abc" } })).toBeUndefined();
    expect(typeof opcoes.queryFn).toBe("function");
  });
});
