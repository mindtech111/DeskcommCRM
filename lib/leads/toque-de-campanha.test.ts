import { describe, expect, it } from "vitest";

import {
  TETO_DE_TOQUES,
  etiquetasDoToque,
  fundirEtiquetas,
  fundirToque,
  montarToque,
} from "@/lib/leads/toque-de-campanha";

const TOQUE = montarToque({
  utm: { utm_source: "revi", utm_medium: "vb", utm_campaign: "inverno", utm_term: "ignorado" },
  trackingLinkId: "link-1",
  ref: "K7M2P9",
  at: "2026-11-26T12:00:00.000Z",
});

describe("toque de campanha", () => {
  it("guarda só origem, meio, campanha, link, ref e hora", () => {
    expect(TOQUE).toEqual({
      utm_source: "revi",
      utm_medium: "vb",
      utm_campaign: "inverno",
      tracking_link_id: "link-1",
      ref: "K7M2P9",
      at: "2026-11-26T12:00:00.000Z",
    });
  });

  it("etiqueta revi/vb quando a origem é revi e o meio é vb; sem origem, a tag é rastreio", () => {
    expect(
      etiquetasDoToque({ utm_source: "revi", utm_medium: "vb", utm_campaign: "inverno" }),
    ).toEqual(["inverno", "revi/vb"]);
    expect(etiquetasDoToque({ utm_source: "instagram" })).toEqual(["instagram"]);
    expect(etiquetasDoToque({})).toEqual(["rastreio"]);
  });

  it("não reescreve o primeiro toque e não repete o mesmo ref", () => {
    const primeiro = fundirToque({ utm_source: "organico", ad_platform: "site" }, TOQUE);
    expect(primeiro.mudou).toBe(true);
    expect(primeiro.metadata.utm_source).toBe("organico");
    expect(primeiro.metadata.ad_platform).toBe("site");
    expect(primeiro.metadata.last_touch).toEqual(TOQUE);
    expect(primeiro.metadata.touches).toEqual([TOQUE]);

    const deNovo = fundirToque(primeiro.metadata, TOQUE);
    expect(deNovo.mudou).toBe(false);
    expect(deNovo.metadata.touches).toHaveLength(1);
  });

  it("a lista de toques tem teto e fica com os mais novos", () => {
    let metadata: Record<string, unknown> = {};
    for (let i = 0; i < TETO_DE_TOQUES + 3; i++) {
      metadata = fundirToque(
        metadata,
        montarToque({
          utm: { utm_campaign: `c${i}` },
          trackingLinkId: null,
          ref: `R${i}XXXX`,
          at: "t",
        }),
      ).metadata;
    }
    const touches = metadata.touches as Array<{ ref: string }>;
    expect(touches).toHaveLength(TETO_DE_TOQUES);
    expect(touches[0]?.ref).toBe("R3XXXX");
    expect(touches.at(-1)?.ref).toBe(`R${TETO_DE_TOQUES + 2}XXXX`);
  });

  it("junta etiquetas sem apagar as que o card já tinha", () => {
    expect(fundirEtiquetas(["vip", "inverno"], ["inverno", "revi/vb"])).toEqual([
      "vip",
      "inverno",
      "revi/vb",
    ]);
  });
});
