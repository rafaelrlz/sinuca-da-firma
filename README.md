# Campeonato de Sinuca — liga e bolão virtual

Para publicar um campeonato que já possui confrontos, resultados e apostas, siga [MIGRACAO-VERCEL-NEON.md](MIGRACAO-VERCEL-NEON.md). Não gere uma nova liga durante a migração.

Sistema para organizar o campeonato de sinuca da empresa como uma **liga por pontos, todos contra todos**.

Também foi incluído um **bolão com fichas virtuais**, sem dinheiro, pagamento ou saque.

## Endereços

Campeonato público:

```text
http://IP-DO-SERVIDOR:3000
```

Bolão virtual:

```text
http://IP-DO-SERVIDOR:3000/bolao
```

Login administrativo:

```text
http://IP-DO-SERVIDOR:3000/login
```

Defina as credenciais com `SINUCA_ADMIN_USER` e `SINUCA_ADMIN_PASSWORD`. Nunca publique a senha administrativa no repositório.

## Liga por pontos

Na aba **Liga por pontos**, o administrador gera e opera uma tabela em que cada jogador enfrenta todos os demais uma vez. A classificação completa fica na aba separada **Ranking da liga**, acessível pelo menu lateral e pelo botão **Ver ranking** da tela de partidas.

Quando a liga já estiver em andamento, novos jogadores podem ser incluídos a qualquer momento. O sistema valida toda a tabela, preserva os confrontos, IDs, resultados, bolas e apostas existentes e cria somente os jogos que faltam entre o novo participante e o elenco atual. Esses duelos aproveitam espaços livres nas rodadas existentes e, quando necessário, são adicionados em novas rodadas retroativas.

Pontuação padrão:

```text
Vitória: 3 pontos
Derrota: 0 ponto
```

Critérios de desempate:

1. pontos;
2. número de vitórias;
3. saldo de bolas;
4. total de bolas matadas;
5. ordem alfabética.

O valor da vitória pode ser alterado em **Configurações**. A derrota sempre vale 0 ponto, portanto a pontuação nunca diminui. Cada jogador possui 7 bolas comuns mais o castigo. Ao registrar a partida, informe quantas bolas cada um matou. O saldo da partida é a quantidade que o perdedor deixou na mesa, incluindo o castigo (`8 - bolas matadas pelo perdedor`): o vencedor recebe esse número como saldo positivo e o perdedor recebe o mesmo número como saldo negativo.

## Bolão com fichas virtuais

Qualquer pessoa da rede pode abrir `/bolao` e criar um perfil com:

- nome no ranking;
- PIN numérico de 4 a 8 dígitos.

Cada perfil começa com:

```text
10.000 fichas virtuais
```

Na primeira inicialização desta versão, cada perfil existente recebe um bônus único de 9.000 fichas. A migração é registrada no banco e não se repete em reinicializações ou novos deploys.

Regras padrão:

- aposta mínima: 1 ficha;
- aposta máxima por partida: 500 fichas;
- o usuário escolhe o vencedor;
- acerto paga 2× a aposta, incluindo a devolução das fichas apostadas;
- erro devolve as fichas reservadas e mantém a pontuação;
- uma aposta aberta pode ser alterada ou cancelada;
- a aposta é encerrada quando o administrador registra o placar;
- se o confronto for recriado com outros jogadores, a aposta é anulada e as fichas são devolvidas.

O ranking do bolão usa o saldo apurado das apostas encerradas. Ele apenas sobe com acertos; erros não retiram pontos. Fichas reservadas em apostas abertas aparecem separadamente.

### Administração do bolão

Quando o administrador estiver logado e abrir `/bolao`, aparecerá o botão:

```text
Zerar bolão e perfis
```

Essa ação apaga somente os perfis e apostas. Liga, jogadores e placares não são alterados.

> O bolão é exclusivamente recreativo e usa pontos virtuais. O sistema não possui depósitos, pagamentos, saque, prêmio em dinheiro ou integração financeira.

## Acesso público e administrativo

Sem login, qualquer pessoa pode:

- visualizar a classificação da liga;
- consultar rodadas e placares;
- consultar a classificação;
- participar do bolão virtual;
- exportar uma cópia JSON do campeonato.

No cabeçalho público, o item **Ranking** abre a liga já posicionado suavemente na classificação.

Somente o administrador pode:

- cadastrar, editar e excluir jogadores;
- gerar ou refazer a liga;
- registrar, editar e apagar placares;
- alterar regras e pontuação;
- importar backups;
- restaurar os dados iniciais;
- zerar os perfis e apostas do bolão.

A proteção está no servidor, e não apenas nos botões da tela.

## Como iniciar no Windows

Extraia a pasta inteira e execute:

```text
iniciar.bat
```

O sistema será aberto neste computador em:

```text
http://127.0.0.1:3000
```

A janela também exibirá o endereço de rede, por exemplo:

```text
http://192.168.1.25:3000
```

Não feche a janela do servidor enquanto as pessoas estiverem usando o sistema.

## Como iniciar no macOS ou Linux

```bash
chmod +x iniciar.sh
./iniciar.sh
```

Ou:

```bash
python3 server.py
```

## Banco persistente

No uso local, todos os dados ficam no mesmo banco SQLite:

```text
data/campeonato.db
```

O banco armazena:

- jogadores;
- configurações;
- tabela e placares da liga;
- dados legados de formatos anteriores, preservados para compatibilidade e não exibidos na interface;
- perfis do bolão;
- PINs protegidos por hash;
- fichas e apostas.

O arquivo adicional:

```text
data/backup-latest.json
```

é uma cópia legível do estado do campeonato. Para preservar também os dados do bolão, faça backup do arquivo `campeonato.db` inteiro.

## Publicar gratuitamente com Vercel + Neon

O mesmo projeto funciona em dois modos:

- localmente, com SQLite e sem instalar dependências;
- na Vercel, com a função Python em `api/index.py` e PostgreSQL no Neon.

### 1. Preparar o Neon

Crie o projeto no Neon e copie a **connection string** com `sslmode=require`. Não envie essa string por mensagem, não coloque no código e não a salve no Git.

### 2. Configurar a Vercel

Importe este diretório/repositório na Vercel e cadastre estas variáveis em **Settings → Environment Variables** para Production, Preview e Development:

```text
DATABASE_URL=connection string do Neon
SINUCA_ADMIN_USER=seu usuário administrativo
SINUCA_ADMIN_PASSWORD=uma senha longa e exclusiva
```

O arquivo `vercel.json` já configura a função Python, as rotas da API e os cabeçalhos de segurança. Na Vercel, o login fica bloqueado se `SINUCA_ADMIN_PASSWORD` não estiver configurada, evitando publicar a senha local padrão por engano.

### 3. Migrar os dados locais, se desejar

Primeiro faça uma cópia de `data/campeonato.db`. Depois, em uma máquina com Python:

```powershell
python -m pip install -r requirements.txt
$env:DATABASE_URL="COLE_A_CONNECTION_STRING_SOMENTE_NESTA_SESSAO"
python scripts/migrate_sqlite_to_neon.py
python scripts/migrate_sqlite_to_neon.py --apply
Remove-Item Env:DATABASE_URL
```

A primeira execução apenas mostra quantos registros serão migrados. A segunda grava o estado do campeonato, perfis e apostas no Neon. O SQLite de origem não é alterado.

Se o projeto ainda não tiver dados importantes, basta fazer o primeiro deploy: as tabelas são criadas automaticamente na primeira chamada à API.

### 4. Conferir o deploy

Abra estas rotas na URL fornecida pela Vercel:

```text
/
/login
/bolao
/api/health
```

Em `/api/health`, o campo `database` deve mostrar `postgresql-neon`.

## Atualizar uma instalação existente

1. Encerre o servidor antigo com `Ctrl+C`.
2. Faça uma cópia da pasta `data` antiga.
3. Extraia esta versão em uma nova pasta.
4. Copie o arquivo antigo `data/campeonato.db` para a nova pasta `data`.
5. Execute `iniciar.bat`.

Ao iniciar, o servidor cria automaticamente as tabelas novas da liga e do bolão sem apagar os dados anteriores.

## Rede interna e firewall

O servidor usa a porta:

```text
TCP 3000
```

Ele escuta em `0.0.0.0`, permitindo acesso pela rede interna. No Firewall do Windows, libere o Python ou a porta TCP 3000 somente em **redes privadas**.

Não é necessário liberar a porta 8080.

## Segurança incluída

- login administrativo por sessão;
- cookie administrativo `HttpOnly` e `SameSite=Strict`;
- limite de tentativas incorretas no login administrativo;
- PIN do bolão armazenado como hash PBKDF2, e não em texto puro;
- token de acesso do bolão armazenado no banco apenas como hash;
- API administrativa bloqueada sem autenticação;
- arquivos internos, banco e backups não podem ser baixados pelo navegador;
- cabeçalhos de segurança e política de conteúdo local.

O sistema usa HTTP dentro da rede interna. Não publique diretamente na internet sem HTTPS, proxy reverso e revisão de segurança.

## Alterar usuário e senha do administrador

Windows, no Prompt de Comando:

```bat
set SINUCA_ADMIN_USER=outro_usuario
set SINUCA_ADMIN_PASSWORD=uma_senha_forte
iniciar.bat
```

macOS ou Linux:

```bash
SINUCA_ADMIN_USER=outro_usuario SINUCA_ADMIN_PASSWORD=uma_senha_forte ./iniciar.sh
```

## Estrutura do projeto

```text
campeonato-sinuca-local-v5/
├── index.html
├── app.js
├── bolao.html
├── bolao.js
├── login.html
├── login.js
├── styles.css
├── server.py
├── database.py
├── api/
│   └── index.py
├── scripts/
│   └── migrate_sqlite_to_neon.py
├── requirements.txt
├── vercel.json
├── iniciar.bat
├── iniciar.sh
└── data/
    ├── campeonato.db          # criado ou reutilizado automaticamente
    ├── backup-latest.json     # criado automaticamente
    └── LEIA-ME.txt
```

## Referências de formato

- Round-robin: cada participante enfrenta todos os outros, com classificação por resultados acumulados.
- World Snooker Tour — Championship League: exemplo de competição de sinuca com grupos e partidas em formato round-robin.
- Sportspoule: exemplo de bolão em que participantes fazem previsões e acompanham uma classificação.
- FIFA: referência para tabelas e classificação por pontos.
- WPBSA: terminologia de partidas divididas em frames.

## Encerramento correto

Na janela do servidor, pressione:

```text
Ctrl+C
```

O banco é atualizado a cada alteração. Não existe um botão adicional de encerramento.
