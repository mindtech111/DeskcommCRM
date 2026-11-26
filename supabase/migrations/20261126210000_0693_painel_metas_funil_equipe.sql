-- manifest: Metas da clínica, funil do período e comparativo de quem vende no painel — tabela com RLS por organização e RPC security invoker, sem nome de pessoa no código.
-- 0693: metas, funil e equipe do painel
--
-- Não havia onde gravar meta comercial. As tabelas `meta_*` são anúncio
-- (Meta Ads), não alvo de venda. A meta mora aqui, uma linha por organização.
-- Quem lê é membro da organização. Quem grava pela REST autenticada, ninguém:
-- insert/update/delete ficam só no service_role. A rota prova MFA (requireRole),
-- o acompanhamento e o papel, e grava com a organização da sessão. A policy de
-- escrita continua no arquivo para o grant não voltar aberto: gerente, ou admin
-- de plataforma com escopo full, e o acompanhamento só de leitura não escreve.
-- fn_session_mfa_proven não entra na policy — authenticated não executa essa
-- função. A prova de MFA mora na rota, que é a única porta de escrita.
--
-- fn_painel_comercial é SECURITY INVOKER, no mesmo molde de fn_painel_diario
-- (0692): a RLS de leads, atividades, mensagens, etapas, conversas e membros
-- continua valendo. p_org é a organização ativa, resolvida na rota. O fuso
-- dos dias é America/Sao_Paulo, o mesmo de lib/metrics/painel-periodo.ts.
-- Nomes de pessoa NÃO saem daqui: só o user_id. A rota resolve o nome.
--
-- Funil: lead novo é crm_leads.created_at na janela. Em atendimento, consulta
-- agendada e consulta realizada são entradas stage_changed cujo nome ATUAL da
-- etapa, depois de trim e minúsculas, é exatamente esse — a mesma régua da
-- 0692 para as duas consultas. Ganho é status won com closed_at na janela.
-- Lead que já nasce na etapa, sem stage_changed, não entra nas três do meio.
--
-- Quem entra no comparativo: membro com papel agent (o papel de vendas) ainda
-- aceito, ou quem é o responsável atual de lead criado, ganho ou movido nessas
-- etapas na janela, ou quem enviou mensagem humana, ou o responsável atual da
-- conversa que recebeu mensagem na janela. O dono é o owner_user_id de agora,
-- não um histórico de atribuição — o produto não guarda o dono no instante da
-- criação.

create table if not exists public.painel_metas (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  leads_atendidos_dia integer,
  agendamentos_dia integer,
  consultas_realizadas_dia integer,
  vendas_dia integer,
  valor_cents_dia bigint,
  leads_atendidos_mes integer,
  agendamentos_mes integer,
  consultas_realizadas_mes integer,
  vendas_mes integer,
  valor_cents_mes bigint,
  moeda text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.painel_metas drop constraint if exists painel_metas_moeda;
alter table public.painel_metas
  add constraint painel_metas_moeda
  check (moeda is null or moeda ~ '^[A-Z]{3}$');

alter table public.painel_metas drop constraint if exists painel_metas_nao_negativo;
alter table public.painel_metas
  add constraint painel_metas_nao_negativo
  check (
    (leads_atendidos_dia is null or leads_atendidos_dia >= 0)
    and (agendamentos_dia is null or agendamentos_dia >= 0)
    and (consultas_realizadas_dia is null or consultas_realizadas_dia >= 0)
    and (vendas_dia is null or vendas_dia >= 0)
    and (valor_cents_dia is null or valor_cents_dia >= 0)
    and (leads_atendidos_mes is null or leads_atendidos_mes >= 0)
    and (agendamentos_mes is null or agendamentos_mes >= 0)
    and (consultas_realizadas_mes is null or consultas_realizadas_mes >= 0)
    and (vendas_mes is null or vendas_mes >= 0)
    and (valor_cents_mes is null or valor_cents_mes >= 0)
  );

comment on table public.painel_metas is
  'Meta diária e, se a organização quiser, mensal do painel (/app/painel). Uma linha por organização. Sem linha, a tela mostra o realizado e convida a definir a meta.';

alter table public.painel_metas enable row level security;

drop policy if exists tenant_isolation_painel_metas_select on public.painel_metas;
create policy tenant_isolation_painel_metas_select
  on public.painel_metas
  for select
  using (organization_id in (select public.fn_user_org_ids()));

drop policy if exists tenant_isolation_painel_metas_insert on public.painel_metas;
create policy tenant_isolation_painel_metas_insert
  on public.painel_metas
  for insert
  with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_support_write_allowed(organization_id)
    and (
      public.fn_role_at_least(organization_id, 'manager')
      or public.fn_is_platform_admin_full()
    )
  );

drop policy if exists tenant_isolation_painel_metas_update on public.painel_metas;
create policy tenant_isolation_painel_metas_update
  on public.painel_metas
  for update
  using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_support_write_allowed(organization_id)
    and (
      public.fn_role_at_least(organization_id, 'manager')
      or public.fn_is_platform_admin_full()
    )
  )
  with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_support_write_allowed(organization_id)
    and (
      public.fn_role_at_least(organization_id, 'manager')
      or public.fn_is_platform_admin_full()
    )
  );

drop policy if exists tenant_isolation_painel_metas_delete on public.painel_metas;
create policy tenant_isolation_painel_metas_delete
  on public.painel_metas
  for delete
  using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_support_write_allowed(organization_id)
    and (
      public.fn_role_at_least(organization_id, 'manager')
      or public.fn_is_platform_admin_full()
    )
  );

-- Escrita autenticada revogada de propósito. O PostgREST com o JWT da sessão
-- não grava meta: pularia o MFA e a auditoria da rota. authenticated só lê.
revoke all on table public.painel_metas from public, anon, authenticated;
grant select on table public.painel_metas to authenticated;
grant all on table public.painel_metas to service_role;

drop trigger if exists trg_painel_metas_updated_at on public.painel_metas;
create trigger trg_painel_metas_updated_at
  before update on public.painel_metas
  for each row execute function public.fn_set_updated_at();

create or replace function public.fn_painel_comercial(
  p_org uuid,
  p_inicio timestamptz,
  p_fim timestamptz
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_funil jsonb;
  v_equipe jsonb;
begin
  if p_org is null
     or p_inicio is null
     or p_fim is null
     or p_inicio >= p_fim
     or (p_fim - p_inicio) > interval '32 days'
  then
    return jsonb_build_object('erro', 'janela_invalida');
  end if;

  with entradas as (
    select lower(btrim(s.name)) as nome
    from public.crm_lead_activities a
    join public.crm_stages s
      on s.organization_id = a.organization_id
     and s.id = (
       case
         when coalesce(a.payload->>'to_stage_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         then (a.payload->>'to_stage_id')::uuid
         else null
       end
     )
    where a.organization_id = p_org
      and a.type = 'stage_changed'
      and a.performed_at >= p_inicio
      and a.performed_at < p_fim
  ),
  totais as (
    select
      (select count(*)::int from public.crm_leads l
        where l.organization_id = p_org
          and l.created_at >= p_inicio
          and l.created_at < p_fim) as lead_novo,
      (select count(*)::int from entradas where nome = 'em atendimento') as em_atendimento,
      (select count(*)::int from entradas where nome = 'consulta agendada') as consulta_agendada,
      (select count(*)::int from entradas where nome = 'consulta realizada') as consulta_realizada,
      (select count(*)::int from public.crm_leads l
        where l.organization_id = p_org
          and l.status = 'won'
          and l.closed_at >= p_inicio
          and l.closed_at < p_fim) as ganho
  )
  select jsonb_build_object(
    'etapas', jsonb_build_array(
      jsonb_build_object('id', 'lead_novo', 'total', lead_novo),
      jsonb_build_object('id', 'em_atendimento', 'total', em_atendimento),
      jsonb_build_object('id', 'consulta_agendada', 'total', consulta_agendada),
      jsonb_build_object('id', 'consulta_realizada', 'total', consulta_realizada),
      jsonb_build_object('id', 'ganho', 'total', ganho)
    ),
    'conversoes', jsonb_build_array(
      jsonb_build_object(
        'de', 'lead_novo',
        'para', 'em_atendimento',
        'taxa', case when lead_novo > 0 then round(em_atendimento::numeric / lead_novo, 4) else null end
      ),
      jsonb_build_object(
        'de', 'em_atendimento',
        'para', 'consulta_agendada',
        'taxa', case when em_atendimento > 0 then round(consulta_agendada::numeric / em_atendimento, 4) else null end
      ),
      jsonb_build_object(
        'de', 'consulta_agendada',
        'para', 'consulta_realizada',
        'taxa', case when consulta_agendada > 0 then round(consulta_realizada::numeric / consulta_agendada, 4) else null end
      ),
      jsonb_build_object(
        'de', 'consulta_realizada',
        'para', 'ganho',
        'taxa', case when consulta_realizada > 0 then round(ganho::numeric / consulta_realizada, 4) else null end
      )
    )
  ) into v_funil
  from totais;

  with dias as (
    select gs::date as dia
    from generate_series(
      (p_inicio at time zone 'America/Sao_Paulo')::date,
      ((p_fim - interval '1 microsecond') at time zone 'America/Sao_Paulo')::date,
      interval '1 day'
    ) as gs
  ),
  leads_novos as (
    select l.owner_user_id, (l.created_at at time zone 'America/Sao_Paulo')::date as dia
    from public.crm_leads l
    where l.organization_id = p_org
      and l.created_at >= p_inicio
      and l.created_at < p_fim
  ),
  entradas as (
    select lower(btrim(s.name)) as nome, l.owner_user_id
    from public.crm_lead_activities a
    join public.crm_leads l
      on l.organization_id = a.organization_id
     and l.id = a.lead_id
    join public.crm_stages s
      on s.organization_id = a.organization_id
     and s.id = (
       case
         when coalesce(a.payload->>'to_stage_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         then (a.payload->>'to_stage_id')::uuid
         else null
       end
     )
    where a.organization_id = p_org
      and a.type = 'stage_changed'
      and a.performed_at >= p_inicio
      and a.performed_at < p_fim
  ),
  ganhos as (
    select l.owner_user_id, l.currency as moeda, l.value_cents
    from public.crm_leads l
    where l.organization_id = p_org
      and l.status = 'won'
      and l.closed_at >= p_inicio
      and l.closed_at < p_fim
  ),
  msgs as (
    select m.sent_by_user_id as user_id
    from public.messages m
    where m.organization_id = p_org
      and m.direction = 'outbound'
      and m.sent_by_user_id is not null
      and m.status in ('sent', 'delivered', 'read')
      and m.sent_at >= p_inicio
      and m.sent_at < p_fim
  ),
  responsaveis_conversa as (
    select distinct c.assigned_to_user_id as user_id
    from public.messages m
    join public.conversations c
      on c.organization_id = m.organization_id
     and c.id = m.conversation_id
    where m.organization_id = p_org
      and m.direction = 'inbound'
      and m.sent_at >= p_inicio
      and m.sent_at < p_fim
      and c.assigned_to_user_id is not null
  ),
  inbounds as (
    select m.conversation_id, min(m.sent_at) as primeiro
    from public.messages m
    where m.organization_id = p_org
      and m.direction = 'inbound'
      and m.sent_at >= p_inicio
      and m.sent_at < p_fim
    group by m.conversation_id
  ),
  novas as (
    select i.conversation_id, i.primeiro
    from inbounds i
    where not exists (
      select 1
      from public.messages anterior
      where anterior.organization_id = p_org
        and anterior.conversation_id = i.conversation_id
        and anterior.direction = 'inbound'
        and anterior.sent_at < p_inicio
    )
  ),
  primeira_humana as (
    select n.primeiro, o.sent_by_user_id as quem, o.sent_at as saida
    from novas n
    join lateral (
      select o.sent_by_user_id, o.sent_at
      from public.messages o
      where o.organization_id = p_org
        and o.conversation_id = n.conversation_id
        and o.direction = 'outbound'
        and o.status in ('sent', 'delivered', 'read')
        and o.sent_by_user_id is not null
        and o.sent_at >= n.primeiro
        and o.sent_at < p_fim
      order by o.sent_at
      limit 1
    ) o on true
  ),
  agentes as (
    select uo.user_id
    from public.user_organizations uo
    where uo.organization_id = p_org
      and uo.role = 'agent'
      and uo.accepted_at is not null
      and uo.revoked_at is null
  ),
  pessoas as (
    select user_id from agentes
    union
    select owner_user_id from leads_novos where owner_user_id is not null
    union
    select owner_user_id from ganhos where owner_user_id is not null
    union
    select owner_user_id from entradas
      where owner_user_id is not null
        and nome in ('em atendimento', 'consulta agendada', 'consulta realizada')
    union
    select user_id from msgs
    union
    select user_id from responsaveis_conversa
  ),
  metricas as (
    select
      p.user_id,
      (
        select uo.role
        from public.user_organizations uo
        where uo.organization_id = p_org
          and uo.user_id = p.user_id
          and uo.accepted_at is not null
          and uo.revoked_at is null
        limit 1
      ) as papel,
      coalesce(ln.leads_recebidos, 0) as leads_recebidos,
      coalesce(ms.mensagens_enviadas, 0) as mensagens_enviadas,
      rp.p50_segundos,
      coalesce(rp.amostra_resposta, 0) as amostra_resposta,
      coalesce(ag.agendamentos, 0) as agendamentos,
      coalesce(cr.consultas_realizadas, 0) as consultas_realizadas,
      coalesce(gv.vendas, 0) as vendas
    from pessoas p
    left join (
      select owner_user_id, count(*)::int as leads_recebidos
      from leads_novos
      where owner_user_id is not null
      group by owner_user_id
    ) ln on ln.owner_user_id = p.user_id
    left join (
      select user_id, count(*)::int as mensagens_enviadas
      from msgs
      group by user_id
    ) ms on ms.user_id = p.user_id
    left join (
      select quem as user_id,
             count(*)::int as amostra_resposta,
             round((percentile_cont(0.5) within group (
               order by extract(epoch from (saida - primeiro))
             ))::numeric, 1) as p50_segundos
      from primeira_humana
      group by quem
    ) rp on rp.user_id = p.user_id
    left join (
      select owner_user_id, count(*)::int as agendamentos
      from entradas
      where nome = 'consulta agendada' and owner_user_id is not null
      group by owner_user_id
    ) ag on ag.owner_user_id = p.user_id
    left join (
      select owner_user_id, count(*)::int as consultas_realizadas
      from entradas
      where nome = 'consulta realizada' and owner_user_id is not null
      group by owner_user_id
    ) cr on cr.owner_user_id = p.user_id
    left join (
      select owner_user_id, count(*)::int as vendas
      from ganhos
      where owner_user_id is not null
      group by owner_user_id
    ) gv on gv.owner_user_id = p.user_id
  ),
  ordenadas as (
    select m.*, row_number() over (order by m.leads_recebidos desc, m.user_id) as pos
    from metricas m
  )
  select jsonb_build_object(
    'truncada', (select count(*) > 40 from pessoas),
    'pessoas', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'user_id', o.user_id,
          'papel', o.papel,
          'leads_recebidos', o.leads_recebidos,
          'por_dia', (
            select coalesce(jsonb_agg(
              jsonb_build_object(
                'dia', to_char(d.dia, 'YYYY-MM-DD'),
                'total', coalesce(n.total, 0)
              )
              order by d.dia
            ), '[]'::jsonb)
            from dias d
            left join (
              select ln.dia, count(*)::int as total
              from leads_novos ln
              where ln.owner_user_id = o.user_id
              group by ln.dia
            ) n on n.dia = d.dia
          ),
          'mensagens_enviadas', o.mensagens_enviadas,
          'p50_segundos', o.p50_segundos,
          'amostra_resposta', o.amostra_resposta,
          'agendamentos', o.agendamentos,
          'consultas_realizadas', o.consultas_realizadas,
          'vendas', o.vendas,
          'valor_por_moeda', (
            select coalesce(jsonb_agg(jsonb_build_object(
              'moeda', g.moeda,
              'quantidade', g.quantidade,
              'valor_cents', g.valor_cents
            ) order by g.moeda nulls last), '[]'::jsonb)
            from (
              select ga.moeda,
                     count(*)::int as quantidade,
                     coalesce(sum(ga.value_cents), 0)::bigint as valor_cents
              from ganhos ga
              where ga.owner_user_id = o.user_id
              group by ga.moeda
            ) g
          ),
          'conversao', case
            when o.leads_recebidos > 0 then round(o.vendas::numeric / o.leads_recebidos, 4)
            else null
          end
        )
        order by o.leads_recebidos desc, o.user_id
      )
      from ordenadas o
      where o.pos <= 40
    ), '[]'::jsonb),
    'sem_responsavel', jsonb_build_object(
      'leads_recebidos', (select count(*)::int from leads_novos where owner_user_id is null),
      'agendamentos', (
        select count(*)::int from entradas
        where nome = 'consulta agendada' and owner_user_id is null
      ),
      'consultas_realizadas', (
        select count(*)::int from entradas
        where nome = 'consulta realizada' and owner_user_id is null
      ),
      'vendas', (select count(*)::int from ganhos where owner_user_id is null),
      'valor_por_moeda', coalesce((
        select jsonb_agg(jsonb_build_object(
          'moeda', g.moeda,
          'quantidade', g.quantidade,
          'valor_cents', g.valor_cents
        ) order by g.moeda nulls last)
        from (
          select ga.moeda,
                 count(*)::int as quantidade,
                 coalesce(sum(ga.value_cents), 0)::bigint as valor_cents
          from ganhos ga
          where ga.owner_user_id is null
          group by ga.moeda
        ) g
      ), '[]'::jsonb)
    )
  ) into v_equipe;

  return jsonb_build_object('funil', v_funil, 'equipe', v_equipe);
end;
$fn$;

revoke all on function public.fn_painel_comercial(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.fn_painel_comercial(uuid, timestamptz, timestamptz) to authenticated, service_role;

comment on function public.fn_painel_comercial(uuid, timestamptz, timestamptz) is
  'Funil do período e comparativo de quem vende no painel. Security invoker: RLS filtra. Não devolve nome de pessoa, só user_id. Fuso dos dias: America/Sao_Paulo.';

notify pgrst, 'reload schema';
