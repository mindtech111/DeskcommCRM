-- manifest: Dashboard comercial (/app/dashboard) — RPC security definer com a guarda da 0694 que reaproveita fn_painel_comercial_v2 e acrescenta período anterior, tempo médio do ciclo, interesse das oportunidades, meta mensal e vendas do mês.
-- 0695: dashboard comercial
--
-- Uma chamada só para a página: a mesma conta da visão comercial (0694) para
-- o período pedido e para o período anterior do MESMO tamanho (as variações %
-- dos cards), mais:
--   * ciclo_medio_dias: média de dias entre created_at e closed_at das vendas
--     fechadas no período (nulo sem venda — não 0);
--   * interesse de cada oportunidade prioritária: custom_fields->>'interesse',
--     ou a primeira tag conhecida (silver, ouro, tricologia, spa, lipedema,
--     consulta), ou nulo;
--   * meta mensal: painel_metas.valor_cents_mes da organização (0693), nula
--     quando não definida;
--   * vendas do mês corrente até agora (America/Sao_Paulo), no funil escolhido.
--
-- SECURITY DEFINER com a guarda da fn_painel_comercial_v2 (manager+ da
-- organização ou admin de plataforma, MFA provado). Read-only.

create or replace function public.fn_dashboard_comercial(
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
  v_atual jsonb;
  v_anterior jsonb;
  v_pipeline uuid;
  v_dur interval;
  v_mes_ini timestamptz;
  v_extra jsonb;
begin
  if p_org is null
     or not public.fn_session_mfa_proven()
     or not (
       public.fn_is_platform_admin()
       or (p_org in (select public.fn_user_org_ids()) and public.fn_role_at_least(p_org, 'manager'))
     )
  then
    return jsonb_build_object('erro', 'sem_permissao');
  end if;

  v_atual := public.fn_painel_comercial_v2(p_org, p_inicio, p_fim, p_pipeline);
  if v_atual ? 'erro' then
    return v_atual;
  end if;
  v_pipeline := (v_atual->'pipeline'->>'id')::uuid;
  v_dur := p_fim - p_inicio;
  v_anterior := public.fn_painel_comercial_v2(p_org, p_inicio - v_dur, p_inicio, v_pipeline);
  v_mes_ini := (date_trunc('month', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo';

  select jsonb_build_object(
    'ciclo_medio_dias', (
      select round(avg(extract(epoch from (l.closed_at - l.created_at)) / 86400.0)::numeric, 1)
        from public.crm_leads l
       where l.organization_id = p_org and l.pipeline_id = v_pipeline
         and l.status = 'won' and l.closed_at >= p_inicio and l.closed_at < p_fim
         and l.closed_at >= l.created_at),
    'meta_mensal_cents', (select m.valor_cents_mes from public.painel_metas m where m.organization_id = p_org),
    'vendas_mes', (
      select jsonb_build_object('quantidade', count(*), 'valor_cents', coalesce(sum(l.value_cents), 0))
        from public.crm_leads l
       where l.organization_id = p_org and l.pipeline_id = v_pipeline
         and l.status = 'won' and l.closed_at >= v_mes_ini and l.closed_at <= now()),
    'interesses', (
      select coalesce(jsonb_object_agg(l.id::text, i.interesse), '{}'::jsonb)
        from public.crm_leads l
        cross join lateral (
          select coalesce(
            nullif(btrim(l.custom_fields->>'interesse'), ''),
            (select initcap(t) from unnest(coalesce(l.tags, '{}'::text[])) t
              where lower(t) in ('silver', 'ouro', 'tricologia', 'spa', 'lipedema', 'consulta', 'soroterapia', 'emagrecimento')
              limit 1)
          ) as interesse
        ) i
       where l.organization_id = p_org
         and l.id in (select (e->>'lead_id')::uuid from jsonb_array_elements(v_atual->'prioridades') e)
         and i.interesse is not null)
  ) into v_extra;

  return v_atual
    || jsonb_build_object(
         'anterior', jsonb_build_object(
           'inicio', p_inicio - v_dur,
           'fim', p_inicio,
           'kpis', v_anterior->'kpis',
           'funil_topo', v_anterior->'funil'->0->'chegaram',
           'funil_fim', v_anterior->'funil'->-1->'chegaram'),
         'extra', v_extra);
end;
$fn$;

revoke all on function public.fn_dashboard_comercial(uuid, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.fn_dashboard_comercial(uuid, timestamptz, timestamptz, uuid) to authenticated, service_role;
