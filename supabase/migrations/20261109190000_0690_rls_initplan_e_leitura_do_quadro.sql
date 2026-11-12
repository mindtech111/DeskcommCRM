-- manifest: A leitura deixa de reavaliar auth.uid() e a regra de escrita em cada linha. Policies permissivas de SELECT que conviviam com uma FOR ALL passam a uma só (a escrita vira insert/update/delete com a mesma expressão, porque o USING da escrita já era subconjunto da leitura), e o quadro do funil resolve a visibilidade do negócio uma vez por consulta.
-- 0690: RLS initplan e leitura do quadro
--
-- O advisor auth_rls_initplan marca policy cuja expressão chama auth.uid()
-- (ou auth.jwt/role/email) solto: o planner reavalia por linha. A forma
-- (select auth.uid()) vira InitPlan, uma vez por consulta. O mesmo vale para
-- fn_is_platform_admin() e fn_is_platform_admin_full(), que não dependem da linha.
--
-- O advisor multiple_permissive_policies marca duas policies permissivas no
-- mesmo comando. O caso da casa é uma policy de leitura e uma FOR ALL de
-- escrita: FOR ALL também vale para SELECT, o Postgres junta por OR e o plano
-- avalia a função de escrita em cada linha. A escrita continua com a mesma
-- expressão e o mesmo nome no UPDATE (é por ele que o catálogo da 0533 confere
-- fn_is_platform_admin_full); insert e delete ganham policies irmãs. O USING
-- da escrita é subconjunto da leitura (scope full implica a função pura, e o
-- papel da escrita é mais estreito que o da leitura), então tirar a escrita do
-- SELECT não esconde nem revela linha.
--
-- Exceção: skill_pointers e skill_versions. A leitura do catálogo global é
-- organization_id nulo e a FOR ALL só alcança a organização do chamador. As
-- duas juntas são o SELECT. A policy de leitura passa a ser o OR, e a escrita
-- fica só com o pertencimento.
--
-- O quadro (crm_leads por pipeline_id, status diferente de archived, ordem
-- position_in_stage) já achava o funil pelo índice existente. O tempo estava
-- em fn_can_view_lead por linha. fn_contexto_de_visibilidade_de_lead materializa
-- uma vez o papel e o modo de visibilidade; a policy só compara colunas. O
-- resultado é o mesmo de fn_can_view_lead, inclusive admin de plataforma e
-- sessão de suporte.


-- public.ai_agent_version_channels
drop policy if exists "tenant_isolation_ai_agent_version_channels_select" on public.ai_agent_version_channels;
create policy "tenant_isolation_ai_agent_version_channels_select" on public.ai_agent_version_channels
  for select
  using (
organization_id in (select * from public.fn_user_org_ids())
  )
;
drop policy if exists "tenant_isolation_ai_agent_version_channels_insert" on public.ai_agent_version_channels;
drop policy if exists "tenant_isolation_ai_agent_version_channels_delete" on public.ai_agent_version_channels;
drop policy if exists "tenant_isolation_ai_agent_version_channels_write" on public.ai_agent_version_channels;

create policy "tenant_isolation_ai_agent_version_channels_insert" on public.ai_agent_version_channels
  for insert
  with check (
    organization_id in (select * from public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin')
  
  )
;
create policy "tenant_isolation_ai_agent_version_channels_write" on public.ai_agent_version_channels
  for update
  using (
    organization_id in (select * from public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin')
  
  )
  with check (
    organization_id in (select * from public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin')
  
  )
;
create policy "tenant_isolation_ai_agent_version_channels_delete" on public.ai_agent_version_channels
  for delete
  using (
    organization_id in (select * from public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin')
  
  )
;

-- public.ai_agent_versions
drop policy if exists "tenant_isolation_ai_agent_versions_select" on public.ai_agent_versions;
create policy "tenant_isolation_ai_agent_versions_select" on public.ai_agent_versions
  for select
  using (
organization_id in (select public.fn_user_org_ids())
  )
;
drop policy if exists "tenant_isolation_ai_agent_versions_insert" on public.ai_agent_versions;
drop policy if exists "tenant_isolation_ai_agent_versions_delete" on public.ai_agent_versions;
drop policy if exists "tenant_isolation_ai_agent_versions_write" on public.ai_agent_versions;

create policy "tenant_isolation_ai_agent_versions_insert" on public.ai_agent_versions
  for insert
  with check (
    organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin')
  
  )
;
create policy "tenant_isolation_ai_agent_versions_write" on public.ai_agent_versions
  for update
  using (
    organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin')
  
  )
  with check (
    organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin')
  
  )
;
create policy "tenant_isolation_ai_agent_versions_delete" on public.ai_agent_versions
  for delete
  using (
    organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin')
  
  )
;

-- public.ai_agents
drop policy if exists "tenant_isolation_ai_agents_select" on public.ai_agents;
create policy "tenant_isolation_ai_agents_select" on public.ai_agents
  for select
  using (
    organization_id in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin())
  
  )
;
drop policy if exists "tenant_isolation_ai_agents_insert" on public.ai_agents;
drop policy if exists "tenant_isolation_ai_agents_delete" on public.ai_agents;
drop policy if exists "tenant_isolation_ai_agents_write" on public.ai_agents;

create policy "tenant_isolation_ai_agents_insert" on public.ai_agents
  for insert
  with check (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or (select public.fn_is_platform_admin_full())
  
  )
;
create policy "tenant_isolation_ai_agents_write" on public.ai_agents
  for update
  using (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or (select public.fn_is_platform_admin_full())
  
  )
  with check (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or (select public.fn_is_platform_admin_full())
  
  )
;
create policy "tenant_isolation_ai_agents_delete" on public.ai_agents
  for delete
  using (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or (select public.fn_is_platform_admin_full())
  
  )
;

-- public.ai_budgets
drop policy if exists "tenant_isolation_ai_budgets_select" on public.ai_budgets;
create policy "tenant_isolation_ai_budgets_select" on public.ai_budgets
  for select
  using (
    organization_id in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin())
  
  )
;
drop policy if exists "tenant_isolation_ai_budgets_insert" on public.ai_budgets;
drop policy if exists "tenant_isolation_ai_budgets_delete" on public.ai_budgets;
drop policy if exists "tenant_isolation_ai_budgets_write" on public.ai_budgets;

create policy "tenant_isolation_ai_budgets_insert" on public.ai_budgets
  for insert
  with check (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or (select public.fn_is_platform_admin_full())
  
  )
;
create policy "tenant_isolation_ai_budgets_write" on public.ai_budgets
  for update
  using (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or (select public.fn_is_platform_admin_full())
  
  )
  with check (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or (select public.fn_is_platform_admin_full())
  
  )
;
create policy "tenant_isolation_ai_budgets_delete" on public.ai_budgets
  for delete
  using (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or (select public.fn_is_platform_admin_full())
  
  )
;

-- public.ai_chunks
drop policy if exists "tenant_isolation_ai_chunks_select" on public.ai_chunks;
create policy "tenant_isolation_ai_chunks_select" on public.ai_chunks
  for select
  using (
    organization_id in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin())
  
  )
;
drop policy if exists "tenant_isolation_ai_chunks_insert" on public.ai_chunks;
drop policy if exists "tenant_isolation_ai_chunks_delete" on public.ai_chunks;
drop policy if exists "tenant_isolation_ai_chunks_write" on public.ai_chunks;

create policy "tenant_isolation_ai_chunks_insert" on public.ai_chunks
  for insert
  with check (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or (select public.fn_is_platform_admin_full())
  
  )
;
create policy "tenant_isolation_ai_chunks_write" on public.ai_chunks
  for update
  using (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or (select public.fn_is_platform_admin_full())
  
  )
  with check (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or (select public.fn_is_platform_admin_full())
  
  )
;
create policy "tenant_isolation_ai_chunks_delete" on public.ai_chunks
  for delete
  using (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or (select public.fn_is_platform_admin_full())
  
  )
;

-- public.ai_faq_items
drop policy if exists "tenant_isolation_ai_faq_items_select" on public.ai_faq_items;
create policy "tenant_isolation_ai_faq_items_select" on public.ai_faq_items
  for select
  using (
organization_id in (select public.fn_user_org_ids())
  )
;
drop policy if exists "tenant_isolation_ai_faq_items_insert" on public.ai_faq_items;
drop policy if exists "tenant_isolation_ai_faq_items_delete" on public.ai_faq_items;
drop policy if exists "tenant_isolation_ai_faq_items_write" on public.ai_faq_items;

create policy "tenant_isolation_ai_faq_items_insert" on public.ai_faq_items
  for insert
  with check (
    organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager')
  
  )
;
create policy "tenant_isolation_ai_faq_items_write" on public.ai_faq_items
  for update
  using (
    organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager')
  
  )
  with check (
    organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager')
  
  )
;
create policy "tenant_isolation_ai_faq_items_delete" on public.ai_faq_items
  for delete
  using (
    organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager')
  
  )
;

-- public.ai_invocations
drop policy if exists "tenant_isolation_ai_invocations_read" on public.ai_invocations;
create policy "tenant_isolation_ai_invocations_read" on public.ai_invocations
  for select
  using (
"organization_id" in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin())
  )
;
drop policy if exists "tenant_isolation_ai_invocations_insert" on public.ai_invocations;
drop policy if exists "tenant_isolation_ai_invocations_delete" on public.ai_invocations;
drop policy if exists "tenant_isolation_ai_invocations_write" on public.ai_invocations;

create policy "tenant_isolation_ai_invocations_insert" on public.ai_invocations
  for insert
  with check (
"organization_id" in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin_full())
  )
;
create policy "tenant_isolation_ai_invocations_write" on public.ai_invocations
  for update
  using (
"organization_id" in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin_full())
  )
  with check (
"organization_id" in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin_full())
  )
;
create policy "tenant_isolation_ai_invocations_delete" on public.ai_invocations
  for delete
  using (
"organization_id" in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin_full())
  )
;

-- public.ai_knowledge_sources
drop policy if exists "tenant_isolation_ai_knowledge_sources_select" on public.ai_knowledge_sources;
create policy "tenant_isolation_ai_knowledge_sources_select" on public.ai_knowledge_sources
  for select
  using (
    organization_id in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin())
  
  )
;
drop policy if exists "tenant_isolation_ai_knowledge_sources_insert" on public.ai_knowledge_sources;
drop policy if exists "tenant_isolation_ai_knowledge_sources_delete" on public.ai_knowledge_sources;
drop policy if exists "tenant_isolation_ai_knowledge_sources_write" on public.ai_knowledge_sources;

create policy "tenant_isolation_ai_knowledge_sources_insert" on public.ai_knowledge_sources
  for insert
  with check (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager'))
    or (select public.fn_is_platform_admin_full())
  
  )
;
create policy "tenant_isolation_ai_knowledge_sources_write" on public.ai_knowledge_sources
  for update
  using (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager'))
    or (select public.fn_is_platform_admin_full())
  
  )
  with check (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager'))
    or (select public.fn_is_platform_admin_full())
  
  )
;
create policy "tenant_isolation_ai_knowledge_sources_delete" on public.ai_knowledge_sources
  for delete
  using (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'manager'))
    or (select public.fn_is_platform_admin_full())
  
  )
;

-- public.ai_knowledge_versions
drop policy if exists "tenant_isolation_ai_kbv_select" on public.ai_knowledge_versions;
create policy "tenant_isolation_ai_kbv_select" on public.ai_knowledge_versions
  for select
  using (
    organization_id in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin())
  
  )
;
drop policy if exists "tenant_isolation_ai_kbv_insert" on public.ai_knowledge_versions;
drop policy if exists "tenant_isolation_ai_kbv_delete" on public.ai_knowledge_versions;
drop policy if exists "tenant_isolation_ai_kbv_write" on public.ai_knowledge_versions;

create policy "tenant_isolation_ai_kbv_insert" on public.ai_knowledge_versions
  for insert
  with check (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or (select public.fn_is_platform_admin_full())
  
  )
;
create policy "tenant_isolation_ai_kbv_write" on public.ai_knowledge_versions
  for update
  using (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or (select public.fn_is_platform_admin_full())
  
  )
  with check (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or (select public.fn_is_platform_admin_full())
  
  )
;
create policy "tenant_isolation_ai_kbv_delete" on public.ai_knowledge_versions
  for delete
  using (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or (select public.fn_is_platform_admin_full())
  
  )
;

-- public.ai_provider_credentials
drop policy if exists "tenant_isolation_ai_provider_credentials_select" on public.ai_provider_credentials;
create policy "tenant_isolation_ai_provider_credentials_select" on public.ai_provider_credentials
  for select
  using (
organization_id in (select public.fn_user_org_ids())
  )
;
drop policy if exists "tenant_isolation_ai_provider_credentials_insert" on public.ai_provider_credentials;
drop policy if exists "tenant_isolation_ai_provider_credentials_delete" on public.ai_provider_credentials;
drop policy if exists "tenant_isolation_ai_provider_credentials_write" on public.ai_provider_credentials;

create policy "tenant_isolation_ai_provider_credentials_insert" on public.ai_provider_credentials
  for insert
  with check (
    organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin')
  
  )
;
create policy "tenant_isolation_ai_provider_credentials_write" on public.ai_provider_credentials
  for update
  using (
    organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin')
  
  )
  with check (
    organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin')
  
  )
;
create policy "tenant_isolation_ai_provider_credentials_delete" on public.ai_provider_credentials
  for delete
  using (
    organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin')
  
  )
;

-- public.ai_purpose_bindings
drop policy if exists "tenant_isolation_ai_purpose_bindings_select" on public.ai_purpose_bindings;
create policy "tenant_isolation_ai_purpose_bindings_select" on public.ai_purpose_bindings
  for select
  using (
organization_id in (select public.fn_user_org_ids())
  )
;
drop policy if exists "tenant_isolation_ai_purpose_bindings_insert" on public.ai_purpose_bindings;
drop policy if exists "tenant_isolation_ai_purpose_bindings_delete" on public.ai_purpose_bindings;
drop policy if exists "tenant_isolation_ai_purpose_bindings_write" on public.ai_purpose_bindings;

create policy "tenant_isolation_ai_purpose_bindings_insert" on public.ai_purpose_bindings
  for insert
  with check (
    organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin')
  
  )
;
create policy "tenant_isolation_ai_purpose_bindings_write" on public.ai_purpose_bindings
  for update
  using (
    organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin')
  
  )
  with check (
    organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin')
  
  )
;
create policy "tenant_isolation_ai_purpose_bindings_delete" on public.ai_purpose_bindings
  for delete
  using (
    organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin')
  
  )
;

-- public.ai_router_members
drop policy if exists "tenant_isolation_ai_router_members_select" on public.ai_router_members;
create policy "tenant_isolation_ai_router_members_select" on public.ai_router_members
  for select
  using (
organization_id in (select public.fn_user_org_ids())
  )
;
drop policy if exists "tenant_isolation_ai_router_members_insert" on public.ai_router_members;
drop policy if exists "tenant_isolation_ai_router_members_delete" on public.ai_router_members;
drop policy if exists "tenant_isolation_ai_router_members_write" on public.ai_router_members;

create policy "tenant_isolation_ai_router_members_insert" on public.ai_router_members
  for insert
  with check (
    organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin')
  
  )
;
create policy "tenant_isolation_ai_router_members_write" on public.ai_router_members
  for update
  using (
    organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin')
  
  )
  with check (
    organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin')
  
  )
;
create policy "tenant_isolation_ai_router_members_delete" on public.ai_router_members
  for delete
  using (
    organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin')
  
  )
;

-- public.ai_routers
drop policy if exists "tenant_isolation_ai_routers_select" on public.ai_routers;
create policy "tenant_isolation_ai_routers_select" on public.ai_routers
  for select
  using (
organization_id in (select public.fn_user_org_ids())
  )
;
drop policy if exists "tenant_isolation_ai_routers_insert" on public.ai_routers;
drop policy if exists "tenant_isolation_ai_routers_delete" on public.ai_routers;
drop policy if exists "tenant_isolation_ai_routers_write" on public.ai_routers;

create policy "tenant_isolation_ai_routers_insert" on public.ai_routers
  for insert
  with check (
    organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin')
  
  )
;
create policy "tenant_isolation_ai_routers_write" on public.ai_routers
  for update
  using (
    organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin')
  
  )
  with check (
    organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin')
  
  )
;
create policy "tenant_isolation_ai_routers_delete" on public.ai_routers
  for delete
  using (
    organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin')
  
  )
;

-- public.api_tokens
drop policy if exists "api_tokens_tenant_read" on public.api_tokens;
create policy "api_tokens_tenant_read" on public.api_tokens
  for select
  using (
public.fn_role_at_least("organization_id",'admin') or (select public.fn_is_platform_admin())
  )
;
drop policy if exists "api_tokens_admin_insert" on public.api_tokens;
drop policy if exists "api_tokens_admin_delete" on public.api_tokens;
drop policy if exists "api_tokens_admin_write" on public.api_tokens;

create policy "api_tokens_admin_insert" on public.api_tokens
  for insert
  with check (
public.fn_role_at_least("organization_id",'admin') or (select public.fn_is_platform_admin_full())
  )
;
create policy "api_tokens_admin_write" on public.api_tokens
  for update
  using (
public.fn_role_at_least("organization_id",'admin') or (select public.fn_is_platform_admin_full())
  )
  with check (
public.fn_role_at_least("organization_id",'admin') or (select public.fn_is_platform_admin_full())
  )
;
create policy "api_tokens_admin_delete" on public.api_tokens
  for delete
  using (
public.fn_role_at_least("organization_id",'admin') or (select public.fn_is_platform_admin_full())
  )
;

-- public.automation_rules
drop policy if exists "automation_rules_select" on public.automation_rules;
create policy "automation_rules_select" on public.automation_rules
  for select
  using (
    (organization_id in (select public.fn_user_org_ids()))
    or (select public.fn_is_platform_admin())
  
  )
;
drop policy if exists "automation_rules_manager_insert" on public.automation_rules;
drop policy if exists "automation_rules_manager_delete" on public.automation_rules;
drop policy if exists "automation_rules_manager_write" on public.automation_rules;

create policy "automation_rules_manager_insert" on public.automation_rules
  for insert
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
;
create policy "automation_rules_manager_write" on public.automation_rules
  for update
  using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
;
create policy "automation_rules_manager_delete" on public.automation_rules
  for delete
  using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
;

-- public.calendar_appointments
drop policy if exists "calendar_appointments_select" on public.calendar_appointments;
create policy "calendar_appointments_select" on public.calendar_appointments
  for select
  using (
    public.fn_can_view_appointment(organization_id, owner_user_id)
    -- A OPÇÃO da #978, dentro do pertencimento (ver COLISÃO DECLARADA acima):
    -- com ela ligada ou ausente o colega da MESMA organização continua lendo a
    -- agenda da equipe; com ela em falso só o que `fn_can_view_appointment`
    -- concede.
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_colegas_podem_mexer_na_agenda(organization_id))
  
  )
;
drop policy if exists "calendar_appointments_insert" on public.calendar_appointments;
drop policy if exists "calendar_appointments_delete" on public.calendar_appointments;
drop policy if exists "calendar_appointments_write" on public.calendar_appointments;

create policy "calendar_appointments_insert" on public.calendar_appointments
  for insert
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent')
        and (public.fn_role_at_least(organization_id, 'manager')
             or public.fn_can_view_appointment(organization_id, owner_user_id)
             or public.fn_colegas_podem_mexer_na_agenda(organization_id)))
  
  )
;
create policy "calendar_appointments_write" on public.calendar_appointments
  for update
  using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent')
        and (public.fn_role_at_least(organization_id, 'manager')
             or public.fn_can_view_appointment(organization_id, owner_user_id)
             or public.fn_colegas_podem_mexer_na_agenda(organization_id)))
  
  )
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent')
        and (public.fn_role_at_least(organization_id, 'manager')
             or public.fn_can_view_appointment(organization_id, owner_user_id)
             or public.fn_colegas_podem_mexer_na_agenda(organization_id)))
  
  )
;
create policy "calendar_appointments_delete" on public.calendar_appointments
  for delete
  using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent')
        and (public.fn_role_at_least(organization_id, 'manager')
             or public.fn_can_view_appointment(organization_id, owner_user_id)
             or public.fn_colegas_podem_mexer_na_agenda(organization_id)))
  
  )
;

-- public.calendar_availability_exceptions
drop policy if exists "calendar_availability_exceptions_select" on public.calendar_availability_exceptions;
create policy "calendar_availability_exceptions_select" on public.calendar_availability_exceptions
  for select
  using (
    (organization_id in (select public.fn_user_org_ids())) or (select public.fn_is_platform_admin())
  
  )
;
drop policy if exists "calendar_availability_exceptions_insert" on public.calendar_availability_exceptions;
drop policy if exists "calendar_availability_exceptions_delete" on public.calendar_availability_exceptions;
drop policy if exists "calendar_availability_exceptions_write" on public.calendar_availability_exceptions;

create policy "calendar_availability_exceptions_insert" on public.calendar_availability_exceptions
  for insert
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and (user_id = (select auth.uid()) or public.fn_role_at_least(organization_id, 'manager')))
  
  )
;
create policy "calendar_availability_exceptions_write" on public.calendar_availability_exceptions
  for update
  using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and (user_id = (select auth.uid()) or public.fn_role_at_least(organization_id, 'manager')))
  
  )
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and (user_id = (select auth.uid()) or public.fn_role_at_least(organization_id, 'manager')))
  
  )
;
create policy "calendar_availability_exceptions_delete" on public.calendar_availability_exceptions
  for delete
  using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and (user_id = (select auth.uid()) or public.fn_role_at_least(organization_id, 'manager')))
  
  )
;

-- public.calendar_event_types
drop policy if exists "calendar_event_types_select" on public.calendar_event_types;
create policy "calendar_event_types_select" on public.calendar_event_types
  for select
  using (
    (organization_id in (select public.fn_user_org_ids())) or (select public.fn_is_platform_admin())
  
  )
;
drop policy if exists "calendar_event_types_insert" on public.calendar_event_types;
drop policy if exists "calendar_event_types_delete" on public.calendar_event_types;
drop policy if exists "calendar_event_types_write" on public.calendar_event_types;

create policy "calendar_event_types_insert" on public.calendar_event_types
  for insert
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
;
create policy "calendar_event_types_write" on public.calendar_event_types
  for update
  using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
;
create policy "calendar_event_types_delete" on public.calendar_event_types
  for delete
  using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
;

-- public.campaign_channel_sessions
drop policy if exists "campaign_channel_sessions_select" on public.campaign_channel_sessions;
create policy "campaign_channel_sessions_select" on public.campaign_channel_sessions
  for select
  using (
    (organization_id in (select public.fn_user_org_ids())) or (select public.fn_is_platform_admin())
  
  )
;
drop policy if exists "campaign_channel_sessions_insert" on public.campaign_channel_sessions;
drop policy if exists "campaign_channel_sessions_delete" on public.campaign_channel_sessions;
drop policy if exists "campaign_channel_sessions_write" on public.campaign_channel_sessions;

create policy "campaign_channel_sessions_insert" on public.campaign_channel_sessions
  for insert
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
;
create policy "campaign_channel_sessions_write" on public.campaign_channel_sessions
  for update
  using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
;
create policy "campaign_channel_sessions_delete" on public.campaign_channel_sessions
  for delete
  using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
;

-- public.campaign_recipients
drop policy if exists "campaign_recipients_select" on public.campaign_recipients;
create policy "campaign_recipients_select" on public.campaign_recipients
  for select
  using (
    (organization_id in (select public.fn_user_org_ids())) or (select public.fn_is_platform_admin())
  
  )
;
drop policy if exists "campaign_recipients_insert" on public.campaign_recipients;
drop policy if exists "campaign_recipients_delete" on public.campaign_recipients;
drop policy if exists "campaign_recipients_write" on public.campaign_recipients;

create policy "campaign_recipients_insert" on public.campaign_recipients
  for insert
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
;
create policy "campaign_recipients_write" on public.campaign_recipients
  for update
  using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
;
create policy "campaign_recipients_delete" on public.campaign_recipients
  for delete
  using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
;

-- public.campaign_suppressions
drop policy if exists "campaign_suppressions_select" on public.campaign_suppressions;
create policy "campaign_suppressions_select" on public.campaign_suppressions
  for select
  using (
    (organization_id in (select public.fn_user_org_ids())) or (select public.fn_is_platform_admin())
  
  )
;
drop policy if exists "campaign_suppressions_insert" on public.campaign_suppressions;
drop policy if exists "campaign_suppressions_delete" on public.campaign_suppressions;
drop policy if exists "campaign_suppressions_write" on public.campaign_suppressions;

create policy "campaign_suppressions_insert" on public.campaign_suppressions
  for insert
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
;
create policy "campaign_suppressions_write" on public.campaign_suppressions
  for update
  using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
;
create policy "campaign_suppressions_delete" on public.campaign_suppressions
  for delete
  using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
;

-- public.campaign_templates
drop policy if exists "campaign_templates_select" on public.campaign_templates;
create policy "campaign_templates_select" on public.campaign_templates
  for select
  using (
    (organization_id in (select public.fn_user_org_ids())) or (select public.fn_is_platform_admin())
  
  )
;
drop policy if exists "campaign_templates_insert" on public.campaign_templates;
drop policy if exists "campaign_templates_delete" on public.campaign_templates;
drop policy if exists "campaign_templates_write" on public.campaign_templates;

create policy "campaign_templates_insert" on public.campaign_templates
  for insert
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
;
create policy "campaign_templates_write" on public.campaign_templates
  for update
  using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
;
create policy "campaign_templates_delete" on public.campaign_templates
  for delete
  using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
;

-- public.campaigns
drop policy if exists "campaigns_select" on public.campaigns;
create policy "campaigns_select" on public.campaigns
  for select
  using (
    (organization_id in (select public.fn_user_org_ids())) or (select public.fn_is_platform_admin())
  
  )
;
drop policy if exists "campaigns_insert" on public.campaigns;
drop policy if exists "campaigns_delete" on public.campaigns;
drop policy if exists "campaigns_write" on public.campaigns;

create policy "campaigns_insert" on public.campaigns
  for insert
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
;
create policy "campaigns_write" on public.campaigns
  for update
  using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
;
create policy "campaigns_delete" on public.campaigns
  for delete
  using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
;

-- public.channel_session_warmup
drop policy if exists "warmup_tenant_isolation_read" on public.channel_session_warmup;
create policy "warmup_tenant_isolation_read" on public.channel_session_warmup
  for select
  using (
"organization_id" in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin())
  )
;
drop policy if exists "warmup_tenant_isolation_insert" on public.channel_session_warmup;
drop policy if exists "warmup_tenant_isolation_delete" on public.channel_session_warmup;
drop policy if exists "warmup_tenant_isolation_write" on public.channel_session_warmup;

create policy "warmup_tenant_isolation_insert" on public.channel_session_warmup
  for insert
  with check (
"organization_id" in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin_full())
  )
;
create policy "warmup_tenant_isolation_write" on public.channel_session_warmup
  for update
  using (
"organization_id" in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin_full())
  )
  with check (
"organization_id" in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin_full())
  )
;
create policy "warmup_tenant_isolation_delete" on public.channel_session_warmup
  for delete
  using (
"organization_id" in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin_full())
  )
;

-- public.channel_sessions
drop policy if exists "channel_sessions_tenant_select" on public.channel_sessions;
create policy "channel_sessions_tenant_select" on public.channel_sessions
  for select
  using (
    organization_id in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin())
  
  )
;
drop policy if exists "channel_sessions_tenant_insert" on public.channel_sessions;
drop policy if exists "channel_sessions_tenant_delete" on public.channel_sessions;
drop policy if exists "channel_sessions_tenant_write" on public.channel_sessions;

create policy "channel_sessions_tenant_insert" on public.channel_sessions
  for insert
  with check (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or (select public.fn_is_platform_admin_full())
  
  )
;
create policy "channel_sessions_tenant_write" on public.channel_sessions
  for update
  using (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or (select public.fn_is_platform_admin_full())
  
  )
  with check (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or (select public.fn_is_platform_admin_full())
  
  )
;
create policy "channel_sessions_tenant_delete" on public.channel_sessions
  for delete
  using (
    (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin'))
    or (select public.fn_is_platform_admin_full())
  
  )
;

-- public.contacts
drop policy if exists "tenant_isolation_contacts_read" on public.contacts;
create policy "tenant_isolation_contacts_read" on public.contacts
  for select
  using (
"organization_id" in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin())
  )
;
drop policy if exists "tenant_isolation_contacts_insert" on public.contacts;
drop policy if exists "tenant_isolation_contacts_delete" on public.contacts;
drop policy if exists "tenant_isolation_contacts_write" on public.contacts;

create policy "tenant_isolation_contacts_insert" on public.contacts
  for insert
  with check (
"organization_id" in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin_full())
  )
;
create policy "tenant_isolation_contacts_write" on public.contacts
  for update
  using (
"organization_id" in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin_full())
  )
  with check (
"organization_id" in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin_full())
  )
;
create policy "tenant_isolation_contacts_delete" on public.contacts
  for delete
  using (
"organization_id" in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin_full())
  )
;

-- public.crm_pipelines
drop policy if exists "crm_pipelines_select" on public.crm_pipelines;
create policy "crm_pipelines_select" on public.crm_pipelines
  for select
  using (
    (organization_id in (select public.fn_user_org_ids()))
    or (select public.fn_is_platform_admin())
  
  )
;
drop policy if exists "crm_pipelines_manager_insert" on public.crm_pipelines;
drop policy if exists "crm_pipelines_manager_delete" on public.crm_pipelines;
drop policy if exists "crm_pipelines_manager_write" on public.crm_pipelines;

create policy "crm_pipelines_manager_insert" on public.crm_pipelines
  for insert
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
;
create policy "crm_pipelines_manager_write" on public.crm_pipelines
  for update
  using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
;
create policy "crm_pipelines_manager_delete" on public.crm_pipelines
  for delete
  using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
;

-- public.crm_proposal_items
drop policy if exists "crm_proposal_items_select" on public.crm_proposal_items;
create policy "crm_proposal_items_select" on public.crm_proposal_items
  for select
  using (
    (organization_id in (select public.fn_user_org_ids())) or (select public.fn_is_platform_admin())
  
  )
;
drop policy if exists "crm_proposal_items_insert" on public.crm_proposal_items;
drop policy if exists "crm_proposal_items_delete" on public.crm_proposal_items;
drop policy if exists "crm_proposal_items_write" on public.crm_proposal_items;

create policy "crm_proposal_items_insert" on public.crm_proposal_items
  for insert
  with check (
organization_id in (select public.fn_user_org_ids())
              and public.fn_role_at_least(organization_id, 'agent')
              and exists (select 1 from public.crm_proposals p
                           where p.id = crm_proposal_items.proposal_id
                             and p.organization_id = crm_proposal_items.organization_id
                             and p.status = 'rascunho')
  )
;
create policy "crm_proposal_items_write" on public.crm_proposal_items
  for update
  using (
organization_id in (select public.fn_user_org_ids())
         and public.fn_role_at_least(organization_id, 'agent')
         and exists (select 1 from public.crm_proposals p
                      where p.id = crm_proposal_items.proposal_id
                        and p.organization_id = crm_proposal_items.organization_id
                        and p.status = 'rascunho')
  )
  with check (
organization_id in (select public.fn_user_org_ids())
              and public.fn_role_at_least(organization_id, 'agent')
              and exists (select 1 from public.crm_proposals p
                           where p.id = crm_proposal_items.proposal_id
                             and p.organization_id = crm_proposal_items.organization_id
                             and p.status = 'rascunho')
  )
;
create policy "crm_proposal_items_delete" on public.crm_proposal_items
  for delete
  using (
organization_id in (select public.fn_user_org_ids())
         and public.fn_role_at_least(organization_id, 'agent')
         and exists (select 1 from public.crm_proposals p
                      where p.id = crm_proposal_items.proposal_id
                        and p.organization_id = crm_proposal_items.organization_id
                        and p.status = 'rascunho')
  )
;

-- public.crm_stages
drop policy if exists "crm_stages_select" on public.crm_stages;
create policy "crm_stages_select" on public.crm_stages
  for select
  using (
    (organization_id in (select public.fn_user_org_ids()))
    or (select public.fn_is_platform_admin())
  
  )
;
drop policy if exists "crm_stages_manager_insert" on public.crm_stages;
drop policy if exists "crm_stages_manager_delete" on public.crm_stages;
drop policy if exists "crm_stages_manager_write" on public.crm_stages;

create policy "crm_stages_manager_insert" on public.crm_stages
  for insert
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
;
create policy "crm_stages_manager_write" on public.crm_stages
  for update
  using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
;
create policy "crm_stages_manager_delete" on public.crm_stages
  for delete
  using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
;

-- public.crm_tasks
drop policy if exists "crm_tasks_select" on public.crm_tasks;
create policy "crm_tasks_select" on public.crm_tasks
  for select
  using (
    public.fn_can_view_task(organization_id, assigned_to, created_by)
    -- Mesma opção, mesma colocação da irmã da agenda: o recorte por responsável
    -- da #2902 entra na leitura das tarefas quando a organização desliga a chave.
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_colegas_podem_mexer_na_agenda(organization_id))
  
  )
;
drop policy if exists "crm_tasks_insert" on public.crm_tasks;
drop policy if exists "crm_tasks_delete" on public.crm_tasks;
drop policy if exists "crm_tasks_write" on public.crm_tasks;

create policy "crm_tasks_insert" on public.crm_tasks
  for insert
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent')
        and (public.fn_role_at_least(organization_id, 'manager')
             or public.fn_can_view_task(organization_id, assigned_to, created_by)
             or public.fn_colegas_podem_mexer_na_agenda(organization_id)))
  
  )
;
create policy "crm_tasks_write" on public.crm_tasks
  for update
  using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent')
        and (public.fn_role_at_least(organization_id, 'manager')
             or public.fn_can_view_task(organization_id, assigned_to, created_by)
             or public.fn_colegas_podem_mexer_na_agenda(organization_id)))
  
  )
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent')
        and (public.fn_role_at_least(organization_id, 'manager')
             or public.fn_can_view_task(organization_id, assigned_to, created_by)
             or public.fn_colegas_podem_mexer_na_agenda(organization_id)))
  
  )
;
create policy "crm_tasks_delete" on public.crm_tasks
  for delete
  using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent')
        and (public.fn_role_at_least(organization_id, 'manager')
             or public.fn_can_view_task(organization_id, assigned_to, created_by)
             or public.fn_colegas_podem_mexer_na_agenda(organization_id)))
  
  )
;

-- public.external_db_connections
drop policy if exists "tenant_isolation_external_db_connections_select" on public.external_db_connections;
create policy "tenant_isolation_external_db_connections_select" on public.external_db_connections
  for select
  using (
organization_id in (select * from public.fn_user_org_ids())
  )
;
drop policy if exists "tenant_isolation_external_db_connections_insert" on public.external_db_connections;
drop policy if exists "tenant_isolation_external_db_connections_delete" on public.external_db_connections;
drop policy if exists "tenant_isolation_external_db_connections_write" on public.external_db_connections;

create policy "tenant_isolation_external_db_connections_insert" on public.external_db_connections
  for insert
  with check (
    organization_id in (select * from public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin')
  
  )
;
create policy "tenant_isolation_external_db_connections_write" on public.external_db_connections
  for update
  using (
    organization_id in (select * from public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin')
  
  )
  with check (
    organization_id in (select * from public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin')
  
  )
;
create policy "tenant_isolation_external_db_connections_delete" on public.external_db_connections
  for delete
  using (
    organization_id in (select * from public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin')
  
  )
;

-- public.incidents
drop policy if exists "incidents_tenant_read" on public.incidents;
create policy "incidents_tenant_read" on public.incidents
  for select
  using (
(select public.fn_is_platform_admin())
  )
;
drop policy if exists "incidents_admin_insert" on public.incidents;
drop policy if exists "incidents_admin_delete" on public.incidents;
drop policy if exists "incidents_admin_write" on public.incidents;

create policy "incidents_admin_insert" on public.incidents
  for insert
  with check (
(select public.fn_is_platform_admin_full())
  )
;
create policy "incidents_admin_write" on public.incidents
  for update
  using (
(select public.fn_is_platform_admin_full())
  )
  with check (
(select public.fn_is_platform_admin_full())
  )
;
create policy "incidents_admin_delete" on public.incidents
  for delete
  using (
(select public.fn_is_platform_admin_full())
  )
;

-- public.message_templates
drop policy if exists "message_templates_select" on public.message_templates;
create policy "message_templates_select" on public.message_templates
  for select
  using (
    (
      organization_id in (select fn_user_org_ids())
      and (owner_user_id is null or owner_user_id = (select auth.uid()))
    )
    or (select fn_is_platform_admin())
  
  )
;
drop policy if exists "message_templates_insert" on public.message_templates;
drop policy if exists "message_templates_delete" on public.message_templates;
drop policy if exists "message_templates_write" on public.message_templates;

create policy "message_templates_insert" on public.message_templates
  for insert
  with check (
    organization_id in (select fn_user_org_ids())
    and (
      (owner_user_id = (select auth.uid()) and fn_role_at_least(organization_id, 'agent'))
      or (owner_user_id is null and fn_role_at_least(organization_id, 'manager'))
    )
  
  )
;
create policy "message_templates_write" on public.message_templates
  for update
  using (
    organization_id in (select fn_user_org_ids())
    and (
      (owner_user_id = (select auth.uid()) and fn_role_at_least(organization_id, 'agent'))
      or (owner_user_id is null and fn_role_at_least(organization_id, 'manager'))
    )
  
  )
  with check (
    organization_id in (select fn_user_org_ids())
    and (
      (owner_user_id = (select auth.uid()) and fn_role_at_least(organization_id, 'agent'))
      or (owner_user_id is null and fn_role_at_least(organization_id, 'manager'))
    )
  
  )
;
create policy "message_templates_delete" on public.message_templates
  for delete
  using (
    organization_id in (select fn_user_org_ids())
    and (
      (owner_user_id = (select auth.uid()) and fn_role_at_least(organization_id, 'agent'))
      or (owner_user_id is null and fn_role_at_least(organization_id, 'manager'))
    )
  
  )
;

-- public.nuvemshop_products
drop policy if exists "nuvemshop_products_read" on public.nuvemshop_products;
create policy "nuvemshop_products_read" on public.nuvemshop_products
  for select
  using (
"organization_id" in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin())
  )
;
drop policy if exists "nuvemshop_products_tenant_insert" on public.nuvemshop_products;
drop policy if exists "nuvemshop_products_tenant_delete" on public.nuvemshop_products;
drop policy if exists "nuvemshop_products_tenant_write" on public.nuvemshop_products;

create policy "nuvemshop_products_tenant_insert" on public.nuvemshop_products
  for insert
  with check (
"organization_id" in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin_full())
  )
;
create policy "nuvemshop_products_tenant_write" on public.nuvemshop_products
  for update
  using (
"organization_id" in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin_full())
  )
  with check (
"organization_id" in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin_full())
  )
;
create policy "nuvemshop_products_tenant_delete" on public.nuvemshop_products
  for delete
  using (
"organization_id" in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin_full())
  )
;

-- public.org_guardrail_layers
drop policy if exists "org_guardrail_layers_select" on public.org_guardrail_layers;
create policy "org_guardrail_layers_select" on public.org_guardrail_layers
  for select
  using (
    (organization_id in (select public.fn_user_org_ids()))
    or (select public.fn_is_platform_admin())
  
  )
;
drop policy if exists "org_guardrail_layers_admin_insert" on public.org_guardrail_layers;
drop policy if exists "org_guardrail_layers_admin_delete" on public.org_guardrail_layers;
drop policy if exists "org_guardrail_layers_admin_write" on public.org_guardrail_layers;

create policy "org_guardrail_layers_admin_insert" on public.org_guardrail_layers
  for insert
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'admin'))
  
  )
;
create policy "org_guardrail_layers_admin_write" on public.org_guardrail_layers
  for update
  using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'admin'))
  
  )
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'admin'))
  
  )
;
create policy "org_guardrail_layers_admin_delete" on public.org_guardrail_layers
  for delete
  using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'admin'))
  
  )
;

-- public.org_voice_calls
drop policy if exists "org_voice_calls_select" on public.org_voice_calls;
create policy "org_voice_calls_select" on public.org_voice_calls
  for select
  using (
    (organization_id in (select public.fn_user_org_ids()))
    or (select public.fn_is_platform_admin())
  
  )
;
drop policy if exists "org_voice_calls_admin_insert" on public.org_voice_calls;
drop policy if exists "org_voice_calls_admin_delete" on public.org_voice_calls;
drop policy if exists "org_voice_calls_admin_write" on public.org_voice_calls;

create policy "org_voice_calls_admin_insert" on public.org_voice_calls
  for insert
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'admin'))
  
  )
;
create policy "org_voice_calls_admin_write" on public.org_voice_calls
  for update
  using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'admin'))
  
  )
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'admin'))
  
  )
;
create policy "org_voice_calls_admin_delete" on public.org_voice_calls
  for delete
  using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'admin'))
  
  )
;

-- public.proposal_templates
drop policy if exists "proposal_templates_select" on public.proposal_templates;
create policy "proposal_templates_select" on public.proposal_templates
  for select
  using (
    (organization_id in (select public.fn_user_org_ids())) or (select public.fn_is_platform_admin())
  
  )
;
drop policy if exists "proposal_templates_insert" on public.proposal_templates;
drop policy if exists "proposal_templates_delete" on public.proposal_templates;
drop policy if exists "proposal_templates_write" on public.proposal_templates;

create policy "proposal_templates_insert" on public.proposal_templates
  for insert
  with check (
organization_id in (select public.fn_user_org_ids())
              and public.fn_role_at_least(organization_id, 'manager')
  )
;
create policy "proposal_templates_write" on public.proposal_templates
  for update
  using (
organization_id in (select public.fn_user_org_ids())
         and public.fn_role_at_least(organization_id, 'manager')
  )
  with check (
organization_id in (select public.fn_user_org_ids())
              and public.fn_role_at_least(organization_id, 'manager')
  )
;
create policy "proposal_templates_delete" on public.proposal_templates
  for delete
  using (
organization_id in (select public.fn_user_org_ids())
         and public.fn_role_at_least(organization_id, 'manager')
  )
;

-- public.recurring_entries
drop policy if exists "tenant_isolation_recurring_entries_read" on public.recurring_entries;
create policy "tenant_isolation_recurring_entries_read" on public.recurring_entries
  for select
  using (
organization_id in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin())
  )
;
drop policy if exists "tenant_isolation_recurring_entries_insert" on public.recurring_entries;
drop policy if exists "tenant_isolation_recurring_entries_delete" on public.recurring_entries;
drop policy if exists "tenant_isolation_recurring_entries_write" on public.recurring_entries;

create policy "tenant_isolation_recurring_entries_insert" on public.recurring_entries
  for insert
  with check (
    (select public.fn_is_platform_admin_full())
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
;
create policy "tenant_isolation_recurring_entries_write" on public.recurring_entries
  for update
  using (
organization_id in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin_full())
  )
  with check (
    (select public.fn_is_platform_admin_full())
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
;
create policy "tenant_isolation_recurring_entries_delete" on public.recurring_entries
  for delete
  using (
organization_id in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin_full())
  )
;

-- public.team_invites
drop policy if exists "team_invites_select" on public.team_invites;
create policy "team_invites_select" on public.team_invites
  for select
  using (
    (select public.fn_is_platform_admin())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
;
drop policy if exists "team_invites_insert" on public.team_invites;
drop policy if exists "team_invites_delete" on public.team_invites;
drop policy if exists "team_invites_write" on public.team_invites;

create policy "team_invites_insert" on public.team_invites
  for insert
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'admin'))
  
  )
;
create policy "team_invites_write" on public.team_invites
  for update
  using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'admin'))
  
  )
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'admin'))
  
  )
;
create policy "team_invites_delete" on public.team_invites
  for delete
  using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'admin'))
  
  )
;

-- public.voice_calls
drop policy if exists "voice_calls_select" on public.voice_calls;
create policy "voice_calls_select" on public.voice_calls
  for select
  using (
organization_id in (select public.fn_user_org_ids())
  )
;
drop policy if exists "voice_calls_insert" on public.voice_calls;
drop policy if exists "voice_calls_delete" on public.voice_calls;
drop policy if exists "voice_calls_write" on public.voice_calls;

create policy "voice_calls_insert" on public.voice_calls
  for insert
  with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'agent')
  
  )
;
create policy "voice_calls_write" on public.voice_calls
  for update
  using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'agent')
  
  )
  with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'agent')
  
  )
;
create policy "voice_calls_delete" on public.voice_calls
  for delete
  using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'agent')
  
  )
;

-- public.voip_trunk_settings
drop policy if exists "voip_trunk_settings_select" on public.voip_trunk_settings;
create policy "voip_trunk_settings_select" on public.voip_trunk_settings
  for select
  using (
organization_id in (select public.fn_user_org_ids())
  )
;
drop policy if exists "voip_trunk_settings_admin_insert" on public.voip_trunk_settings;
drop policy if exists "voip_trunk_settings_admin_delete" on public.voip_trunk_settings;
drop policy if exists "voip_trunk_settings_admin_write" on public.voip_trunk_settings;

create policy "voip_trunk_settings_admin_insert" on public.voip_trunk_settings
  for insert
  with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  
  )
;
create policy "voip_trunk_settings_admin_write" on public.voip_trunk_settings
  for update
  using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  
  )
  with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  
  )
;
create policy "voip_trunk_settings_admin_delete" on public.voip_trunk_settings
  for delete
  using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  
  )
;

-- public.webhook_sources
drop policy if exists "webhook_sources_select" on public.webhook_sources;
create policy "webhook_sources_select" on public.webhook_sources
  for select
  using (
    (organization_id in (select public.fn_user_org_ids()))
    or (select public.fn_is_platform_admin())
  
  )
;
drop policy if exists "webhook_sources_manager_insert" on public.webhook_sources;
drop policy if exists "webhook_sources_manager_delete" on public.webhook_sources;
drop policy if exists "webhook_sources_manager_write" on public.webhook_sources;

create policy "webhook_sources_manager_insert" on public.webhook_sources
  for insert
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
;
create policy "webhook_sources_manager_write" on public.webhook_sources
  for update
  using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
  with check (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
;
create policy "webhook_sources_manager_delete" on public.webhook_sources
  for delete
  using (
    (select public.fn_is_platform_admin_full())
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  
  )
;



-- chamadas estaveis que o advisor marca (auth.uid / auth.*), mesmo comando

-- public.attendant_availability.attendant_availability_insert
drop policy if exists "attendant_availability_insert" on public.attendant_availability;
create policy "attendant_availability_insert" on public.attendant_availability
  for insert
  with check (
    (select public.fn_is_platform_admin_full())
    or (organization_id in (select public.fn_user_org_ids())
        and (user_id = (select auth.uid())
             or public.fn_role_at_least(organization_id, 'manager')))
  
  )
;

-- public.attendant_availability.attendant_availability_update
drop policy if exists "attendant_availability_update" on public.attendant_availability;
create policy "attendant_availability_update" on public.attendant_availability
  for update
  using (
    (select public.fn_is_platform_admin_full())
    or (organization_id in (select public.fn_user_org_ids())
        and (user_id = (select auth.uid())
             or public.fn_role_at_least(organization_id, 'manager')))
  
  )
  with check (
    (select public.fn_is_platform_admin_full())
    or (organization_id in (select public.fn_user_org_ids())
        and (user_id = (select auth.uid())
             or public.fn_role_at_least(organization_id, 'manager')))
  
  )
;

-- public.attendant_availability.attendant_availability_delete
drop policy if exists "attendant_availability_delete" on public.attendant_availability;
create policy "attendant_availability_delete" on public.attendant_availability
  for delete
  using (
    (select public.fn_is_platform_admin_full())
    or (organization_id in (select public.fn_user_org_ids())
        and (user_id = (select auth.uid())
             or public.fn_role_at_least(organization_id, 'manager')))
  
  )
;

-- public.user_organizations.user_orgs_select
drop policy if exists "user_orgs_select" on public.user_organizations;
create policy "user_orgs_select" on public.user_organizations
  for select
  using (
    (user_id = (select auth.uid()))
    or public.fn_role_at_least(organization_id, 'manager')
    or (select public.fn_is_platform_admin())
  
  )
;

-- public.push_subscriptions.push_subscriptions_own
drop policy if exists "push_subscriptions_own" on public.push_subscriptions;
create policy "push_subscriptions_own" on public.push_subscriptions
  for all
  using (
    organization_id in (select public.fn_user_org_ids())
    and user_id = (select auth.uid())
    and public.fn_role_at_least(organization_id, 'viewer')
  
  )
  with check (
    organization_id in (select public.fn_user_org_ids())
    and user_id = (select auth.uid())
    and public.fn_role_at_least(organization_id, 'viewer')
  
  )
;

-- public.calendar_connection_calendars.calendar_connection_calendars_select
drop policy if exists "calendar_connection_calendars_select" on public.calendar_connection_calendars;
create policy "calendar_connection_calendars_select" on public.calendar_connection_calendars
  for select
  using (
    (select public.fn_is_platform_admin())
    or ((organization_id in (select public.fn_user_org_ids()))
        and exists (
          select 1 from public.calendar_connections c
           where c.id = connection_id
             and (c.user_id = (select auth.uid())
                  or public.fn_role_at_least(c.organization_id, 'manager'))
        ))
  
  )
;

-- public.calendar_connections.calendar_connections_dono_ou_manager_read
drop policy if exists "calendar_connections_dono_ou_manager_read" on public.calendar_connections;
create policy "calendar_connections_dono_ou_manager_read" on public.calendar_connections
  for select
  using (
    (select public.fn_is_platform_admin())
    or ((organization_id in (select public.fn_user_org_ids()))
        and (user_id = (select auth.uid()) or public.fn_role_at_least(organization_id, 'manager')))
  
  )
;

-- public.conversation_notes.conversation_notes_insert
drop policy if exists "conversation_notes_insert" on public.conversation_notes;
create policy "conversation_notes_insert" on public.conversation_notes
  for insert
  with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'agent')
    and created_by_user_id = (select auth.uid())
    and exists (
      select 1 from public.conversations c
      where c.organization_id = conversation_notes.organization_id
        and c.id = conversation_notes.conversation_id
        and public.fn_can_view_conversation(c.organization_id, c.assigned_to_user_id)
    )
  
  )
;

-- public.conversation_notes.conversation_notes_update
drop policy if exists "conversation_notes_update" on public.conversation_notes;
create policy "conversation_notes_update" on public.conversation_notes
  for update
  using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'agent')
    and (created_by_user_id = (select auth.uid()) or public.fn_role_at_least(organization_id, 'manager'))
    and exists (
      select 1 from public.conversations c
      where c.organization_id = conversation_notes.organization_id
        and c.id = conversation_notes.conversation_id
        and public.fn_can_view_conversation(c.organization_id, c.assigned_to_user_id)
    )
  
  )
  with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'agent')
    and (created_by_user_id = (select auth.uid()) or public.fn_role_at_least(organization_id, 'manager'))
    and exists (
      select 1 from public.conversations c
      where c.organization_id = conversation_notes.organization_id
        and c.id = conversation_notes.conversation_id
        and public.fn_can_view_conversation(c.organization_id, c.assigned_to_user_id)
    )
  
  )
;

-- public.conversation_notes.conversation_notes_delete
drop policy if exists "conversation_notes_delete" on public.conversation_notes;
create policy "conversation_notes_delete" on public.conversation_notes
  for delete
  using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'agent')
    and (created_by_user_id = (select auth.uid()) or public.fn_role_at_least(organization_id, 'manager'))
    and exists (
      select 1 from public.conversations c
      where c.organization_id = conversation_notes.organization_id
        and c.id = conversation_notes.conversation_id
        and public.fn_can_view_conversation(c.organization_id, c.assigned_to_user_id)
    )
  
  )
;

-- public.conversation_notes select (as duas permissivas viram uma, OR)
drop policy if exists "conversation_notes_select" on public.conversation_notes;
drop policy if exists "conversation_notes_select_platform_admin" on public.conversation_notes;
create policy "conversation_notes_select" on public.conversation_notes
  for select
  using (
(
    organization_id in (select public.fn_user_org_ids())
    and exists (
      select 1 from public.conversations c
      where c.organization_id = conversation_notes.organization_id
        and c.id = conversation_notes.conversation_id
        and public.fn_can_view_conversation(c.organization_id, c.assigned_to_user_id)
    )
  
  )
  or (
(select public.fn_is_platform_admin())
  )
  );

-- public.account_plans
drop policy if exists "tenant_isolation_account_plans_read" on public.account_plans;
create policy "tenant_isolation_account_plans_read" on public.account_plans
  for select
  using (
(organization_id in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin()))
  );
drop policy if exists "tenant_isolation_account_plans_insert" on public.account_plans;
drop policy if exists "tenant_isolation_account_plans_delete" on public.account_plans;
drop policy if exists "tenant_isolation_account_plans_write" on public.account_plans;
create policy "tenant_isolation_account_plans_insert" on public.account_plans
  for insert
  with check (
(select public.fn_is_platform_admin_full())
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'manager'))
  );
create policy "tenant_isolation_account_plans_write" on public.account_plans
  for update
  using (
(organization_id in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin_full()))
  )
  with check (
(select public.fn_is_platform_admin_full())
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'manager'))
  );
create policy "tenant_isolation_account_plans_delete" on public.account_plans
  for delete
  using (
(organization_id in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin_full()))
  );

-- public.financial_accounts
drop policy if exists "tenant_isolation_financial_accounts_read" on public.financial_accounts;
create policy "tenant_isolation_financial_accounts_read" on public.financial_accounts
  for select
  using (
(organization_id in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin()))
  );
drop policy if exists "tenant_isolation_financial_accounts_insert" on public.financial_accounts;
drop policy if exists "tenant_isolation_financial_accounts_delete" on public.financial_accounts;
drop policy if exists "tenant_isolation_financial_accounts_write" on public.financial_accounts;
create policy "tenant_isolation_financial_accounts_insert" on public.financial_accounts
  for insert
  with check (
(select public.fn_is_platform_admin_full())
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'manager'))
  );
create policy "tenant_isolation_financial_accounts_write" on public.financial_accounts
  for update
  using (
(organization_id in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin_full()))
  )
  with check (
(select public.fn_is_platform_admin_full())
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'manager'))
  );
create policy "tenant_isolation_financial_accounts_delete" on public.financial_accounts
  for delete
  using (
(organization_id in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin_full()))
  );

-- public.payment_methods
drop policy if exists "tenant_isolation_payment_methods_read" on public.payment_methods;
create policy "tenant_isolation_payment_methods_read" on public.payment_methods
  for select
  using (
(organization_id in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin()))
  );
drop policy if exists "tenant_isolation_payment_methods_insert" on public.payment_methods;
drop policy if exists "tenant_isolation_payment_methods_delete" on public.payment_methods;
drop policy if exists "tenant_isolation_payment_methods_write" on public.payment_methods;
create policy "tenant_isolation_payment_methods_insert" on public.payment_methods
  for insert
  with check (
(select public.fn_is_platform_admin_full())
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'manager'))
  );
create policy "tenant_isolation_payment_methods_write" on public.payment_methods
  for update
  using (
(organization_id in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin_full()))
  )
  with check (
(select public.fn_is_platform_admin_full())
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'manager'))
  );
create policy "tenant_isolation_payment_methods_delete" on public.payment_methods
  for delete
  using (
(organization_id in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin_full()))
  );

-- public.financial_entries
drop policy if exists "tenant_isolation_financial_entries_read" on public.financial_entries;
create policy "tenant_isolation_financial_entries_read" on public.financial_entries
  for select
  using (
(organization_id in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin()))
  );
drop policy if exists "tenant_isolation_financial_entries_insert" on public.financial_entries;
drop policy if exists "tenant_isolation_financial_entries_delete" on public.financial_entries;
drop policy if exists "tenant_isolation_financial_entries_write" on public.financial_entries;
create policy "tenant_isolation_financial_entries_insert" on public.financial_entries
  for insert
  with check (
(select public.fn_is_platform_admin_full())
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'agent'))
  );
create policy "tenant_isolation_financial_entries_write" on public.financial_entries
  for update
  using (
(organization_id in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin_full()))
  )
  with check (
(select public.fn_is_platform_admin_full())
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'agent'))
  );
create policy "tenant_isolation_financial_entries_delete" on public.financial_entries
  for delete
  using (
(organization_id in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin_full()))
  );

-- public.lgpd_requests
drop policy if exists "lgpd_requests_admin_select" on public.lgpd_requests;
create policy "lgpd_requests_admin_select" on public.lgpd_requests
  for select
  using (
(select public.fn_is_platform_admin()) or ((organization_id in (select public.fn_user_org_ids())) and public.fn_role_at_least(organization_id, 'admin'))
  );
drop policy if exists "lgpd_requests_admin_insert" on public.lgpd_requests;
drop policy if exists "lgpd_requests_admin_delete" on public.lgpd_requests;
drop policy if exists "lgpd_requests_admin_write" on public.lgpd_requests;
create policy "lgpd_requests_admin_insert" on public.lgpd_requests
  for insert
  with check (
(select public.fn_is_platform_admin_full()) or ((organization_id in (select public.fn_user_org_ids())) and public.fn_role_at_least(organization_id, 'admin'))
  );
create policy "lgpd_requests_admin_write" on public.lgpd_requests
  for update
  using (
(select public.fn_is_platform_admin_full()) or ((organization_id in (select public.fn_user_org_ids())) and public.fn_role_at_least(organization_id, 'admin'))
  )
  with check (
(select public.fn_is_platform_admin_full()) or ((organization_id in (select public.fn_user_org_ids())) and public.fn_role_at_least(organization_id, 'admin'))
  );
create policy "lgpd_requests_admin_delete" on public.lgpd_requests
  for delete
  using (
(select public.fn_is_platform_admin_full()) or ((organization_id in (select public.fn_user_org_ids())) and public.fn_role_at_least(organization_id, 'admin'))
  );

-- public.merge_queue
drop policy if exists "merge_queue_manager_select" on public.merge_queue;
create policy "merge_queue_manager_select" on public.merge_queue
  for select
  using (
(select public.fn_is_platform_admin()) or ((organization_id in (select public.fn_user_org_ids())) and public.fn_role_at_least(organization_id, 'manager'))
  );
drop policy if exists "merge_queue_manager_insert" on public.merge_queue;
drop policy if exists "merge_queue_manager_delete" on public.merge_queue;
drop policy if exists "merge_queue_manager_write" on public.merge_queue;
create policy "merge_queue_manager_insert" on public.merge_queue
  for insert
  with check (
(select public.fn_is_platform_admin_full()) or ((organization_id in (select public.fn_user_org_ids())) and public.fn_role_at_least(organization_id, 'manager'))
  );
create policy "merge_queue_manager_write" on public.merge_queue
  for update
  using (
(select public.fn_is_platform_admin_full()) or ((organization_id in (select public.fn_user_org_ids())) and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
(select public.fn_is_platform_admin_full()) or ((organization_id in (select public.fn_user_org_ids())) and public.fn_role_at_least(organization_id, 'manager'))
  );
create policy "merge_queue_manager_delete" on public.merge_queue
  for delete
  using (
(select public.fn_is_platform_admin_full()) or ((organization_id in (select public.fn_user_org_ids())) and public.fn_role_at_least(organization_id, 'manager'))
  );

-- public.orders
drop policy if exists "orders_tenant_select" on public.orders;
create policy "orders_tenant_select" on public.orders
  for select
  using (
(organization_id in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin()))
  );
drop policy if exists "orders_tenant_insert" on public.orders;
drop policy if exists "orders_tenant_delete" on public.orders;
drop policy if exists "orders_tenant_write" on public.orders;
create policy "orders_tenant_insert" on public.orders
  for insert
  with check (
(organization_id in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin_full()))
  );
create policy "orders_tenant_write" on public.orders
  for update
  using (
(organization_id in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin_full()))
  )
  with check (
(organization_id in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin_full()))
  );
create policy "orders_tenant_delete" on public.orders
  for delete
  using (
(organization_id in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin_full()))
  );

-- public.organizations
drop policy if exists "orgs_select" on public.organizations;
create policy "orgs_select" on public.organizations
  for select
  using (
(id in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin()))
  );
drop policy if exists "orgs_write_platform_admin_insert" on public.organizations;
drop policy if exists "orgs_write_platform_admin_delete" on public.organizations;
drop policy if exists "orgs_write_platform_admin" on public.organizations;
create policy "orgs_write_platform_admin_insert" on public.organizations
  for insert
  with check (
(select public.fn_is_platform_admin_full())
  );
create policy "orgs_write_platform_admin" on public.organizations
  for update
  using (
(select public.fn_is_platform_admin_full())
  )
  with check (
(select public.fn_is_platform_admin_full())
  );
create policy "orgs_write_platform_admin_delete" on public.organizations
  for delete
  using (
(select public.fn_is_platform_admin_full())
  );

-- public.tenant_integrations
drop policy if exists "tenant_integrations_select" on public.tenant_integrations;
create policy "tenant_integrations_select" on public.tenant_integrations
  for select
  using (
(organization_id in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin()))
  );
drop policy if exists "tenant_integrations_admin_insert" on public.tenant_integrations;
drop policy if exists "tenant_integrations_admin_delete" on public.tenant_integrations;
drop policy if exists "tenant_integrations_admin_write" on public.tenant_integrations;
create policy "tenant_integrations_admin_insert" on public.tenant_integrations
  for insert
  with check (
(select public.fn_is_platform_admin_full()) or ((organization_id in (select public.fn_user_org_ids())) and public.fn_role_at_least(organization_id, 'manager'))
  );
create policy "tenant_integrations_admin_write" on public.tenant_integrations
  for update
  using (
(select public.fn_is_platform_admin_full()) or ((organization_id in (select public.fn_user_org_ids())) and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
(select public.fn_is_platform_admin_full()) or ((organization_id in (select public.fn_user_org_ids())) and public.fn_role_at_least(organization_id, 'manager'))
  );
create policy "tenant_integrations_admin_delete" on public.tenant_integrations
  for delete
  using (
(select public.fn_is_platform_admin_full()) or ((organization_id in (select public.fn_user_org_ids())) and public.fn_role_at_least(organization_id, 'manager'))
  );

-- public.skill_pointers (leitura global OU da organização; escrita só da organização)
drop policy if exists "catalog_read_skill_pointers" on public.skill_pointers;
create policy "catalog_read_skill_pointers" on public.skill_pointers
  for select
  using (
    organization_id is null
    or organization_id in (select public.fn_user_org_ids())
  );
drop policy if exists "tenant_isolation_skill_pointers_all" on public.skill_pointers;
drop policy if exists "tenant_isolation_skill_pointers_insert" on public.skill_pointers;
drop policy if exists "tenant_isolation_skill_pointers_delete" on public.skill_pointers;
create policy "tenant_isolation_skill_pointers_insert" on public.skill_pointers
  for insert
  with check (
    organization_id in (select public.fn_user_org_ids())
  );
create policy "tenant_isolation_skill_pointers_all" on public.skill_pointers
  for update
  using (
    organization_id in (select public.fn_user_org_ids())
  )
  with check (
    organization_id in (select public.fn_user_org_ids())
  );
create policy "tenant_isolation_skill_pointers_delete" on public.skill_pointers
  for delete
  using (
    organization_id in (select public.fn_user_org_ids())
  );

-- public.skill_versions (leitura global OU da organização; escrita só da organização)
drop policy if exists "catalog_read_skill_versions" on public.skill_versions;
create policy "catalog_read_skill_versions" on public.skill_versions
  for select
  using (
    organization_id is null
    or organization_id in (select public.fn_user_org_ids())
  );
drop policy if exists "tenant_isolation_skill_versions_all" on public.skill_versions;
drop policy if exists "tenant_isolation_skill_versions_insert" on public.skill_versions;
drop policy if exists "tenant_isolation_skill_versions_delete" on public.skill_versions;
create policy "tenant_isolation_skill_versions_insert" on public.skill_versions
  for insert
  with check (
    organization_id in (select public.fn_user_org_ids())
  );
create policy "tenant_isolation_skill_versions_all" on public.skill_versions
  for update
  using (
    organization_id in (select public.fn_user_org_ids())
  )
  with check (
    organization_id in (select public.fn_user_org_ids())
  );
create policy "tenant_isolation_skill_versions_delete" on public.skill_versions
  for delete
  using (
    organization_id in (select public.fn_user_org_ids())
  );

-- public.organization_extensions (auth.uid solto; a policy continua só para authenticated)
drop policy if exists tenant_isolation_organization_extensions_select on public.organization_extensions;
create policy tenant_isolation_organization_extensions_select on public.organization_extensions
  for select to authenticated using (
    organization_id in (select public.fn_user_org_ids())
    and (
      exists (select 1 from public.user_organizations u where u.organization_id = organization_extensions.organization_id
        and u.user_id = (select auth.uid()) and u.accepted_at is not null and u.revoked_at is null)
      or exists (select 1 from (select public.fn_support_context() s) c
        where c.s->>'status' = 'active' and (c.s->>'organization_id')::uuid = organization_extensions.organization_id)
    )
  );

-- public.user_recovery_codes
drop policy if exists "recovery_codes_self" on public.user_recovery_codes;
create policy "recovery_codes_self" on public.user_recovery_codes
  for all
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));


-- Visibilidade do negócio, uma vez por consulta. O corpo repete a decisão de
-- fn_can_view_lead (papel, modo, dono, admin de plataforma, sessão de suporte)
-- sem chamar a função em cada linha.
create or replace function public.fn_contexto_de_visibilidade_de_lead()
returns table (organization_id uuid, role text, visibility_mode text, user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with ctx as (
    select public.fn_support_context() as s, (select auth.uid()) as uid
  ),
  membros as (
    select uo.organization_id,
           case
             when c.s->>'status' = 'active'
              and (c.s->>'organization_id')::uuid = uo.organization_id
             then case when c.s->>'access_mode' = 'full' then 'admin' else 'viewer' end
             else uo.role
           end as role,
           coalesce(o.settings->>'visibility_mode', 'own_and_unassigned') as visibility_mode,
           c.uid as user_id
    from ctx c
    join public.user_organizations uo on uo.user_id = c.uid and uo.revoked_at is null
    join public.organizations o on o.id = uo.organization_id
  ),
  suporte as (
    select (c.s->>'organization_id')::uuid,
           case when c.s->>'access_mode' = 'full' then 'admin' else 'viewer' end,
           coalesce(o.settings->>'visibility_mode', 'own_and_unassigned'),
           c.uid
    from ctx c
    join public.organizations o on o.id = (c.s->>'organization_id')::uuid
    where c.s->>'status' = 'active'
      and (c.s->>'organization_id') is not null
      and not exists (
        select 1 from membros m
        where m.organization_id = (c.s->>'organization_id')::uuid
      )
  )
  select * from membros
  union all
  select * from suporte;
$$;

revoke all on function public.fn_contexto_de_visibilidade_de_lead() from public, anon;
grant execute on function public.fn_contexto_de_visibilidade_de_lead() to authenticated, service_role;

drop policy if exists "crm_leads_select" on public.crm_leads;
create policy "crm_leads_select" on public.crm_leads
  for select
  using (
    (select public.fn_is_platform_admin())
    or organization_id in (
      select c.organization_id
      from public.fn_contexto_de_visibilidade_de_lead() c
      where c.role in ('viewer', 'manager', 'admin')
         or c.visibility_mode = 'all'
    )
    or (
      organization_id in (
        select c.organization_id
        from public.fn_contexto_de_visibilidade_de_lead() c
        where c.role = 'agent'
          and c.visibility_mode = 'own_and_unassigned'
      )
      and (
        owner_user_id is null
        or owner_user_id = (select c.user_id from public.fn_contexto_de_visibilidade_de_lead() c limit 1)
      )
    )
    or (
      organization_id in (
        select c.organization_id
        from public.fn_contexto_de_visibilidade_de_lead() c
        where c.role = 'agent'
          and c.visibility_mode is distinct from 'all'
          and c.visibility_mode is distinct from 'own_and_unassigned'
      )
      and owner_user_id = (select c.user_id from public.fn_contexto_de_visibilidade_de_lead() c limit 1)
    )
  );
