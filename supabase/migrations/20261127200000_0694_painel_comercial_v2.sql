-- manifest: Painel comercial v2 (pedido da gestão comercial da Inochi) — uma RPC security definer com guarda (manager+, MFA) que devolve KPIs, funil por safra seguindo as etapas reais do funil escolhido, canais, anúncios, série diária, oportunidades prioritárias e perdas por motivo.
-- 0694: painel comercial v2
--
-- Por que uma função nova e não mexer na 0692/0693:
--   * O funil da 0693 conta etapas por NOME fixo ("em atendimento", "consulta
--     agendada", "consulta realizada"). Funil com outros nomes mostra zero.
--     Aqui o funil é o do próprio pipeline (crm_stages em ordem de position).
--   * A 0693 conta "entradas na etapa no período", e a taxa passa de 100%
--     quando chega gente de antes. Aqui o funil é POR SAFRA: dos leads criados
--     no período, quantos chegaram até cada etapa (maior posição já alcançada,
--     pelo histórico stage_changed ou pela etapa atual). Nunca passa de 100%.
--   * As duas anteriores somam todos os funis da organização. Esta recebe o
--     funil (p_pipeline); nulo = o funil padrão.
--
-- Papéis de etapa sem nome fixo: "agendamento" é a primeira etapa (por
-- posição) cujo nome contém "agend"; "comparecimento" é a primeira que contém
-- "compareceu" ou "realizad". Sem etapa assim, o indicador volta nulo (não
-- zero fingindo medição).
--
-- Etapas fora do funil principal (perda, follow-up, sem resposta, reativação,
-- desqualificado) não entram na escada do funil: is_lost, ou nome que começa
-- com "follow-up", "sem resposta", "reativa" ou "desqualific".
--
-- SECURITY DEFINER com guarda explícita (manager+ da organização, MFA provado),
-- no molde da fn_painel_rastreio (0692): sob RLS linha a linha o agregado levou
-- 52 s num banco Micro. Read-only.

create or replace function public.fn_painel_rotulo_canal(p_source text, p_meta jsonb, p_tags text[], p_pipeline_nome text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when lower(coalesce(p_pipeline_nome, '')) ~ '(^|[^a-z])vb([^a-z]|$)|vitaminas'
      or lower(btrim(coalesce(p_source, ''))) like '%revi%'
      or lower(btrim(coalesce(p_meta->>'utm_source', ''))) like '%revi%'
      or exists (select 1 from unnest(coalesce(p_tags, '{}'::text[])) t where lower(t) like '%vb%' or lower(t) like '%vitaminas%')
      then 'Vitaminas Brasil'
    when exists (select 1 from unnest(coalesce(p_tags, '{}'::text[])) t where lower(t) like 'indica%')
      or lower(btrim(coalesce(p_source, ''))) like 'indica%'
      then 'Indicação'
    when lower(btrim(coalesce(p_source, ''))) in ('meta_ads', 'meta', 'facebook', 'instagram')
      or lower(btrim(coalesce(p_meta->>'utm_source', ''))) in ('meta', 'meta_ads', 'facebook', 'instagram', 'fb', 'ig')
      or lower(btrim(coalesce(p_meta->>'ad_platform', ''))) in ('meta', 'meta_ads', 'facebook', 'instagram')
      then 'Meta Ads'
    when lower(btrim(coalesce(p_source, ''))) like 'google%'
      or lower(btrim(coalesce(p_meta->>'utm_source', ''))) like 'google%'
      then 'Google Ads'
    when lower(btrim(coalesce(p_source, ''))) in ('site', 'lp', 'landing', 'webhook')
      or exists (select 1 from unnest(coalesce(p_tags, '{}'::text[])) t where lower(t) like 'origem:site%' or lower(t) like 'origem:score%')
      then 'Site'
    when lower(btrim(coalesce(p_source, ''))) like 'whatsapp%' or lower(btrim(coalesce(p_source, ''))) = 'wa'
      then 'WhatsApp (orgânico)'
    when lower(btrim(coalesce(p_source, ''))) like 'import%'
      then 'Base importada'
    when btrim(coalesce(p_source, '')) = '' then 'Sem origem'
    else initcap(replace(btrim(p_source), '_', ' '))
  end;
$$;

create or replace function public.fn_painel_rotulo_anuncio(p_meta jsonb)
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
    case when nullif(btrim(coalesce(p_meta->>'ad_title', '')), '') is not null
         then 'Anúncio: ' || left(btrim(p_meta->>'ad_title'), 60) end
  );
$$;

create or replace function public.fn_painel_comercial_v2(
  p_org uuid,
  p_inicio timestamptz,
  p_fim timestamptz,
  p_pipeline uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_pipeline uuid;
  v_pipeline_nome text;
  v_pos_agend numeric;
  v_pos_comp numeric;
  v_out jsonb;
begin
  -- Mesma guarda da fn_painel_rastreio (0692): definer para não pagar a RLS
  -- linha a linha num agregado (medido: 52 s sob RLS num banco Micro), mas só
  -- para manager+ da própria organização (ou admin de plataforma) com MFA provado.
  if p_org is null
     or not public.fn_session_mfa_proven()
     or not (
       public.fn_is_platform_admin()
       or (p_org in (select public.fn_user_org_ids()) and public.fn_role_at_least(p_org, 'manager'))
     )
  then
    return jsonb_build_object('erro', 'sem_permissao');
  end if;

  if p_org is null or p_inicio is null or p_fim is null or p_inicio >= p_fim
     or (p_fim - p_inicio) > interval '370 days' then
    return jsonb_build_object('erro', 'janela_invalida');
  end if;

  select p.id, p.name into v_pipeline, v_pipeline_nome
    from public.crm_pipelines p
   where p.organization_id = p_org
     and coalesce(p.is_archived, false) = false
     and (p.id = p_pipeline or (p_pipeline is null and p.is_default))
   order by p.is_default desc
   limit 1;
  if v_pipeline is null then
    return jsonb_build_object('erro', 'funil_inexistente');
  end if;

  select min(s.position) filter (where lower(s.name) like '%agend%'),
         coalesce(min(s.position) filter (where lower(s.name) like '%compareceu%'),
                  min(s.position) filter (where lower(s.name) like '%realizad%' and lower(s.name) not like '%agend%'))
    into v_pos_agend, v_pos_comp
    from public.crm_stages s
   where s.pipeline_id = v_pipeline and coalesce(s.is_archived, false) = false
     and not s.is_lost;

  with etapas as (
    select s.id, s.name, s.position, s.is_won, s.is_lost, s.win_probability, s.color,
           (s.is_lost
            or lower(s.name) ~ '^(follow-up|follow up|sem resposta|reativa|desqualific)') as lateral_
      from public.crm_stages s
     where s.pipeline_id = v_pipeline and coalesce(s.is_archived, false) = false
  ),
  escada as (
    select e.*, row_number() over (order by e.position) as degrau
      from etapas e where not e.lateral_
  ),
  leads as (
    select l.id, l.title, l.status, l.value_cents, l.currency, l.created_at, l.closed_at,
           l.last_activity_at, l.owner_user_id, l.stage_id, l.lost_reason, l.contact_id,
           l.source, l.source_metadata, l.tags, l.expected_close_date
      from public.crm_leads l
     where l.organization_id = p_org and l.pipeline_id = v_pipeline
  ),
  mov as (
    select a.lead_id, max(es.position) as pos
      from public.crm_lead_activities a
      join escada es on es.id = case
        when coalesce(a.payload->>'to_stage_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (a.payload->>'to_stage_id')::uuid end
     where a.organization_id = p_org and a.type = 'stage_changed'
       and a.lead_id in (select id from leads where created_at >= p_inicio and created_at < p_fim)
     group by a.lead_id
  ),
  alcance as (
    -- maior posição de escada já alcançada (histórico + etapa atual; ganho = topo)
    select l.id,
           greatest(coalesce(m.pos, -1),
                    coalesce(es.position, -1),
                    case when l.status = 'won' then (select max(position) from escada) else -1 end) as pos_max
      from leads l
      left join mov m on m.lead_id = l.id
      left join escada es on es.id = l.stage_id
     where l.created_at >= p_inicio and l.created_at < p_fim
  ),
  safra as (
    select l.*, a.pos_max,
           public.fn_painel_rotulo_canal(l.source, l.source_metadata, l.tags, v_pipeline_nome) as canal,
           public.fn_painel_rotulo_anuncio(l.source_metadata) as anuncio
      from leads l join alcance a on a.id = l.id
  ),
  ganhos_periodo as (
    select * from leads where status = 'won' and closed_at >= p_inicio and closed_at < p_fim
  ),
  abertos as (
    select l.*, e.win_probability, e.name as etapa_nome
      from leads l left join etapas e on e.id = l.stage_id
     where l.status = 'open'
  )
  select jsonb_build_object(
    'pipeline', jsonb_build_object('id', v_pipeline, 'nome', v_pipeline_nome),
    'pipelines', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.name, 'padrao', p.is_default) order by p.is_default desc, p.position, p.name), '[]'::jsonb)
                    from public.crm_pipelines p where p.organization_id = p_org and coalesce(p.is_archived, false) = false),
    'kpis', jsonb_build_object(
      'leads', (select count(*) from safra),
      'agendamentos', case when v_pos_agend is null then null else (select count(*) from safra where pos_max >= v_pos_agend) end,
      'comparecimentos', case when v_pos_comp is null then null else (select count(*) from safra where pos_max >= v_pos_comp) end,
      'vendas', (select count(*) from ganhos_periodo),
      'faturamento_cents', (select coalesce(sum(value_cents), 0) from ganhos_periodo),
      'vendas_com_valor', (select count(*) from ganhos_periodo where coalesce(value_cents, 0) > 0),
      'vendas_da_safra', (select count(*) from safra where status = 'won'),
      'pipeline_aberto_cents', (select coalesce(sum(value_cents), 0) from abertos),
      'abertos', (select count(*) from abertos),
      'abertos_com_valor', (select count(*) from abertos where coalesce(value_cents, 0) > 0),
      'previsao_cents', (select coalesce(sum(round(value_cents * win_probability / 100.0)), 0) from abertos where win_probability is not null and coalesce(value_cents, 0) > 0),
      'abertos_sem_responsavel', (select count(*) from abertos where owner_user_id is null),
      'perdidos', (select count(*) from leads where status = 'lost' and closed_at >= p_inicio and closed_at < p_fim)
    ),
    'funil', (select coalesce(jsonb_agg(jsonb_build_object(
                'etapa_id', es.id, 'nome', es.name, 'degrau', es.degrau, 'ganho', es.is_won,
                'probabilidade', es.win_probability,
                'chegaram', (select count(*) from safra s where s.pos_max >= es.position),
                'agora', (select count(*) from leads l where l.stage_id = es.id and l.status <> 'lost')
              ) order by es.position), '[]'::jsonb) from escada es),
    'laterais', (select coalesce(jsonb_agg(jsonb_build_object(
                   'etapa_id', e.id, 'nome', e.name, 'perda', e.is_lost,
                   'agora', (select count(*) from leads l where l.stage_id = e.id)
                 ) order by e.position), '[]'::jsonb) from etapas e where e.lateral_),
    'canais', (select coalesce(jsonb_agg(c order by (c->>'leads')::int desc), '[]'::jsonb) from (
                 select jsonb_build_object(
                   'canal', canal,
                   'leads', count(*),
                   'agendamentos', case when v_pos_agend is null then null else count(*) filter (where pos_max >= v_pos_agend) end,
                   'vendas', count(*) filter (where status = 'won'),
                   'valor_cents', coalesce(sum(value_cents) filter (where status = 'won'), 0)
                 ) as c
                 from safra group by canal) x),
    'anuncios', (select coalesce(jsonb_agg(c order by (c->>'leads')::int desc), '[]'::jsonb) from (
                 select jsonb_build_object(
                   'anuncio', anuncio, 'canal', min(canal),
                   'leads', count(*),
                   'agendamentos', case when v_pos_agend is null then null else count(*) filter (where pos_max >= v_pos_agend) end,
                   'vendas', count(*) filter (where status = 'won'),
                   'valor_cents', coalesce(sum(value_cents) filter (where status = 'won'), 0)
                 ) as c
                 from safra where anuncio is not null group by anuncio order by count(*) desc limit 20) x),
    'sem_anuncio', (select count(*) from safra where anuncio is null),
    'diario', (with dias as (
                   select g.dia::date as dia
                     from generate_series((p_inicio at time zone 'America/Sao_Paulo')::date,
                                          ((p_fim - interval '1 second') at time zone 'America/Sao_Paulo')::date,
                                          interval '1 day') g(dia)),
                 dl as (select (created_at at time zone 'America/Sao_Paulo')::date as dia, count(*) as n
                          from leads where created_at >= p_inicio and created_at < p_fim group by 1),
                 dv as (select (closed_at at time zone 'America/Sao_Paulo')::date as dia, count(*) as n
                          from leads where status = 'won' and closed_at >= p_inicio and closed_at < p_fim group by 1),
                 da as (select (a.created_at at time zone 'America/Sao_Paulo')::date as dia, count(distinct a.lead_id) as n
                          from public.crm_lead_activities a
                          join etapas e on e.id = case when coalesce(a.payload->>'to_stage_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (a.payload->>'to_stage_id')::uuid end
                         where a.organization_id = p_org and a.type = 'stage_changed'
                           and a.created_at >= p_inicio and a.created_at < p_fim
                           and v_pos_agend is not null and e.position = v_pos_agend
                         group by 1)
               select coalesce(jsonb_agg(jsonb_build_object('dia', d.dia, 'leads', coalesce(dl.n, 0),
                        'agendamentos', coalesce(da.n, 0), 'vendas', coalesce(dv.n, 0)) order by d.dia), '[]'::jsonb)
                 from dias d left join dl on dl.dia = d.dia left join dv on dv.dia = d.dia left join da on da.dia = d.dia),
    'prioridades', (select coalesce(jsonb_agg(x order by (x->>'ordem')::numeric desc nulls last, x->>'ultimo_contato' asc nulls first), '[]'::jsonb) from (
                 select jsonb_build_object(
                   'lead_id', a.id,
                   'titulo', a.title,
                   'contato', coalesce(nullif(c.display_name, ''), nullif(c.name, ''), a.title),
                   'etapa', a.etapa_nome,
                   'probabilidade', a.win_probability,
                   'valor_cents', a.value_cents,
                   'responsavel_id', a.owner_user_id,
                   'ultimo_contato', a.last_activity_at,
                   'dias_sem_contato', case when a.last_activity_at is null then null else floor(extract(epoch from (now() - a.last_activity_at)) / 86400) end,
                   'proxima_tarefa', (select jsonb_build_object('titulo', t.title, 'quando', t.due_date) from public.crm_tasks t
                                        where t.lead_id = a.id and coalesce(t.status, '') not in ('done', 'completed', 'cancelled', 'concluida')
                                        order by t.due_date asc nulls last limit 1),
                   'ordem', coalesce(a.value_cents, 0) * coalesce(a.win_probability, 0) / 100.0
                          + coalesce(a.win_probability, 0)
                 ) as x
                 from abertos a left join public.contacts c on c.id = a.contact_id
                 order by coalesce(a.value_cents, 0) * coalesce(a.win_probability, 0) desc, coalesce(a.win_probability, 0) desc, a.last_activity_at desc nulls last
                 limit 12) y),
    'perdas', (select coalesce(jsonb_agg(jsonb_build_object('motivo', motivo, 'total', n) order by n desc), '[]'::jsonb) from (
                 select coalesce(nullif(btrim(lost_reason), ''), 'Sem motivo informado') as motivo, count(*) as n
                   from leads where status = 'lost' and closed_at >= p_inicio and closed_at < p_fim
                  group by 1) p)
  ) into v_out;

  return v_out;
end;
$fn$;

revoke all on function public.fn_painel_rotulo_canal(text, jsonb, text[], text) from public, anon;
revoke all on function public.fn_painel_rotulo_anuncio(jsonb) from public, anon;
revoke all on function public.fn_painel_comercial_v2(uuid, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.fn_painel_rotulo_canal(text, jsonb, text[], text) to authenticated, service_role;
grant execute on function public.fn_painel_rotulo_anuncio(jsonb) to authenticated, service_role;
grant execute on function public.fn_painel_comercial_v2(uuid, timestamptz, timestamptz, uuid) to authenticated, service_role;
