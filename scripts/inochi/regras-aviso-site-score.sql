-- NÃO EXECUTADO.
--
-- Regras da Clínica Inochi para o site e o Score de Longevidade.
-- O Marcos revisa este arquivo e, se concordar, cola no SQL editor do
-- banco DESSA instalação. Não entra em supabase/migrations: o update.sh
-- não aplica, e nenhuma outra instalação recebe estas regras.
--
-- As quatro regras nascem DESLIGADAS (is_active = false). Ligar é na tela
-- Automações, depois de ler o texto do aviso. Rodar de novo não duplica:
-- o nome da regra é a trava.
--
-- O que este arquivo cria
--   (a) lead.created da fonte "Site · contato"  -> aviso interno
--   (a) lead.created da fonte "Score de Longevidade" -> aviso interno
--       sessão remetente: número terminado em 8827 (WA | Isabela)
--       destino: +55 11 92619-8917  (canônico, COM o nono dígito)
--   (b) lead.silent_for 2 h, direção do_cliente, tag origem:site
--   (b) lead.silent_for 2 h, direção do_cliente, tag origem:score
--       tarefa "Resgatar lead do site/score" para a pessoa da sessão
--       terminada em 8917 (WA | Fernanda comercial)
--
-- O texto do aviso só usa {{primeiro_nome}}, {{origem}}, {{assunto}} e
-- {{link}}. Não leva resposta do Score nem dado de saúde.

begin;

do $regra$
declare
  v_org uuid;
  v_site uuid;
  v_score uuid;
  v_isabela uuid;
  v_fernanda_sessao uuid;
  v_fernanda uuid;
  v_destino constant text := '+5511926198917';
  v_modelo constant text := E'{{primeiro_nome}} · {{origem}}\n{{assunto}}\n{{link}}';
  v_qtd int;
begin
  select count(distinct organization_id) into v_qtd
  from public.webhook_sources
  where name in ('Site · contato', 'Score de Longevidade');
  if v_qtd <> 1 then
    raise exception 'Esperava as duas fontes na mesma organização. Achei % organização(ões).', v_qtd;
  end if;

  select organization_id into v_org
  from public.webhook_sources
  where name = 'Site · contato' and is_active
  limit 1;

  select id into v_site
  from public.webhook_sources
  where organization_id = v_org and name = 'Site · contato' and is_active;
  select id into v_score
  from public.webhook_sources
  where organization_id = v_org and name = 'Score de Longevidade' and is_active;
  if v_site is null or v_score is null then
    raise exception 'Fonte ativa não encontrada. Site=%, Score=%', v_site, v_score;
  end if;

  select count(*) into v_qtd
  from public.channel_sessions
  where organization_id = v_org
    and archived_at is null
    and right(regexp_replace(coalesce(phone_number, ''), '\D', '', 'g'), 4) = '8827';
  if v_qtd <> 1 then
    raise exception 'Esperava uma sessão ativa terminada em 8827. Achei %.', v_qtd;
  end if;
  select id into v_isabela
  from public.channel_sessions
  where organization_id = v_org
    and archived_at is null
    and right(regexp_replace(coalesce(phone_number, ''), '\D', '', 'g'), 4) = '8827';

  select count(*) into v_qtd
  from public.channel_sessions
  where organization_id = v_org
    and archived_at is null
    and right(regexp_replace(coalesce(phone_number, ''), '\D', '', 'g'), 4) = '8917';
  if v_qtd <> 1 then
    raise exception 'Esperava uma sessão ativa terminada em 8917. Achei %.', v_qtd;
  end if;
  select id into v_fernanda_sessao
  from public.channel_sessions
  where organization_id = v_org
    and archived_at is null
    and right(regexp_replace(coalesce(phone_number, ''), '\D', '', 'g'), 4) = '8917';

  -- A responsável é a pessoa da sessão Fernanda. Primeiro o created_by, se o
  -- nome ou o e-mail diz Fernanda. Senão, a única integrante da organização
  -- cujo nome ou e-mail diz Fernanda. Mais de uma, ou nenhuma: para e lista.
  select u.id into v_fernanda
  from auth.users u
  join public.channel_sessions s on s.created_by = u.id
  where s.id = v_fernanda_sessao
    and (
      coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', '') ilike '%fernanda%'
      or u.email ilike '%fernanda%'
    );

  if v_fernanda is null then
    select count(*) into v_qtd
    from public.user_organizations m
    join auth.users u on u.id = m.user_id
    where m.organization_id = v_org
      and m.revoked_at is null
      and (
        coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', '') ilike '%fernanda%'
        or u.email ilike '%fernanda%'
      );
    if v_qtd <> 1 then
      raise exception
        'Não deu para apontar a tarefa para uma Fernanda só (achei %). Confira o nome na equipe e o created_by da sessão 8917.',
        v_qtd;
    end if;
    select u.id into v_fernanda
    from public.user_organizations m
    join auth.users u on u.id = m.user_id
    where m.organization_id = v_org
      and m.revoked_at is null
      and (
        coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', '') ilike '%fernanda%'
        or u.email ilike '%fernanda%'
      );
  end if;

  if not exists (
    select 1 from public.automation_rules
    where organization_id = v_org and name = 'Aviso interno · Site · contato'
  ) then
    insert into public.automation_rules
      (organization_id, name, trigger_event, trigger_config, conditions, actions, is_active, created_by_user_id)
    values (
      v_org,
      'Aviso interno · Site · contato',
      'lead.created',
      jsonb_build_object('webhook_source_id', v_site),
      '[]'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'type', 'send_internal_whatsapp',
        'config', jsonb_build_object(
          'channel_session_id', v_isabela,
          'telefone_destino', v_destino,
          'template', v_modelo
        )
      )),
      false,
      v_fernanda
    );
  end if;

  if not exists (
    select 1 from public.automation_rules
    where organization_id = v_org and name = 'Aviso interno · Score de Longevidade'
  ) then
    insert into public.automation_rules
      (organization_id, name, trigger_event, trigger_config, conditions, actions, is_active, created_by_user_id)
    values (
      v_org,
      'Aviso interno · Score de Longevidade',
      'lead.created',
      jsonb_build_object('webhook_source_id', v_score),
      '[]'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'type', 'send_internal_whatsapp',
        'config', jsonb_build_object(
          'channel_session_id', v_isabela,
          'telefone_destino', v_destino,
          'template', v_modelo
        )
      )),
      false,
      v_fernanda
    );
  end if;

  if not exists (
    select 1 from public.automation_rules
    where organization_id = v_org and name = 'Resgatar lead do site'
  ) then
    insert into public.automation_rules
      (organization_id, name, trigger_event, trigger_config, conditions, actions, is_active, created_by_user_id)
    values (
      v_org,
      'Resgatar lead do site',
      'lead.silent_for',
      jsonb_build_object('horas', 2, 'unidade', 'horas', 'direcao', 'do_cliente', 'proteger_pela_agenda', false),
      jsonb_build_array(jsonb_build_object('field', 'lead.tags', 'op', 'contains', 'value', 'origem:site')),
      jsonb_build_array(jsonb_build_object(
        'type', 'create_task',
        'config', jsonb_build_object(
          'titulo', 'Resgatar lead do site/score',
          'vence_em_dias', 0,
          'atribuir_a', jsonb_build_object('usuario_id', v_fernanda),
          'prioridade', 'high'
        )
      )),
      false,
      v_fernanda
    );
  end if;

  if not exists (
    select 1 from public.automation_rules
    where organization_id = v_org and name = 'Resgatar lead do score'
  ) then
    insert into public.automation_rules
      (organization_id, name, trigger_event, trigger_config, conditions, actions, is_active, created_by_user_id)
    values (
      v_org,
      'Resgatar lead do score',
      'lead.silent_for',
      jsonb_build_object('horas', 2, 'unidade', 'horas', 'direcao', 'do_cliente', 'proteger_pela_agenda', false),
      jsonb_build_array(jsonb_build_object('field', 'lead.tags', 'op', 'contains', 'value', 'origem:score')),
      jsonb_build_array(jsonb_build_object(
        'type', 'create_task',
        'config', jsonb_build_object(
          'titulo', 'Resgatar lead do site/score',
          'vence_em_dias', 0,
          'atribuir_a', jsonb_build_object('usuario_id', v_fernanda),
          'prioridade', 'high'
        )
      )),
      false,
      v_fernanda
    );
  end if;

  raise notice 'Regras conferidas para a organização %. Continuam desligadas até alguém ligar na tela.', v_org;
end
$regra$;

commit;
