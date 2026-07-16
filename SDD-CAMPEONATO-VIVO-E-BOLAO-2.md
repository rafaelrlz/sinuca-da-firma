# SDD — Campeonato Vivo e Bolão 2.0

**Status:** Proposto para implementação local
**Versão:** 1.0
**Data:** 16 de julho de 2026
**Produto:** Sinuca da Firma
**Base obrigatória:** `SDD-EXPANSAO-DO-SITE.md`, `PRODUCT.md` e `DESIGN.md`

## 1. Objetivo

Este documento define a segunda grande evolução da Sinuca da Firma. O objetivo é transformar o produto em uma central viva do campeonato, com atenção especial ao bolão, sem deixar Agenda, Início, Liga, Ranking, Jogadores, Estatísticas, Notícias, Cards, Temporadas, Hall da Fama, Premiações, Comunidade e Administração em segundo plano.

O bolão será o principal motor de retorno recorrente: antes da partida, o usuário consulta a agenda e registra seu palpite; durante a partida, acompanha a Central ao Vivo; depois, confere a apuração, sua evolução e o conteúdo gerado pelo resultado.

Esta implementação deverá preservar integralmente:

- dados atuais;
- comportamento público e administrativo existente;
- funcionamento local com SQLite;
- compatibilidade com PostgreSQL/Neon;
- backups antigos;
- modo recreativo atual do bolão;
- regra de que não existe aposta com dinheiro, pagamento, saque ou prêmio financeiro.

## 2. Política de execução desta versão

Esta versão será implementada e testada integralmente no working tree antes de qualquer publicação.

Regras obrigatórias:

- não executar `git add`;
- não executar `git commit`;
- não executar `git push`;
- não criar tag;
- não abrir pull request;
- não alterar histórico Git;
- não migrar destrutivamente o banco real;
- criar backup do banco antes de desenvolver migrações;
- executar migrações e testes destrutivos apenas sobre cópias temporárias;
- não incluir `.impeccable/critique/` em qualquer entrega futura;
- ao final, deixar todas as alterações locais disponíveis para inspeção e teste manual do usuário.

Comandos Git somente de leitura, como `git status`, `git diff`, `git log` e `git show`, são permitidos.

## 3. Contexto atual

O produto já possui:

- administração completa do campeonato;
- liga, rodadas, partidas, ranking e mata-mata;
- agenda flexível independente da ordem das rodadas;
- próximo jogo oficial e até três destaques;
- disponibilidade dos jogadores;
- perfis e páginas de confronto;
- estatísticas e comparador;
- notícias, cards e temporadas;
- Hall da Fama, premiações, reações e mural;
- bolão virtual com cadastro por nome e PIN;
- saldo inicial, limite por aposta, ranking e histórico;
- integração do bolão com próximo jogo, agenda e partida em andamento;
- proteção administrativa, rate limits e auditoria.

No modelo atual do bolão:

- cada perfil começa com fichas virtuais;
- a aposta reserva fichas enquanto está aberta;
- um acerto gera lucro equivalente ao valor apostado;
- um erro devolve as fichas, sem prejuízo;
- a aposta fecha quando a partida entra em andamento;
- o ranking é ordenado principalmente pelo saldo apurado;
- as regras são constantes no servidor;
- não há temporada própria do bolão;
- não há snapshot completo das regras em cada aposta;
- não há linha do tempo imutável de eventos da aposta;
- a experiência é uma página única, funcional, mas pouco personalizada.

## 4. Visão do produto

### 4.1 Posicionamento

**O campeonato acontece aqui — antes, durante e depois de cada partida.**

### 4.2 Ciclo principal

```text
Agenda e contexto
└── Palpite no bolão
    └── Fechamento transparente
        └── Central ao vivo
            └── Resultado oficial
                ├── Apuração do bolão
                ├── Ranking e estatísticas
                ├── Notícias e cards
                └── Comunidade e histórico
```

### 4.3 Usuários

**Administrador**

- configura regras;
- agenda e inicia partidas;
- registra resultados;
- supervisiona apuração;
- modera comunidade;
- encerra temporadas;
- investiga eventos e conflitos.

**Participante do bolão**

- entra com nome e PIN;
- consulta partidas disponíveis;
- registra e altera palpites;
- acompanha saldo, posição e histórico;
- compara desempenho;
- acompanha partidas ao vivo.

**Visitante público**

- acompanha campeonato, agenda e Central ao Vivo;
- consulta rankings, perfis, estatísticas e notícias;
- visualiza dados públicos do bolão conforme a política de visibilidade.

## 5. Metas

- Dar ao participante uma área “Meu bolão” clara e personalizada.
- Preservar o modo recreativo atual como padrão.
- Permitir regras competitivas opcionais e configuráveis.
- Registrar o snapshot das regras e odds de cada aposta.
- Fechar apostas de forma automática e previsível.
- Tornar apuração idempotente, auditável e explicável.
- Criar rankings do bolão por rodada, período e temporada.
- Criar temporadas próprias do bolão sem apagar históricos.
- Criar uma Central ao Vivo integrada ao confronto.
- Personalizar a página inicial conforme o contexto do visitante.
- Ampliar Agenda, jogadores, Liga, Ranking e Estatísticas.
- Automatizar conteúdo sem publicar nada sem confirmação.
- Melhorar comunidade, moderação e administração.
- Preparar PWA, leitura offline e notificações opcionais.
- Manter WCAG AA, desempenho e responsividade a partir de 320 px.

## 6. Não objetivos

- Não criar apostas com dinheiro real.
- Não criar depósitos, saques, pagamentos ou prêmios financeiros.
- Não reproduzir aparência de cassino, casa de apostas ou aplicativo gamer.
- Não criar odds manipuladas para vantagem da organização.
- Não substituir o placar e o resultado oficial por votação pública.
- Não permitir que uma automação publique conteúdo sem revisão.
- Não exigir login dos jogadores do campeonato.
- Não exigir serviço externo para o funcionamento básico local.
- Não introduzir framework ou etapa de build no frontend.
- Não apagar apostas antigas para iniciar nova temporada.
- Não alterar retrospectivamente a regra de uma aposta já criada.

## 7. Princípios de produto e UX

### 7.1 Bolão como competição recreativa

O bolão deve parecer uma brincadeira competitiva bem organizada, não um produto financeiro. A linguagem usará “palpite”, “fichas virtuais”, “posição” e “desempenho”, evitando termos promocionais de apostas comerciais.

### 7.2 Transparência antes da ação

Antes de confirmar um palpite, o participante deverá compreender:

- quantas fichas serão reservadas;
- qual regra de perda está ativa;
- qual odd ou multiplicador será aplicado;
- qual retorno potencial existe;
- quando o palpite fecha;
- quando ele ainda pode ser alterado ou cancelado.

### 7.3 Regra imutável por aposta

Toda aposta armazenará um snapshot das regras. Alterar a configuração do bolão afetará somente novas apostas ou apostas novamente confirmadas, nunca uma aposta encerrada.

### 7.4 Fonte oficial única

Partida, participantes, andamento e resultado continuarão vindo do estado oficial do campeonato. O bolão não duplicará placares nem decidirá resultados.

### 7.5 Progressão sem excesso visual

A interface deverá mostrar primeiro o que exige ação. Histórico detalhado, regras avançadas e estatísticas secundárias serão apresentados por navegação contextual ou expansão progressiva, evitando grades intermináveis de cartões.

### 7.6 Ouro conquistado

O ouro continuará reservado para liderança, campeão, conquista ou atenção real. O verde será usado para identidade, ação e estado, não como decoração espalhada.

## 8. Decisões funcionais

## 8.1 Modos de perda

O bolão terá três modos:

- `refund`: erro devolve integralmente as fichas; comportamento atual e padrão.
- `forfeit`: erro perde integralmente as fichas apostadas.
- `partial`: erro devolve uma porcentagem configurável.

O padrão de instalações e backups antigos será:

```json
{
  "lossPolicy": "refund",
  "lossRefundPercent": 100
}
```

## 8.2 Odds

Modos disponíveis:

- `fixed`: multiplicador definido pelo administrador; padrão `2.0`.
- `crowd`: odd calculada pela distribuição de fichas já apostadas.

O modo `crowd` será opt-in e inicialmente desativado.

Regras:

- a odd exibida antes da confirmação é uma prévia;
- a odd efetivamente aceita será salva no registro;
- atualizar uma aposta gera novo snapshot;
- aposta encerrada mantém a odd aceita;
- o cálculo deverá possuir limites mínimo e máximo configuráveis;
- o cálculo não poderá resultar em retorno negativo ou `NaN`;
- o usuário verá o retorno potencial em fichas, não apenas a odd decimal.

Fórmula inicial para o modo comunitário:

```text
participação = fichas no jogador / fichas totais da partida
odd bruta = 1 / participação
odd final = limitar(odd bruta, odd mínima, odd máxima)
```

Quando não houver amostra suficiente, será usado o multiplicador fixo.

## 8.3 Cálculo financeiro virtual

Para cada aposta:

```text
lucro em acerto = stake × (acceptedOdds - 1)
delta em erro refund = 0
delta em erro forfeit = -stake
delta em erro partial = -stake × (1 - refundPercent / 100)
delta em anulação = 0
saldo disponível = saldo apurado - stakes pendentes
```

Valores fracionários serão arredondados para fichas inteiras com regra única documentada e testada. A recomendação é arredondamento para baixo no retorno final, evitando gerar fichas não explicáveis.

## 8.4 Fechamento

Uma aposta estará fechada se qualquer condição verdadeira ocorrer:

- partida em andamento;
- resultado já registrado;
- bloqueio manual administrativo;
- horário de fechamento calculado já passou.

Configuração:

```json
{
  "closePolicy": "scheduled_or_started",
  "lockMinutesBefore": 0
}
```

Políticas:

- `started_only`: fecha apenas ao iniciar a partida.
- `scheduled_or_started`: fecha no horário calculado ou ao iniciar.
- `manual_or_started`: administrador fecha manualmente ou a partida inicia.

Partida cancelada ou com participantes substituídos deverá anular os palpites incompatíveis. Partida adiada preservará os palpites por padrão, reabrindo alterações até o novo horário de fechamento.

## 8.5 Visibilidade dos palpites

Políticas:

- `after_lock`: distribuição pública somente após fechamento; padrão.
- `always`: distribuição pública durante o período aberto.
- `admin_only`: distribuição visível somente ao administrador até a apuração.

O palpite individual de cada participante nunca será mostrado publicamente antes do fechamento.

## 8.6 Apuração

- Será idempotente.
- Será derivada do resultado oficial.
- Registrará data, regra, odd, retorno e motivo.
- Resultado alterado pelo administrador provocará reprocessamento auditável.
- Uma apuração nunca poderá ser aplicada duas vezes.
- A interface administrativa oferecerá prévia antes de uma correção manual.

## 8.7 Temporadas do bolão

- Existirá no máximo uma temporada ativa.
- A temporada poderá acompanhar a temporada esportiva, mas terá ID próprio.
- Encerrar uma temporada não excluirá perfis, apostas ou ranking histórico.
- Uma nova temporada poderá reiniciar saldos sem apagar o histórico.
- Ações destrutivas serão substituídas por arquivamento e confirmação reforçada.

## 8.8 Conquistas

Conquistas iniciais:

- primeiro palpite;
- primeiro acerto;
- três acertos consecutivos;
- cinco acertos consecutivos;
- acerto em azarão;
- líder da rodada;
- líder mensal;
- campeão da temporada do bolão.

Conquistas serão derivadas ou concedidas idempotentemente; nunca poderão duplicar.

## 8.9 Central ao Vivo

A Central ao Vivo será ativada quando houver partida oficial em andamento.

Ela exibirá:

- jogadores;
- placar atual disponível;
- agenda e local;
- rodada;
- retrospecto;
- forma recente;
- distribuição dos palpites já fechados;
- total de participantes e fichas;
- mural vinculado à partida;
- reações;
- link para confronto completo;
- estado textual equivalente para leitores de tela.

O modo telão será somente leitura, com tipografia maior e atualização automática.

## 9. Arquitetura de informação

## 9.1 Navegação pública principal

- Início
- Liga
- Agenda
- Ranking
- Jogadores
- Bolão
- Notícias

## 9.2 Destinos contextuais

- Central ao Vivo
- Meu bolão
- Detalhes do ranking do bolão
- Estatísticas
- Comparador
- Confronto
- Temporada
- Hall da Fama
- Premiações
- Comunidade

## 9.3 Bolão

Ordem de conteúdo para participante autenticado:

1. resumo “Meu bolão”;
2. ações pendentes e próximo fechamento;
3. partidas abertas;
4. apostas abertas;
5. resultados recentes;
6. ranking da rodada;
7. ranking geral;
8. desempenho e conquistas;
9. regras vigentes.

Ordem para visitante não autenticado:

1. explicação curta;
2. acesso ou cadastro;
3. partidas abertas em modo de consulta;
4. ranking público;
5. regras;
6. aviso de uso exclusivamente virtual.

## 9.4 Administração

**Campeonato**

- Visão geral
- Operar rodada
- Agenda
- Jogadores
- Liga
- Ranking
- Estatísticas
- Temporadas

**Participação e conteúdo**

- Bolão
- Notícias
- Cards
- Premiações
- Comunidade

**Sistema**

- Configurações
- Auditoria
- Backups
- Saúde do sistema

## 10. Modelo de dados

Todas as migrações deverão funcionar em SQLite e PostgreSQL, ser repetíveis com segurança e registrar marcador em `schema_migrations`.

## 10.1 `betting_seasons`

- `id`
- `title`
- `status`: `draft`, `active`, `archived`
- `starts_at`
- `ends_at`
- `initial_balance`
- `rules_json`
- `created_by`
- `created_at`
- `updated_at`
- `archived_at`

Restrições:

- somente uma temporada ativa;
- `rules_json` validado antes de salvar;
- temporada arquivada não poderá receber novas apostas.

## 10.2 Ampliação de `bets`

Adicionar:

- `season_id`
- `accepted_odds`
- `potential_return`
- `rules_snapshot_json`
- `locked_at`
- `settled_at`
- `settlement_status`
- `settlement_delta`
- `settlement_reason`
- `void_reason`

Valores de `settlement_status`:

- `pending`
- `won`
- `lost`
- `void`

Compatibilidade:

- apostas antigas receberão a temporada lógica `legacy-current`;
- apostas antigas usarão `lossPolicy=refund`;
- apostas antigas usarão odd `2.0`;
- nenhum dado original será descartado;
- o resultado derivado atual deverá permanecer numericamente idêntico após a migração.

## 10.3 `bet_events`

Linha do tempo imutável:

- `id`
- `bet_id`
- `bettor_id`
- `event_type`
- `detail_json`
- `actor_type`: `bettor`, `admin`, `system`
- `actor_id`
- `created_at`

Eventos iniciais:

- `created`
- `updated`
- `cancelled`
- `locked`
- `reopened`
- `settled`
- `resettled`
- `voided`

## 10.4 `bettor_balance_events`

Eventos não derivados diretamente de apostas:

- `id`
- `bettor_id`
- `season_id`
- `event_type`
- `amount`
- `reason`
- `created_by`
- `created_at`

Tipos:

- `initial_credit`
- `admin_adjustment`
- `bonus`
- `penalty`
- `migration`

Todo ajuste administrativo exigirá motivo e auditoria.

## 10.5 Ampliação de `bettors`

Adicionar:

- `public_profile_enabled`
- `bio`
- `favorite_player_id`
- `avatar_data`
- `avatar_type`
- `last_seen_at`

Nome e PIN continuarão obrigatórios. Perfil público será opt-in.

## 10.6 `bettor_achievements`

- `id`
- `bettor_id`
- `season_id`
- `achievement_type`
- `detail_json`
- `earned_at`

Restrição única por conquista, participante, temporada e contexto aplicável.

## 10.7 `match_betting_controls`

Permite controle específico por partida:

- `match_kind`
- `match_id`
- `betting_status`: `inherit`, `open`, `locked`, `disabled`
- `lock_at`
- `note`
- `updated_by`
- `updated_at`

## 10.8 `match_live_events`

- `id`
- `match_kind`
- `match_id`
- `event_type`
- `payload_json`
- `created_by`
- `created_at`

Primeira versão:

- `started`
- `score_updated`
- `note`
- `paused`
- `resumed`
- `finished`
- `corrected`

O resultado oficial continuará sendo salvo no estado competitivo.

## 10.9 Notificações

Tabela opcional, implementada somente na fase correspondente:

### `notification_subscriptions`

- `id`
- `visitor_id`
- `bettor_id`
- `endpoint`
- `subscription_json`
- `preferences_json`
- `active`
- `created_at`
- `updated_at`

Nenhuma notificação será ativada sem consentimento explícito.

## 10.10 Comunidade

Ampliar `community_posts` com:

- `parent_id`
- `pinned`
- `edited_at`
- `match_id`
- `season_id`

Respostas terão profundidade máxima limitada para preservar legibilidade.

## 11. Contrato de regras do bolão

Exemplo:

```json
{
  "schemaVersion": 1,
  "mode": "recreational",
  "initialBalance": 10000,
  "minStake": 1,
  "maxStake": 500,
  "roundStakeLimit": null,
  "lossPolicy": "refund",
  "lossRefundPercent": 100,
  "oddsMode": "fixed",
  "fixedOdds": 2,
  "minimumOdds": 1.25,
  "maximumOdds": 4,
  "minimumCrowdStake": 100,
  "closePolicy": "scheduled_or_started",
  "lockMinutesBefore": 0,
  "predictionVisibility": "after_lock",
  "allowCancellation": true,
  "virtualOnly": true
}
```

O servidor será a autoridade para normalização e validação. O frontend poderá compartilhar helpers de domínio, mas nunca será a única barreira.

## 12. APIs

Endpoints existentes deverão permanecer compatíveis.

## 12.1 Participante

- `GET /api/bets` — snapshot compatível e ampliado.
- `GET /api/bets/me` — perfil, saldos, desempenho e conquistas.
- `GET /api/bets/matches` — partidas e estado de fechamento.
- `GET /api/bets/leaderboard?scope=overall|round|month|season`.
- `GET /api/bets/history?status=...&cursor=...`.
- `GET /api/bets/rules`.
- `GET /api/bets/preview?matchId=...&winnerId=...&stake=...`.
- `POST /api/bets/wager`.
- `POST /api/bets/cancel`.

## 12.2 Administração

- `GET /api/admin/bets/settings`.
- `PUT /api/admin/bets/settings`.
- `GET /api/admin/bets/participants`.
- `PUT /api/admin/bets/participants`.
- `POST /api/admin/bets/adjust-balance`.
- `POST /api/admin/bets/lock-match`.
- `POST /api/admin/bets/reopen-match`.
- `POST /api/admin/bets/settle-preview`.
- `POST /api/admin/bets/reprocess`.
- `POST /api/admin/bets/seasons`.
- `POST /api/admin/bets/seasons/archive`.
- `GET /api/admin/bets/events`.

O endpoint destrutivo `/api/bets/reset` deverá ser descontinuado na interface. Se mantido por compatibilidade, exigirá confirmação reforçada, backup e configuração explícita para ser habilitado.

## 12.3 Central ao Vivo

- `GET /api/live`.
- `GET /api/live?matchId=...`.
- `POST /api/admin/live/events`.
- `DELETE /api/admin/live/events?id=...` somente para correção auditada.

## 12.4 Home

- `GET /api/home` poderá agregar somente dados públicos já disponíveis.
- A ausência desse endpoint não deverá bloquear a fase: o frontend poderá compor o resumo com chamadas existentes.

## 12.5 Notificações

- `POST /api/notifications/subscribe`.
- `PUT /api/notifications/preferences`.
- `DELETE /api/notifications/subscribe`.
- `POST /api/admin/notifications/test`.

## 13. Fluxos principais

## 13.1 Registrar palpite

1. Participante abre uma partida disponível.
2. Escolhe o vencedor.
3. Informa as fichas.
4. Interface mostra regra, fechamento e retorno potencial.
5. Participante confirma.
6. Servidor recalcula disponibilidade, odd e regras.
7. Servidor rejeita se a partida fechou durante a operação.
8. Aposta e evento são salvos na mesma transação.
9. Interface atualiza saldo e mostra confirmação compreensível.

## 13.2 Alterar palpite

1. Participante abre uma aposta pendente.
2. Altera jogador ou fichas.
3. Interface informa que odd e snapshot poderão mudar.
4. Servidor valida o fechamento.
5. Evento `updated` registra antes e depois.

## 13.3 Fechar partida

1. Horário limite chega, administrador bloqueia ou partida inicia.
2. Sistema considera a partida fechada.
3. Apostas pendentes recebem evento `locked` idempotente.
4. Distribuição poderá ser revelada conforme configuração.
5. Nenhuma alteração ou cancelamento será aceita.

## 13.4 Apurar resultado

1. Administrador registra resultado oficial.
2. Sistema identifica apostas pendentes.
3. Calcula o delta usando o snapshot individual.
4. Persiste apuração e evento na mesma transação.
5. Atualiza conquistas e rankings derivados.
6. Oferece gerar notícia e cards.
7. Usuário recebe explicação do resultado no histórico.

## 13.5 Corrigir resultado

1. Administrador corrige o resultado oficial.
2. Sistema cria prévia das diferenças.
3. Administrador confirma.
4. Sistema reprocessa somente apostas afetadas.
5. Evento `resettled` preserva valores anteriores e novos.
6. Auditoria registra administrador, data e motivo.

## 13.6 Encerrar temporada do bolão

1. Administrador visualiza prévia do ranking final.
2. Sistema verifica partidas e apostas pendentes.
3. Pendências precisam ser resolvidas ou anuladas explicitamente.
4. Temporada é arquivada.
5. Campeão e conquistas são registrados.
6. Cards e notícia são oferecidos como rascunho.
7. Criação da próxima temporada ocorre em ação separada.

## 13.7 Acompanhar ao vivo

1. Administrador inicia a partida.
2. Central ao Vivo passa a ser o destino prioritário.
3. Apostas são fechadas.
4. Distribuição é revelada conforme regra.
5. Eventos e placar são atualizados.
6. Ao finalizar, a tela transita para resumo do resultado.

## 14. Especificação de interface

## 14.1 Bolão público

### Cabeçalho

- marca e retorno ao campeonato;
- estado da conexão;
- identificação do participante;
- atalho para regras;
- sem hero excessivamente alto.

### Meu bolão

- posição geral e variação;
- saldo disponível;
- saldo apurado;
- fichas reservadas;
- taxa de acerto;
- sequência atual;
- próximo fechamento;
- ação mais importante visível primeiro.

Não usar o padrão genérico de quatro cartões idênticos. Métricas devem formar um placar compacto, com hierarquia e comparação contextual.

### Partidas abertas

- prioridade para próximo jogo e partidas próximas do fechamento;
- filtros por estado e jogador;
- fechamento textual e contagem regressiva;
- escolha de jogador com controle nativo acessível;
- fichas e retorno potencial;
- contexto da agenda;
- link para confronto;
- confirmação inline;
- atualização sem perder foco ou posição de rolagem.

### Minhas apostas

Abas ou filtros:

- abertas;
- encerradas;
- acertos;
- erros;
- anuladas.

Cada linha explicará:

- escolha;
- stake;
- regra;
- odd;
- retorno ou perda;
- estado;
- data;
- evento mais recente.

### Ranking

- geral;
- rodada;
- mês;
- temporada;
- sequência;
- azarões.

No mobile, rankings usarão lista/tabela responsiva, não rolagem horizontal obrigatória para informações essenciais.

### Desempenho

- evolução do saldo;
- precisão;
- lucro virtual;
- distribuição de escolhas;
- melhores e piores períodos;
- conquistas.

Gráficos terão resumo textual.

## 14.2 Administração do bolão

- temporada ativa;
- regras vigentes;
- prévia humana das consequências;
- participantes e estado;
- ajustes auditáveis;
- partidas abertas, fechadas e apuradas;
- ações de fechar e reabrir;
- prévia de reprocessamento;
- eventos pesquisáveis;
- arquivamento de temporada;
- nenhuma ação destrutiva como destaque primário.

Alterações de regra deverão usar formulário progressivo:

1. modo básico;
2. regras de perda;
3. odds;
4. fechamento;
5. visibilidade;
6. revisão e confirmação.

## 14.3 Central ao Vivo

### Público

- placar dominante;
- nomes e estado da partida;
- rodada, local e horário;
- distribuição do bolão fechada;
- retrospecto e forma;
- timeline;
- comunidade;
- ações de compartilhar e abrir confronto.

### Telão

- alto contraste;
- tipografia legível à distância;
- nenhuma ação administrativa;
- atualização automática;
- prevenção de layout shift.

### Administração

- iniciar, pausar, retomar e finalizar;
- atualizar placar;
- registrar nota;
- corrigir evento;
- confirmação antes de finalizar.

## 14.4 Página inicial personalizada

### Visitante

- partida em andamento ou próximo jogo;
- agenda imediata;
- último resultado;
- ranking resumido;
- notícias;
- chamada para o bolão.

### Participante autenticado no bolão

- palpites pendentes;
- próximo fechamento;
- posição;
- resultado mais recente;
- partida ao vivo.

### Administrador

- tarefas pendentes;
- partidas sem programação;
- próximo jogo não escolhido;
- resultados aguardando registro;
- moderação;
- rascunhos automáticos.

Personalização deverá ser progressiva: a home pública continuará útil se APIs opcionais falharem.

## 14.5 Agenda

- lista, semana e mês;
- filtros por jogador, local, período e estado;
- exportação `.ics`;
- compartilhamento para WhatsApp/Web Share;
- confirmação de presença administrada;
- histórico de remarcação;
- disponibilidade agregada sem expor detalhes privados;
- sugestão de horário sem decisão automática.

## 14.6 Jogadores e confrontos

- forma dos últimos cinco jogos;
- linha do tempo;
- conquistas;
- rivalidades históricas;
- desempenho por adversário;
- compartilhamento;
- privacidade de disponibilidade;
- comparação contextual.

## 14.7 Liga e ranking

- critérios de desempate acessíveis;
- evolução por rodada;
- linha de corte configurável;
- simulador de cenários;
- forma recente;
- comparação com temporada anterior;
- bracket móvel com zoom e navegação por teclado.

## 14.8 Estatísticas

- filtros por temporada, período e adversário;
- amostra e contexto;
- médias de placar;
- desempenho recente;
- recordes;
- comparação de até três jogadores;
- exportação para cards;
- resumo textual dos gráficos.

## 14.9 Notícias e cards

- rascunho pós-jogo;
- resumo semanal;
- pré-jogo;
- agendamento de publicação;
- busca e categorias;
- histórico editorial;
- pacotes de cards;
- QR Code opcional;
- exportação em lote;
- nenhum conteúdo publicado automaticamente.

## 14.10 Temporadas, Hall da Fama e premiações

- narrativa da temporada;
- ranking histórico de títulos;
- recordes absolutos;
- galeria de campeões;
- etapas de indicação, votação e resultado;
- resultados ocultos até encerramento;
- cards de indicados e vencedores.

## 14.11 Comunidade

- respostas encadeadas com profundidade limitada;
- posts fixados;
- vínculo com partida e temporada;
- menções;
- edição com marca textual;
- moderação e histórico;
- rate limit;
- denúncias nunca ocultam automaticamente.

## 15. Estados obrigatórios

Toda superfície nova deverá tratar:

- carregamento com skeleton compatível com o layout;
- vazio inicial;
- vazio após filtro;
- servidor indisponível;
- timeout;
- resposta parcial;
- sessão expirada;
- conflito entre administradores;
- ação já concluída em outra aba;
- dados antigos incompletos;
- texto longo;
- nomes repetidos;
- caracteres acentuados;
- viewport de 320 px;
- zoom de 200%;
- movimento reduzido;
- navegação por teclado;
- retorno do navegador;
- atualização em background sem perda de entrada do usuário.

## 16. Fases e tasks

## Fase 0 — Fundação e contratos

Objetivo: preparar contratos, migrações seguras e domínio testável.

- [ ] `LIVE-FOUND-01` Criar backup ignorado do banco real antes das migrações.
- [ ] `LIVE-FOUND-02` Criar banco temporário a partir de uma cópia do banco real.
- [ ] `LIVE-FOUND-03` Documentar contagens e integridade antes da migração.
- [ ] `LIVE-FOUND-04` Criar migração `betting_v2`.
- [ ] `LIVE-FOUND-05` Criar tabelas e colunas descritas neste SDD.
- [ ] `LIVE-FOUND-06` Backfill de apostas antigas com regra recreativa.
- [ ] `LIVE-FOUND-07` Garantir equivalência numérica do ranking antes/depois.
- [ ] `LIVE-FOUND-08` Criar módulo de domínio do bolão independente da UI.
- [ ] `LIVE-FOUND-09` Normalizar regras e rejeitar configurações inválidas.
- [ ] `LIVE-FOUND-10` Implementar cálculo de fechamento.
- [ ] `LIVE-FOUND-11` Implementar cálculo de odd e retorno.
- [ ] `LIVE-FOUND-12` Implementar cálculo de apuração.
- [ ] `LIVE-FOUND-13` Implementar apuração idempotente.
- [ ] `LIVE-FOUND-14` Implementar eventos imutáveis.
- [ ] `LIVE-FOUND-15` Criar testes unitários de domínio.

Critério de saída: banco antigo migra sem perda e o snapshot atual do bolão permanece equivalente.

## Fase 1 — Integridade e administração do bolão

Objetivo: tornar as regras configuráveis e a operação auditável.

- [ ] `BET-ADMIN-01` Criar temporada ativa padrão.
- [ ] `BET-ADMIN-02` Criar APIs administrativas de configuração.
- [ ] `BET-ADMIN-03` Criar editor progressivo de regras.
- [ ] `BET-ADMIN-04` Criar prévia das consequências da configuração.
- [ ] `BET-ADMIN-05` Criar listagem de participantes.
- [ ] `BET-ADMIN-06` Criar ativação e suspensão sem exclusão.
- [ ] `BET-ADMIN-07` Criar ajuste de saldo com motivo.
- [ ] `BET-ADMIN-08` Criar controle por partida.
- [ ] `BET-ADMIN-09` Criar bloqueio manual.
- [ ] `BET-ADMIN-10` Criar reabertura auditada.
- [ ] `BET-ADMIN-11` Criar prévia de apuração.
- [ ] `BET-ADMIN-12` Criar reprocessamento por correção de resultado.
- [ ] `BET-ADMIN-13` Criar visualizador de eventos.
- [ ] `BET-ADMIN-14` Retirar “zerar bolão” do fluxo principal.
- [ ] `BET-ADMIN-15` Criar arquivamento seguro em substituição ao reset.

Critério de saída: administrador controla o bolão sem editar código e toda alteração relevante possui auditoria.

## Fase 2 — Meu Bolão e palpites

Objetivo: reconstruir a experiência do participante.

- [ ] `BET-UX-01` Reorganizar a página sem quebrar login e cadastro.
- [ ] `BET-UX-02` Criar resumo “Meu bolão”.
- [ ] `BET-UX-03` Criar avisos de ação pendente.
- [ ] `BET-UX-04` Criar lista priorizada de partidas.
- [ ] `BET-UX-05` Criar filtros de partidas.
- [ ] `BET-UX-06` Mostrar contagem regressiva de fechamento.
- [ ] `BET-UX-07` Mostrar regra e retorno potencial.
- [ ] `BET-UX-08` Criar confirmação inline do palpite.
- [ ] `BET-UX-09` Preservar foco e rolagem após atualização.
- [ ] `BET-UX-10` Criar histórico filtrável.
- [ ] `BET-UX-11` Mostrar linha do tempo da aposta.
- [ ] `BET-UX-12` Criar regras em linguagem simples.
- [ ] `BET-UX-13` Criar perfil público opt-in.
- [ ] `BET-UX-14` Criar gráficos com resumo textual.
- [ ] `BET-UX-15` Validar 320 px, 390 px, tablet e desktop.

Critério de saída: um participante entende e conclui um palpite sem depender de instrução externa.

## Fase 3 — Rankings, temporadas e conquistas do bolão

Objetivo: criar progressão e recorrência.

- [ ] `BET-SEASON-01` Criar ranking geral.
- [ ] `BET-SEASON-02` Criar ranking de rodada.
- [ ] `BET-SEASON-03` Criar ranking mensal.
- [ ] `BET-SEASON-04` Criar ranking de temporada.
- [ ] `BET-SEASON-05` Criar ranking de sequência.
- [ ] `BET-SEASON-06` Criar ranking de azarões quando odds dinâmicas estiverem ativas.
- [ ] `BET-SEASON-07` Criar evolução de posição.
- [ ] `BET-SEASON-08` Criar concessão idempotente de conquistas.
- [ ] `BET-SEASON-09` Criar galeria de conquistas.
- [ ] `BET-SEASON-10` Criar encerramento de temporada.
- [ ] `BET-SEASON-11` Criar nova temporada sem apagar histórico.
- [ ] `BET-SEASON-12` Criar página histórica por temporada.
- [ ] `BET-SEASON-13` Gerar rascunho de notícia e cards do campeão.

Critério de saída: o bolão pode atravessar múltiplas temporadas preservando rankings e apostas.

## Fase 4 — Central ao Vivo

Objetivo: integrar o momento da partida ao restante do produto.

- [ ] `LIVE-01` Criar contrato de eventos ao vivo.
- [ ] `LIVE-02` Criar APIs públicas e administrativas.
- [ ] `LIVE-03` Integrar início da partida ao fechamento do bolão.
- [ ] `LIVE-04` Criar tela pública da Central ao Vivo.
- [ ] `LIVE-05` Criar modo telão.
- [ ] `LIVE-06` Criar controles administrativos.
- [ ] `LIVE-07` Criar timeline.
- [ ] `LIVE-08` Exibir distribuição dos palpites conforme política.
- [ ] `LIVE-09` Integrar confronto, agenda e retrospecto.
- [ ] `LIVE-10` Integrar mural e reações.
- [ ] `LIVE-11` Criar transição para resultado final.
- [ ] `LIVE-12` Tratar pausa, retomada, correção e reconexão.

Critério de saída: iniciar uma partida fecha palpites e ativa uma experiência pública coerente.

## Fase 5 — Início e Agenda

Objetivo: personalizar a entrada e ampliar a operação diária.

- [ ] `HOME-01` Criar composição pública da home.
- [ ] `HOME-02` Criar resumo para participante do bolão.
- [ ] `HOME-03` Criar resumo administrativo.
- [ ] `HOME-04` Priorizar partida ao vivo.
- [ ] `HOME-05` Criar fallback quando APIs opcionais falharem.
- [ ] `AGENDA2-01` Criar visualização semanal.
- [ ] `AGENDA2-02` Criar visualização mensal.
- [ ] `AGENDA2-03` Preservar visualização em lista.
- [ ] `AGENDA2-04` Ampliar filtros.
- [ ] `AGENDA2-05` Criar compartilhamento para WhatsApp/Web Share.
- [ ] `AGENDA2-06` Criar confirmação de presença administrada.
- [ ] `AGENDA2-07` Criar sugestão não bloqueante de horário.
- [ ] `AGENDA2-08` Melhorar histórico de reagendamentos.

Critério de saída: cada perfil de acesso encontra na home sua próxima ação relevante sem perder a experiência pública geral.

## Fase 6 — Competição e inteligência

Objetivo: aprofundar jogadores, Liga, Ranking, confrontos e Estatísticas.

- [ ] `PLAYER2-01` Criar forma dos últimos cinco jogos.
- [ ] `PLAYER2-02` Criar linha do tempo do jogador.
- [ ] `PLAYER2-03` Criar rivalidades calculadas.
- [ ] `PLAYER2-04` Criar conquistas e marcos.
- [ ] `PLAYER2-05` Criar controles de privacidade de disponibilidade.
- [ ] `MATCH2-01` Integrar dados do bolão já fechados.
- [ ] `MATCH2-02` Integrar Central ao Vivo.
- [ ] `LEAGUE2-01` Explicar critérios de desempate.
- [ ] `LEAGUE2-02` Criar evolução por rodada.
- [ ] `LEAGUE2-03` Criar simulador de cenários.
- [ ] `LEAGUE2-04` Melhorar bracket móvel.
- [ ] `STATS2-01` Criar filtros por temporada, período e adversário.
- [ ] `STATS2-02` Criar médias de placar.
- [ ] `STATS2-03` Criar recordes históricos.
- [ ] `STATS2-04` Comparar até três jogadores.
- [ ] `STATS2-05` Exibir tamanho da amostra.
- [ ] `STATS2-06` Exportar estatística para card.

Critério de saída: números oficiais contam uma narrativa compreensível e não induzem conclusões sem amostra.

## Fase 7 — Conteúdo, temporadas e premiações

Objetivo: transformar os acontecimentos em memória e divulgação.

- [ ] `CONTENT2-01` Criar pré-jogo automático como rascunho.
- [ ] `CONTENT2-02` Criar resumo semanal como rascunho.
- [ ] `CONTENT2-03` Criar agendamento de publicação.
- [ ] `CONTENT2-04` Criar busca e filtros de notícias.
- [ ] `CONTENT2-05` Criar histórico editorial.
- [ ] `CARD2-01` Criar pacote pós-jogo.
- [ ] `CARD2-02` Criar cards do bolão.
- [ ] `CARD2-03` Criar exportação em lote.
- [ ] `CARD2-04` Criar QR Code opcional.
- [ ] `SEASON2-01` Criar narrativa de temporada.
- [ ] `SEASON2-02` Criar ranking histórico de títulos.
- [ ] `SEASON2-03` Criar galeria de campeões.
- [ ] `AWARD2-01` Criar etapas de indicação e votação.
- [ ] `AWARD2-02` Criar política de resultado oculto.
- [ ] `AWARD2-03` Criar cards de indicados e vencedores.

Critério de saída: resultados relevantes podem virar conteúdo revisável e arquivo histórico sem publicação automática.

## Fase 8 — Comunidade, PWA e notificações

Objetivo: aumentar retorno e participação com consentimento e moderação.

- [ ] `COMMUNITY2-01` Criar respostas encadeadas.
- [ ] `COMMUNITY2-02` Limitar profundidade.
- [ ] `COMMUNITY2-03` Criar posts fixados.
- [ ] `COMMUNITY2-04` Vincular posts a partida e temporada.
- [ ] `COMMUNITY2-05` Criar edição identificada.
- [ ] `COMMUNITY2-06` Ampliar moderação e auditoria.
- [ ] `PWA-01` Criar manifest.
- [ ] `PWA-02` Criar service worker.
- [ ] `PWA-03` Criar leitura offline pública.
- [ ] `PWA-04` Evitar cache de respostas privadas.
- [ ] `NOTIFY-01` Criar consentimento explícito.
- [ ] `NOTIFY-02` Criar preferências por tipo.
- [ ] `NOTIFY-03` Notificar próximo fechamento.
- [ ] `NOTIFY-04` Notificar início e resultado.
- [ ] `NOTIFY-05` Criar revogação simples.

Critério de saída: instalação e notificações são opcionais, privadas e não comprometem o funcionamento básico.

## Fase 9 — Hardening e preparação para teste do usuário

Objetivo: entregar o working tree pronto para avaliação, sem versionar ou publicar.

- [ ] `HARD-01` Executar compilação Python.
- [ ] `HARD-02` Executar `node --check` em todos os JavaScripts.
- [ ] `HARD-03` Executar testes de domínio.
- [ ] `HARD-04` Executar testes de APIs.
- [ ] `HARD-05` Executar migração sobre cópia do banco.
- [ ] `HARD-06` Comparar contagens antes/depois.
- [ ] `HARD-07` Executar `PRAGMA integrity_check`.
- [ ] `HARD-08` Testar SQLite.
- [ ] `HARD-09` Testar compatibilidade PostgreSQL quando ambiente estiver disponível.
- [ ] `HARD-10` Testar múltiplos administradores.
- [ ] `HARD-11` Testar duas abas do mesmo participante.
- [ ] `HARD-12` Testar fechamento simultâneo com envio de palpite.
- [ ] `HARD-13` Testar voltar/avançar.
- [ ] `HARD-14` Testar offline e reconexão.
- [ ] `HARD-15` Testar 320, 390, 768 e 1440 px.
- [ ] `HARD-16` Testar teclado, foco, zoom e movimento reduzido.
- [ ] `HARD-17` Executar auditoria Impeccable.
- [ ] `HARD-18` Executar `git diff --check`.
- [ ] `HARD-19` Revisar ausência de segredos e dados de usuários.
- [ ] `HARD-20` Gerar relatório local de implementação e testes.
- [ ] `HARD-21` Confirmar que nenhum commit ou push foi realizado.

Critério de saída: todas as funcionalidades estão disponíveis localmente para o usuário testar e o Git contém somente alterações não commitadas.

## 17. Dependências

```text
Fundação e contratos
├── Administração do bolão
│   └── Meu Bolão
│       └── Rankings, temporadas e conquistas
├── Central ao Vivo
│   ├── Home personalizada
│   ├── Confronto
│   └── Conteúdo pós-jogo
├── Agenda ampliada
└── Competição e inteligência
    ├── Cards
    ├── Temporadas
    └── Premiações

Comunidade existente
└── Respostas e vínculos
    └── Notificações opcionais

Hardening depende de todas as fases selecionadas para a entrega.
```

## 18. Estratégia de paralelismo com agents

Há quatro slots totais, incluindo o agente principal. Utilizar todos quando houver tarefas independentes.

## 18.1 Papéis recomendados

### Agente principal — integração

Responsabilidades:

- manter o goal e o plano;
- ler integralmente instruções e SDD;
- distribuir fases;
- impedir conflito de arquivos;
- revisar decisões de domínio;
- integrar trabalho;
- executar gate final;
- não executar commit nem push.

### Agent A — backend, banco e APIs

Arquivos exclusivos enquanto ativo:

- `server.py`
- `database.py`
- `api/index.py`
- scripts Python de migração e testes de API.

Responsabilidades:

- migrações;
- regras server-side;
- transações;
- auditoria;
- endpoints;
- segurança;
- compatibilidade SQLite/PostgreSQL.

### Agent B — bolão

Arquivos exclusivos enquanto ativo:

- `bolao.html`
- `bolao.js`
- novo módulo `betting-domain.js`, se acordado;
- novo CSS específico do bolão, se criado;
- testes JavaScript exclusivos do bolão.

Responsabilidades:

- Meu Bolão;
- palpites;
- histórico;
- rankings;
- estados de UI;
- acessibilidade da página.

### Agent C — experiência geral

Arquivos exclusivos enquanto ativo:

- `index.html`
- `app.js`
- `styles.css`
- módulos públicos novos acordados.

Responsabilidades:

- Central ao Vivo;
- home;
- agenda;
- jogadores;
- Liga;
- estatísticas;
- conteúdo;
- comunidade.

### Agent D — auditoria

Quando os outros três slots estiverem ocupados, o agente principal assumirá revisão. Em ondas posteriores, liberar um slot para um agent de QA somente leitura:

- não editar arquivos pertencentes a outro agent;
- criar checklist e testes isolados;
- inspecionar acessibilidade, segurança, migração e regressões;
- informar problemas ao agente principal.

## 18.2 Regras de conflito

- Somente um agent edita `server.py`.
- Somente um agent edita `app.js`.
- Somente um agent edita `styles.css`.
- Nenhum agent faz commit.
- Nenhum agent desfaz mudanças de outro.
- Mudanças cruzadas devem ser solicitadas ao proprietário do arquivo.
- Antes de trocar a propriedade de um arquivo, o agent anterior deve estar concluído ou interrompido.
- Agents devem registrar contratos e decisões em mensagens ao principal.

## 18.3 Ondas recomendadas

### Onda 1

- Backend: Fundação e migrações.
- Bolão: especificação do domínio e estrutura de UI sem depender das APIs finais.
- Experiência: Central ao Vivo e home em análise/estrutura, sem assumir contrato instável.

### Onda 2

- Backend: APIs administrativas e participante.
- Bolão: Meu Bolão e palpites.
- Experiência: Central ao Vivo.

### Onda 3

- Backend: temporadas, rankings e notificações.
- Bolão: rankings, conquistas e histórico.
- Experiência: home, Agenda e competição.

### Onda 4

- Backend: comunidade e conteúdo complementar.
- Bolão: refinamento responsivo e acessível.
- Experiência: conteúdo, temporadas e premiações.

### Onda 5

- QA: regressão e segurança.
- Agentes proprietários: correções por arquivo.
- Principal: integração, validação visual e relatório.

## 19. Segurança e privacidade

- PIN nunca será armazenado em texto puro.
- Tokens continuarão armazenados somente como hash no banco.
- Endpoints de participante terão rate limit.
- Ajustes de saldo exigirão autenticação e motivo.
- Odds e retorno serão recalculados no servidor.
- Fechamento será validado na transação da aposta.
- Resultado e apuração não confiarão em dados do navegador.
- Perfil público do apostador será opt-in.
- Distribuição de palpites respeitará a política configurada.
- Service worker nunca armazenará respostas privadas, tokens ou conteúdo administrativo.
- Push notification exigirá consentimento e revogação.
- Conteúdo comunitário será escapado.
- Denúncias entrarão na fila de moderação, sem censura automática.
- Toda correção administrativa relevante terá auditoria.

## 20. Acessibilidade

- WCAG AA.
- Áreas de toque de pelo menos 44 × 44 px quando possível.
- Foco visível.
- Ordem de tabulação previsível.
- `aria-live` somente para atualizações importantes.
- Contagem regressiva não será anunciada a cada segundo.
- Estado aberto/fechado não dependerá apenas de cor.
- Gráficos terão tabela ou resumo textual.
- Diálogos devolverão foco ao acionador.
- Atualização automática não roubará foco.
- Modo telão terá contraste e escala adequados.
- Layout funcionará com zoom de 200%.
- Movimento respeitará `prefers-reduced-motion`.

## 21. Desempenho

- Evitar recarregar estado completo a cada interação.
- Atualizações do bolão deverão preservar formulários ativos.
- Rankings serão paginados ou limitados quando necessário.
- Histórico usará cursor.
- Gráficos serão calculados uma vez por snapshot.
- Imagens terão dimensões e formatos limitados.
- Service worker usará cache versionado.
- Central ao Vivo deverá fazer polling adaptativo ou atualização eficiente.
- Aba em background reduzirá frequência de sincronização.
- Conteúdo principal permanecerá funcional sem JavaScript de notificações.

## 22. Estratégia de testes

## 22.1 Domínio do bolão

- regra recreativa antiga;
- perda integral;
- perda parcial;
- odd fixa;
- odd comunitária sem apostas;
- odd comunitária com divisão igual;
- odd mínima e máxima;
- alteração de aposta;
- fechamento por horário;
- fechamento por início;
- fechamento manual;
- simultaneidade no instante de fechamento;
- adiamento;
- cancelamento;
- substituição de jogador;
- resultado corrigido;
- apuração repetida;
- arredondamento;
- saldo insuficiente;
- limite por rodada;
- temporada arquivada.

## 22.2 Migração

- banco vazio;
- banco atual real copiado;
- banco já migrado;
- apostas antigas abertas;
- apostas antigas concluídas;
- perfis inativos;
- caracteres acentuados;
- rollback após erro;
- contagens idênticas;
- integridade do banco;
- compatibilidade de backup.

## 22.3 APIs

- autenticação;
- autorização;
- validação;
- rate limit;
- privacidade;
- paginação;
- conflito;
- duas requisições simultâneas;
- reprocessamento;
- suspensão de participante;
- alteração de regras;
- dados públicos sem notas internas.

## 22.4 Interface

- visitante;
- participante;
- administrador;
- primeiro acesso;
- sem partidas;
- sem apostas;
- temporada encerrada;
- partida fechando;
- erro durante confirmação;
- sessão expirada;
- reconexão;
- atualização em outra aba;
- voltar/avançar;
- teclado;
- leitor de tela básico;
- 320, 390, 768 e 1440 px.

## 22.5 Regressão

- login administrativo;
- campeonato;
- geração de liga;
- agenda;
- próximo jogo;
- destaques;
- placar;
- ranking;
- perfis;
- confronto;
- estatísticas;
- notícias;
- cards;
- temporadas;
- premiações;
- reações;
- mural;
- exportação e importação;
- execução local e serverless.

## 23. Critérios de aceite principais

### Bolão

- Modo atual continua funcionando sem alteração de resultado.
- Participante sabe quanto pode ganhar ou perder antes de confirmar.
- Aposta encerrada mantém as regras aceitas.
- Fechamento do servidor não pode ser contornado pelo frontend.
- A apuração é idempotente.
- Correção de resultado é auditável.
- Rankings por período não alteram o ranking oficial do campeonato.
- Encerrar temporada não apaga histórico.

### Central ao Vivo

- Partida em andamento fecha palpites.
- Página pública reflete a partida correta.
- Distribuição respeita a política de visibilidade.
- Reconexão não duplica eventos.
- Finalização leva ao resultado oficial.

### Demais áreas

- Home continua útil sem perfil do bolão.
- Agenda continua independente da ordem das rodadas.
- Estatísticas são derivadas de resultados oficiais.
- Notícias e cards permanecem como rascunho até confirmação.
- Comunidade mantém moderação e rate limit.
- Nenhuma área perde rotas ou funcionalidades existentes.

### Git e entrega

- Nenhum commit novo.
- Nenhum push.
- Nenhuma tag.
- Working tree contém todas as alterações para teste.
- `git diff --check` passa.
- Relatório lista todos os arquivos e testes.

## 24. Definição de pronto

Uma task estará pronta quando:

- implementação funcional concluída;
- compatibilidade antiga preservada;
- estado vazio, carregamento e erro tratados;
- regras validadas no servidor;
- testes relevantes adicionados e executados;
- desktop e mobile verificados;
- acessibilidade revisada;
- dados reais não foram descartados;
- documentação atualizada;
- diff revisado;
- nenhum commit ou push realizado.

Uma fase somente estará pronta quando seu critério de saída for demonstrável em banco temporário e navegador.

## 25. Gate final obrigatório

Executar ao menos:

```powershell
python -m py_compile server.py database.py api/index.py
```

Executar `node --check` em todos os arquivos JavaScript.

Executar:

- testes existentes;
- novos testes de domínio;
- novos testes das APIs;
- testes de migração;
- `git diff --check`;
- validação visual no navegador;
- auditoria de acessibilidade;
- inspeção de segredos e dados privados;
- `git status --short --branch`.

O relatório final deverá declarar explicitamente:

- “Nenhum commit foi criado.”
- “Nenhum push foi realizado.”
- “As alterações permanecem locais para teste.”

## 26. Entrega esperada ao usuário

Ao finalizar, apresentar:

- fases concluídas;
- tasks concluídas;
- migrações criadas;
- backup utilizado;
- arquivos alterados e novos;
- testes executados;
- screenshots ou rotas validadas;
- problemas encontrados e corrigidos;
- limitações restantes;
- passos de teste manual;
- estado final do Git;
- confirmação de ausência de commit e push.
