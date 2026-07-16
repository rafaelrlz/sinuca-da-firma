# Prompt para a próxima sessão limpa

Trabalhe no projeto:

`C:\Users\RLZ\Desktop\campeonato-sinuca-local-v5`

Quero que você implemente integralmente o SDD:

`C:\Users\RLZ\Desktop\campeonato-sinuca-local-v5\SDD-CAMPEONATO-VIVO-E-BOLAO-2.md`

Use o skill `impeccable` para orientar UX, interface, responsividade, acessibilidade e qualidade visual.

Crie um goal para concluir todo o SDD e trabalhe com persistência até finalizar todas as fases previstas. Autorizo explicitamente o uso de subagents em paralelo.

## Regra absoluta de versionamento desta sessão

Esta implementação será testada localmente antes de qualquer publicação.

- NÃO execute `git add`.
- NÃO crie commits.
- NÃO execute `git push`.
- NÃO crie tags.
- NÃO abra pull request.
- NÃO altere o histórico Git.
- Deixe todas as mudanças no working tree para que eu possa testar.
- Comandos Git somente de leitura, como `status`, `diff`, `log` e `show`, são permitidos.
- Ao final, confirme explicitamente que não houve commit nem push.

## Antes de começar

Leia completamente:

- `AGENTS.md`
- `SDD-CAMPEONATO-VIVO-E-BOLAO-2.md`
- `SDD-EXPANSAO-DO-SITE.md`
- `PRODUCT.md`
- `DESIGN.md`
- `ANALISE-MELHORIAS.md`
- `README.md`
- `TESTES-EXPANSAO.md`

Depois:

1. Inspecione todo o código relevante.
2. Inspecione `git status`, `git diff` e o histórico recente.
3. Considere os dois novos documentos de planejamento como alterações legítimas do usuário.
4. Preserve todas as funcionalidades e os dados existentes.
5. Não inclua nem manipule `.impeccable/critique/` como código do produto.
6. Não altere o banco real antes de criar backup.
7. Use banco copiado ou ambiente temporário em testes destrutivos.
8. Não faça perguntas quando uma decisão segura puder ser inferida do SDD e do código.

## Organização dos subagents

Use todos os slots quando existirem tarefas independentes.

### Agent de backend

Responsável exclusivamente por:

- `server.py`
- `database.py`
- `api/index.py`
- migrações;
- testes Python e APIs;
- segurança e compatibilidade SQLite/PostgreSQL.

### Agent do bolão

Responsável exclusivamente por:

- `bolao.html`
- `bolao.js`
- módulos e CSS novos exclusivos do bolão;
- testes JavaScript do domínio do bolão.

### Agent da experiência geral

Responsável exclusivamente por:

- `index.html`
- `app.js`
- `styles.css`
- Central ao Vivo;
- home, Agenda, jogadores, Liga, estatísticas, conteúdo e comunidade.

### Agent de revisão

Deve atuar preferencialmente sem editar arquivos pertencentes aos outros:

- revisar acessibilidade;
- revisar responsividade;
- revisar segurança;
- revisar migração;
- testar regressões;
- enviar problemas ao agente principal.

O agente principal deve:

- manter o goal e o plano atualizados;
- impedir conflitos de arquivos;
- revisar todo o trabalho;
- integrar contratos entre frontend e backend;
- executar os testes finais;
- nunca criar commit ou push.

Somente um agent pode editar `server.py`, `app.js` ou `styles.css` por vez. Agents não podem desfazer mudanças uns dos outros.

## Prioridades

Siga as dependências do SDD:

1. Fundação, contratos e migração segura.
2. Integridade e administração do bolão.
3. Meu Bolão e experiência de palpites.
4. Rankings, temporadas e conquistas do bolão.
5. Central ao Vivo.
6. Home personalizada e Agenda ampliada.
7. Jogadores, confrontos, Liga, Ranking e Estatísticas.
8. Notícias, cards, temporadas, Hall da Fama e premiações.
9. Comunidade, PWA e notificações.
10. Hardening, regressão e preparação para meu teste manual.

O bolão merece atenção especial, mas nenhuma área do SDD pode ser ignorada.

## Regras indispensáveis do bolão

- O modo atual `refund`, em que o erro devolve fichas, continua sendo o padrão.
- Modos competitivos são opcionais.
- Toda aposta salva snapshot das regras e da odd aceita.
- Mudança de configuração não altera aposta encerrada.
- Fechamento é validado no servidor.
- Partida em andamento sempre fecha apostas.
- Resultado oficial é a única fonte para apuração.
- Apuração deve ser idempotente.
- Correção de resultado deve ser auditável.
- Cancelamento ou troca de participantes deve anular apostas incompatíveis.
- Temporadas não podem apagar histórico.
- Tudo continua exclusivamente virtual, sem dinheiro, pagamento ou saque.
- A interface não pode parecer cassino ou casa de apostas.

## Requisitos de execução

- Não pare no planejamento.
- Implemente código funcional.
- Trabalhe em fases pequenas e verificáveis.
- Atualize o plano após cada fase.
- Preserve backups e dados antigos.
- Trate vazio, carregamento, erro, timeout, offline e servidor indisponível.
- Teste público, participante do bolão e administrador.
- Teste desktop e mobile, incluindo 320 px.
- Teste voltar/avançar.
- Teste múltiplos administradores.
- Teste duas abas do participante.
- Teste concorrência no instante do fechamento.
- Teste migrações sem descartar dados.
- Teste SQLite e mantenha compatibilidade PostgreSQL.
- Faça validação visual no navegador.
- Use o design system existente.

Execute ao menos:

- `python -m py_compile server.py database.py api/index.py`
- verificação de sintaxe de todos os JavaScripts com `node --check`;
- testes existentes;
- novos testes de domínio e APIs;
- testes de migração;
- comparação das contagens do banco;
- `PRAGMA integrity_check` na cópia SQLite;
- `git diff --check`;
- auditoria Impeccable;
- busca por segredos, bancos e dados privados no diff.

## Entrega final

Entregue um relatório contendo:

- fases e tasks concluídas;
- migrações realizadas;
- backup e bancos temporários usados;
- arquivos principais alterados;
- testes executados e resultados;
- funcionalidades disponíveis;
- rotas e viewports validados;
- limitações restantes;
- roteiro para meu teste manual;
- saída resumida de `git status`;
- confirmação literal: “Nenhum commit foi criado.”
- confirmação literal: “Nenhum push foi realizado.”
- confirmação literal: “As alterações permanecem locais para teste.”

Comece imediatamente e não aguarde nova confirmação.
