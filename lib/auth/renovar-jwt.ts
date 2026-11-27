/**
 * Depois de gravar `user_metadata`, o access token continua o antigo.
 *
 * No auth-js 2.117, `_updateUser` troca `session.user` e grava a sessão, mas
 * não emite outro JWT. `getClaims()` lê esse JWT. Sem renovar, o próximo
 * render volta o idioma e o nome de antes — e o formulário de perfil, que
 * reenvia todos os campos, escreve o valor velho por cima do que acabou de
 * salvar.
 */
export async function renovarJwtDepoisDoPerfil(supabase: {
  auth: {
    refreshSession: () => Promise<{ error: { message: string } | null }>;
  };
}): Promise<string | null> {
  const { error } = await supabase.auth.refreshSession();
  return error ? error.message : null;
}
