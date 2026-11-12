/**
 * Recuo do cliente admin (`X-Client-Info: deskcomm-crm/admin`).
 *
 * O worker, o relógio e os crons falam com o PostgREST por este fetch. Com o
 * banco fora do ar cada consulta volta 5xx ou estoura o tempo na hora, e o
 * laço seguinte dispara outra sem esperar: a indisponibilidade vira uma
 * tempestade que impede o banco de voltar.
 *
 * O que este módulo faz, e o que ele recusa:
 *
 *   - 429, 408, 5xx e falha de rede/timeout em LEITURA (GET/HEAD) tentam de
 *     novo, com espera exponencial e jitter, até um teto de tentativas.
 *   - Escrita (POST/PATCH/DELETE) NÃO repete 5xx nem timeout: o servidor pode
 *     ter aplicado o efeito e perdido a resposta. Repetir criaria linha. 429
 *     e 408 repetem, porque o pedido foi recusado antes do efeito.
 *   - Depois de esgotar, o processo inteiro PAUSA. A próxima consulta do
 *     admin espera essa pausa, então um laço que "tenta de novo já" não
 *     martela. Uma resposta ok zera a pausa.
 */

export const TENTATIVAS_DO_ADMIN = 3;
const BASE_MS = 300;
const TETO_DA_TENTATIVA_MS = 8_000;
const TETO_DA_PAUSA_MS = 30_000;

export interface OpcoesDoRecuo {
  /** Total de idas à rede, incluindo a primeira. */
  tentativas?: number;
  dormir?: (ms: number, signal?: AbortSignal) => Promise<void>;
  agora?: () => number;
  /** 0..1. Injetável para o teste não depender do relógio aleatório. */
  aleatorio?: () => number;
}

let pausaAte = 0;
let falhasSeguidas = 0;

/** Só para teste: o processo volta ao estado de quem nunca falhou. */
export function reiniciarRecuoDoAdmin(): void {
  pausaAte = 0;
  falhasSeguidas = 0;
}

/** Quanto o processo ainda vai esperar antes da próxima consulta admin. */
export function pausaDoAdminMs(agora = Date.now()): number {
  return Math.max(0, pausaAte - agora);
}

function dormirDeVerdade(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", aoAbortar);
      resolve();
    }, ms);
    const aoAbortar = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    };
    signal?.addEventListener("abort", aoAbortar, { once: true });
  });
}

function metodoDe(input: RequestInfo | URL, init?: RequestInit): string {
  const declarado = init?.method?.toUpperCase();
  if (declarado) return declarado;
  if (typeof Request !== "undefined" && input instanceof Request) return input.method.toUpperCase();
  return "GET";
}

function ehLeitura(metodo: string): boolean {
  return metodo === "GET" || metodo === "HEAD";
}

export function ehFalhaDeTransporte(erro: unknown): boolean {
  // `DOMException` no jsdom do teste nem sempre passa em `instanceof Error`,
  // e o nome é o que o restante do repo já usa para timeout de fetch.
  if (!erro || typeof erro !== "object") return false;
  const nome = "name" in erro ? String((erro as { name: unknown }).name) : "";
  if (nome === "AbortError") return false;
  if (nome === "TimeoutError") return true;
  if (!(erro instanceof Error)) return false;
  const texto = erro.message.toLowerCase();
  return (
    texto.includes("fetch failed") ||
    texto.includes("network") ||
    texto.includes("timeout") ||
    texto.includes("econnreset") ||
    texto.includes("econnrefused") ||
    texto.includes("und_err") ||
    texto.includes("headers overflow") ||
    texto.includes("socket")
  );
}

function statusRecuavel(status: number, metodo: string): boolean {
  if (status === 429 || status === 408) return true;
  return ehLeitura(metodo) && status >= 500;
}

function esperaMs(tentativa: number, aleatorio: () => number, retryAfterMs: number | null): number {
  if (retryAfterMs !== null && retryAfterMs > 0) {
    return Math.min(retryAfterMs, TETO_DA_PAUSA_MS);
  }
  const expo = Math.min(TETO_DA_TENTATIVA_MS, BASE_MS * 2 ** Math.max(0, tentativa - 1));
  const jitter = Math.round(expo * 0.25 * aleatorio());
  return expo + jitter;
}

function retryAfterMs(resposta: Response): number | null {
  const bruto = resposta.headers?.get?.("retry-after");
  if (!bruto) return null;
  const segundos = Number(bruto);
  if (!Number.isFinite(segundos) || segundos < 0) return null;
  return segundos * 1000;
}

function registrarFalha(agora: () => number): void {
  falhasSeguidas = Math.min(falhasSeguidas + 1, 8);
  const pausa = Math.min(TETO_DA_PAUSA_MS, 400 * 2 ** (falhasSeguidas - 1));
  pausaAte = agora() + pausa;
}

function registrarOk(): void {
  falhasSeguidas = 0;
  pausaAte = 0;
}

/**
 * Espera do laço de polling depois de um tick que falhou.
 *
 * O intervalo ocioso configurado continua valendo quando ele já é maior. O
 * recuo só impede o caso em que o intervalo é curto (ou zero) e o banco está
 * fora: sem isto o laço gira na velocidade do erro.
 */
export function esperaAposFalha(falhasSeguidasDoLaco: number, intervaloOciosoMs: number): number {
  const n = Math.max(1, Math.min(falhasSeguidasDoLaco, 8));
  const recuo = Math.min(TETO_DA_PAUSA_MS, 500 * 2 ** (n - 1));
  return Math.max(intervaloOciosoMs, recuo);
}

export function fetchComRecuo(
  interno: typeof globalThis.fetch,
  opcoes: OpcoesDoRecuo = {},
): typeof globalThis.fetch {
  // A suíte fala com um Supabase que não está de pé e espera a falha na hora.
  // Sem este atalho, cada GET 5xx dormiria de verdade e a pausa do processo
  // vazaria para o teste seguinte. Quem passa `dormir` (o teste deste módulo)
  // continua exercitando o recuo.
  if (process.env.VITEST === "true" && !opcoes.dormir) return interno;

  const tentativas = opcoes.tentativas ?? TENTATIVAS_DO_ADMIN;
  const dormir = opcoes.dormir ?? dormirDeVerdade;
  const agora = opcoes.agora ?? Date.now;
  const aleatorio = opcoes.aleatorio ?? Math.random;

  return async (input, init) => {
    // O `next build` gera página estática sem banco. A marca e os módulos já
    // caem no .env quando o fetch falha. Esperar aqui estoura o teto de 60s
    // por página e o build inteiro morre.
    if (process.env.NEXT_PHASE === "phase-production-build") {
      return interno(input, init);
    }

    const signal = init?.signal ?? undefined;
    const falta = pausaAte - agora();
    if (falta > 0) await dormir(falta, signal ?? undefined);

    const metodo = metodoDe(input, init);
    let ultima: Response | null = null;

    for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
      try {
        const resposta = await interno(input, init);
        const recua = statusRecuavel(resposta.status, metodo) && tentativa < tentativas;
        if (!recua) {
          if (resposta.ok) registrarOk();
          else if (statusRecuavel(resposta.status, metodo) || resposta.status >= 500 || resposta.status === 429) {
            registrarFalha(agora);
          }
          return resposta;
        }
        ultima = resposta;
        await dormir(esperaMs(tentativa, aleatorio, retryAfterMs(resposta)), signal ?? undefined);
      } catch (erro) {
        const transiente = ehLeitura(metodo) && ehFalhaDeTransporte(erro);
        if (!transiente || tentativa >= tentativas) {
          if (transiente || ehFalhaDeTransporte(erro)) registrarFalha(agora);
          throw erro;
        }
        await dormir(esperaMs(tentativa, aleatorio, null), signal ?? undefined);
      }
    }

    registrarFalha(agora);
    return ultima ?? new Response(null, { status: 503 });
  };
}
