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
