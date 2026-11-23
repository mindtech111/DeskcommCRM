import { describe, expect, it } from "vitest";

import { PROVIDERS_DE_MENSAGEM } from "@/lib/channels/capabilities";
import { aceitaAvisoLivre } from "@/lib/channels/aviso-livre";

describe("aceitaAvisoLivre", () => {
  it("só deixa passar canal que manda texto livre fora da janela", () => {
    const livres = PROVIDERS_DE_MENSAGEM.filter((p) => aceitaAvisoLivre(p));
    const presos = PROVIDERS_DE_MENSAGEM.filter((p) => !aceitaAvisoLivre(p));
    expect(livres.length).toBeGreaterThan(0);
    expect(presos.length).toBeGreaterThan(0);
    expect(aceitaAvisoLivre(null)).toBe(false);
    expect(aceitaAvisoLivre("desconhecido")).toBe(false);
  });
});
