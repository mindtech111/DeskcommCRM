/**
 * Quem é o usuário desta requisição, sem ir ao Auth server quando dá.
 *
 * `getClaims()` verifica a assinatura do JWT. Com chave assimétrica (ECC/RSA,
 * o padrão dos projetos novos) a verificação é local, contra o JWKS em cache
 * no processo — o primeiro pedido busca `/.well-known/jwks.json`, os seguintes
 * não. Com segredo simétrico (HS256, instalações antigas) o SDK chama
 * `getUser()` por dentro, uma vez: aí não há atalho, e também não há segunda
 * ida.
 *
 * Não é `getSession()`. Aquele lê o cookie e acredita. Aqui o `sub` só volta
 * depois da assinatura conferida. A RLS continua valendo: o Postgres recebe o
 * mesmo JWT.
 *
 * `getUser()` direto fica onde o registro VIVO do Auth server é a pergunta —
 * MFA, senha, encerrar todas as sessões, id de sessão de acompanhamento.
 * Identificar a pessoa para ler a tela não é uma dessas perguntas: um usuário
 * apagado no Auth continua válido até o access token expirar (em geral 1h).
 * A membership revogada continua caindo na consulta de `user_organizations`.
 */

export interface UsuarioIdentificado {
  id: string;
  email: string;
  user_metadata: Record<string, unknown>;
}

export interface ErroDeIdentificacao {
  name?: string;
  message?: string;
  status?: number | null;
  code?: string | null;
}

export interface ResultadoDaIdentificacao {
  usuario: UsuarioIdentificado | null;
  error: ErroDeIdentificacao | null;
  /** Qual método respondeu. O log e o teste distinguem os dois. */
  via: "getClaims" | "getUser";
}

interface ClaimsMinimos {
  sub?: unknown;
  email?: unknown;
  user_metadata?: unknown;
}

/**
 * O cliente real tem os dois métodos. O dublê de teste que só stubba
 * `getUser` não tem `getClaims` — aí o fallback preserva a suíte e o
 * comportamento antigo. Em produção o ramo do `getUser` não roda.
 */
export interface ClienteParaIdentificar {
  auth: {
    getClaims?: () => Promise<{
      data: { claims?: ClaimsMinimos } | null;
      error: ErroDeIdentificacao | null;
    }>;
    getUser: (jwt?: string) => Promise<{
      data: {
        user: {
          id: string;
          email?: string | null;
          user_metadata?: Record<string, unknown> | null;
        } | null;
      };
      error: ErroDeIdentificacao | null;
    }>;
  };
}

function metadataDe(valor: unknown): Record<string, unknown> {
  if (valor && typeof valor === "object" && !Array.isArray(valor)) {
    return valor as Record<string, unknown>;
  }
  return {};
}

export async function identificarUsuario(
  supabase: ClienteParaIdentificar,
): Promise<ResultadoDaIdentificacao> {
  if (typeof supabase.auth.getClaims === "function") {
    const { data, error } = await supabase.auth.getClaims();
    const sub = data?.claims?.sub;
    if (error || typeof sub !== "string" || sub.length === 0) {
      return { usuario: null, error: error ?? null, via: "getClaims" };
    }
    const email = data?.claims?.email;
    return {
      usuario: {
        id: sub,
        email: typeof email === "string" ? email : "",
        user_metadata: metadataDe(data?.claims?.user_metadata),
      },
      error: null,
      via: "getClaims",
    };
  }

  // getUser() permanece neste ramo porque o cliente não oferece getClaims
  // (suíte, ou SDK anterior a ele). É a confirmação no Auth server — um
  // round-trip — e não a verificação local.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { usuario: null, error: error ?? null, via: "getUser" };
  }
  return {
    usuario: {
      id: data.user.id,
      email: data.user.email ?? "",
      user_metadata: metadataDe(data.user.user_metadata),
    },
    error: null,
    via: "getUser",
  };
}
