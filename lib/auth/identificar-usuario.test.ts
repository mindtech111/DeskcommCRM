import { describe, expect, it, vi } from "vitest";

import { identificarUsuario } from "./identificar-usuario";

describe("identificarUsuario", () => {
  it("com getClaims, o id sai do sub e getUser não é chamado", async () => {
    const getUser = vi.fn();
    const resultado = await identificarUsuario({
      auth: {
        getClaims: async () => ({
          data: {
            claims: {
              sub: "usuario-1",
              email: "a@b.c",
              user_metadata: { full_name: "Ana" },
            },
          },
          error: null,
        }),
        getUser,
      },
    });

    expect(getUser).not.toHaveBeenCalled();
    expect(resultado.via).toBe("getClaims");
    expect(resultado.error).toBeNull();
    expect(resultado.usuario).toEqual({
      id: "usuario-1",
      email: "a@b.c",
      user_metadata: { full_name: "Ana" },
    });
  });

  it("sessão ausente no getClaims volta como erro, sem inventar usuário", async () => {
    const resultado = await identificarUsuario({
      auth: {
        getClaims: async () => ({
          data: null,
          error: { name: "AuthSessionMissingError", message: "Auth session missing!", status: 400 },
        }),
        getUser: vi.fn(),
      },
    });
    expect(resultado.usuario).toBeNull();
    expect(resultado.via).toBe("getClaims");
    expect(resultado.error?.name).toBe("AuthSessionMissingError");
  });

  it("sem getClaims, cai no getUser — é o dublê de teste, não o caminho de produção", async () => {
    const resultado = await identificarUsuario({
      auth: {
        getUser: async () => ({
          data: { user: { id: "u-legado", email: "z@z.z", user_metadata: {} } },
          error: null,
        }),
      },
    });
    expect(resultado.via).toBe("getUser");
    expect(resultado.usuario?.id).toBe("u-legado");
  });
});
