/**
 * GET /api/v1/conversations/counts — contagens por visão do inbox (G4-02).
 *
 * Usa o client user-scoped (cookie session) → a leitura HERDA a RLS de
 * SELECT de `conversations` (fn_can_view_conversation, migration 0035). Um agent
 * em modo own* recebe a contagem do SEU escopo, NUNCA o total da org — a mesma
 * garantia do listing.
 *
 * Uma consulta só, não seis `count=exact`. Cada HEAD exato reavalia a RLS na
 * tabela inteira (1–4 s em produção, e alguns batiam no `statement_timeout`
 * de 8 s). Agregação condicional no PostgREST exige `db-aggregates-enabled`,
 * que este repositório não liga, e uma função no banco seria migration —
 * fora deste conserto. `count=estimated` faria o badge divergir da lista, e
 * este arquivo existe para os dois dizerem o mesmo número. A saída é um
 * SELECT das colunas que separam as abas, paginado por `id` até a página
 * vazia (o `max_rows` do PostgREST corta em 1000), e a soma acontece aqui.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { idsDosCanaisDesativados } from "@/lib/channels/desativado";
import { loadAuthUser } from "@/lib/auth/server";
import { orgAtivaDaApi } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { CONVERSATION_TERMINAL_STATUSES } from "@/lib/schemas";
import { orgTemAutomatico } from "@/lib/ai/agents/org-tem-automatico";
import { comandosDaFila } from "@/lib/inbox/comando-da-conversa";
import { aplicarMarcadores, modoDeEtiqueta } from "@/lib/inbox/marcador-da-conversa";
import { createClient } from "@/lib/supabase/server";
import { idsDeContatosPessoais } from "../_handler";

export const dynamic = "force-dynamic";

/** Um par pronto para virar predicado: coluna e valor. */
export type FiltroDeContagem = readonly [coluna: string, valor: string | boolean];

/**
 * Os filtros AUXILIARES que a lista aplicou e que a contagem tem de aplicar junto.
 *
 * ─── O defeito ─────────────────────────────────────────────────────────────
 * Medido na tela: com "Não lidos" ligado, a lista mostrava ZERO linhas e a aba
 * continuava estampando "Todas 2". Este próprio arquivo já declarava a regra —
 * "um badge que conta o que a aba não mostra manda o atendente procurar trabalho
 * que não existe" — e a regra estava certa: a COBERTURA parou no predicado da
 * aba e nunca alcançou os filtros ao lado dela.
 *
 * ─── Por que uma lista só, e não um `if` por contagem ──────────────────────
 * Uma lista aplicada a TODAS as contagens torna a divergência impossível por
 * construção: não existe o caminho "esqueci de pôr o filtro na contagem X".
 * `tests/unit/badge-espelha-o-filtro.test.ts` vigia que nenhuma contagem seja
 * montada por fora.
 *
 * A busca (`search`) NÃO entra: ela casa contato por uma consulta auxiliar em
 * `contacts`, e repetir aquela lógica aqui criaria uma SEGUNDA régua de busca —
 * e a segunda régua sempre diverge. Enquanto isso, o badge sob busca fica maior
 * que a lista, e isso está declarado, não esquecido.
 */
export function filtrosAuxiliaresDaContagem(sp: URLSearchParams): FiltroDeContagem[] {
  const filtros: FiltroDeContagem[] = [];
  const canal = sp.get("channel_session_id");
  if (canal) filtros.push(["channel_session_id", canal]);
  // O atendente escolhido pelo gerente. Só id de usuário (uuid) entra: qualquer
  // outra coisa seria ignorada em silêncio e a contagem divergiria da lista.
  const atendente = sp.get("assigned_to");
  if (
    atendente &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(atendente)
  ) {
    filtros.push(["assigned_to_user_id", atendente]);
  }
  // O MARCADOR não entra nesta lista, e não é esquecimento: ele não é
  // IGUALDADE numa coluna, é um `or=` sobre DUAS caixas — `conversations.tags`
  // e o campo calculado do contato. `conversations` não tem coluna `tag` (`tag`
  // é o nome do parâmetro da URL): com ele aqui, o laço lá embaixo pedia
  // `.eq("tag", …)`, o PostgREST devolvia 42703 (`undefined_column`) e a rota
  // INTEIRA respondia 500 — com um marcador filtrado, toda aba do Inbox ficava
  // sem número, a "Fechadas" inclusive (#1223). Quem aplica o marcador é
  // `aplicarMarcador`, a mesma régua que a lista usa.
  return filtros;
}

/** Verdadeiro quando a contagem deve pedir só as não lidas. */
export function contagemSoNaoLidas(sp: URLSearchParams): boolean {
  return sp.get("unread") === "true";
}

/** O que uma linha precisa para cair na aba certa. Nada além. */
export interface LinhaDeContagem {
  id: string;
  status: string;
  comando_da_conversa: string | null;
  assigned_to_user_id: string | null;
}

export interface ContagensDaBarra {
  fila: number;
  automatico: number;
  unassigned: number;
  mine: number;
  all: number;
  closed: number;
  archived: number;
}

/**
 * As seis abas a partir das linhas que já passaram pelos filtros comuns.
 *
 * O atendente escolhido pelo gerente NÃO entra no WHERE: a aba Minhas ignora
 * essa escolha (a lista pede `assigned_to=me`). Aplicá-lo na consulta tiraria
 * as conversas de quem está logado e o badge de Minhas iria a zero.
 */
export function contagensDoRecorte(
  linhas: readonly LinhaDeContagem[],
  opts: {
    userId: string;
    comandosFila: readonly string[];
    atendenteEscolhido: string | null;
  },
): ContagensDaBarra {
  const terminais = new Set<string>(CONVERSATION_TERMINAL_STATUSES);
  // O banco compara uuid sem caixa. A lista pede `.eq` e aceita o id como
  // veio na URL. Aqui a comparação é em memória, e o PostgREST devolve o
  // uuid em minúsculas: sem normalizar, um id em maiúsculas zera as abas
  // filtradas e a lista continua mostrando as conversas.
  const escolhido = opts.atendenteEscolhido?.toLowerCase() ?? null;
  const eu = opts.userId.toLowerCase();
  let fila = 0;
  let automatico = 0;
  let mine = 0;
  let all = 0;
  let closed = 0;
  let archived = 0;
  for (const linha of linhas) {
    const dono = linha.assigned_to_user_id?.toLowerCase() ?? null;
    const noRecorte = escolhido === null || dono === escolhido;
    if (noRecorte) {
      all += 1;
      if (
        linha.comando_da_conversa !== null &&
        opts.comandosFila.includes(linha.comando_da_conversa)
      ) {
        fila += 1;
      }
      if (linha.comando_da_conversa === "automatico") automatico += 1;
      if (linha.status === "closed") closed += 1;
      if (linha.status === "archived") archived += 1;
    }
    if (dono === eu && !terminais.has(linha.status)) mine += 1;
  }
  return { fila, automatico, unassigned: fila, mine, all, closed, archived };
}

/** Página da leitura. Igual ao `max_rows` do `supabase/config.toml`. */
const PAGINA_DA_CONTAGEM = 1000;

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supabase = await createClient();

  // Sem getUser() aqui: loadAuthUser já identificou (getClaims).
  const authUser = await loadAuthUser();
  if (!authUser) {
    return fail("unauthenticated", "Auth required.", 401, { requestId });
  }
  const ativa = await orgAtivaDaApi(authUser, requestId);
  if (!ativa.ok) return ativa.response;
  const activeOrg = ativa.org;
  if (!activeOrg) {
    return fail(
      "no_active_org",
      traduzir("No active organization.", authUser?.idioma ?? "pt-BR"),
      403,
      { requestId },
    );
  }

  const org = activeOrg.orgId;
  const sp = req.nextUrl.searchParams;
  const auxiliares = filtrosAuxiliaresDaContagem(sp);
  const soNaoLidas = contagemSoNaoLidas(sp);
  // ⚠️ O badge conta o MESMO que a lista mostra, então o marcador é lido com
  // `getAll` e o `modo` viaja junto (#1274). Ler com `get` aqui deixaria o badge
  // de um filtro de duas etiquetas contando uma só — e a aba diria "Fila 3"
  // listando duas: exatamente a divergência que este arquivo existe para
  // impedir, agora pelo caminho do marcador em vez do de canal.
  const marcadores = sp.getAll("tag");
  const modo = modoDeEtiqueta(sp.get("modo")) ?? "e";

  // ⚠️ TODA contagem nasce daqui, e daqui já sai com `organization_id` E com os
  // filtros auxiliares. Herdar tira a opção de esquecer: não existe o caminho
  // "montei uma contagem e não pus o filtro".
  //
  // Pessoal não soma em nenhuma aba (spec 21, etapa 7 — critério 3): ao marcar,
  // a contagem cai exatamente nas não-lidas daquele contato. A MESMA exclusão
  // da lista, pela mesma primitiva — sem ela o badge diria o que a aba esconde.
  const pessoais = await idsDeContatosPessoais(supabase, org);
  // Canal desativado nunca entra na inbox: o mesmo corte da lista, para badge
  // e aba nunca divergirem.
  const idsDesativados = await idsDosCanaisDesativados(supabase, org);
  // Minhas ignora o atendente escolhido. Os outros filtros valem para todas
  // as abas e ficam no WHERE — inclusive Minhas.
  const atendenteEscolhido =
    auxiliares.find(([coluna]) => coluna === "assigned_to_user_id")?.[1] ?? null;
  const filtrosComuns = auxiliares.filter(([coluna]) => coluna !== "assigned_to_user_id");
  const consultaDasContagens = () => {
    let q = supabase
      .from("conversations")
      .select("id, status, comando_da_conversa, assigned_to_user_id")
      .eq("organization_id", org);
    if (idsDesativados.length > 0) {
      q = q.not("channel_session_id", "in", `(${idsDesativados.join(",")})`);
    }
    for (const [coluna, valor] of filtrosComuns) q = q.eq(coluna, valor);
    // O marcador entra pela régua da LISTA — a mesma função, não uma segunda.
    q = aplicarMarcadores(q, marcadores, modo);
    if (pessoais.length > 0) q = q.not("contact_id", "in", `(${pessoais.join(",")})`);
    if (soNaoLidas) q = q.gt("unread_count_for_assignee", 0);
    return q;
  };

  // O fato ORG-WIDE resolvido ANTES da leitura, porque ele escolhe QUAL
  // conjunto de comandos a Fila pede. `undefined` (não deu para saber) segue a
  // convenção da regra: assume que há automático.
  //
  // A FILA DEIXOU DE SER "sem dono + status de espera". Aquele par contava
  // como trabalho humano pendente tudo que o robô estava atendendo. Agora a
  // soma usa `comandosDaFila`, o mesmo predicado da aba.
  //
  // Fechadas e Arquivadas são status diferentes (#923): somar os dois no
  // mesmo número fazia o badge dizer 120 e a lista mostrar 40.
  // `unassigned` continua respondendo, com o MESMO valor de `fila`.
  const automaticoDaOrg = await orgTemAutomatico(supabase, org);

  const porId = new Map<string, LinhaDeContagem>();
  let cursor: string | undefined;
  for (;;) {
    let q = consultaDasContagens().order("id", { ascending: true }).limit(PAGINA_DA_CONTAGEM);
    if (cursor) q = q.gt("id", cursor);
    const pagina = await q;
    if (pagina.error) {
      return fail("internal_error", pagina.error.message, 500, { requestId });
    }
    const linhas = pagina.data ?? [];
    if (linhas.length === 0) break;
    const ultimo = linhas[linhas.length - 1]?.id;
    if (!ultimo || (cursor !== undefined && ultimo <= cursor)) {
      return fail("internal_error", "Falha ao contar as conversas.", 500, { requestId });
    }
    for (const linha of linhas) porId.set(linha.id, linha);
    cursor = ultimo;
  }

  const contagens = contagensDoRecorte([...porId.values()], {
    userId: authUser.id,
    comandosFila: comandosDaFila(automaticoDaOrg),
    atendenteEscolhido: typeof atendenteEscolhido === "string" ? atendenteEscolhido : null,
  });

  return ok(
    {
      fila: contagens.fila,
      automatico: contagens.automatico,
      unassigned: contagens.unassigned,
      mine: contagens.mine,
      all: contagens.all,
      closed: contagens.closed,
      archived: contagens.archived,
    },
    { requestId },
  );
}
