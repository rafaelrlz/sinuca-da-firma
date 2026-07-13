# Migração segura do campeonato para Vercel + Neon

Este procedimento copia o campeonato existente. Ele **não gera uma nova liga** e não altera os IDs dos duelos.

## Inventário de referência

Conferido em 13/07/2026 antes da publicação:

- 11 jogadores;
- 11 rodadas;
- 55 duelos, todos com ID único;
- 2 resultados de liga;
- 6 perfis no bolão;
- 18 apostas;
- assinatura SHA-256 dos duelos: `c97eca66f0beb453cc5fdfa5a8bc8d91913873d40f20791534a8b31c14c0cfc2`.

O arquivo `data/campeonato-pre-duelo-unico-20260713-133416.db` é o backup anterior à mudança do placar. Não o apague.

## 1. Congelar a origem

1. Não registre placares durante a migração.
2. Encerre o servidor local com `Ctrl+C`.
3. Não clique em **Gerar liga** ou em qualquer ação que recrie confrontos.

## 2. Auditar o SQLite sem alterar nada

```powershell
python scripts/migrate_sqlite_local.py --report data/migration-report-current.json
```

Confirme no relatório os valores do inventário e a mesma assinatura SHA-256. `changedResultIds` informa quais placares antigos seriam convertidos de 2 × 0 para 1 × 0. Vencedor, bolas matadas, jogadores, rodadas e IDs permanecem iguais.

Se houver normalização pendente, aplique-a assim:

```powershell
python scripts/migrate_sqlite_local.py --apply --report data/migration-report-applied.json
```

O comando cria outro backup consistente em `data/migration-backups/` antes de gravar.

## 3. Preparar o Neon

Copie a connection string do Neon sem publicá-la no Git e sem enviá-la em mensagens:

```powershell
python -m pip install -r requirements.txt
$env:DATABASE_URL = "COLE_A_CONNECTION_STRING_DO_NEON_AQUI"
```

## 4. Simular a cópia para o Neon

```powershell
python scripts/migrate_sqlite_to_neon.py
```

Esse comando somente mostra o manifesto esperado. Confira novamente jogadores, rodadas, 55 duelos, resultados, perfis, apostas e o hash.

## 5. Copiar e validar dentro de uma transação

```powershell
python scripts/migrate_sqlite_to_neon.py --apply
```

O utilitário grava e relê tudo no Neon, comparando:

- a assinatura de cada duelo: rodada, ID, jogador A e jogador B;
- os IDs dos jogadores e resultados;
- as partidas em andamento;
- os IDs dos perfis do bolão;
- as chaves e IDs das apostas;
- o estado completo, incluindo vencedor e bolas matadas.

O `commit` só acontece se tudo conferir. Qualquer diferença provoca rollback.

## 6. Configurar e publicar na Vercel

Configure para Production, Preview e Development:

- `DATABASE_URL`: connection string do Neon;
- `SINUCA_ADMIN_USER`: usuário administrativo;
- `SINUCA_ADMIN_PASSWORD`: senha longa e exclusiva.

Depois publique o repositório. O `vercel.json` já direciona `/api/*` para a função Python.

## 7. Conferência final

1. Confira classificação, bolas matadas e algumas rodadas na área pública.
2. Verifique especialmente os dois duelos que já possuem resultado.
3. Como admin, marque um duelo pendente como **Em andamento**.
4. No bolão, confirme que ele ficou bloqueado e que palpites existentes continuam visíveis.
5. Encerre o estado de andamento se o teste não corresponder a uma partida real.

Mantenha o SQLite e os backups locais até o campeonato terminar.
