/**
 * Aviso interno por WhatsApp — o texto que a EQUIPE recebe, nunca o cliente.
 *
 * O modelo só aceita quatro marcações: primeiro nome, origem, assunto e o
 * link do card. Qualquer outra (`{{lead.custom_fields…}}`, resposta de
 * formulário, campo de saúde) recusa o envio inteiro. Não há caminho que
 * preencha o texto com o que o lead escreveu no Score.
 *
 * A origem é o NOME da fonte ou a tag `origem:*`. O assunto é o título do
 * card. Nenhum dos dois lê `custom_fields`.
 */
import { nomeDoContato, type ContatoNomeavel } from "@/lib/contacts/rotulo-do-contato";
import { urlPublicaUsavel } from "@/lib/escalacao/url-publica";
import { normalizePhoneBR } from "@/lib/channels/phone-variants";

export const VARIAVEIS_DO_AVISO_INTERNO = ["primeiro_nome", "origem", "assunto", "link"] as const;
export type VariavelDoAvisoInterno = (typeof VARIAVEIS_DO_AVISO_INTERNO)[number];

const PERMITIDAS = new Set<string>(VARIAVEIS_DO_AVISO_INTERNO);

/**
 * Toda marcação `{{...}}`, não só nome com letra e ponto.
 *
 * `{{first-name}}` tem hífen: o recorte antigo nem via a marcação, o modelo
 * passava na validação e o texto saía com o colchete cru. Aqui qualquer
 * conteúdo que não seja uma das quatro marcações recusa o modelo inteiro.
 */
export function variaveisCitadas(modelo: string): string[] {
  return [...modelo.matchAll(/\{\{([^{}]*)\}\}/g)].map((m) => (m[1] ?? "").trim());
}

export function modeloDeAvisoInternoValido(modelo: string): boolean {
  const citadas = variaveisCitadas(modelo);
  return citadas.every((nome) => PERMITIDAS.has(nome));
}

export interface DadosDoAvisoInterno {
  primeiro_nome: string;
  origem: string;
  assunto: string;
  link: string;
}

/**
 * Monta SÓ o que pode ir no WhatsApp da equipe.
 *
 * `origemNome` é o nome da fonte (coluna `webhook_sources.name`), resolvido
 * pelo chamador. A tag `origem:*` cobre o caso em que a fonte não tem nome.
 * Título longo é cortado: o aviso é um recado, não o formulário.
 */
export function dadosDoAvisoInterno(entrada: {
  contact: ContatoNomeavel | null | undefined;
  lead: { id?: string; title?: string | null; tags?: unknown } | null | undefined;
  origemNome: string | null;
  urlPublica: string;
}): DadosDoAvisoInterno {
  const nome = nomeDoContato(entrada.contact ?? undefined) ?? "";
  const primeiro = nome.trim().split(/\s+/)[0] ?? "";
  const tags = Array.isArray(entrada.lead?.tags) ? entrada.lead.tags.map(String) : [];
  const tagDeOrigem = tags.find((tag) => tag.toLowerCase().startsWith("origem:")) ?? "";
  const origem = (entrada.origemNome ?? "").trim() || tagDeOrigem;
  const assunto = (entrada.lead?.title ?? "").trim().slice(0, 120);
  const id = entrada.lead?.id;
  const base = entrada.urlPublica.replace(/\/+$/, "");
  const link = id && urlPublicaUsavel(entrada.urlPublica) ? `${base}/app/leads/${id}` : "";
  return { primeiro_nome: primeiro, origem, assunto, link };
}

/** Preenche o modelo. Recusa (devolve `null`) se houver marcação fora da lista. */
export function renderAvisoInterno(modelo: string, dados: DadosDoAvisoInterno): string | null {
  if (!modeloDeAvisoInternoValido(modelo)) return null;
  return modelo.replace(/\{\{([^{}]*)\}\}/g, (_m, nome: string) => {
    const chave = nome.trim();
    if (!PERMITIDAS.has(chave)) return "";
    return dados[chave as VariavelDoAvisoInterno];
  });
}

export function telefoneDeAvisoInterno(bruto: unknown): string | null {
  return normalizePhoneBR(bruto);
}
