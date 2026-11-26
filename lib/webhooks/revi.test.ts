import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { REVI_PAYLOAD_PENDENTE, isReviPayload } from "@/lib/webhooks/revi";

describe("adaptador da Revi", () => {
  it("não reconhece payload nenhum enquanto o contrato real não chegou", () => {
    expect(REVI_PAYLOAD_PENDENTE).toBe(true);
    expect(isReviPayload({ event: "message", utm_source: "revi" })).toBe(false);
    expect(isReviPayload(null)).toBe(false);
  });

  it("o arquivo não inventa endpoint", () => {
    const fonte = readFileSync(resolve(__dirname, "revi.ts"), "utf8");
    expect(fonte).not.toMatch(/https?:\/\//);
    expect(fonte).toContain("PENDENTE");
  });
});
