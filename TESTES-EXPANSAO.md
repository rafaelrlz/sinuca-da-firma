# Testes da expansão do site

Este roteiro valida a migração e as funcionalidades do `SDD-EXPANSAO-DO-SITE.md` sem alterar o banco real.

## Preparação segura

1. Copie `data/campeonato.db` para um diretório temporário.
2. Defina `SINUCA_DATABASE_PATH`, `SINUCA_DATA_DIR`, `SINUCA_PORT` e `NO_BROWSER=1`.
3. Use credenciais administrativas exclusivas de teste.
4. Registre as contagens de jogadores, partidas, resultados, apostas, notícias e comentários antes da inicialização.
5. Inicie o servidor duas vezes e confirme que a migração é idempotente.

## Contrato e agenda

- Importar estados antigos sem `programming`, `availability` ou `adminTasks`.
- Remover IDs inexistentes, partidas concluídas e destaques acima de três.
- Selecionar como próximo jogo confrontos de rodadas diferentes.
- Trocar o próximo jogo sem alterar as rodadas.
- Concluir o próximo jogo e confirmar que nenhum substituto é escolhido.
- Agendar, adiar, cancelar e limpar data/local/observações.
- Confirmar conflito de disponibilidade sem bloqueio.
- Conferir administrador e horário em estado e auditoria.
- Verificar que notas internas não aparecem em respostas públicas.

## Concorrência

1. Abra duas sessões administrativas na mesma revisão.
2. Salve pela sessão A.
3. Tente salvar pela sessão B.
4. Confirme HTTP `409`, estado/revisão atuais e ausência de sobrescrita.
5. Refaça a alteração sobre a revisão atual.

## Recursos ampliados

- Perfil sem foto, foto válida e upload inválido.
- Renomeação por ID e perfil após alteração do nome.
- Confronto pendente e concluído.
- Estatísticas com zero, um e vários resultados.
- Comparação sem retrospecto e com confronto direto.
- Cards com nomes longos e acentos nos três formatos.
- Rascunho de notícia associado a partida e jogadores.
- Arquivamento com e sem pendências; liga atual preservada.
- Voto duplicado, fechamento de enquete e premiação.
- Alteração e remoção de reação.
- Mural, rate limit, denúncia, ocultação e exclusão.

## Regressão e interface

- Geração e expansão incremental da liga.
- Placar rápido e diálogo de resultado.
- Ranking, bolão, notícias, comentários e avaliações.
- Exportação e importação do estado.
- Público e administrador em 1440×900, 1024×768, 390×844 e 320×568.
- Teclado, foco, zoom de 200% e movimento reduzido.
- Voltar, avançar e recarregar deep links.
- Loading, estado vazio e servidor indisponível.

## Comandos automatizados

```text
python -m py_compile server.py database.py api/index.py scripts/test_expansion_api.py
python scripts/test_expansion_api.py
python scripts/test_betting_balance_migration.py
node scripts/test_expansion_domain.js
node scripts/test_league_bye_expansion.js
node --check app.js
node --check bolao.js
node --check expansion-domain.js
node --check league-schedule.js
node --check login.js
git diff --check
```
