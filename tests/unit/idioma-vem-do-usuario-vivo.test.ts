import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O idioma da tela não pode ficar preso no access token.
 *
 * `admin.updateUserById({ user_metadata: { locale } })` — o que o e2e faz
 * antes do reload — grava a conta e não reemite o JWT. `getClaims()` lê o
 * token, então a página continuaria em português. O registro vivo vem de
 * `getUser()`, em paralelo com as memberships.
 */

const vivo = {
  locale: "es" as string | null,
  full_name: "Ana Silva" as string | null,
};

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {} }),
}));
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirect");
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: null }) };
      return chain;
    },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => ({
        data: {
          claims: {
            sub: "u1",
            email: "a@b.c",
            user_metadata: { locale: "pt-BR", full_name: "Ana" },
          },
        },
        error: null,
      }),
      getUser: async () => ({
        data: {
          user: {
            id: "u1",
            email: "a@b.c",
            user_metadata: { locale: vivo.locale, full_name: vivo.full_name },
          },
        },
        error: null,
      }),
    },
    rpc: async () => ({ data: null, error: null }),
    from: () => {
      const resultado = { data: [], error: null };
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        order: () => chain,
        maybeSingle: async () => ({ data: null, error: null }),
        then: (r: (v: unknown) => unknown) => Promise.resolve(resultado).then(r),
      };
      return chain;
    },
  }),
}));

const { loadAuthUser } = await import("@/lib/auth/server");

beforeEach(() => {
  vivo.locale = "es";
  vivo.full_name = "Ana Silva";
});

describe("loadAuthUser — perfil vivo, não o JWT", () => {
  it("o reload depois de gravar o idioma lê o registro, não o token antigo", async () => {
    const u = await loadAuthUser();
    expect(u?.idioma).toBe("es");
    expect(u?.full_name).toBe("Ana Silva");
    expect(u?.id).toBe("u1");
  });
});
