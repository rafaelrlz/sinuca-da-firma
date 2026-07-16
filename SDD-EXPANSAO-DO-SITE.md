# SDD — Expansão da Sinuca da Firma

**Status:** Proposto
**Versão:** 1.0
**Data:** 16 de julho de 2026
**Produto:** Sinuca da Firma
**Documento relacionado:** `ANALISE-MELHORIAS.md`

## 1. Objetivo

Este documento define o plano técnico e de produto para ampliar o site com agenda flexível, perfis públicos, confrontos diretos, estatísticas, cards de compartilhamento, temporadas históricas, premiações e novas formas de participação.

A prioridade central é permitir que o administrador escolha manualmente o próximo jogo e os confrontos em destaque. A tabela da liga continuará organizada em rodadas, mas a ordem real das partidas poderá variar conforme a disponibilidade dos jogadores.

## 2. Contexto

O campeonato não segue necessariamente a sequência numérica das rodadas. Em um dia podem estar disponíveis jogadores de rodadas diferentes, enquanto outros confrontos precisam ser adiados.

O sistema deve separar três conceitos:

- **Tabela da liga:** define todos os confrontos obrigatórios e suas rodadas.
- **Agenda real:** registra quando e onde uma partida poderá acontecer.
- **Programação editorial:** determina qual jogo aparece como próximo ou em destaque no site.

Essa separação evita que a organização precise alterar a tabela oficial apenas porque os jogadores não estão disponíveis na ordem prevista.

## 3. Metas

- Permitir que o administrador escolha qualquer partida pendente como próximo jogo.
- Permitir até três jogos em destaque, independentemente da rodada.
- Registrar disponibilidade dos jogadores sem bloquear decisões administrativas.
- Criar uma agenda pública confiável.
- Dar identidade e histórico a cada jogador.
- Transformar resultados em estatísticas, notícias e conteúdo compartilhável.
- Preservar temporadas anteriores.
- Aumentar a participação por meio de votações, reações e comentários.
- Manter a administração rápida e adequada ao funcionamento atual sem dependências externas no frontend.

## 4. Não objetivos

- Não transformar o sistema em uma plataforma profissional de reservas.
- Não exigir que cada jogador tenha login.
- Não impedir uma partida por conflito de disponibilidade; o sistema apenas alertará.
- Não mudar automaticamente os confrontos definidos pela liga.
- Não permitir apostas com dinheiro, pagamentos ou premiações financeiras.
- Não criar uma aparência de cassino, rede social aberta ou aplicativo gamer.

## 5. Decisões principais

### 5.1 Próximo jogo e jogos em destaque

- Existirá apenas **um próximo jogo oficial** por vez.
- Poderão existir até **três jogos em destaque**.
- O próximo jogo pode também estar entre os destaques.
- Somente partidas pendentes com dois jogadores definidos poderão ser escolhidas.
- A escolha não dependerá do número da rodada.
- Uma partida concluída será removida automaticamente da programação futura.
- Se o próximo jogo for concluído, o site não escolherá outro automaticamente. O administrador receberá uma pendência para selecionar o seguinte.
- O administrador poderá substituir o próximo jogo a qualquer momento.

### 5.2 Disponibilidade

- A disponibilidade será informada pelo administrador.
- Os estados iniciais serão:
  - Disponível
  - Talvez
  - Indisponível
  - Não informado
- A disponibilidade poderá ter início, fim e observação.
- Conflitos gerarão avisos, mas o administrador poderá confirmar a programação.
- Na primeira versão, jogadores não terão login para informar disponibilidade diretamente.

### 5.3 Agenda e rodadas

- Rodada continuará sendo um agrupamento esportivo e critério de organização.
- Data, horário, local e prioridade serão atributos independentes.
- A agenda pública será ordenada por:
  1. partida em andamento;
  2. próximo jogo definido;
  3. partidas com data marcada;
  4. jogos em destaque sem data;
  5. demais partidas pendentes.

### 5.4 Arquitetura de dados

Será adotada uma arquitetura híbrida:

- Estado competitivo e programação corrente permanecerão no JSON principal do campeonato, preservando backup e sincronização existentes.
- Conteúdo social, perfis com imagem, temporadas arquivadas e votações usarão tabelas próprias no banco.
- Estatísticas serão calculadas a partir dos resultados oficiais, evitando duplicação.

## 6. Arquitetura de informação

### 6.1 Menu público recomendado

- Início
- Liga
- Agenda
- Ranking
- Jogadores
- Bolão
- Notícias

### 6.2 Destinos secundários

Estas páginas não precisam ocupar permanentemente o menu principal:

- Estatísticas
- Comparar jogadores
- Página do confronto
- Hall da Fama
- Temporadas
- Premiações
- Regras

Elas serão acessadas por botões contextuais na página inicial, no ranking, nos perfis e nas notícias.

### 6.3 Menu administrativo recomendado

**Competição**

- Visão geral
- Operar rodada
- Agenda
- Jogadores
- Liga
- Ranking
- Estatísticas
- Temporadas

**Conteúdo**

- Bolão
- Notícias
- Premiações
- Cards para compartilhar

**Sistema**

- Configurações
- Histórico
- Backup

## 7. Modelo de dados

## 7.1 Programação da liga

Adicionar ao objeto `state.league`:

```json
{
  "programming": {
    "nextMatchId": "league-match-123",
    "featuredMatchIds": [
      "league-match-123",
      "league-match-456"
    ],
    "matches": {
      "league-match-123": {
        "scheduledAt": "2026-07-18T17:30:00-03:00",
        "location": "Sala de jogos",
        "status": "scheduled",
        "priority": 1,
        "note": "Confirmado com os dois jogadores",
        "updatedAt": "2026-07-16T14:00:00-03:00",
        "updatedBy": "admin"
      }
    }
  }
}
```

Estados possíveis:

- `unscheduled`
- `scheduled`
- `postponed`
- `cancelled`

Partidas concluídas continuarão sendo identificadas pelo resultado oficial, não por um estado duplicado na agenda.

## 7.2 Disponibilidade

Adicionar ao estado principal:

```json
{
  "availability": {
    "player-1": [
      {
        "id": "availability-uuid",
        "status": "available",
        "startsAt": "2026-07-18T08:00:00-03:00",
        "endsAt": "2026-07-18T18:00:00-03:00",
        "note": "Disponível após as 14h",
        "updatedAt": "2026-07-16T14:00:00-03:00",
        "updatedBy": "admin"
      }
    ]
  }
}
```

Regras:

- Entradas antigas poderão ser removidas automaticamente após um período configurável.
- Ausência de registro significa “Não informado”.
- Sobreposições deverão ser consolidadas na interface.

## 7.3 Perfis públicos

Nova tabela `player_profiles`:

- `player_id`
- `display_name`
- `bio`
- `nickname`
- `image_data`
- `image_type`
- `favorite_shot`
- `joined_at`
- `created_at`
- `updated_at`

O nome competitivo continuará vindo do estado oficial. O perfil apenas complementará o jogador.

## 7.4 Temporadas

Nova tabela `season_archives`:

- `id`
- `title`
- `started_at`
- `ended_at`
- `champion_player_id`
- `runner_up_player_id`
- `snapshot_json`
- `summary`
- `created_by`
- `created_at`

O `snapshot_json` armazenará jogadores, tabela, resultados, ranking final, premiações e configurações relevantes.

## 7.5 Premiações e votações

Novas tabelas:

### `polls`

- `id`
- `type`
- `title`
- `description`
- `starts_at`
- `ends_at`
- `status`
- `created_by`
- `created_at`

### `poll_options`

- `id`
- `poll_id`
- `player_id`
- `match_id`
- `label`

### `poll_votes`

- `poll_id`
- `option_id`
- `visitor_id`
- `created_at`

Restrição única por enquete e visitante.

## 7.6 Reações

Nova tabela `content_reactions`:

- `content_type`
- `content_id`
- `visitor_id`
- `reaction`
- `created_at`
- `updated_at`

Reações iniciais:

- `great_match`
- `surprise`
- `played_well`
- `rematch`
- `historic`

## 7.7 Mural

Nova tabela `community_posts`:

- `id`
- `visitor_id`
- `author`
- `body`
- `status`
- `report_count`
- `created_at`

O mural deverá reutilizar proteção contra spam, denúncias e moderação já adotadas nos comentários.

## 8. APIs propostas

### 8.1 Programação e disponibilidade

Na primeira entrega, programação e disponibilidade poderão continuar usando `/api/state`, pois fazem parte do estado competitivo e dos backups.

Criar funções de domínio no frontend e no servidor para:

- normalizar programação;
- remover referências a partidas inexistentes;
- impedir partida concluída como próximo jogo;
- limitar destaques;
- validar datas;
- identificar conflitos de disponibilidade.

Em uma evolução posterior, poderão ser criadas:

- `GET /api/schedule`
- `PUT /api/schedule`
- `GET /api/availability`
- `PUT /api/availability`

Essa separação só será necessária se conflitos entre vários administradores se tornarem frequentes.

### 8.2 Perfis

- `GET /api/players/profiles`
- `GET /api/players/profile?id=...`
- `POST /api/players/profile` — administrador
- `GET /api/players/profile/image?id=...`

### 8.3 Temporadas

- `GET /api/seasons`
- `GET /api/seasons?id=...`
- `POST /api/seasons/archive` — administrador

### 8.4 Votações

- `GET /api/polls`
- `POST /api/polls` — administrador
- `POST /api/polls/vote`
- `DELETE /api/polls` — administrador

### 8.5 Reações e mural

- `POST /api/reactions`
- `GET /api/reactions?contentType=...&contentId=...`
- `GET /api/community`
- `POST /api/community`
- `POST /api/community/report`
- `DELETE /api/community` — administrador

## 9. Fluxos principais

## 9.1 Selecionar próximo jogo

1. Administrador abre “Agenda”.
2. A interface apresenta todas as partidas pendentes, sem limitar à rodada atual.
3. Administrador pesquisa ou filtra por jogador, rodada, data e disponibilidade.
4. Cada confronto mostra a disponibilidade conhecida dos dois participantes.
5. Administrador escolhe “Definir como próximo”.
6. Havendo conflito, o sistema apresenta um aviso e permite confirmar.
7. O próximo jogo anterior perde o estado automaticamente.
8. A página pública, a página inicial e o bolão passam a destacar o confronto.
9. A alteração entra no histórico com administrador e horário.

## 9.2 Destacar uma partida

1. Administrador seleciona “Adicionar aos destaques”.
2. O sistema permite no máximo três destaques.
3. Ao atingir o limite, o administrador escolhe qual destaque substituir.
4. Destaques aparecem na página inicial e na Agenda.
5. Partidas concluídas deixam a lista automaticamente, mas continuam acessíveis no histórico.

## 9.3 Agendar ou adiar

1. Administrador abre o confronto.
2. Informa data, horário, local e observação.
3. O sistema compara com disponibilidade registrada.
4. A confirmação atualiza a Agenda pública.
5. Se adiada, a partida permanece pendente e recebe indicação de adiamento.

## 9.4 Informar disponibilidade

1. Administrador abre o perfil ou Agenda.
2. Escolhe o jogador.
3. Registra período, estado e observação.
4. A informação aparece ao selecionar jogos futuros.
5. A disponibilidade nunca altera resultados ou tabela.

## 9.5 Arquivar temporada

1. Administrador seleciona “Encerrar temporada”.
2. Sistema verifica partidas pendentes.
3. Se houver pendências, exibe confirmação especial.
4. Sistema cria um snapshot imutável.
5. Temporada passa ao Hall da Fama.
6. O campeonato atual só é reiniciado após confirmação separada.

## 10. Telas e componentes

## 10.1 Agenda pública

Elementos:

- próximo jogo em destaque;
- estado “Hoje tem jogo” quando aplicável;
- partidas em andamento;
- próximos jogos com data;
- destaques ainda sem data;
- histórico recente;
- filtros por jogador e situação;
- botões “Ver confronto”, “Adicionar ao calendário”, “Ir para o bolão” e “Compartilhar”.

Estados:

- nenhuma partida programada;
- próximo jogo sem data definida;
- jogo hoje;
- jogo em andamento;
- partida adiada;
- agenda completamente concluída;
- servidor indisponível.

## 10.2 Agenda administrativa

Elementos:

- resumo do próximo jogo;
- alertas de disponibilidade;
- busca por jogador;
- filtros por rodada, status e data;
- lista de todos os confrontos pendentes;
- programação inline;
- histórico das alterações;
- ações “Definir como próximo”, “Destacar”, “Agendar”, “Adiar” e “Remover da agenda”.

A tela deve privilegiar operação inline. Modal será usado apenas para confirmação destrutiva ou conflito importante.

## 10.3 Perfil do jogador

Elementos:

- foto ou avatar;
- nome e apelido;
- posição;
- campanha;
- aproveitamento;
- bolas matadas;
- saldo;
- sequência atual;
- próximo adversário;
- últimos resultados;
- retrospecto contra adversários;
- notícias relacionadas;
- premiações.

Botões:

- Comparar jogadores
- Ver confrontos
- Compartilhar perfil
- Ir para o próximo jogo

## 10.4 Página do confronto

Elementos:

- jogadores;
- data, local e rodada;
- disponibilidade conhecida;
- retrospecto direto;
- forma recente;
- posição no ranking;
- placar, quando concluído;
- comentários e avaliação da partida;
- notícias relacionadas.

Botões:

- Adicionar ao calendário
- Compartilhar confronto
- Ir para o bolão
- Comentar resultado
- Gerar card — administrador
- Publicar notícia — administrador

## 10.5 Estatísticas

Seções:

- líderes em vitórias;
- bolas matadas;
- saldo;
- aproveitamento;
- sequência de vitórias;
- evolução por rodada;
- partidas mais equilibradas;
- maiores vitórias;
- confronto mais frequente;
- desempenho recente.

As estatísticas deverão ser derivadas dos resultados oficiais.

## 10.6 Hall da Fama

Elementos:

- campeão atual;
- campeões anteriores;
- pódios;
- recordes históricos;
- temporadas arquivadas;
- premiações;
- classificação final de cada edição.

## 10.7 Central de cards

Modelos:

- próximo confronto;
- jogo em destaque;
- resultado final;
- classificação da rodada;
- craque da rodada;
- campeão da temporada.

Na primeira versão, os cards serão gerados no navegador com Canvas e exportados em PNG. Não será necessário armazenar os arquivos no banco.

## 11. Automações recomendadas

- Ao concluir o próximo jogo, criar uma tarefa administrativa “Escolher próximo jogo”.
- Ao salvar um resultado, oferecer “Gerar notícia deste resultado”.
- O formulário de notícia deverá ser preenchido com jogadores, rodada, placar e data.
- Ao agendar uma partida, oferecer “Gerar card do confronto”.
- Ao finalizar uma rodada, oferecer abertura da votação de craque.
- Ao encerrar uma votação, registrar a premiação no perfil.
- Ao arquivar uma temporada, gerar card do campeão.

As automações deverão sugerir ações, nunca publicar ou alterar conteúdo sem confirmação.

## 12. Fases de implementação

## Fase 0 — Fundação

Objetivo: preparar contratos de dados e compatibilidade.

### Tasks

- [ ] `FOUND-01` Incrementar a versão do estado da aplicação.
- [ ] `FOUND-02` Criar normalização para `league.programming`.
- [ ] `FOUND-03` Criar normalização para disponibilidade.
- [ ] `FOUND-04` Remover automaticamente referências a partidas inexistentes.
- [ ] `FOUND-05` Preservar compatibilidade com backups antigos.
- [ ] `FOUND-06` Incluir programação e disponibilidade na exportação/importação.
- [ ] `FOUND-07` Criar helpers únicos para localizar partidas por ID.
- [ ] `FOUND-08` Criar testes manuais documentados para migração.

## Fase 1 — Agenda flexível e próximo jogo

Objetivo: resolver a operação real do campeonato.

### Backend e domínio

- [ ] `AGENDA-01` Implementar estrutura de programação no estado.
- [ ] `AGENDA-02` Implementar seleção única do próximo jogo.
- [ ] `AGENDA-03` Implementar até três jogos em destaque.
- [ ] `AGENDA-04` Implementar data, horário, local, observação e adiamento.
- [ ] `AGENDA-05` Implementar disponibilidade dos jogadores.
- [ ] `AGENDA-06` Implementar detecção de conflito com possibilidade de confirmação.
- [ ] `AGENDA-07` Remover jogos concluídos da programação futura.
- [ ] `AGENDA-08` Registrar alterações na atividade administrativa.

### Interface administrativa

- [ ] `AGENDA-09` Criar aba Agenda.
- [ ] `AGENDA-10` Listar partidas pendentes de todas as rodadas.
- [ ] `AGENDA-11` Adicionar busca por jogador.
- [ ] `AGENDA-12` Adicionar filtros por rodada, disponibilidade e situação.
- [ ] `AGENDA-13` Criar ação “Definir como próximo”.
- [ ] `AGENDA-14` Criar ação “Adicionar aos destaques”.
- [ ] `AGENDA-15` Criar formulário inline de programação.
- [ ] `AGENDA-16` Criar painel de disponibilidade.
- [ ] `AGENDA-17` Exibir alertas sem bloquear a decisão.

### Interface pública

- [ ] `AGENDA-18` Criar rota e aba pública Agenda.
- [ ] `AGENDA-19` Mostrar próximo jogo na página inicial.
- [ ] `AGENDA-20` Mostrar jogos em destaque.
- [ ] `AGENDA-21` Criar estado “Hoje tem jogo”.
- [ ] `AGENDA-22` Criar botão de calendário usando arquivo `.ics`.
- [ ] `AGENDA-23` Criar compartilhamento do confronto.
- [ ] `AGENDA-24` Integrar atalhos para o bolão.

## Fase 2 — Perfis e página do confronto

Objetivo: dar contexto e identidade aos participantes.

### Tasks

- [ ] `PROFILE-01` Criar tabela e migração de perfis.
- [ ] `PROFILE-02` Criar APIs públicas e administrativas.
- [ ] `PROFILE-03` Criar upload otimizado de foto.
- [ ] `PROFILE-04` Criar editor de perfil no admin.
- [ ] `PROFILE-05` Criar rota pública do jogador.
- [ ] `PROFILE-06` Tornar nomes do ranking clicáveis.
- [ ] `PROFILE-07` Calcular campanha e forma recente.
- [ ] `PROFILE-08` Mostrar próximo adversário.
- [ ] `PROFILE-09` Relacionar notícias ao jogador.
- [ ] `MATCH-01` Criar rota pública do confronto.
- [ ] `MATCH-02` Exibir retrospecto direto.
- [ ] `MATCH-03` Exibir posição e forma dos jogadores.
- [ ] `MATCH-04` Integrar comentários e avaliação da partida.
- [ ] `MATCH-05` Integrar agenda, bolão e compartilhamento.

## Fase 3 — Comparador e estatísticas

Objetivo: transformar resultados em narrativa competitiva.

### Tasks

- [ ] `STATS-01` Centralizar funções de cálculo estatístico.
- [ ] `STATS-02` Criar testes com zero, um e vários resultados.
- [ ] `STATS-03` Criar aba Estatísticas no admin.
- [ ] `STATS-04` Criar página pública de estatísticas.
- [ ] `STATS-05` Criar ranking de sequências.
- [ ] `STATS-06` Criar estatísticas de bolas e saldo.
- [ ] `STATS-07` Criar gráfico de evolução da posição.
- [ ] `STATS-08` Identificar partidas equilibradas e maiores vitórias.
- [ ] `COMPARE-01` Criar seletor de dois jogadores.
- [ ] `COMPARE-02` Criar comparativo de campanha.
- [ ] `COMPARE-03` Criar retrospecto direto.
- [ ] `COMPARE-04` Criar compartilhamento da comparação.

## Fase 4 — Cards e automação editorial

Objetivo: facilitar divulgação e publicação.

### Tasks

- [ ] `CARD-01` Definir formatos quadrado, vertical e horizontal.
- [ ] `CARD-02` Criar gerador Canvas reutilizável.
- [ ] `CARD-03` Criar card de próximo confronto.
- [ ] `CARD-04` Criar card de resultado.
- [ ] `CARD-05` Criar card de ranking.
- [ ] `CARD-06` Criar card de craque e campeão.
- [ ] `CARD-07` Implementar exportação PNG.
- [ ] `CARD-08` Validar nomes longos e ausência de foto.
- [ ] `NEWS-01` Criar botão “Gerar notícia do resultado”.
- [ ] `NEWS-02` Preencher título, resumo, corpo e data automaticamente.
- [ ] `NEWS-03` Manter publicação como rascunho até confirmação.
- [ ] `NEWS-04` Associar notícia a jogadores e partida.

## Fase 5 — Temporadas e Hall da Fama

Objetivo: preservar a história do campeonato.

### Tasks

- [ ] `SEASON-01` Criar tabela e migração de temporadas.
- [ ] `SEASON-02` Criar serviço de snapshot imutável.
- [ ] `SEASON-03` Criar validação de partidas pendentes.
- [ ] `SEASON-04` Criar fluxo “Encerrar temporada”.
- [ ] `SEASON-05` Separar arquivamento de restauração da nova temporada.
- [ ] `SEASON-06` Criar página pública Hall da Fama.
- [ ] `SEASON-07` Criar página de detalhes da temporada.
- [ ] `SEASON-08` Exibir campeões, pódios e ranking final.
- [ ] `SEASON-09` Calcular recordes históricos.
- [ ] `SEASON-10` Integrar notícias e premiações da temporada.

## Fase 6 — Premiações, reações e comunidade

Objetivo: aumentar a participação sem comprometer a moderação.

### Tasks

- [ ] `POLL-01` Criar tabelas e migrações de votação.
- [ ] `POLL-02` Criar gestão de enquetes no admin.
- [ ] `POLL-03` Criar votação única por visitante.
- [ ] `POLL-04` Criar craque da rodada.
- [ ] `POLL-05` Registrar vencedores no perfil.
- [ ] `REACT-01` Criar reações em notícias e confrontos.
- [ ] `REACT-02` Limitar uma reação ativa por visitante e conteúdo.
- [ ] `COMMUNITY-01` Criar mural da resenha.
- [ ] `COMMUNITY-02` Reutilizar limites de spam.
- [ ] `COMMUNITY-03` Implementar denúncias.
- [ ] `COMMUNITY-04` Criar moderação administrativa.
- [ ] `COMMUNITY-05` Criar regras e estados vazios.

## 13. Dependências

```text
Fundação
└── Agenda flexível
    ├── Página do confronto
    │   ├── Comparador
    │   └── Cards
    ├── Perfis
    │   ├── Estatísticas
    │   └── Premiações
    └── Temporadas
        └── Hall da Fama

Notícias existentes
└── Automação editorial

Comentários e visitantes existentes
├── Reações
├── Votações
└── Mural
```

## 14. Critérios de aceite principais

### Agenda

- Administrador consegue escolher como próximo jogo qualquer confronto pendente.
- A partida pode pertencer a qualquer rodada.
- Trocar o próximo jogo não altera a tabela da liga.
- É impossível manter uma partida concluída como próximo jogo.
- Até três partidas podem ser destacadas.
- Disponibilidade conflitante gera aviso, mas permite confirmação.
- Página pública reflete a mudança após sincronização.
- Agenda funciona mesmo quando nenhuma partida tem data.

### Perfis e confrontos

- Todo jogador cadastrado possui uma rota pública, mesmo sem foto ou biografia.
- Estatísticas do perfil correspondem ao ranking oficial.
- Retrospecto direto considera apenas resultados válidos.
- Exclusão ou renomeação de jogador não quebra páginas antigas da temporada atual.

### Estatísticas

- Nenhuma métrica é armazenada manualmente.
- Todos os números são derivados dos resultados.
- Empates estatísticos têm critério explícito.
- Estado sem partidas concluídas é compreensível.

### Cards

- Exportação funciona em navegadores modernos.
- Nomes longos não ultrapassam a arte.
- Ausência de foto usa avatar consistente.
- Nenhum card é publicado automaticamente.

### Temporadas

- Arquivar não remove a temporada atual.
- Snapshot pode ser consultado mesmo depois de novos jogadores e resultados.
- Reiniciar campeonato exige confirmação separada.
- Backup JSON inclui referência às temporadas ou instrução clara sobre o backup do banco.

### Participação

- Votação é limitada por visitante.
- Reações podem ser alteradas.
- Mural possui limite de tamanho e frequência.
- Conteúdo denunciado aparece na moderação.
- Exclusão administrativa fica registrada.

## 15. Segurança e privacidade

- Uploads aceitarão apenas formatos de imagem permitidos e tamanho limitado.
- Conteúdo público será escapado antes de entrar no HTML.
- APIs administrativas exigirão sessão válida.
- Votos, reações e mensagens usarão identificador anônimo já adotado nas notícias.
- Endpoints sociais terão rate limit.
- Informações de disponibilidade deverão evitar detalhes pessoais desnecessários.
- Observações públicas serão separadas das notas internas do administrador.

## 16. Acessibilidade

- Todos os fluxos deverão atender WCAG AA.
- Próximo jogo e destaques não dependerão apenas de cor.
- Filtros e seletores terão rótulos visíveis.
- Cards gerados deverão manter contraste legível.
- Gráficos terão resumo textual equivalente.
- Agenda e comparação funcionarão por teclado.
- Datas usarão marcação semântica e texto local em português.
- Movimento respeitará `prefers-reduced-motion`.

## 17. Desempenho

- Fotos de jogadores serão convertidas para WebP e limitadas em dimensões.
- Estatísticas serão calculadas uma vez por renderização e reutilizadas.
- Listas grandes usarão filtros antes de renderizar detalhes.
- Temporadas carregarão resumo primeiro e snapshot completo sob demanda.
- Cards serão gerados apenas quando solicitados.
- Novas imagens não deverão aumentar significativamente o carregamento inicial.

## 18. Estratégia de testes

### Testes de domínio

- partida de qualquer rodada como próximo jogo;
- troca de próximo jogo;
- conclusão do próximo jogo;
- destaques acima do limite;
- partida inexistente em backup antigo;
- disponibilidade conflitante;
- jogador sem disponibilidade;
- datas em fusos diferentes;
- temporada sem resultados;
- temporada com partidas pendentes;
- retrospecto sem confronto anterior;
- nomes longos e caracteres acentuados.

### Testes de interface

- público e administrador;
- desktop e mobile;
- navegação voltar/avançar;
- teclado;
- leitor de tela básico;
- servidor indisponível;
- carregamento lento;
- estados vazios;
- múltiplos administradores alterando programação.

### Testes de regressão

- geração da liga;
- registro de placar;
- ranking;
- bolão;
- notícias;
- comentários;
- avaliações;
- exportação e importação;
- autenticação com múltiplos administradores.

## 19. Estratégia de entrega

Cada fase deverá resultar em um commit e uma entrega utilizável.

Ordem recomendada:

1. Fundação e agenda administrativa.
2. Agenda pública e próximo jogo na página inicial.
3. Perfis e páginas de confronto.
4. Estatísticas e comparação.
5. Cards e automação de notícias.
6. Temporadas e Hall da Fama.
7. Premiações, reações e mural.

Não iniciar uma fase social antes de concluir moderação, limites e estados de erro correspondentes.

## 20. Definição de pronto

Uma task será considerada pronta quando:

- comportamento implementado;
- dados antigos preservados;
- erro e estado vazio tratados;
- mobile verificado;
- fluxo público e administrativo verificados;
- sintaxe Python e JavaScript validada;
- alterações no banco documentadas;
- acessibilidade básica revisada;
- critérios de aceite atendidos;
- documentação atualizada;
- commit específico criado.

## 21. Primeiro ciclo recomendado

O primeiro ciclo deverá conter apenas:

- estrutura de programação;
- seleção manual do próximo jogo;
- até três jogos em destaque;
- data, horário, local e adiamento;
- disponibilidade administrada;
- aba Agenda no admin;
- Agenda pública;
- destaque do próximo jogo na página inicial;
- botões “Ver confronto”, “Ir para o bolão”, “Adicionar ao calendário” e “Compartilhar”.

Esse ciclo resolve o problema operacional mais importante e cria a base para praticamente todas as outras funcionalidades.
