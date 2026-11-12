---
impacto: nada_mudou
secao: corrigido
titulo: O quadro do funil deixa de reler a permissão em cada negócio
---

A leitura do quadro avaliava a regra de visibilidade uma vez por negócio, e a
regra de escrita entrava na mesma leitura. As duas passam a ser resolvidas uma
vez por consulta. Quem vê e quem grava cada registro não muda; a atualização
aplica isso sozinha.
