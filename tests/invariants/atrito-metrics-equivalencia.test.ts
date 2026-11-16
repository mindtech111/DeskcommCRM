import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { GOV_MANAGER, GOV_ORG, GOV_SESSION, lastLine, seedGov, sql } from "./gov-helpers";

/**
 * A reescrita de fn_atrito_metrics (migration 9408) tem de devolver o MESMO
 * jsonb da definição anterior. O oráculo é o corpo que estava no baseline,
 * criado aqui com outro nome — o banco do teste já tem a função nova, porque
 * o baseline aplicado é o de depois da migration.
 *
 * A fixture cobre o que a reescrita podia trocar em silêncio: mensagem antes
 * da janela que ainda está na vida da demanda, saída no mesmo instante (não
 * conta), saída depois de p_to (conta na espera), fala sem body (não entra no
 * lag) e repetição pós-passagem cuja resposta cai fora da janela mas dentro
 * das 24 h.
 */

const ORG = GOV_ORG;
const VIZ = "c0c00000-0000-4000-8000-0000000000bb";
const SESSION_VIZ = "c0c00000-0000-4000-8000-0000000000ff";
const CT = "c0c01111-0000-4000-8000-000000000001";
const CT2 = "c0c01111-0000-4000-8000-000000000002";
const CTV = "c0c01111-0000-4000-8000-000000000099";
const CV = "c0c02222-0000-4000-8000-000000000001";
const CV2 = "c0c02222-0000-4000-8000-000000000002";
const CVV = "c0c02222-0000-4000-8000-000000000099";
const CASO = "c0c03333-0000-4000-8000-000000000001";
const DEM = "c0c04444-0000-4000-8000-000000000001";
const DEMV = "c0c04444-0000-4000-8000-000000000099";
const DE = "2026-07-01T00:00:00Z";
const ATE = "2026-08-01T00:00:00Z";

const FALA = "qual o prazo de entrega do pedido";
const FALA_DE_NOVO = "qual o prazo de entrega desse pedido";
const FALA_PASSAGEM = "preciso trocar o produto que comprou com defeito na semana passada";
const FALA_PASSAGEM_DE_NOVO = "preciso trocar o produto que comprou com defeito na semana passada mesmo";

function chamar(fn: "fn_atrito_metrics" | "fn_atrito_metrics_antes", org: string, horas = 72): string {
  return lastLine(sql(`
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${GOV_MANAGER}"}', false);
    select public.${fn}('${org}'::uuid, '${DE}'::timestamptz, '${ATE}'::timestamptz, ${horas});
  `));
}

function iguais(org: string, horas = 72): string {
  return lastLine(sql(`
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${GOV_MANAGER}"}', false);
    select (
      public.fn_atrito_metrics('${org}'::uuid, '${DE}'::timestamptz, '${ATE}'::timestamptz, ${horas})
      = public.fn_atrito_metrics_antes('${org}'::uuid, '${DE}'::timestamptz, '${ATE}'::timestamptz, ${horas})
    )::text;
  `));
}

beforeAll(() => {
  seedGov();
  sql(readFileSync(join(process.cwd(), "tests/invariants/sql/fn_atrito_metrics_antes.sql"), "utf8"));
  sql(`
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${VIZ}', 'atrito-eq-viz', 'Vizinha Equivalencia', 'Vizinha');
    insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
      values ('${SESSION_VIZ}', '${VIZ}', 'atrito-eq-viz', '\\x00'::bytea);

    insert into public.contacts (id, organization_id, display_name) values
      ('${CT}', '${ORG}', 'Contato Equivalencia'),
      ('${CT2}', '${ORG}', 'Contato Passagem'),
      ('${CTV}', '${VIZ}', 'Contato Vizinho');
    insert into public.conversations
      (id, organization_id, contact_id, channel_session_id, status, last_outbound_at, last_inbound_at)
    values
      ('${CV}', '${ORG}', '${CT}', '${GOV_SESSION}', 'open', '2026-07-20T12:00:00Z', '2026-07-20T10:00:00Z'),
      ('${CV2}', '${ORG}', '${CT2}', '${GOV_SESSION}', 'open', '2026-07-21T10:00:00Z', '2026-07-22T10:00:00Z'),
      ('${CVV}', '${VIZ}', '${CTV}', '${SESSION_VIZ}', 'open', '2026-07-20T12:00:00Z', '2026-07-20T10:00:00Z');

    insert into public.agent_cases
      (id, organization_id, conversation_id, status, title, summary, blocker, followup_attempts, opened_at, closed_at)
    values
      ('${CASO}', '${ORG}', '${CV}', 'resolved', 'Caso', 'resumo', 'bloqueio', 4, '2026-06-20T10:00:00Z', '2026-07-06T10:00:00Z');

    insert into public.demandas
      (id, organization_id, contact_id, agent_case_id, aberta_em, origem, estado, dono_kind, desfecho, fechada_em)
    values
      ('${DEM}', '${ORG}', '${CT}', '${CASO}', '2026-06-20T10:00:00Z', 'handoff', 'resolvida', 'ia', 'resolvida', '2026-07-06T10:00:00Z'),
      ('${DEMV}', '${VIZ}', '${CTV}', null, '2026-07-02T10:00:00Z', 'handoff', 'resolvida', 'ia', 'resolvida', '2026-07-03T10:00:00Z');
    insert into public.demanda_conversas (organization_id, demanda_id, conversation_id) values
      ('${ORG}', '${DEM}', '${CV}'),
      ('${VIZ}', '${DEMV}', '${CVV}');

    insert into public.messages
      (organization_id, conversation_id, channel_session_id, contact_id, type, direction, status, sent_via, body, sent_at)
    values
      ('${ORG}', '${CV}', '${GOV_SESSION}', '${CT}', 'text', 'inbound', 'received', 'ai', 'antes da janela', '2026-06-21T10:00:00Z'),
      ('${ORG}', '${CV}', '${GOV_SESSION}', '${CT}', 'text', 'outbound', 'sent', 'ai', null, '2026-07-05T10:00:00Z'),
      ('${ORG}', '${CV}', '${GOV_SESSION}', '${CT}', 'text', 'inbound', 'received', 'ai', '${FALA}', '2026-07-05T10:00:00Z'),
      ('${ORG}', '${CV}', '${GOV_SESSION}', '${CT}', 'text', 'inbound', 'received', 'ai', null, '2026-07-05T10:20:00Z'),
      ('${ORG}', '${CV}', '${GOV_SESSION}', '${CT}', 'text', 'outbound', 'sent', 'ai', null, '2026-07-05T10:30:00Z'),
      ('${ORG}', '${CV}', '${GOV_SESSION}', '${CT}', 'text', 'inbound', 'received', 'ai', '${FALA_DE_NOVO}', '2026-07-05T11:00:00Z'),
      ('${ORG}', '${CV}', '${GOV_SESSION}', '${CT}', 'text', 'inbound', 'received', 'ai', 'ainda sem resposta na janela', '2026-07-28T10:00:00Z'),
      ('${ORG}', '${CV}', '${GOV_SESSION}', '${CT}', 'text', 'outbound', 'sent', 'user', null, '2026-08-02T10:00:00Z'),
      ('${ORG}', '${CV2}', '${GOV_SESSION}', '${CT2}', 'text', 'inbound', 'received', 'ai', '${FALA_PASSAGEM}', '2026-07-31T18:00:00Z'),
      ('${ORG}', '${CV2}', '${GOV_SESSION}', '${CT2}', 'text', 'inbound', 'received', 'ai', '${FALA_PASSAGEM_DE_NOVO}', '2026-08-01T12:00:00Z'),
      ('${VIZ}', '${CVV}', '${SESSION_VIZ}', '${CTV}', 'text', 'inbound', 'received', 'ai', 'vizinha', '2026-07-02T11:00:00Z');

    insert into public.passagens_de_atendimento
      (organization_id, contact_id, conversation_id, motor, origem, motivo_codigo, body, criado_em)
    values
      ('${ORG}', '${CT2}', '${CV2}', 'engine', 'pedido_explicito', 'requested_human', 'a narrativa', '2026-07-31T20:00:00Z');
  `);
});

describe("fn_atrito_metrics — o resultado novo é o antigo", () => {
  it("a função continua security invoker", () => {
    expect(lastLine(sql(`select prosecdef::text from pg_proc where proname = 'fn_atrito_metrics';`))).toBe(
      "false",
    );
  });

  it("o jsonb inteiro coincide com o corpo anterior, na régua padrão", () => {
    expect(iguais(ORG)).toBe("true");
  });

  it("coincide também quando a régua de abandono muda", () => {
    expect(iguais(ORG, 24 * 365 * 50)).toBe("true");
  });

  it("a mensagem de antes da janela entra no turno, e a saída do mesmo instante não responde", () => {
    const m = JSON.parse(chamar("fn_atrito_metrics", ORG)) as {
      escopo: { demandas: number };
      cliente: {
        turnos_p50: number;
        reperguntas: number;
        perguntas_com_resposta: number;
        esperas_medidas: number;
        esperas_caladas: number;
        passagens_medidas: number;
        repeticao_pos_passagem: number;
        abandonos: number;
        conversas_com_fala_nossa: number;
      };
    };
    // Vida da demanda: 20/06–06/07. Seis mensagens nesse intervalo, uma delas
    // em junho — a de body nulo também conta turno. p50 de um único valor é
    // o próprio valor.
    expect(m.escopo.demandas).toBe(1);
    expect(m.cliente.turnos_p50).toBe(6);
    expect(m.cliente.reperguntas).toBe(1);
    expect(m.cliente.perguntas_com_resposta).toBe(1);
    // Quatro inbounds na janela (um sem body). Dois só são respondidos em agosto.
    expect(m.cliente.esperas_medidas).toBe(4);
    expect(m.cliente.esperas_caladas).toBe(2);
    expect(m.cliente.passagens_medidas).toBe(1);
    expect(m.cliente.repeticao_pos_passagem).toBe(1);
    expect(m.cliente.conversas_com_fala_nossa).toBe(2);
    expect(m.cliente.abandonos).toBe(1);
  });

  it("a organização vizinha não entra, nas duas funções", () => {
    const antigo = JSON.parse(chamar("fn_atrito_metrics_antes", VIZ)) as { escopo: { demandas: number } };
    const novo = JSON.parse(chamar("fn_atrito_metrics", VIZ)) as { escopo: { demandas: number } };
    expect(antigo.escopo.demandas).toBe(0);
    expect(novo.escopo.demandas).toBe(0);
  });
});
