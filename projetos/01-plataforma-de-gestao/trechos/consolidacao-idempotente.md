# Resumo diário recalculado, não incrementado

## O problema

O primeiro desenho contava sessões com um contador incremental: `+1` no início da sessão, `+duração` no fim. Em produção apareceu uma linha com **0 sessões e 1.070 s de duração acumulada**.

O motivo: quando o evento de *início* se perde (o visitante recarrega a página dentro da mesma sessão, um lote falha, ou a sessão nasceu antes do rastreamento existir), o evento de *fim* ainda chega e soma duração. O total sobe, a contagem não, e a média fica dividida por menos sessões do que realmente houve.

## A correção

Tudo que é "por sessão" passou a sair de uma tabela de **sessões**, que é auto-corretiva: ela ganha uma linha tanto no início quanto no fim, com `GREATEST` para que um fim tardio só aumente os valores, nunca zere.

```sql
INSERT INTO sessao (id, inicio, fim, duracao_s, engajado_s, cliques)
VALUES (:id, :inicio, :fim, :duracao, :engajado, :cliques)
ON DUPLICATE KEY UPDATE
  fim        = COALESCE(VALUES(fim), fim),
  duracao_s  = GREATEST(duracao_s,  VALUES(duracao_s)),
  engajado_s = GREATEST(engajado_s, VALUES(engajado_s)),
  cliques    = GREATEST(cliques,    VALUES(cliques));
```

O resumo diário é montado **a partir dela, recalculando**. Rodar duas vezes dá o mesmo resultado, então a rotina noturna pode repetir os últimos dias sem medo e ainda conserta qualquer dia que tenha ficado torto:

```sql
-- Recalcula (não incrementa): idempotente.
INSERT INTO resumo_diario (data, sessoes, novos, recorrentes, duracao_total_s, engajado_total_s, rejeicoes)
SELECT DATE(inicio),
       COUNT(*),
       SUM(is_recorrente = 0),
       SUM(is_recorrente = 1),
       SUM(duracao_s),
       SUM(engajado_s),
       SUM(cliques = 0 AND engajado_s < 10)      -- rejeição: não clicou e ficou < 10 s de atenção real
  FROM sessao
 WHERE inicio >= :corte
 GROUP BY DATE(inicio)
ON DUPLICATE KEY UPDATE
  sessoes          = VALUES(sessoes),
  novos            = VALUES(novos),
  recorrentes      = VALUES(recorrentes),
  duracao_total_s  = VALUES(duracao_total_s),
  engajado_total_s = VALUES(engajado_total_s),
  rejeicoes        = VALUES(rejeicoes);
```

## Por que isso importa além do bug

A sessão crua é apagada aos 90 dias para o banco não crescer sem fim. Como o resumo é **consolidado antes** de apagar, é ele que guarda o histórico longo. Sem esse passo, o histórico de tempo e retenção sumiria junto com as sessões.

## Detalhe: "únicos" não se somam

Visitantes únicos por dia **não podem** ser somados para dar únicos do período: quem voltou em três dias seria contado três vezes. O número do período sai de um `COUNT(DISTINCT visitante)` direto sobre as sessões.
