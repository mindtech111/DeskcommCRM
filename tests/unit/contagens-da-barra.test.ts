import { describe, expect, it } from "vitest";

import { contagensDoRecorte, type LinhaDeContagem } from "@/app/api/v1/conversations/counts/route";

const EU = "11111111-1111-4111-8111-111111111111";
const OUTRO = "22222222-2222-4222-8222-222222222222";

function linha(over: Partial<LinhaDeContagem> & Pick<LinhaDeContagem, "id">): LinhaDeContagem {
  return {
    status: "open",
    comando_da_conversa: "aguardando",
    assigned_to_user_id: null,
    ...over,
  };
}

describe("contagens da barra — uma passada, o mesmo formato", () => {
  const base = [
    linha({ id: "1", comando_da_conversa: "aguardando" }),
    linha({ id: "2", comando_da_conversa: "automatico", assigned_to_user_id: EU }),
    linha({ id: "3", comando_da_conversa: "humano", assigned_to_user_id: EU, status: "open" }),
    linha({ id: "4", comando_da_conversa: "humano", assigned_to_user_id: EU, status: "closed" }),
    linha({
      id: "5",
      comando_da_conversa: "humano",
      assigned_to_user_id: OUTRO,
      status: "archived",
    }),
    linha({
      id: "6",
      comando_da_conversa: "encerrada",
      assigned_to_user_id: OUTRO,
      status: "closed",
    }),
  ];

  it("separa as abas e mantém unassigned igual à fila", () => {
    const c = contagensDoRecorte(base, {
      userId: EU,
      comandosFila: ["aguardando"],
      atendenteEscolhido: null,
    });
    expect(c).toEqual({
      fila: 1,
      automatico: 1,
      unassigned: 1,
      mine: 2,
      all: 6,
      closed: 2,
      archived: 1,
    });
    expect(Object.keys(c).sort()).toEqual(
      ["all", "archived", "automatico", "closed", "fila", "mine", "unassigned"].sort(),
    );
  });

  it("Minhas ignora o atendente escolhido e não conta o que já fechou", () => {
    const c = contagensDoRecorte(base, {
      userId: EU,
      comandosFila: ["aguardando"],
      atendenteEscolhido: OUTRO,
    });
    expect(c.all).toBe(2);
    expect(c.mine).toBe(2);
    expect(c.closed).toBe(1);
    expect(c.archived).toBe(1);
    expect(c.fila).toBe(0);
  });

  it("uuid do atendente em maiúsculas conta o mesmo que a lista", () => {
    const c = contagensDoRecorte(
      [linha({ id: "9", assigned_to_user_id: OUTRO, comando_da_conversa: "humano" })],
      { userId: EU, comandosFila: ["aguardando"], atendenteEscolhido: OUTRO.toUpperCase() },
    );
    expect(c.all).toBe(1);
    expect(c.closed).toBe(0);
  });

  it("sem automático na org, a fila também conta o comando automatico", () => {
    const c = contagensDoRecorte(base, {
      userId: EU,
      comandosFila: ["aguardando", "automatico"],
      atendenteEscolhido: null,
    });
    expect(c.fila).toBe(2);
    expect(c.automatico).toBe(1);
    expect(c.unassigned).toBe(c.fila);
  });
});
