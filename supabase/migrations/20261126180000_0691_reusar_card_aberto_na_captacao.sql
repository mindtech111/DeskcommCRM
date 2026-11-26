-- manifest: A captação pode reaproveitar o card aberto do contato (opção por fonte: fontes novas nascem ligadas, as que já existiam ficam desligadas) e gravar uma origem configurável no card novo em vez do literal webhook.
--
-- 0691: reaproveitar o card aberto é opção da fonte.
--
-- O bloco abaixo é o MESMO, letra a letra, no apêndice de
-- `supabase/baseline.sql` — é ele que o `update.sh` reaplica.

-- ---- reaproveitar o card aberto na captação (migration 0691) ----
-- Um envio que reencontra a pessoa pelo telefone abria um segundo card
-- mesmo quando ela já tinha um aberto. A opção fica DESLIGADA no banco:
-- fonte que já existia, e INSERT que não conhece a coluna, continuam
-- abrindo um card por envio. Quem cria a fonte pela tela liga explicitamente.
-- Default true aqui ligava o reuso em todo fixture de teste e o segundo
-- envio do mesmo telefone deixava de criar o card que o teste media.
--
-- `capture_source` é só um nome anotado no metadata do card NOVO. A coluna
-- `crm_leads.source` continua `webhook`: o consentimento da IA e o índice
-- do envio repetido exigem esse valor. NULL não anota nome extra.

alter table public.webhook_sources
  add column if not exists reuse_open_lead boolean;

alter table public.webhook_sources
  add column if not exists capture_source text;

update public.webhook_sources
   set reuse_open_lead = false
 where reuse_open_lead is null;

alter table public.webhook_sources
  alter column reuse_open_lead set default false;

alter table public.webhook_sources
  alter column reuse_open_lead set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'webhook_sources_capture_source_check'
       and conrelid = 'public.webhook_sources'::regclass
  ) then
    alter table public.webhook_sources
      add constraint webhook_sources_capture_source_check
      check (capture_source is null or capture_source ~ '^[a-z][a-z0-9_]{0,31}$');
  end if;
end $$;

comment on column public.webhook_sources.reuse_open_lead is
  'Quando true, envio que casa um contato com card aberto reaproveita esse card (etiquetas e utm) em vez de abrir outro. Default false: INSERT que não conhece a coluna mantém um card por envio. A tela de criação liga explicitamente.';

comment on column public.webhook_sources.capture_source is
  'Nome anotado em source_metadata.capture_source do card NOVO. Não substitui crm_leads.source, que continua webhook. NULL não anota nome extra.';
