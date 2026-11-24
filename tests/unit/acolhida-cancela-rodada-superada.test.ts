/**
 * A acolhida é o único workflow de PR que não tinha grupo de concorrência.
 * Os pesados (ci, perf, publish-image, e2e) já cancelam por job — e NÃO no
 * nível do workflow, de propósito (tests/unit/concorrencia-so-nos-jobs-pesados.test.ts).
 * Este aqui não tem agregador com `always()`, então o grupo no workflow não
 * segura a rodada seguinte.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const yml = readFileSync(".github/workflows/acolhida.yml", "utf8");

describe("acolhida cancela a rodada superada do mesmo PR", () => {
  it("declara concurrency no workflow, por PR, com cancel-in-progress", () => {
    expect(yml).toMatch(
      /^concurrency:\n {2}group: acolhida-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\n {2}cancel-in-progress: true\s*$/m,
    );
  });
});
