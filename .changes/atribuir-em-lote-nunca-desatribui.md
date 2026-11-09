---
impacto: nada_mudou
secao: corrigido
titulo: Atribuir em lote não tira mais o responsável por engano
---

No quadro do funil, o menu "Responsável…" da barra de seleção tinha, no mesmo
lugar dos atendentes, um item "Remover responsável" sem confirmação. Com a lista
de atendentes ainda carregando, o menu abria só com "Eu" e esse item, e um
clique deixava todos os negócios selecionados sem responsável.

Agora o menu só atribui, e fica desabilitado até a lista chegar. Tirar o
responsável virou o botão próprio "Desatribuir…", que pede confirmação com a
contagem. Na API, `POST /api/v1/leads/bulk` com `action: "assign"` exige
`owner_user_id`: sem ele, responde 422 `owner_required` e não altera nada.
Para deixar sem responsável, use `action: "unassign"`, também restrita a
gerente ou acima e auditada como `leads.bulk_unassigned`.

A troca de dono em lote também passou a ser uma escrita só, de até 1000
negócios: ou todos mudam, ou nenhum muda. Antes ela ia em pedaços de 50, e uma
falha no meio deixava parte do funil reatribuída e parte não. Escolher o
atendente agora abre uma confirmação com o nome dele e a contagem. Quem recebe
o lote ganha um aviso só, com o número de negócios, em vez de um por negócio.
Webhooks e automações de "responsável mudou" continuam disparando por negócio.
