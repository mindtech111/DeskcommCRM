/**
 * E2E SOB PEDIDO: com `vars.E2E_SOB_PEDIDO == 'ligado'`, PR sem o rótulo `e2e`
 * responde `e2e=nao` no `e2e-alcance`, e o agregador aceita as partes puladas
 * pela porta que já existia (e2e-so-aceita-pulo-declarado.test.ts).
 *
 * Errar para `nao` deixa regressão passar com o check `e2e` verde. Por isso o
 * script do passo é EXECUTADO, com um `gh` falso que diz quais arquivos o PR
 * mudou e anota se foi chamado, em vez de buscar texto no YAML.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const WORKFLOW = ".github/workflows/e2e.yml";

// Sem parser YAML nas dependências: recorte do `run: |` do passo `id: alcance`.
function scriptDoAlcance(): string {
  const linhas = readFileSync(WORKFLOW, "utf-8").split("\n");
  const passo = linhas.findIndex((l) => /^\s+id: alcance$/.test(l));
  const run = linhas.findIndex((l, i) => i > passo && /^\s+run: \|$/.test(l));
  const indent = (linhas[run + 1] ?? "").match(/^\s*/)![0].length;
  const corpo: string[] = [];
  for (const l of linhas.slice(run + 1)) {
    if (l.trim() && l.match(/^\s*/)![0].length < indent) break;
    corpo.push(l.slice(indent));
  }
  return corpo.join("\n");
}

const SCRIPT = scriptDoAlcance();

type Caso = { evento: string; sobPedido?: string; rotulos?: string; arquivos?: string[]; ghFalha?: boolean };

function responde(c: Caso): { e2e: string; chamouGh: boolean } {
  const dir = mkdtempSync(join(tmpdir(), "e2e-sob-pedido-"));
  const marca = join(dir, "gh-chamado");
  const gh = join(dir, "gh");
  writeFileSync(
    gh,
    `#!/usr/bin/env bash\ntouch "${marca}"\n${c.ghFalha ? "exit 1" : `printf '%s\\n' ${(c.arquivos ?? []).map((a) => `'${a}'`).join(" ")}`}\n`,
  );
  chmodSync(gh, 0o755);
  const saida = join(dir, "output");
  writeFileSync(saida, "");
  execFileSync("bash", ["-c", SCRIPT], {
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      GITHUB_EVENT_NAME: c.evento,
      GITHUB_OUTPUT: saida,
      GITHUB_STEP_SUMMARY: "/dev/null",
      GITHUB_REPOSITORY: "dono/repo",
      PR: "1",
      SOB_PEDIDO: c.sobPedido ?? "",
      ROTULOS: c.rotulos ?? "",
    },
    encoding: "utf-8",
  });
  const e2e = readFileSync(saida, "utf-8").match(/^e2e=(.*)$/m)?.[1] ?? "<vazio>";
  return { e2e, chamouGh: existsSync(marca) };
}

const TELA = ["app/(app)/leads/page.tsx"];
const SO_DOC = ["docs/leia.md"];

describe("e2e sob pedido (vars.E2E_SOB_PEDIDO)", () => {
  it("controle positivo: o recorte pegou o script do alcance, com a chave e os rótulos", () => {
    for (const v of ["SOB_PEDIDO", "ROTULOS", "pr-alcanca-o-e2e.sh", "GITHUB_OUTPUT"]) expect(SCRIPT).toContain(v);
  });

  it("controle positivo: o gatilho labeled existe, senão pôr o rótulo não dispara nada", () => {
    expect(readFileSync(WORKFLOW, "utf-8")).toMatch(
      /^ {2}pull_request:\n(?: {4}.*\n)*? {4}types: \[opened, synchronize, reopened, labeled\]$/m,
    );
  });

  it("chave ligada, PR sem o rótulo: pula, e nem consulta os arquivos", () => {
    expect(responde({ evento: "pull_request", sobPedido: "ligado", arquivos: TELA })).toEqual({ e2e: "nao", chamouGh: false });
  });

  it("chave ligada, rótulo parecido não vale: só `e2e` exato", () => {
    for (const rotulos of ["e2e-depois", "sem-e2e", "E2E", "docs,e2e2"]) {
      expect(responde({ evento: "pull_request", sobPedido: "ligado", rotulos, arquivos: TELA }).e2e, rotulos).toBe("nao");
    }
  });

  it("chave ligada, PR com o rótulo: volta à régua de arquivos (tela roda, só doc pula)", () => {
    expect(responde({ evento: "pull_request", sobPedido: "ligado", rotulos: "bug,e2e", arquivos: TELA }).e2e).toBe("sim");
    expect(responde({ evento: "pull_request", sobPedido: "ligado", rotulos: "e2e", arquivos: SO_DOC }).e2e).toBe("nao");
    expect(responde({ evento: "pull_request", sobPedido: "ligado", rotulos: "e2e", ghFalha: true }).e2e).toBe("sim");
  });

  it("chave desligada, ausente ou com outro valor: régua de antes, rótulo nenhum muda nada", () => {
    for (const sobPedido of ["", "1", "sim", "LIGADO"]) {
      expect(responde({ evento: "pull_request", sobPedido, arquivos: TELA }).e2e, sobPedido || "<vazia>").toBe("sim");
      expect(responde({ evento: "pull_request", sobPedido, arquivos: SO_DOC }).e2e, sobPedido || "<vazia>").toBe("nao");
    }
  });

  it("fora de pull_request a main mede tudo, mesmo com a chave ligada", () => {
    expect(responde({ evento: "push", sobPedido: "ligado" })).toEqual({ e2e: "sim", chamouGh: false });
  });
});
