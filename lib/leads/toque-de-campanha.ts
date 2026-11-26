/**
 * O ÚLTIMO toque de uma campanha, sem reescrever o primeiro.
 *
 * Quem já é contato e clica num link rastreável (`[ref:XXXXXX]`) não pode
 * perder a origem original — ela explica por que o relacionamento nasceu.
 * O clique novo entra em `source_metadata.last_touch` e numa lista `touches`,
 * e vira etiqueta no card. O `source` da linha não é deste arquivo.
 */

/** Quantos toques a ficha guarda. O mais novo fica; o mais velho sai. */
export const TETO_DE_TOQUES = 20;

export interface ToqueDeCampanha {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  tracking_link_id: string | null;
  ref: string;
  at: string;
}

const CHAVES_DO_TOQUE = ["utm_source", "utm_medium", "utm_campaign"] as const;

export function montarToque(input: {
  utm: Record<string, string>;
  trackingLinkId: string | null;
  ref: string;
  at: string;
}): ToqueDeCampanha {
  const toque: ToqueDeCampanha = {
    tracking_link_id: input.trackingLinkId,
    ref: input.ref,
    at: input.at,
  };
  for (const chave of CHAVES_DO_TOQUE) {
    const valor = input.utm[chave]?.trim().slice(0, 200);
    if (valor) toque[chave] = valor;
  }
  return toque;
}

/** Etiqueta curta: sem quebra de linha, teto de 60. Vazio não vira tag. */
export function limparEtiqueta(valor: string | undefined | null): string | null {
  if (typeof valor !== "string") return null;
  const limpo = valor.trim().replace(/\s+/g, " ").slice(0, 60);
  if (!limpo) return null;
  return limpo;
}

/**
 * A tag da campanha é o `utm_campaign`. A tag da origem:
 *
 * - `utm_source` revi → `revi/vb`, qualquer que seja o meio (em produção o
 *   meio é `whatsapp`, e a etiqueta ainda é `revi/vb`);
 * - outra origem → o próprio `utm_source`;
 * - sem origem → `rastreio`.
 */
export function etiquetasDoToque(utm: Record<string, string>): string[] {
  const tags: string[] = [];
  const campanha = limparEtiqueta(utm.utm_campaign);
  if (campanha) tags.push(campanha);
  const source = limparEtiqueta(utm.utm_source);
  if (source?.toLowerCase() === "revi") tags.push("revi/vb");
  else if (source) tags.push(source);
  else tags.push("rastreio");
  return [...new Set(tags)];
}

function metadataAtual(valor: unknown): Record<string, unknown> {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return {};
  return { ...(valor as Record<string, unknown>) };
}

/**
 * Acrescenta o toque. O mesmo `ref` não entra duas vezes — o clique já é
 * consumido uma vez no banco, e esta é a segunda trava, para o caso de a
 * ficha já ter o toque e a mensagem chegar de novo.
 *
 * Não mexe nas chaves do primeiro toque (`utm_*` no topo, `ad_platform`).
 */
export function fundirToque(
  metadata: unknown,
  toque: ToqueDeCampanha,
): { metadata: Record<string, unknown>; mudou: boolean } {
  const atual = metadataAtual(metadata);
  const touches = Array.isArray(atual.touches) ? [...atual.touches] : [];
  const jaTem = touches.some(
    (item) => item && typeof item === "object" && (item as { ref?: unknown }).ref === toque.ref,
  );
  if (jaTem) return { metadata: atual, mudou: false };
  const proximos = [...touches, toque].slice(-TETO_DE_TOQUES);
  return {
    metadata: { ...atual, last_touch: toque, touches: proximos },
    mudou: true,
  };
}

/** Une etiquetas sem duplicar e sem apagar as que o card já tinha. */
export function fundirEtiquetas(atuais: unknown, novas: readonly string[]): string[] {
  const base = Array.isArray(atuais)
    ? atuais.filter((tag): tag is string => typeof tag === "string" && tag.trim() !== "")
    : [];
  const vistos = new Set(base);
  const saida = [...base];
  for (const tag of novas) {
    if (!vistos.has(tag)) {
      vistos.add(tag);
      saida.push(tag);
    }
  }
  return saida;
}
