/**
 * O aviso interno sai como texto livre, na hora, para um número da equipe.
 *
 * Canal que exige janela de 24 h ou definição aprovada não entrega esse
 * recado: a API pode aceitar e a entrega morre depois. A pergunta é a
 * capability, nunca o nome de quem transporta.
 */
import { capabilitiesOf, transportaMensagem } from "@/lib/channels/capabilities";
import type { ChannelProvider } from "@/lib/channels/types";

export function aceitaAvisoLivre(provider: string | null | undefined): boolean {
  if (!transportaMensagem(provider)) return false;
  try {
    return capabilitiesOf(provider as ChannelProvider).freeformOutsideWindow;
  } catch {
    return false;
  }
}
