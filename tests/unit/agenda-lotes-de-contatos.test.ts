import { describe, expect, it, vi } from "vitest";

import { protecaoAgendaSupabase } from "@/lib/agenda/protecao-followup";
import { logger } from "@/lib/logger";

const AGORA = new Date("2026-09-06T12:00:00Z");

describe("proteção da agenda — .in de contatos em lotes de 100", () => {
  it("250 contatos viram lotes de no máximo 100 e a organização é lida uma vez", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `c-${i.toString().padStart(3, "0")}`);
    const lotes: string[][] = [];
    let leiturasDaOrg = 0;
    const db = {
      from(tabela: string) {
        const filtros: Array<(linha: { id: string; contact_id: string }) => boolean> = [];
        let depois = false;
        const q = {
          select: () => q,
          eq: () => q,
          in: (coluna: string, valores: string[]) => {
            if (tabela === "calendar_appointments" && coluna === "contact_id")
              lotes.push([...valores]);
            filtros.push((linha) => coluna !== "contact_id" || valores.includes(linha.contact_id));
            return q;
          },
          order: () => q,
          limit: () => q,
          gt: () => {
            depois = true;
            return q;
          },
          single: async () => {
            leiturasDaOrg += 1;
            return { data: { settings: {} }, error: null };
          },
          then: (ok: (v: unknown) => unknown) => {
            const linha = {
              id: "appt-1",
              contact_id: "c-000",
              revision: 1,
              status: "confirmed",
              starts_at: "2099-01-01T12:00:00Z",
              ends_at: "2099-01-01T13:00:00Z",
            };
            const data =
              tabela === "calendar_appointments" && !depois && filtros.every((f) => f(linha))
                ? [linha, linha]
                : [];
            return Promise.resolve({ data, error: null }).then(ok);
          },
        };
        return q;
      },
    };
    const mapa = await protecaoAgendaSupabase(db as never, "org", [...ids, ids[0]!], AGORA);
    const distintos = [...new Map(lotes.map((lote) => [lote.join(","), lote])).values()];
    expect(distintos.length).toBeGreaterThan(1);
    expect(distintos.every((lote) => lote.length <= 100)).toBe(true);
    expect(distintos.flat()).toHaveLength(250);
    expect(leiturasDaOrg).toBe(1);
    expect(mapa.get("c-000")).toMatchObject({ adiar: true, appointment_id: "appt-1" });
    expect(mapa.get("c-249")).toMatchObject({ adiar: false, motivo: "sem_compromisso" });
    expect(mapa.size).toBe(250);
  });

  it("falha no lote registra a tabela uma vez, não uma linha por contato", async () => {
    const erro = vi.spyOn(logger, "error").mockImplementation(() => {});
    const db = {
      from() {
        const q = {
          select: () => q,
          eq: () => q,
          in: () => q,
          order: () => q,
          limit: () => q,
          gt: () => q,
          then: (ok: (v: unknown) => unknown) =>
            Promise.resolve({
              data: null,
              error: { message: "URI too long", code: "PGRST100" },
            }).then(ok),
        };
        return q;
      },
    };
    const ids = ["a", "b", "c"];
    const mapa = await protecaoAgendaSupabase(db as never, "org", ids, AGORA);
    expect([...mapa.values()].every((p) => p.motivo === "leitura_indisponivel" && p.adiar)).toBe(
      true,
    );
    expect(erro).toHaveBeenCalledOnce();
    expect(erro).toHaveBeenCalledWith(
      "[agenda] proteção indisponível; cobrança adiada",
      expect.objectContaining({ step: "calendar_appointments", code: "PGRST100", contatos: 3 }),
    );
    erro.mockRestore();
  });
});
