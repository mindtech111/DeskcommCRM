"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useT } from "@/hooks/i18n/useT";
import { formatarDuracao } from "@/lib/metrics/canais";
import type { PessoaDaEquipe } from "@/lib/metrics/painel-comercial";
import { formatValorDoNegocio } from "@/lib/money";

interface SemResponsavel {
  leads_recebidos: number;
  agendamentos: number;
  consultas_realizadas: number;
  vendas: number;
  valor_por_moeda: Array<{ moeda: string | null; quantidade: number; valor_cents: number }>;
}

function rotuloDoPapel(papel: string | null, t: (texto: string) => string): string {
  switch (papel) {
    case "agent":
      return t("Papel de vendas");
    case "manager":
      return t("Papel de gerência");
    case "admin":
      return t("Papel de administração");
    case "viewer":
      return t("Papel de leitura");
    default:
      return t("Fora da equipe");
  }
}

function rotuloDaPessoa(nome: string | null, userId: string, t: (texto: string) => string): string {
  const limpo = nome?.trim();
  if (limpo) return limpo;
  return `${t("Sem nome")} ${userId.slice(0, 8)}`;
}

function textoDoValor(
  linhas: Array<{ moeda: string | null; valor_cents: number }>,
  t: (texto: string) => string,
): string {
  if (linhas.length === 0) return "—";
  return linhas
    .map((linha) =>
      linha.moeda && /^[A-Z]{3}$/.test(linha.moeda)
        ? formatValorDoNegocio(linha.valor_cents, linha.moeda)
        : t("Sem moeda"),
    )
    .join(" · ");
}

function BarrasDoDia({ dias }: { dias: Array<{ dia: string; total: number }> }) {
  const t = useT();
  const topo = Math.max(1, ...dias.map((d) => d.total));
  if (dias.length === 0) return null;
  return (
    <div className="flex h-10 items-end gap-px" aria-hidden="true">
      {dias.map((dia) => (
        <div
          key={dia.dia}
          title={`${dia.dia}: ${dia.total}`}
          className="min-w-0 flex-1 rounded-sm bg-accent/80"
          style={{ height: `${Math.max(8, Math.round((dia.total / topo) * 100))}%` }}
        />
      ))}
      <span className="sr-only">{t("Leads recebidos por dia")}</span>
    </div>
  );
}

export function EquipeDoPeriodo({
  equipe,
}: {
  equipe: {
    truncada: boolean;
    pessoas: PessoaDaEquipe[];
    sem_responsavel: SemResponsavel;
  };
}) {
  const t = useT();
  const sem = equipe.sem_responsavel;
  const temSemResponsavel =
    sem.leads_recebidos > 0 ||
    sem.agendamentos > 0 ||
    sem.consultas_realizadas > 0 ||
    sem.vendas > 0;

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle>{t("Quem vende")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {t(
            "Entram pessoas com papel de vendas e quem recebeu lead, respondeu ou vendeu no período.",
          )}
        </p>
        {equipe.pessoas.length === 0 && !temSemResponsavel ? (
          <p className="text-sm text-muted-foreground">
            {t("Ninguém com papel de vendas, e nenhum lead atribuído neste período.")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Pessoa")}</TableHead>
                  <TableHead className="text-right">{t("Leads recebidos")}</TableHead>
                  <TableHead className="text-right">{t("Mensagens enviadas")}</TableHead>
                  <TableHead className="text-right">{t("Primeira resposta humana")}</TableHead>
                  <TableHead className="text-right">{t("Agendamentos")}</TableHead>
                  <TableHead className="text-right">{t("Consultas realizadas")}</TableHead>
                  <TableHead className="text-right">{t("Vendas")}</TableHead>
                  <TableHead className="text-right">{t("Valor ganho")}</TableHead>
                  <TableHead className="text-right">{t("Conversão")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {equipe.pessoas.map((pessoa) => (
                  <TableRow key={pessoa.user_id}>
                    <TableCell>
                      <div className="flex min-w-40 flex-col gap-1">
                        <span>{rotuloDaPessoa(pessoa.nome, pessoa.user_id, t)}</span>
                        <span className="text-xs text-muted-foreground">
                          {rotuloDoPapel(pessoa.papel, t)}
                        </span>
                        <BarrasDoDia dias={pessoa.por_dia} />
                        <span className="sr-only">
                          {pessoa.por_dia.map((d) => `${d.dia} ${d.total}`).join(", ")}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {pessoa.leads_recebidos}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {pessoa.mensagens_enviadas}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatarDuracao(pessoa.p50_segundos)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{pessoa.agendamentos}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {pessoa.consultas_realizadas}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{pessoa.vendas}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {textoDoValor(pessoa.valor_por_moeda, t)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {pessoa.conversao == null ? "—" : `${Math.round(pessoa.conversao * 100)}%`}
                    </TableCell>
                  </TableRow>
                ))}
                {temSemResponsavel ? (
                  <TableRow>
                    <TableCell>{t("Sem responsável")}</TableCell>
                    <TableCell className="text-right tabular-nums">{sem.leads_recebidos}</TableCell>
                    <TableCell className="text-right">—</TableCell>
                    <TableCell className="text-right">—</TableCell>
                    <TableCell className="text-right tabular-nums">{sem.agendamentos}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {sem.consultas_realizadas}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{sem.vendas}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {textoDoValor(sem.valor_por_moeda, t)}
                    </TableCell>
                    <TableCell className="text-right">—</TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        )}
        {equipe.truncada ? (
          <p className="text-xs text-muted-foreground">
            {t("Mostrando as 40 pessoas com mais leads recebidos.")}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {t(
            "A mediana é das conversas que começaram neste período e cuja primeira resposta humana foi desta pessoa. Uma resposta de hoje a uma mensagem de ontem não entra. O card de cima usa o mesmo recorte de conversa nova e inclui também a saída automática.",
          )}
        </p>
      </CardContent>
    </Card>
  );
}
