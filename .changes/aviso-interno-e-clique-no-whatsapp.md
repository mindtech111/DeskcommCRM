---
impacto: capacidade_nova
secao: adicionado
titulo: A automação pode avisar a equipe no WhatsApp, e o site pode marcar quem clicou
---

Quem monta uma automação ganha a ação "Aviso interno no WhatsApp": escolhe o número que envia, o número da equipe que recebe e um texto com primeiro nome, origem, assunto e o link do card. O texto não aceita outra marcação, nem resposta de formulário. Número que não manda mensagem livre (o WhatsApp oficial, por exemplo) não aparece como remetente e a API recusa a regra. O envio usa o mesmo espaçamento e o mesmo teto diário dos outros avisos internos. Se o número estiver fora do ar, ou se o intervalo ainda não abriu, o aviso espera na fila dele por até seis horas e as outras ações da regra seguem. Se o teto do dia só volta depois desse prazo, o aviso é descartado e fica registrado.

O gatilho "sem mensagem" passa a aceitar horas, além de dias. A condição "não tem a tag" entra no editor. O site pode avisar, numa URL própria da fonte, que a pessoa clicou para abrir o WhatsApp: o card ganha a tag e uma linha na timeline, se o lead for daquela fonte e tiver menos de 48 horas. Fonte que já exige assinatura na captação exige a mesma assinatura neste aviso.

Nenhuma regra é criada sozinha. Quem opera a instalação liga o que quiser na tela de Automações.

Contribuição de @mindtech111.
