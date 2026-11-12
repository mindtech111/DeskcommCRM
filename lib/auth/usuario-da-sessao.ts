import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

/**
 * UM `getUser()` por requisição.
 *
 * O middleware renovava a sessão e, no mesmo clique, o layout, a página e o
 * guard chamavam `auth.getUser()` de novo. Cada chamada vai à rede: o
 * auth-js não reaproveita o usuário que acabou de validar. `cache()` do React
 * deduplica dentro da requisição, inclusive entre layouts aninhados.
 *
 * Isto NÃO é `getSession()`. Quem autoriza continua lendo o usuário que o
 * Auth confirmou.
 */
export const usuarioValidado = cache(async () => {
  const supabase = await createClient();
  return supabase.auth.getUser();
});
