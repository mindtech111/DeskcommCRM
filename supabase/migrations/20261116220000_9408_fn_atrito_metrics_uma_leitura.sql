-- manifest: fn_atrito_metrics deixa de reler messages por mensagem. Em 16/11/2026 a RPC estourou statement_timeout (8,02 s, 57014) num banco de ~63 MB, com as demais consultas em milissegundos depois do initplan da 0690. O índice (organization_id, direction, sent_at) já existia; o tempo estava nas subconsultas correlacionadas (próxima saída, turno por demanda, saída entre duas falas, repetição depois da passagem). A função continua security invoker, com a mesma assinatura e o mesmo jsonb. Cada conjunto é lido uma vez, em CTE materializada, com organização e período no predicado.
--
-- O que NÃO muda, de propósito:
--   · assinatura, defaults (72 h, 0,7, 4 h) e chaves do jsonb;
--   · security invoker — a RLS da sessão continua sendo o escopo. Promover a
--     definer faria a org vizinha aparecer para quem não é dela;
--   · auth.uid() não entra no corpo. Quem o chama é a policy, e desde a 0690
--     a forma é (select auth.uid()) / (select fn_user_org_ids()), uma vez por
--     consulta. O que multiplicava a chamada era varrer a mesma mensagem N
--     vezes, cada varredura com a policy de novo;
--   · nenhum índice novo. idx_messages_org_direction_sent (0133) já cobre
--     (organization_id, direction, sent_at). A consulta antiga não o usava
--     porque o predicado nascia dentro da subconsulta da linha.
--
-- Equivalências que a reescrita precisa preservar (provadas no invariante
-- atrito-metrics-equivalencia, contra o corpo anterior gravado no teste):
--   · próxima saída = menor sent_at de outbound ESTRITAMENTE depois do inbound,
--     mesmo que caia fora de p_to. Outbound no mesmo instante não conta.
--     A janela ordena sent_at desc e, no empate, o inbound antes do outbound,
--     e o min corrente é esse menor instante futuro;
--   · "houve saída no meio" = existe outbound com sent_at estritamente entre
--     o inbound anterior (só falas da janela, body não nulo) e este. A
--     diferença de dois acumulados (estrito < instante, e <= instante) é o
--     mesmo predicado, sem exists por linha;
--   · turno conta mensagem dentro de [aberta_em, fechada_em), inclusive a que
--     chegou antes de p_from. Demanda sem mensagem entra com 0;
--   · repetição pós-passagem continua qualquer fala anterior (sem piso de
--     data) contra fala inbound nas 24 h seguintes, com o mesmo Jaccard.

create or replace function public.fn_atrito_metrics(
  p_org uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_abandono_horas int default 72,
  p_repeticao_min float8 default 0.7,
  p_espera_horas int default 4
) returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with
  demandas_j as materialized (
    select d.id, d.agent_case_id, d.aberta_em, d.fechada_em
      from public.demandas d
     where d.organization_id = p_org
       and d.fechada_em is not null
       and d.fechada_em >= p_from
       and d.fechada_em < p_to
  ),
  -- Uma leitura de messages cobre turno, envio, repergunta e espera.
  -- O piso é o mais cedo entre a janela e a abertura da demanda que fecha
  -- nela: turno conta mensagem anterior a p_from, espera conta saída
  -- posterior a p_to. least() devolve null se algum argumento é null, por
  -- isso o coalesce.
  desde_leitura as materialized (
    select least(p_from, coalesce(min(aberta_em), p_from)) as desde
      from demandas_j
  ),
  msgs as materialized (
    select m.conversation_id,
           m.sent_at,
           m.direction,
           case
             when m.direction = 'inbound'
              and m.sent_at >= p_from
              and m.sent_at < p_to
             then m.body
           end as body,
           m.sent_via
      from public.messages m
     where m.organization_id = p_org
       and m.direction in ('inbound', 'outbound')
       and m.sent_at >= (select desde from desde_leitura)
  ),
  conversas_demanda as materialized (
    select d.id as demanda_id, d.aberta_em, d.fechada_em, dc.conversation_id
      from demandas_j d
      join public.demanda_conversas dc on dc.demanda_id = d.id
  ),
  turnos as materialized (
    select d.id, count(m.sent_at) as n
      from demandas_j d
      left join conversas_demanda c on c.demanda_id = d.id
      left join msgs m
        on m.conversation_id = c.conversation_id
       and m.sent_at >= c.aberta_em
       and m.sent_at < c.fechada_em
     group by d.id
  ),
  insistencia as materialized (
    select avg(c.followup_attempts)::float8 as media,
           max(c.followup_attempts) as maximo,
           count(*) as base
      from demandas_j d
      join public.agent_cases c on c.id = d.agent_case_id
  ),
  eventos_caso as materialized (
    select e.case_id, e.actor_kind, e.kind, e.human_action, e.created_at
      from public.agent_case_events e
      join demandas_j d on d.agent_case_id = e.case_id
     where e.organization_id = p_org
  ),
  humano as materialized (
    select case_id,
           count(*) as intervencoes,
           min(created_at) as primeiro_toque
      from eventos_caso
     where actor_kind = 'human'
     group by case_id
  ),
  espera_fila as materialized (
    select extract(epoch from (h.primeiro_toque - d.aberta_em)) as segundos
      from demandas_j d
      join humano h on h.case_id = d.agent_case_id
     where h.primeiro_toque > d.aberta_em
  ),
  retrabalho as materialized (
    select count(distinct case_id) as n
      from eventos_caso
     where kind = 'escalated' or human_action = 'escalate'
  ),
  abandono as materialized (
    select count(*) filter (
             where (cv.last_inbound_at is null or cv.last_outbound_at > cv.last_inbound_at)
               and cv.last_outbound_at < now() - make_interval(hours => p_abandono_horas)
               and cv.status not in ('resolved', 'closed')
           ) as abandonadas,
           count(*) as com_fala_nossa
      from public.conversations cv
     where cv.organization_id = p_org
       and cv.last_outbound_at >= p_from
       and cv.last_outbound_at < p_to
  ),
  abertas as materialized (
    select count(*) filter (where d.proximo_passo is null) as sem_passo,
           count(*) as n
      from public.demandas d
     where d.organization_id = p_org
       and d.fechada_em is null
  ),
  -- Dois acumulados de saída, na mesma passada:
  --   acum_antes = saídas com sent_at < este instante (inbound ordenado antes
  --                da saída no empate, então a saída do mesmo instante fica de fora);
  --   acum_ate   = saídas com sent_at <= este instante.
  -- A diferença contra o acum_ate do inbound anterior é o exists antigo.
  eventos_repergunta as materialized (
    select conversation_id, sent_at, direction, body,
           count(*) filter (where direction = 'outbound') over (
             partition by conversation_id
             order by sent_at, case when direction = 'inbound' then 0 else 1 end
           ) as acum_antes,
           count(*) filter (where direction = 'outbound') over (
             partition by conversation_id
             order by sent_at, case when direction = 'outbound' then 0 else 1 end
           ) as acum_ate
      from msgs
     where sent_at >= p_from
       and sent_at < p_to
       and (direction = 'outbound' or (direction = 'inbound' and body is not null))
  ),
  entradas as materialized (
    select conversation_id, sent_at, body,
           lag(body) over (partition by conversation_id order by sent_at) as body_anterior,
           lag(acum_ate) over (partition by conversation_id order by sent_at) as acum_ate_anterior,
           acum_antes
      from eventos_repergunta
     where direction = 'inbound'
  ),
  repeticao as materialized (
    select count(*) filter (
             where case
               when body_anterior is null then false
               when acum_antes <= coalesce(acum_ate_anterior, 0) then false
               else public.fn_atrito_jaccard(body, body_anterior) >= p_repeticao_min
             end
           ) as repetidas,
           count(*) filter (
             where body_anterior is not null
               and acum_antes > coalesce(acum_ate_anterior, 0)
           ) as com_resposta_no_meio
      from entradas
  ),
  -- Próxima saída: min de outbound no quadro que vai do fim da conversa até
  -- esta linha, em ordem sent_at desc. No empate o inbound vem primeiro, então
  -- outbound do mesmo instante não entra — é o mesmo que sent_at > inbound.
  espera_ordem as materialized (
    select sent_at, direction,
           min(sent_at) filter (where direction = 'outbound') over (
             partition by conversation_id
             order by sent_at desc,
                      case when direction = 'inbound' then 0 else 1 end
           ) as proxima_saida
      from msgs
  ),
  espera_calada as materialized (
    select count(*) filter (where espera_s > p_espera_horas * 3600) as caladas,
           count(*) as com_resposta,
           percentile_cont(0.9) within group (order by espera_s) as p90_s
      from (
        select extract(epoch from (proxima_saida - sent_at)) as espera_s
          from espera_ordem
         where direction = 'inbound'
           and sent_at >= p_from
           and sent_at < p_to
           and proxima_saida is not null
      ) prox
  ),
  envios as materialized (
    select count(*) filter (where sent_via = 'ai') as por_ia,
           count(*) filter (where sent_via = 'automation') as por_automacao,
           count(*) filter (where sent_via = 'system') as por_integracao,
           count(*) filter (where sent_via = 'user') as por_humano_no_sistema,
           count(*) filter (where sent_via = 'external_device') as por_humano_fora
      from msgs
     where direction = 'outbound'
       and sent_at >= p_from
       and sent_at < p_to
  ),
  vetos as materialized (
    select count(*) filter (where t.vetoed_gate is not null) as vetados,
           count(distinct t.job_id) as execucoes
      from public.before_send_traces t
     where t.organization_id = p_org
       and t.created_at >= p_from
       and t.created_at < p_to
  ),
  descadastros as materialized (
    select count(*) as n
      from public.contacts c
     where c.organization_id = p_org
       and c.blocked_at is not null
       and c.blocked_at >= p_from
       and c.blocked_at < p_to
  ),
  pedidos_humano as materialized (
    select count(*) as n
      from public.crm_lead_activities a
     where a.organization_id = p_org
       and a.type = 'handoff_triggered'
       and a.performed_at >= p_from
       and a.performed_at < p_to
  ),
  passagens_j as materialized (
    select p.id, p.conversation_id, p.criado_em
      from public.passagens_de_atendimento p
     where p.organization_id = p_org
       and p.criado_em >= p_from
       and p.criado_em < p_to
  ),
  -- Join a partir das passagens: zero passagens não varre messages.
  -- O histórico anterior não tem piso — a régua da 0294 compara com qualquer
  -- fala inbound de antes.
  falas_passagem as materialized (
    select m.conversation_id, m.sent_at, m.body
      from (select distinct conversation_id from passagens_j) pj
      join public.messages m
        on m.organization_id = p_org
       and m.conversation_id = pj.conversation_id
       and m.direction = 'inbound'
       and m.body is not null
  ),
  repeticao_pos_passagem as materialized (
    select count(*) filter (where x.repetiu) as repetidas,
           count(*) filter (where x.voltou) as medidas
      from (
        select exists (
                 select 1
                   from falas_passagem d
                  where d.conversation_id = p.conversation_id
                    and d.sent_at > p.criado_em
                    and d.sent_at < p.criado_em + interval '24 hours'
               ) as voltou,
               exists (
                 select 1
                   from falas_passagem d
                  where d.conversation_id = p.conversation_id
                    and d.sent_at > p.criado_em
                    and d.sent_at < p.criado_em + interval '24 hours'
                    and exists (
                      select 1
                        from falas_passagem a
                       where a.conversation_id = d.conversation_id
                         and a.sent_at < p.criado_em
                         and public.fn_atrito_jaccard(d.body, a.body) >= p_repeticao_min
                    )
               ) as repetiu
          from passagens_j p
      ) x
  ),
  eficiencia as materialized (
    select count(*) filter (where status = 'won') as ganhos,
           count(*) filter (
             where status = 'lost'
               and coalesce(lost_reason, '') <> 'moved_to_another_pipeline'
           ) as perdidos
      from public.crm_leads
     where organization_id = p_org
       and status in ('won', 'lost')
       and closed_at >= p_from
       and closed_at < p_to
  )
  select jsonb_build_object(
    'escopo', jsonb_build_object(
      'demandas', (select count(*) from demandas_j),
      'demandas_com_caso', (select base from insistencia),
      'demandas_abertas', (select n from abertas),
      'de', p_from, 'ate', p_to,
      'abandono_horas', p_abandono_horas,
      'repeticao_min', p_repeticao_min,
      'espera_horas', p_espera_horas,
      'denominador', 'demandas'
    ),
    'cliente', jsonb_build_object(
      'turnos_p50', (select percentile_cont(0.5) within group (order by n) from turnos),
      'turnos_p90', (select percentile_cont(0.9) within group (order by n) from turnos),
      'insistencia_media', (select media from insistencia),
      'insistencia_max', (select maximo from insistencia),
      'pedidos_de_humano', (select n from pedidos_humano),
      'descadastros', (select n from descadastros),
      'abandonos', (select abandonadas from abandono),
      'conversas_com_fala_nossa', (select com_fala_nossa from abandono),
      'reperguntas', (select repetidas from repeticao),
      'perguntas_com_resposta', (select com_resposta_no_meio from repeticao),
      'esperas_caladas', (select caladas from espera_calada),
      'esperas_medidas', (select com_resposta from espera_calada),
      'espera_resposta_p90_s', (select p90_s from espera_calada),
      'repeticao_pos_passagem', (select repetidas from repeticao_pos_passagem),
      'passagens_medidas', (select medidas from repeticao_pos_passagem)
    ),
    'empresa', jsonb_build_object(
      'intervencoes_por_demanda', (
        select avg(coalesce(h.intervencoes, 0))::float8
          from demandas_j d
          left join humano h on h.case_id = d.agent_case_id
      ),
      'espera_humana_p50_s', (select percentile_cont(0.5) within group (order by segundos) from espera_fila),
      'espera_humana_p90_s', (select percentile_cont(0.9) within group (order by segundos) from espera_fila),
      'retrabalho', (select n from retrabalho),
      'vetos', (select vetados from vetos),
      'execucoes_medidas', (select execucoes from vetos),
      'envios_por_ia', (select por_ia from envios),
      'envios_por_automacao', (select por_automacao from envios),
      'envios_por_integracao', (select por_integracao from envios),
      'envios_humano_no_sistema', (select por_humano_no_sistema from envios),
      'envios_humano_fora', (select por_humano_fora from envios),
      'demandas_sem_proximo_passo', (select sem_passo from abertas)
    ),
    'eficiencia', jsonb_build_object(
      'ganhos', (select ganhos from eficiencia),
      'perdidos', (select perdidos from eficiencia)
    )
  );
$$;

revoke all on function public.fn_atrito_metrics(uuid, timestamptz, timestamptz, int, float8, int) from public;
revoke execute on function public.fn_atrito_metrics(uuid, timestamptz, timestamptz, int, float8, int) from anon;
grant execute on function public.fn_atrito_metrics(uuid, timestamptz, timestamptz, int, float8, int)
  to authenticated, service_role;

comment on function public.fn_atrito_metrics(uuid, timestamptz, timestamptz, int, float8, int) is
  'Índice de Atrito (spec 17). Security invoker: o escopo é a RLS da sessão. Cada conjunto é lido uma vez.';
