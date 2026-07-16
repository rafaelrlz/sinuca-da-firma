# Análise de melhorias — Sinuca da Firma

Data da análise: 15 de julho de 2026  
Método: duas avaliações independentes — revisão de design/UX e verificação técnica no código e no navegador.

## Saúde geral

| # | Heurística | Nota | Principal oportunidade |
|---|---|---:|---|
| 1 | Estado do sistema | 2/4 | Loading inicial vazio e falhas que podem ficar presas |
| 2 | Linguagem familiar | 3/4 | Boa linguagem esportiva; algumas regras precisam de contexto |
| 3 | Controle e liberdade | 2/4 | Sem desfazer e histórico do navegador incompleto |
| 4 | Consistência | 3/4 | Visual coeso; Ranking funciona diferente dos outros destinos |
| 5 | Prevenção de erros | 3/4 | Boas confirmações; faltam prévia, autosave e reversão |
| 6 | Descoberta | 3/4 | Ações visíveis; navegação mobile ainda densa |
| 7 | Eficiência | 1/4 | Administração muito serial e sem atalhos |
| 8 | Estética e minimalismo | 3/4 | Identidade forte; heróis repetidos adicionam peso |
| 9 | Recuperação de erros | 2/4 | Toasts claros, mas efêmeros; faltam ações de recuperação |
| 10 | Ajuda contextual | 1/4 | Microcopy boa, porém sem ajuda operacional |
| **Total** |  | **23/40** | **Aceitável, com base sólida** |

## Diagnóstico visual

O site possui uma identidade própria. A fotografia, o verde da mesa, a tipografia de placar e o uso restrito de dourado evitam aparência de cassino, interface gamer ou painel administrativo genérico.

O principal risco visual é a repetição da mesma fórmula de hero verde, título grande e bola 8 em muitas páginas. A assinatura forte da home começa a funcionar como um template nas demais rotas.

A verificação em viewport móvel de 390 px não encontrou overflow horizontal real. O problema móvel mais concreto são alvos de toque abaixo de 44 px e alguns textos auxiliares com contraste insuficiente.

## Pontos fortes

- A experiência pública faz o campeonato parecer importante sem perder a informalidade.
- Liga é a tela mais madura: classificação, rodadas e andamento possuem hierarquia clara.
- Existem boas bases de acessibilidade: landmarks, rótulos, foco visível, diálogos nativos, regiões de status e preferência por movimento reduzido.
- A identidade visual é reconhecível e adequada ao universo da sinuca.

## Melhorias prioritárias

### 1. Administração rápida da rodada — P1

O administrador registra resultados individualmente, abre diálogos repetidamente e ainda utiliza um `prompt` do navegador para editar jogadores.

Implementar:

- central para operar a rodada;
- placares diretamente na lista;
- ação “Salvar e abrir próxima”;
- navegação anterior/próxima;
- atalhos de teclado;
- indicador persistente de estado salvo;
- edição inline de jogadores;
- menu administrativo agrupado em Competição, Conteúdo e Sistema.

### 2. Carregamento, falhas e desempenho — P1

O conteúdo inicial pode permanecer vazio enquanto autenticação, campeonato e notícias são carregados. Em falhas da API, algumas superfícies podem continuar mostrando loading mesmo depois de detectar indisponibilidade.

As imagens principais possuem aproximadamente 2 MB no mobile e 2,7 MB no desktop.

Implementar:

- shell e skeleton imediatos;
- estados de erro com “Tentar novamente”;
- encerramento garantido de qualquer loading;
- cache público seguro;
- imagens responsivas e mais leves em WebP/AVIF;
- apresentação do cache local enquanto o servidor atualiza.

### 3. Governança de notícias e comentários — P1

Notícias e comentários em um ambiente de empresa precisam preservar a rivalidade sem expor colegas de forma inadequada.

Implementar:

- prévia completa antes da publicação;
- rascunho como padrão;
- orientação editorial de tom;
- orientação de texto alternativo neutro e factual;
- regras visíveis de convivência;
- denúncia de comentário;
- histórico de publicação e moderação.

### 4. Navegação e histórico — P2

A navegação utiliza `replaceState`, impedindo que o botão Voltar refaça corretamente o caminho entre as telas. Ranking parece um destino, mas funciona como uma rolagem dentro de Liga.

Implementar:

- `pushState` nas ações do usuário;
- tratamento de `popstate`;
- hashes significativos para Ranking e artigos;
- `aria-current` na navegação ativa;
- definição clara de Ranking como destino público.

### 5. Acessibilidade móvel e legibilidade — P2

Vários controles possuem entre 32 e 40 px de altura, abaixo do alvo móvel recomendado de 44 px. Alguns textos auxiliares também ficam abaixo do contraste WCAG AA.

Implementar:

- alvos mínimos de 44×44 px;
- texto auxiliar com contraste maior;
- piso de 12 px para metadados;
- prosa pública próxima de 16 px;
- espaçamento adequado entre ações móveis.

## Melhorias complementares

- Corrigir o indicador externo em “Área administrativa” ou realmente abrir em nova aba.
- Usar “Vitória +3 · derrota +0” no lugar de “derrota mantém a pontuação”.
- Mover referências técnicas para documentação, fora da rotina administrativa.
- Evitar repetir a mesma arte de hero em todas as rotas.
- Mostrar autor, horário e histórico da última alteração de placares.
- Manter a listagem de notícias como uma chamada compacta, sem repetir o corpo da matéria.

## Ordem de execução

1. Fluxo rápido de operação da rodada.
2. Loading, falhas e otimização de imagens.
3. Prévia e governança de notícias/comentários.
4. Histórico correto de navegação.
5. Acessibilidade, contraste e alvos móveis.
6. Refinamentos complementares e validação final.
