---
impacto: nada_mudou
secao: corrigido
titulo: O CRM espera quando o banco falha, em vez de repetir na hora
---

Quando o banco não respondia, o processo de fundo repetia a consulta no mesmo instante e a lista grande de contatos ia inteira numa URL que o banco recusava. Agora a repetição espera, para depois de algumas tentativas, e essa lista vai em partes. Não há nada para configurar.
