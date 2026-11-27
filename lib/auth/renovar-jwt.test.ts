import { describe, expect, it, vi } from "vitest";

import { renovarJwtDepoisDoPerfil } from "./renovar-jwt";

describe("renovarJwtDepoisDoPerfil", () => {
  it("pede um access token novo depois de gravar o perfil", async () => {
    const refreshSession = vi.fn(async () => ({ error: null }));
    expect(await renovarJwtDepoisDoPerfil({ auth: { refreshSession } })).toBeNull();
    expect(refreshSession).toHaveBeenCalledOnce();
  });

  it("devolve a mensagem quando a renovação falha", async () => {
    const refreshSession = vi.fn(async () => ({ error: { message: "refresh caiu" } }));
    expect(await renovarJwtDepoisDoPerfil({ auth: { refreshSession } })).toBe("refresh caiu");
  });
});
