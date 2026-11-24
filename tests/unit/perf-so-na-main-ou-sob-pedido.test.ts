/**
 * `pnpm build` deixa de rodar em todo pull_request.
 *
 * O check obrigatório `build-and-size` continua no push da `main`. No PR ele
 * repetia um build que, quando o PR alcança imagem, o Dockerfile já faz. Sob
 * pedido o caminho é `workflow_dispatch`. O job segue SEM `if:`: um `if:` falso
 * vira `skipped`, e `skipped` conta como check satisfeito — a cerca disso é
 * `gatilho-dos-jobs-de-entrega.test.ts`, que lê o `if:` e não o `on:`.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const yml = readFileSync(".github/workflows/perf.yml", "utf8");

function blocoOn(texto: string): string {
  const linhas = texto.split("\n");
  const i = linhas.findIndex((l) => l === "on:");
  if (i < 0) return "";
  const out: string[] = [];
  for (const l of linhas.slice(i + 1)) {
    if (l.length > 0 && !l.startsWith(" ") && !l.startsWith("#")) break;
    out.push(l);
  }
  return out.join("\n");
}

describe("perf só na main ou sob pedido", () => {
  it("o instrumento acha o bloco on:", () => {
    expect(blocoOn(yml).length).toBeGreaterThan(0);
  });

  it("não dispara em pull_request; dispara no push da main e sob pedido", () => {
    const on = blocoOn(yml);
    expect(on).toMatch(/^ {2}push:\s*$/m);
    expect(on).toContain("branches: [main]");
    expect(on).toMatch(/^ {2}workflow_dispatch:\s*$/m);
    expect(on).not.toMatch(/^\s*pull_request:/m);
  });

  it("build-and-size continua sem if e continua chamando pnpm build", () => {
    const i = yml.indexOf("\n  build-and-size:\n");
    expect(i).toBeGreaterThan(-1);
    const resto = yml.slice(i);
    const fim = resto.slice(1).search(/\n {2}[A-Za-z0-9_-]+:\n/);
    const job = (fim < 0 ? resto : resto.slice(0, fim + 1))
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("#"))
      .join("\n");
    expect(job).not.toMatch(/^ {4}if:/m);
    expect(job).toContain("pnpm build");
  });
});
