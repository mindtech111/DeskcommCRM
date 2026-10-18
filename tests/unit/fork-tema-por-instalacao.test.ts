// Fork Mindtech: tema por instalação (APP_THEME). Arquivo próprio para não
// conflitar com tests/unit/branding.test.ts do upstream a cada sync.
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { iconeDoTema, resolveBrandTheme } from "@/lib/branding";

describe("resolveBrandTheme", () => {
  it("vazio, ausente ou desconhecido cai no tema padrão (instalação existente não muda)", () => {
    expect(resolveBrandTheme(undefined)).toBe("default");
    expect(resolveBrandTheme("")).toBe("default");
    expect(resolveBrandTheme("   ")).toBe("default");
    expect(resolveBrandTheme("coral")).toBe("default");
  });

  it("aceita tema conhecido sem diferenciar caixa nem espaços", () => {
    expect(resolveBrandTheme("inochi")).toBe("inochi");
    expect(resolveBrandTheme(" Inochi ")).toBe("inochi");
  });

  it("todo tema conhecido tem tokens no CSS de temas e arte em public/brand", () => {
    const RAIZ = path.resolve(__dirname, "../..");
    const css = fs.readFileSync(path.join(RAIZ, "app/brand-themes.css"), "utf8");
    const layout = fs.readFileSync(path.join(RAIZ, "app/layout.tsx"), "utf8");
    expect(layout).toContain('import "./brand-themes.css"');
    for (const tema of ["inochi"]) {
      expect(css).toContain(`[data-brand="${tema}"]`);
      expect(fs.existsSync(path.join(RAIZ, `public/brand/${tema}/logo.svg`))).toBe(true);
    }
  });
});

describe("iconeDoTema", () => {
  it("tema com ícone próprio usa o svg do tema", () => {
    expect(iconeDoTema(null, "inochi")).toBe("/brand/inochi/icon.svg");
  });
  it("favicon subido em /admin/marca vence o do tema", () => {
    expect(iconeDoTema("org/favicon.png", "inochi")).toBeNull();
  });
  it("tema padrão segue o ícone do upstream", () => {
    expect(iconeDoTema(null, "default")).toBeNull();
  });
});
