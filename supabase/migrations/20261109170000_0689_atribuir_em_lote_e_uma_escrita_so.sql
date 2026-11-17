-- manifest: **Atribuir em lote é uma escrita só.** `fn_atribuir_leads_em_lote` troca (ou tira) o dono de até 1000 negócios numa sentença só, tudo ou nada, no lugar dos lotes de 50 que a rota `leads/bulk` aplicava um por um (incidente de 09/11/2026: 50 de 175 mudaram). O gatilho do lead segue emitindo um `lead.assigned` por negócio (gatilho de webhook e automação do cliente) e passa a carimbar `lote_id` quando a troca vem da função, para o push mandar UM aviso pelo `lead.bulk_assigned` — que ganhou consumidor e sai da lista de registro (0239). Idempotente: `create or replace`; apêndice igual no fim do `baseline.sql`.

-- ============================================================================
-- 0689 — ATRIBUIR EM LOTE É UMA ESCRITA SÓ
--
-- Incidente de 09/11/2026 (instalação de clínica): uma reatribuição em lote
-- tocou 50 negócios de um funil de 175. A rota aplicava o lote em chamadas de
-- 50, uma transação por chamada; sob latência alta (p95 de 20 a 50 s naquele
-- dia) uma chamada que falha deixa as anteriores aplicadas e as seguintes não —
-- "atribuí 175" vira "50 mudaram de dono, 125 não", sem que a tela consiga
-- dizer quais. (Que foi ESTE o mecanismo do incidente é hipótese: o banco
-- registrou uma chamada só, de 50 ids, e chamada que falha não deixa evento.)
--
-- Três peças, e as três andam juntas:
--
-- (1) `fn_atribuir_leads_em_lote` — troca o dono de até 1000 negócios numa
--     sentença só (tudo ou nada). 1000 é o `max_rows` do PostgREST deste
--     produto, isto é, o maior quadro que a tela consegue mostrar e selecionar.
--     `security invoker`: a RLS de UPDATE de `crm_leads` vale como valia para o
--     UPDATE que a rota fazia pela sessão. Quem valida o NOVO dono (membro ativo
--     agent+ da org) continua sendo a rota, com service role — a função não
--     sabe ler `user_organizations` alheio pela RLS, e não deve.
--     `p_owner_user_id` null = tirar o dono (ação `unassign` da rota); o trio
--     de posse sai coerente com a 0070 nos dois casos.
--
-- (2) O gatilho do lead continua emitindo UM `lead.assigned` por negócio — é o
--     FATO, e é gatilho que o cliente configura em webhook e automação
--     ("Quando o responsável do lead mudar"). Calar o evento no lote calaria
--     essas regras em silêncio. O que muda: dentro da função acima o gatilho
--     carimba `lote_id` no payload, e o consumidor de push usa o carimbo para
--     mandar UM aviso pelo agregado em vez de N (ver (3)).
--     A chave `deskcomm.lote_de_atribuicao` segue o desenho da
--     `deskcomm.desfecho_pelo_negocio` (0581): de transação, posta e tirada
--     pela própria função, inalcançável pela REST (`set_config` mora em
--     `pg_catalog`). Forjá-la só serviria para o próprio chamador perder o
--     push de uma atribuição que ele mesmo fez.
--
-- (3) `lead.bulk_assigned` ganhou consumidor (o push único ao novo dono) e por
--     isso sai da lista de registro (`fn_event_log_e_registro`, 0239): tipo
--     consumido que nasce `done` nunca chega ao drain.
--
-- Idempotente (`create or replace`); apêndice igual no fim do `baseline.sql`.
-- ============================================================================

create or replace function public.fn_atribuir_leads_em_lote(
  p_organization_id uuid,
  p_lead_ids uuid[],
  p_owner_user_id uuid default null,
  p_lote_id uuid default null
) returns table (lead_id uuid)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_antes text;
begin
  if coalesce(cardinality(p_lead_ids), 0) > 1000 then
    raise exception 'bulk_too_large' using errcode = '22023',
      hint = 'fn_atribuir_leads_em_lote: no máximo 1000 negócios por chamada';
  end if;

  v_antes := current_setting('deskcomm.lote_de_atribuicao', true);
  perform set_config('deskcomm.lote_de_atribuicao', coalesce(p_lote_id::text, ''), true);

  return query
    update public.crm_leads l
       set owner_user_id  = p_owner_user_id,
           owner_agent_id = null,
           owner_kind     = case when p_owner_user_id is null then null else 'user' end,
           assigned_at    = case when p_owner_user_id is null then l.assigned_at else now() end,
           updated_at     = now()
     where l.organization_id = p_organization_id
       and l.id = any(p_lead_ids)
    returning l.id;

  perform set_config('deskcomm.lote_de_atribuicao', coalesce(v_antes, ''), true);
end;
$$;

comment on function public.fn_atribuir_leads_em_lote(uuid, uuid[], uuid, uuid) is
  'Troca o dono de até 1000 negócios numa escrita só (tudo ou nada), com o trio de posse da 0070 coerente. p_owner_user_id null tira o dono. Carimba lote_id no lead.assigned de cada negócio (chave de transação deskcomm.lote_de_atribuicao) para o push mandar um aviso só pelo lead.bulk_assigned. Quem valida o novo dono é a rota POST /api/v1/leads/bulk. Migration 0689.';

revoke all     on function public.fn_atribuir_leads_em_lote(uuid, uuid[], uuid, uuid) from public;
revoke execute on function public.fn_atribuir_leads_em_lote(uuid, uuid[], uuid, uuid) from anon;
grant  execute on function public.fn_atribuir_leads_em_lote(uuid, uuid[], uuid, uuid)
  to authenticated, service_role;

create or replace function public.fn_emit_event_on_lead_change() returns trigger
    language plpgsql
    set search_path to 'public', 'pg_temp'
    as $$
declare
  v_antes text;
  v_lote text;
begin
  if tg_op = 'INSERT' then
    return new;
  end if;

  -- O negócio se anuncia: `auth.uid()` segue preenchido aqui (o UPDATE veio da
  -- sessão de quem moveu o card), e sem este sinal a reserva do `emit_event`
  -- calaria o próprio gatilho. A chave é de transação e volta ao valor anterior
  -- antes do `return` — a janela é este corpo, não o resto da transação.
  v_antes := current_setting('deskcomm.desfecho_pelo_negocio', true);
  perform set_config('deskcomm.desfecho_pelo_negocio', 'on', true);

  if new.status is distinct from old.status then
    if new.status = 'won' then
      perform public.fn_log_event(new.organization_id, 'lead.won',
        jsonb_build_object('lead_id', new.id, 'value_cents', new.value_cents));
    elsif new.status = 'lost' then
      perform public.fn_log_event(new.organization_id, 'lead.lost',
        jsonb_build_object('lead_id', new.id, 'lost_reason', new.lost_reason));
    elsif new.status = 'open' then
      perform public.fn_log_event(new.organization_id, 'lead.reopened',
        jsonb_build_object('lead_id', new.id));
    end if;
  end if;

  if new.owner_user_id is distinct from old.owner_user_id
     or new.owner_agent_id is distinct from old.owner_agent_id then
    -- 0689: dentro de `fn_atribuir_leads_em_lote` o evento leva o lote. O fato
    -- continua um por negócio; o carimbo só diz que ele veio de um lote.
    v_lote := nullif(current_setting('deskcomm.lote_de_atribuicao', true), '');
    perform public.fn_log_event(new.organization_id, 'lead.assigned',
      jsonb_build_object(
        'lead_id', new.id,
        'from_user_id', old.owner_user_id, 'to_user_id', new.owner_user_id,
        'from_agent_id', old.owner_agent_id, 'to_agent_id', new.owner_agent_id,
        'owner_kind', new.owner_kind)
      || case when v_lote is null then '{}'::jsonb else jsonb_build_object('lote_id', v_lote) end);
  end if;

  perform set_config('deskcomm.desfecho_pelo_negocio', coalesce(v_antes, ''), true);
  return new;
end$$;

-- (3) `lead.bulk_assigned` sai da lista de registro: ganhou o consumidor de push.
create or replace function public.fn_event_log_e_registro(p_event_type text)
returns boolean
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select p_event_type = any (array[
    -- IA e agente
    'ai.responded',
    'ai_agent.created',
    'ai_agent.published',
    'ai_agent.run_completed',
    'ai_agent.run_failed',
    'ai_agent.run_started',
    -- agente (harness) — o motor registra quando não há negócio para pendurar
    'agent.activity_unrouted',
    -- canal e conversa
    'channel_session.status_changed',
    'conversation.claimed',
    'conversation.transferred',
    'whatsapp.chat_id_not_recognized',
    'whatsapp.conversation_mark_failed',
    -- contato, lead, organização e plataforma ('lead.reopened' saiu na 0534 e 'lead.bulk_assigned' na 0689: ganharam consumidor)
    'contact.anonymized',
    'contact.created',
    'contact.deleted',
    'contact.updated',
    'crm.activity_write_failed',
    'incident.resolved',
    'lead.bulk_deleted',
    'lead.bulk_tagged',
    'lead.risk_backlog_seeded',
    'lead.updated',
    'org.updated',
    'tenant.onboarded',
    'tenant.reactivated',
    'tenant.suspended',
    'user.profile_updated',
    -- mensagem ('message.failed' saiu aqui na 0417: ele ganhou consumidor)
    'message.outbound',
    'message.sending',
    'message.sent',
    -- LGPD
    'lgpd.export_delivered',
    'lgpd.export_generated',
    'lgpd.redact_applied',
    'lgpd.redact_failed'
  ]::text[]);
$$;

revoke all on function public.fn_event_log_e_registro(text) from public, anon;
grant execute on function public.fn_event_log_e_registro(text) to authenticated, service_role;

notify pgrst, 'reload schema';
