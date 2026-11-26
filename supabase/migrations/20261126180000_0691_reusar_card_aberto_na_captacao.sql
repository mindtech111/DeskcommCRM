-- manifest: A captação pode reaproveitar o card aberto do contato (opção por fonte: fontes novas nascem ligadas, as que já existiam ficam desligadas) e gravar uma origem configurável no card novo em vez do literal webhook.
--
-- 0691: reaproveitar o card aberto é opção da fonte.
--
-- O bloco abaixo é o MESMO, letra a letra, no apêndice de
-- `supabase/baseline.sql` — é ele que o `update.sh` reaplica.

-- ---- reaproveitar o card aberto na captação (migration 0691) ----
-- Um envio que reencontra a pessoa pelo telefone abria um segundo card
-- mesmo quando ela já tinha um aberto. A opção nasce LIGADA para fonte
-- nova e DESLIGADA para as que já existiam: quem integra hoje e espera um
-- card por envio não muda de comportamento no update.sh.
--
-- `capture_source` é a origem gravada só no cadastro NOVO. NULL continua
-- significando `webhook`. Não reescreve card que já nasceu.

alter table public.webhook_sources
  add column if not exists reuse_open_lead boolean;

alter table public.webhook_sources
  add column if not exists capture_source text;

update public.webhook_sources
   set reuse_open_lead = false
 where reuse_open_lead is null;

alter table public.webhook_sources
  alter column reuse_open_lead set default true;

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
  'Quando true, envio que casa um contato com card aberto reaproveita esse card (etiquetas e utm) em vez de abrir outro. Fonte nova nasce true; fonte que já existia na 0691 fica false.';

comment on column public.webhook_sources.capture_source is
  'Origem gravada em contacts.source e crm_leads.source quando o envio CRIA o cadastro. NULL grava webhook. Não altera a origem de um card já existente.';
