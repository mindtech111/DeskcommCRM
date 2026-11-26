-- manifest: Painel diário em /app/painel — agrega leads, mensagens, etapas de consulta, vendas e cliques da janela numa RPC security invoker, sem varrer a tabela conversations.
-- 0691: painel diário
--
-- A tela pede a janela de hoje, 7 ou 30 dias a cada minuto. A conta mora aqui
-- para não paginar mil linhas pelo PostgREST (max_rows) e para o plano usar
-- índice. SECURITY INVOKER: a RLS de crm_leads, crm_lead_activities, messages
-- e crm_stages continua valendo. p_org é a organização ATIVA, resolvida na
-- rota a partir da sessão — quem tem mais de uma empresa não pode somar as
-- duas. Passar o id de outra organização devolve vazio, porque a RLS não
-- mostra a linha.
--
-- Conversas NÃO são contadas em public.conversations. A policy de leitura
-- chama fn_can_view_conversation por linha; um count(*) na tabela inteira da
-- organização não acompanha a janela. O volume sai das mensagens inbound da
-- janela, pelo índice idx_messages_org_direction_sent (0133), e o "já existia
-- antes" é uma sonda por conversation_id em idx_messages_conversation_sent.
--
-- Consultas: entradas em crm_lead_activities type = stage_changed cujo nome
-- ATUAL da etapa (crm_stages.name) é "Consulta agendada" ou "Consulta
-- realizada", depois de trim e minúsculas. Lead que já nasce na etapa, sem
-- essa atividade, não entra — o histórico de movimentação é a fonte, e a
-- criação do card não grava stage_changed. Atividade sem to_stage_id legível
-- também não entra.
--
-- Cliques e a conexão de anúncios moram em tabelas sem policy e sem grant
-- para authenticated (0214, 0381, 0437). fn_painel_rastreio é SECURITY DEFINER
-- estável, só devolve agregado (nunca token, query_raw ou id de contato) e
-- só para manager+ da própria organização ou admin de plataforma. O gasto da
-- conta NÃO é buscado: gasto_cents fica null de propósito.

create index if not exists idx_crm_leads_org_created
  on public.crm_leads (organization_id, created_at);

-- Ganhos da janela filtram status = won e closed_at. Os índices de lead que
-- já existem cobrem stage, owner e last_activity — nenhum começa por closed_at.
create index if not exists idx_crm_leads_org_won_closed
  on public.crm_leads (organization_id, closed_at)
  where status = 'won' and closed_at is not null;

-- meta_ads_click_refs já tem (organization_id, token) e
-- (organization_id, tracking_link_id, created_at). O segundo não serve
-- "todos os cliques da organização na janela": tracking_link_id fica na
-- frente de created_at. O painel filtra só organização + created_at.
create index if not exists meta_ads_click_refs_org_created_idx
  on public.meta_ads_click_refs (organization_id, created_at);

create or replace function public.fn_painel_rotulo_origem(p_source text, p_meta jsonb)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when lower(btrim(coalesce(p_source, ''))) in ('meta_ads', 'meta', 'facebook', 'instagram')
      or lower(btrim(coalesce(p_meta->>'utm_source', ''))) in ('meta', 'meta_ads', 'facebook', 'instagram', 'fb', 'ig')
      or lower(btrim(coalesce(p_meta->>'ad_platform', ''))) in ('meta', 'meta_ads', 'facebook', 'instagram')
      then 'Meta'
    when lower(btrim(coalesce(p_source, ''))) like '%revi%'
      or lower(btrim(coalesce(p_meta->>'utm_source', ''))) like '%revi%'
      or lower(btrim(coalesce(p_meta->>'webhook_source', ''))) like '%revi%'
      or lower(btrim(coalesce(p_meta->>'origem', ''))) like '%revi%'
      then 'Revi'
    when lower(btrim(coalesce(p_source, ''))) in ('site', 'lp', 'landing')
      or lower(btrim(coalesce(p_meta->>'ad_platform', ''))) = 'site'
      or lower(btrim(coalesce(p_meta->>'utm_source', ''))) in ('site', 'lp')
      then 'site'
    when lower(btrim(coalesce(p_source, ''))) in ('whatsapp', 'wa')
      or lower(btrim(coalesce(p_meta->>'utm_source', ''))) in ('whatsapp', 'wa')
      then 'WhatsApp'
    when btrim(coalesce(p_source, '')) = '' then 'sem origem'
    else btrim(p_source)
  end;
$$;

create or replace function public.fn_painel_rotulo_campanha(p_meta jsonb)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(
    nullif(btrim(coalesce(p_meta->>'utm_campaign', '')), ''),
    nullif(btrim(coalesce(p_meta->>'campaign_name', '')), ''),
    nullif(btrim(coalesce(p_meta #>> '{utm,utm_campaign}', '')), ''),
    'sem campanha'
  );
$$;

revoke all on function public.fn_painel_rotulo_origem(text, jsonb) from public, anon;
revoke all on function public.fn_painel_rotulo_campanha(jsonb) from public, anon;
grant execute on function public.fn_painel_rotulo_origem(text, jsonb) to authenticated, service_role;
grant execute on function public.fn_painel_rotulo_campanha(jsonb) to authenticated, service_role;

create or replace function public.fn_painel_rastreio(
  p_org uuid,
  p_inicio timestamptz,
  p_fim timestamptz
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_out jsonb;
begin
  if p_org is null
     or not (
       public.fn_is_platform_admin()
       or (
         p_org in (select public.fn_user_org_ids())
         and public.fn_role_at_least(p_org, 'manager')
       )
     )
  then
    return jsonb_build_object(
      'cliques', 0,
      'casaram_contato', 0,
      'casaram_lead', 0,
      'por_campanha', '[]'::jsonb,
      'por_campanha_truncada', false,
      'por_link', '[]'::jsonb,
      'por_link_truncada', false,
      'conectado', false,
      'motivo', 'sem_permissao'
    );
  end if;

  with cliques as (
    select
      r.tracking_link_id,
      nullif(btrim(coalesce(r.utm->>'utm_campaign', '')), '') as campanha,
      (r.contact_id is not null or r.matched_at is not null) as casou_contato,
      exists (
        select 1
        from public.crm_leads l
        where l.organization_id = r.organization_id
          and r.contact_id is not null
          and l.contact_id = r.contact_id
          and l.created_at >= r.created_at
      ) as casou_lead
    from public.meta_ads_click_refs r
    where r.organization_id = p_org
      and r.created_at >= p_inicio
      and r.created_at < p_fim
  )
  select jsonb_build_object(
    'cliques', (select count(*)::int from cliques),
    'casaram_contato', (select count(*)::int from cliques where casou_contato),
    'casaram_lead', (select count(*)::int from cliques where casou_lead),
    'por_campanha_truncada', (
      select count(*) > 40
      from (select campanha from cliques where campanha is not null group by campanha) g
    ),
    'por_campanha', coalesce((
      select jsonb_agg(jsonb_build_object(
        'campanha', campanha,
        'cliques', n,
        'casaram_contato', contatos,
        'casaram_lead', leads
      ) order by n desc, campanha)
      from (
        select campanha,
               count(*)::int as n,
               count(*) filter (where casou_contato)::int as contatos,
               count(*) filter (where casou_lead)::int as leads
        from cliques
        where campanha is not null
        group by campanha
        order by count(*) desc, campanha
        limit 40
      ) c
    ), '[]'::jsonb),
    'por_link_truncada', (
      select count(*) > 40
      from (
        select tracking_link_id
        from cliques
        where tracking_link_id is not null
        group by tracking_link_id
      ) g
    ),
    'por_link', coalesce((
      select jsonb_agg(jsonb_build_object(
        'nome', nome,
        'cliques', n,
        'casaram_contato', contatos,
        'casaram_lead', leads
      ) order by n desc, nome)
      from (
        select coalesce(nullif(btrim(k.name), ''), 'link removido') as nome,
               count(*)::int as n,
               count(*) filter (where c.casou_contato)::int as contatos,
               count(*) filter (where c.casou_lead)::int as leads
        from cliques c
        left join public.ad_tracking_links k
          on k.organization_id = p_org
         and k.id = c.tracking_link_id
        where c.tracking_link_id is not null
        group by 1
        order by count(*) desc, 1
        limit 40
      ) l
    ), '[]'::jsonb),
    'conectado', exists (
      select 1
      from public.ad_insights_connections x
      where x.organization_id = p_org
        and x.platform = 'meta_ads'
    ),
    'motivo', case
      when exists (
        select 1
        from public.ad_insights_connections x
        where x.organization_id = p_org
          and x.platform = 'meta_ads'
      ) then 'gasto_nao_lido'
      else 'sem_conexao'
    end
  ) into v_out;

  return v_out;
end;
$fn$;

revoke all on function public.fn_painel_rastreio(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.fn_painel_rastreio(uuid, timestamptz, timestamptz) to authenticated, service_role;

comment on function public.fn_painel_rastreio(uuid, timestamptz, timestamptz) is
  'Agregado de cliques (meta_ads_click_refs) e flag de conexão (ad_insights_connections) do painel diário. Security definer estável: as tabelas não têm policy. Não devolve token nem query. Gasto fica de fora — motivo gasto_nao_lido quando a conexão existe.';

create or replace function public.fn_painel_diario(
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
  v_leads jsonb;
  v_conversas jsonb;
  v_resposta jsonb;
  v_consultas jsonb;
  v_vendas jsonb;
  v_bruto jsonb;
begin
  if p_org is null
     or p_inicio is null
     or p_fim is null
     or p_inicio >= p_fim
     or (p_fim - p_inicio) > interval '32 days'
  then
    return jsonb_build_object('erro', 'janela_invalida');
  end if;

  with base as (
    select
      public.fn_painel_rotulo_origem(l.source, l.source_metadata) as origem,
      public.fn_painel_rotulo_campanha(l.source_metadata) as campanha
    from public.crm_leads l
    where l.organization_id = p_org
      and l.created_at >= p_inicio
      and l.created_at < p_fim
  )
  select jsonb_build_object(
    'total', (select count(*)::int from base),
    'sem_campanha', (select count(*)::int from base where campanha = 'sem campanha'),
    'por_campanha_truncada', (
      select count(*) > 40
      from (
        select campanha, origem
        from base
        where campanha <> 'sem campanha'
        group by campanha, origem
      ) g
    ),
    'por_origem', coalesce((
      select jsonb_agg(jsonb_build_object('origem', origem, 'total', total) order by total desc, origem)
      from (
        select origem, count(*)::int as total
        from base
        group by origem
      ) o
    ), '[]'::jsonb),
    'por_campanha', coalesce((
      select jsonb_agg(jsonb_build_object(
        'campanha', campanha,
        'origem', origem,
        'total', total
      ) order by total desc, campanha)
      from (
        select campanha, origem, count(*)::int as total
        from base
        where campanha <> 'sem campanha'
        group by campanha, origem
        order by count(*) desc, campanha
        limit 40
      ) c
    ), '[]'::jsonb)
  ) into v_leads;

  -- Uma varredura da janela (materialized) alimenta volume e primeira resposta.
  -- Não lê public.conversations.
  with inbounds as materialized (
    select m.conversation_id, m.sent_at
    from public.messages m
    where m.organization_id = p_org
      and m.direction = 'inbound'
      and m.sent_at >= p_inicio
      and m.sent_at < p_fim
  ),
  por_conversa as (
    select conversation_id, min(sent_at) as primeiro_na_janela
    from inbounds
    group by conversation_id
  ),
  novas as (
    select p.conversation_id, p.primeiro_na_janela as primeiro
    from por_conversa p
    where not exists (
      select 1
      from public.messages anterior
      where anterior.organization_id = p_org
        and anterior.conversation_id = p.conversation_id
        and anterior.direction = 'inbound'
        and anterior.sent_at < p_inicio
    )
  ),
  tempos as (
    select
      n.primeiro,
      (
        select min(o.sent_at)
        from public.messages o
        where o.organization_id = p_org
          and o.conversation_id = n.conversation_id
          and o.direction = 'outbound'
          and o.sent_at >= n.primeiro
      ) as saida
    from novas n
  )
  select
    jsonb_build_object(
      'com_mensagem_recebida', (select count(*)::int from por_conversa),
      'mensagens_recebidas', (select count(*)::int from inbounds)
    ),
    jsonb_build_object(
      'amostra', (select count(*)::int from novas),
      'respondidas', (select count(*)::int from tempos where saida is not null),
      'taxa', (
        select round(
          (count(*) filter (where saida is not null))::numeric / nullif(count(*), 0),
          4
        )
        from tempos
      ),
      'p50_segundos', (
        select round(
          (percentile_cont(0.5) within group (
            order by extract(epoch from (saida - primeiro))
          ))::numeric,
          1
        )
        from tempos
        where saida is not null
      )
    )
  into v_conversas, v_resposta;

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
  )
  select jsonb_build_object(
    'agendadas', (select count(*)::int from entradas where nome = 'consulta agendada'),
    'realizadas', (select count(*)::int from entradas where nome = 'consulta realizada')
  ) into v_consultas;

  with ganhos as (
    select l.currency as moeda, l.value_cents
    from public.crm_leads l
    where l.organization_id = p_org
      and l.status = 'won'
      and l.closed_at >= p_inicio
      and l.closed_at < p_fim
  )
  select jsonb_build_object(
    'quantidade', (select count(*)::int from ganhos),
    'por_moeda', coalesce((
      select jsonb_agg(jsonb_build_object(
        'moeda', moeda,
        'quantidade', quantidade,
        'valor_cents', valor_cents
      ) order by moeda nulls last)
      from (
        select moeda,
               count(*)::int as quantidade,
               coalesce(sum(value_cents), 0) as valor_cents
        from ganhos
        group by moeda
      ) g
    ), '[]'::jsonb)
  ) into v_vendas;

  v_bruto := public.fn_painel_rastreio(p_org, p_inicio, p_fim);

  return jsonb_build_object(
    'leads_novos', v_leads,
    'conversas', v_conversas,
    'consultas', v_consultas,
    'vendas', v_vendas,
    'resposta', v_resposta,
    'rastreio', jsonb_build_object(
      'cliques', v_bruto->'cliques',
      'casaram_contato', v_bruto->'casaram_contato',
      'casaram_lead', v_bruto->'casaram_lead',
      'por_campanha', coalesce(v_bruto->'por_campanha', '[]'::jsonb),
      'por_campanha_truncada', coalesce(v_bruto->'por_campanha_truncada', 'false'::jsonb),
      'por_link', coalesce(v_bruto->'por_link', '[]'::jsonb),
      'por_link_truncada', coalesce(v_bruto->'por_link_truncada', 'false'::jsonb)
    ),
    'meta', jsonb_build_object(
      'conectado', coalesce(v_bruto->'conectado', 'false'::jsonb),
      'gasto_cents', 'null'::jsonb,
      'custo_por_lead_cents', 'null'::jsonb,
      'moeda', 'null'::jsonb,
      'motivo', coalesce(v_bruto->'motivo', 'null'::jsonb)
    )
  );
end;
$fn$;

revoke all on function public.fn_painel_diario(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.fn_painel_diario(uuid, timestamptz, timestamptz) to authenticated, service_role;

comment on function public.fn_painel_diario(uuid, timestamptz, timestamptz) is
  'Retrato do painel diário (/api/v1/metrics/painel) na janela semiaberta [p_inicio, p_fim). Security invoker: RLS filtra. Não conta conversations. Gasto de anúncio sai null.';

notify pgrst, 'reload schema';
