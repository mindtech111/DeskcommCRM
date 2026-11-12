/**
 * 0690 — a leitura não reavalia auth.uid() nem a regra de escrita por linha,
 * e a visibilidade do quadro coincide com fn_can_view_lead.
 *
 * O plano do quadro, com a policy antiga, filtrava `fn_can_view_lead` em cada
 * negócio (medido: 4,8 s em 4.000 linhas). Com a 0690 o plano traz InitPlan e
 * não cita essa função. Sem o `(select …)` ou com a policy antiga de volta, o
 * caso do plano fica vermelho.
 */
import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode esta suíte via `pnpm test:db`");
}
// O estreitamento do `if` não entra na closure no TypeScript 6: `container`
// continua `string | undefined` dentro de `sql`. A anotação confere o tipo aqui.
const containerName: string = container;

function sql(script: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", containerName, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tA", "-f", "-"],
    { input: script, encoding: "utf8" },
  ).trim();
}

const ORG = "e690e690-0690-4000-8000-000000000010";
const ORG_OWN = "e690e690-0690-4000-8000-000000000011";
const MGR = "e690e690-0690-4000-8000-000000000001";
const AGENT = "e690e690-0690-4000-8000-000000000002";
const OTHER = "e690e690-0690-4000-8000-000000000003";
const PLAT = "e690e690-0690-4000-8000-000000000004";
const PIPE = "e690e690-0690-4000-8000-000000000020";
const STAGE = "e690e690-0690-4000-8000-000000000030";
const PIPE_OWN = "e690e690-0690-4000-8000-000000000021";
const STAGE_OWN = "e690e690-0690-4000-8000-000000000031";
const LEAD_MEU = "e690e690-0690-4000-8000-0000000000a1";
const LEAD_FILA = "e690e690-0690-4000-8000-0000000000a2";
const LEAD_ALHEIO = "e690e690-0690-4000-8000-0000000000a3";

function divergencia(userId: string): string {
  return sql(`
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
    select
      (select count(*) from (
         select l.id from public.crm_leads l
         where public.fn_can_view_lead(l.organization_id, l.owner_user_id)
         except
         select l.id from public.crm_leads l
      ) d)::text
      || '|' ||
      (select count(*) from (
         select l.id from public.crm_leads l
         except
         select l.id from public.crm_leads l
         where public.fn_can_view_lead(l.organization_id, l.owner_user_id)
      ) d)::text;
  `).split("\n").pop() ?? "";
}

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${MGR}', 'rls-0690-mgr@invariant.test'),
      ('${AGENT}', 'rls-0690-agent@invariant.test'),
      ('${OTHER}', 'rls-0690-other@invariant.test'),
      ('${PLAT}', 'rls-0690-plat@invariant.test')
    on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name, settings) values
      ('${ORG}', 'rls-0690', 'RLS 0690', 'RLS 0690', '{}'),
      ('${ORG_OWN}', 'rls-0690-own', 'RLS 0690 own', 'RLS 0690 own', '{"visibility_mode":"own"}')
    on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${MGR}', '${ORG}', 'manager', now()),
      ('${AGENT}', '${ORG}', 'agent', now()),
      ('${AGENT}', '${ORG_OWN}', 'agent', now()),
      ('${OTHER}', '${ORG_OWN}', 'agent', now())
    on conflict do nothing;
    insert into public.platform_admins (user_id, granted_by, scope, mfa_required, reason)
      values ('${PLAT}', '${PLAT}', 'full', false, 'sonda 0690')
    on conflict (user_id) do update set revoked_at = null, scope = 'full';
    insert into public.crm_pipelines (id, organization_id, name, slug) values
      ('${PIPE}', '${ORG}', 'Funil', 'funil-0690'),
      ('${PIPE_OWN}', '${ORG_OWN}', 'Funil own', 'funil-0690-own')
    on conflict do nothing;
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position) values
      ('${STAGE}', '${ORG}', '${PIPE}', 'Novo', 'novo', 1000),
      ('${STAGE_OWN}', '${ORG_OWN}', '${PIPE_OWN}', 'Novo', 'novo', 1000)
    on conflict do nothing;
    insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, owner_user_id, position_in_stage) values
      ('${LEAD_MEU}', '${ORG_OWN}', '${PIPE_OWN}', '${STAGE_OWN}', 'meu', '${AGENT}', 1),
      ('${LEAD_FILA}', '${ORG_OWN}', '${PIPE_OWN}', '${STAGE_OWN}', 'fila', null, 2),
      ('${LEAD_ALHEIO}', '${ORG_OWN}', '${PIPE_OWN}', '${STAGE_OWN}', 'alheio', '${OTHER}', 3)
    on conflict do nothing;
    insert into public.crm_leads (organization_id, pipeline_id, stage_id, title, position_in_stage, status)
    select '${ORG}', '${PIPE}', '${STAGE}', 'Negocio '||g, g, 'open'
    from generate_series(1, 200) g
    where not exists (
      select 1 from public.crm_leads l
      where l.organization_id = '${ORG}' and l.title = 'Negocio '||g
    );
    insert into public.contacts (id, organization_id, display_name)
      values ('e690e690-0690-4000-8000-0000000000c1', '${ORG}', 'Contato 0690')
    on conflict do nothing;
  `);
});

describe("0690 — advisors de RLS", () => {
  it("nenhuma policy de public reavalia auth.uid() por linha", () => {
    const n = sql(`
      select count(*) from pg_policies
       where schemaname = 'public'
         and (
           (coalesce(qual,'') like '%auth.uid()%' and lower(coalesce(qual,'')) not like '%select auth.uid()%')
           or (coalesce(with_check,'') like '%auth.uid()%' and lower(coalesce(with_check,'')) not like '%select auth.uid()%')
           or (coalesce(qual,'') like '%auth.jwt()%' and lower(coalesce(qual,'')) not like '%select auth.jwt()%')
           or (coalesce(with_check,'') like '%auth.jwt()%' and lower(coalesce(with_check,'')) not like '%select auth.jwt()%')
         );
    `);
    expect(n).toBe("0");
  });

  it("não há duas policies permissivas no mesmo comando para o mesmo papel", () => {
    const n = sql(`
      select count(*) from (
        select c.relname, r.rolname, act.cmd
        from pg_policy p
        join pg_class c on p.polrelid = c.oid
        join pg_namespace n on c.relnamespace = n.oid
        join pg_roles r on p.polroles @> array[r.oid] or p.polroles = array[0::oid]
        , lateral (
          select x.cmd from unnest((
            select case p.polcmd
              when 'r' then array['SELECT']
              when 'a' then array['INSERT']
              when 'w' then array['UPDATE']
              when 'd' then array['DELETE']
              when '*' then array['SELECT','INSERT','UPDATE','DELETE']
              else array['ERROR'] end
          )) x(cmd)
        ) act(cmd)
        where c.relkind = 'r' and p.polpermissive and n.nspname = 'public'
          and r.rolname not like 'pg_%' and not r.rolbypassrls
        group by 1, 2, 3
        having count(*) > 1
      ) s;
    `);
    expect(n).toBe("0");
  });
});

describe("0690 — o quadro vê o mesmo que fn_can_view_lead", () => {
  it("manager, agent e admin de plataforma não ganham nem perdem negócio", () => {
    expect(divergencia(MGR)).toBe("0|0");
    expect(divergencia(AGENT)).toBe("0|0");
    expect(divergencia(PLAT)).toBe("0|0");
  });

  it("o plano da leitura do funil não chama fn_can_view_lead por linha", () => {
    const plano = sql(`
      reset role;
      analyze public.crm_leads;
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${MGR}"}', false);
      explain (costs off)
      select id from public.crm_leads
       where pipeline_id = '${PIPE}'
         and status <> 'archived'
       order by position_in_stage;
    `);
    expect(plano).toContain("InitPlan");
    expect(plano).toContain("hashed SubPlan");
    expect(plano).not.toContain("fn_can_view_lead");
  });
});

describe("0690 — separar a escrita do SELECT não muda quem grava", () => {
  it("agent da organização lê o contato e não reescreve o funil", () => {
    const leitor = sql(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${AGENT}"}', false);
      select count(*) from public.contacts where id = 'e690e690-0690-4000-8000-0000000000c1';
    `).split("\n").pop();
    expect(leitor).toBe("1");

    const fora = sql(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${OTHER}"}', false);
      select count(*) from public.contacts where id = 'e690e690-0690-4000-8000-0000000000c1';
    `).split("\n").pop();
    expect(fora).toBe("0");

    const recusa = sql(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${AGENT}"}', false);
      with w as (
        update public.crm_pipelines set name = 'nao' where id = '${PIPE}' returning 1
      ) select count(*) from w;
    `);
    expect(recusa.split("\n").pop()).toBe("0");
  });

  it("manager atualiza o funil da própria organização", () => {
    const n = sql(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${MGR}"}', false);
      with w as (
        update public.crm_pipelines set name = 'Funil' where id = '${PIPE}' returning 1
      ) select count(*) from w;
    `);
    expect(n.split("\n").pop()).toBe("1");
  });
});
