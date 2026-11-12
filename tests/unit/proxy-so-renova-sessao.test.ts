import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * O middleware renova a sessão e só isso. Autorizar aqui com `getUser()` e
 * `fn_is_platform_admin` duplicava a ida ao Auth e ao banco em todo clique.
 * Sem sessão, a porta continua fechada — o que muda é a sessão presente não
 * ser revalidada nesta camada.
 */

const getUser = vi.fn(async () => {
  throw new Error("getUser não pode rodar no middleware");
});
const rpc = vi.fn(async () => {
  throw new Error("rpc não pode rodar no middleware");
});
const getSession = vi.fn(async () => ({ data: { session: null }, error: null }));

vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://supabase.exemplo",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-de-teste",
    SUPABASE_SERVER_URL: undefined,
    NEXT_PUBLIC_APP_URL: "https://crm.exemplo",
    IMPERSONATE_COOKIE_SECRET: "segredo-de-teste",
  },
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getSession, getUser },
    rpc,
  }),
}));

afterEach(() => {
  getUser.mockClear();
  rpc.mockClear();
  getSession.mockClear();
  getSession.mockResolvedValue({ data: { session: null }, error: null });
});

async function chamar(caminho: string) {
  const { proxy } = await import("@/proxy");
  const { NextRequest } = await import("next/server");
  return proxy(new NextRequest(`https://crm.exemplo${caminho}`));
}

describe("o middleware só renova a sessão", () => {
  it("sem sessão, /app continua indo para o login", async () => {
    const resposta = await chamar("/app/inbox");
    expect(resposta.status).toBe(307);
    expect(resposta.headers.get("location")).toContain("/login");
    expect(getUser).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sem sessão, /api continua 401", async () => {
    const resposta = await chamar("/api/v1/conversations");
    expect(resposta.status).toBe(401);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("com sessão, segue sem getUser e sem o RPC de platform admin", async () => {
    getSession.mockResolvedValue({
      data: { session: { user: { id: "u1" } } },
      error: null,
    } as never);
    const resposta = await chamar("/admin");
    expect(resposta.status).not.toBe(307);
    expect(getSession).toHaveBeenCalledOnce();
    expect(getUser).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
