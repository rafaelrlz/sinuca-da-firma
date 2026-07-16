# Relatório local — Campeonato Vivo e Bolão 2.0

Data: 16 de julho de 2026

## Escopo concluído

- Fundação e migrações seguras do bolão 2.0.
- Regras configuráveis, snapshots, odds, fechamento e apuração auditável.
- Administração do bolão, participantes, controles por partida e temporadas.
- Meu Bolão, palpites, histórico, rankings, desempenho, conquistas e perfil opt-in.
- Central ao Vivo pública, administrativa e modo telão.
- Home contextual, Agenda em lista/semana/mês e aprofundamento competitivo.
- Conteúdo, comunidade encadeada, PWA e notificações opcionais.
- Hardening de concorrência, privacidade, acessibilidade e responsividade.

## Migrações

- `betting_v2`
- `betting_v2_season_key`

As migrações são idempotentes, preservam apostas antigas e registram marcadores em `schema_migrations`. O backfill usa temporada legada, modo `refund`, devolução de 100% e odd `2.0`.

## Segurança dos dados

- Banco real não foi migrado durante os testes.
- Backup: `data/migration-backups/campeonato-pre-betting-v2-20260716-100701.db`
- SHA-256: `98CFEF92705290367A6D30E457C7A3C0DC18AA8A233B9AA1377B89CBA7769089`
- Banco final de teste: `data/test-betting-final-20260716-102828/campeonato.db`
- Integridade final: `ok`
- Contagens essenciais preservadas: `app_state=1`, `bettors=6`, `bets=18`, `news_articles=1`, `community_posts=0`.

## Testes executados

- `python -m py_compile server.py database.py api/index.py`
- `python scripts/test_expansion_api.py`
- `python scripts/test_betting_balance_migration.py`
- `python scripts/test_betting_v2.py`
- `node scripts/test_expansion_domain.js`
- `node scripts/test_league_bye_expansion.js`
- `node scripts/test_betting_domain.js`
- `node --check` em todos os arquivos JavaScript.
- Inicialização dupla e migração sobre cópia do banco.
- Comparação de contagens e `PRAGMA integrity_check`.
- Corrida entre fechamento e envio de palpite.
- Cancelamento com timeline preservada.
- Múltiplas temporadas e rankings por escopo.
- `git diff --check`.
- Busca por segredos, bancos e dados privados no código alterado.
- Auditoria Impeccable e revisão independente.

## Validação visual

- `/` em 320 e 1440 px.
- `/bolao` em 390 px.
- `/#live` em 768 px.
- `/#betting-admin` em 320 e 1440 px.
- Cache Storage inspecionado após login administrativo: somente arquivos estáticos públicos, sem URLs `/api/`.

Screenshots locais ignorados pelo Git:

- `validation-home-320.png`
- `validation-home-1440.png`
- `validation-bolao-390.png`
- `validation-live-768.png`
- `validation-admin-betting-320.png`
- `validation-admin-betting-1440.png`

## Limitações conhecidas

- A compatibilidade PostgreSQL/Neon foi mantida no SQL e nos locks, mas não houve teste runtime porque nenhuma `DATABASE_URL` de teste estava disponível.
- O envio Web Push externo depende de configuração de chave pública/VAPID e serviço de entrega. Consentimento, preferências, assinatura/revogação e persistência estão preparados; sem chave, a interface informa que o recurso não está configurado.

## Estado de versionamento

Nenhum commit foi criado.

Nenhum push foi realizado.

As alterações permanecem locais para teste.
