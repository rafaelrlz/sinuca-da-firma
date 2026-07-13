---
name: Sinuca da Firma
description: O campeonato acontece aqui.
colors:
  match-green: "#126347"
  hall-green: "#062c21"
  control-green: "#0c4a36"
  action-green: "#21a071"
  soft-green: "#daf3e7"
  scoreboard-white: "#ffffff"
  table-background: "#f3f5f3"
  quiet-surface: "#f8faf8"
  structural-surface: "#e9efeb"
  table-graphite: "#17231d"
  muted-ink: "#5d6b63"
  divider: "#dce4df"
  victory-gold: "#c79223"
  attention-gold: "#fff5d8"
  error-red: "#b33a3a"
  error-soft: "#fde8e7"
  info-blue: "#2877b5"
  info-soft: "#e5f2fb"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "clamp(25px, 3vw, 40px)"
    fontWeight: 850
    lineHeight: 1.06
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "clamp(20px, 2vw, 27px)"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "18px"
    fontWeight: 800
    lineHeight: 1.25
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "11px"
    fontWeight: 750
    lineHeight: 1.4
    letterSpacing: "0.04em"
rounded:
  sm: "8px"
  control: "10px"
  surface: "14px"
  dialog: "20px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "8px"
  control: "10px"
  md: "16px"
  surface: "22px"
  page: "28px"
  hero: "30px"
components:
  button-primary:
    backgroundColor: "{colors.match-green}"
    textColor: "{colors.scoreboard-white}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "9px 15px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.control-green}"
    textColor: "{colors.scoreboard-white}"
  button-ghost:
    backgroundColor: "{colors.scoreboard-white}"
    textColor: "{colors.table-graphite}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "9px 15px"
    height: "40px"
  input:
    backgroundColor: "{colors.scoreboard-white}"
    textColor: "{colors.table-graphite}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
    height: "42px"
  card:
    backgroundColor: "{colors.scoreboard-white}"
    textColor: "{colors.table-graphite}"
    rounded: "{rounded.surface}"
    padding: "20px 22px 22px"
  badge:
    backgroundColor: "{colors.structural-surface}"
    textColor: "{colors.muted-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "4px 8px"
    height: "24px"
---

# Design System: Sinuca da Firma

## Overview

**Creative North Star: "Sala do Campeonato"**

A interface é o ambiente oficial da competição dentro da empresa: bem cuidada o suficiente para valorizar cada rodada, mas próxima e descontraída o suficiente para continuar parecendo parte da convivência entre colegas. O verde herdado da mesa de sinuca dá identidade; superfícies claras, informação precisa e controles familiares dão confiança.

A área administrativa privilegia densidade controlada, previsibilidade e velocidade. A experiência pública pode ser mais expressiva, com ritmo editorial e movimento guiando a história da competição, desde que placares, tabelas e ações permaneçam imediatamente compreensíveis. O sistema rejeita aparência de site de apostas ou cassino, painel administrativo genérico e estética gamer carregada de neon.

**Key Characteristics:**

- Verde profundo como assinatura, não como decoração espalhada.
- Hierarquia compacta e legível para dados competitivos.
- Superfícies estruturadas por tom, borda discreta e espaçamento.
- Movimento curto e intencional, com alternativa para movimento reduzido.
- Voz sofisticada no acabamento e descontraída no texto.

## Colors

A paleta parte do verde da mesa e o disciplina em papéis claros: comando, profundidade, ação e apoio, cercados por neutros levemente esverdeados.

### Primary

- **Verde da Partida:** conduz ações primárias, estados selecionados e sinais de progresso.
- **Verde do Salão:** ancora navegação, fundos institucionais e superfícies de maior profundidade.
- **Verde de Controle:** sustenta estados de hover e áreas administrativas de alta confiança.
- **Verde de Ação:** aparece em progresso, presença online e pequenos sinais positivos.
- **Verde de Apoio:** cria seleção e confirmação sem competir com o conteúdo.

### Secondary

- **Ouro da Vitória:** reservado para campeão, primeiro lugar e conquistas reais.
- **Ouro de Atenção:** comunica avisos sem assumir a severidade de um erro.

### Tertiary

- **Vermelho de Erro:** exclusão, falha e ações destrutivas.
- **Azul Informativo:** informação neutra que não significa sucesso nem alerta.

### Neutral

- **Branco do Placar:** superfície de leitura e controles.
- **Fundo da Mesa:** plano geral da aplicação.
- **Superfície Silenciosa:** cabeçalhos de tabela e agrupamentos leves.
- **Superfície Estrutural:** seleção passiva, trilhos e áreas secundárias.
- **Grafite da Mesa:** texto principal e números.
- **Tinta Suave:** texto auxiliar que ainda precisa permanecer legível.
- **Divisória:** separação estrutural de baixo contraste.

**The Green Discipline Rule.** Verde saturado deve indicar identidade, ação ou estado; nunca preencher componentes sem função.

**The Earned Gold Rule.** Ouro só aparece quando há conquista, liderança ou atenção real. Nunca é um segundo primário decorativo.

## Typography

**Display Font:** Inter, com fallback para a pilha sans-serif do sistema  
**Body Font:** Inter, com fallback para a pilha sans-serif do sistema

**Character:** Uma única família sans-serif mantém o produto direto e contemporâneo. A distinção vem de peso, escala, largura de linha e espaçamento, não de uma coleção de fontes concorrentes.

### Hierarchy

- **Display** (850, escala fluida até 40px, 1.06): momentos públicos, títulos de hero e estados decisivos; nunca em tabelas ou formulários.
- **Headline** (800, escala fluida até 27px, 1.15): título da tela e contexto principal.
- **Title** (800, 18px, 1.25): cabeçalhos de módulos, diálogos e seções.
- **Body** (400, 13px, 1.6): instruções, explicações e conteúdo corrente, limitado a aproximadamente 70 caracteres por linha quando houver texto longo.
- **Label** (750, 11px, 0.04em): metadados, cabeçalhos de tabela e estados curtos; caixa alta apenas quando a varredura rápida justificar.

**The One-Family Rule.** A interface usa uma única família sans-serif; hierarquia vem de escala e peso, nunca de fontes decorativas.

**The Data Stays Calm Rule.** Tabelas, placares e campos usam tamanhos fixos. Escala fluida pertence somente à apresentação pública e ao título da tela.

## Elevation

O sistema usa profundidade híbrida e contida. Borda e mudança tonal estruturam cartões e campos; sombras aparecem apenas em elementos que realmente se elevam, como ação primária, modal, toast e navegação fixa. Superfícies comuns permanecem próximas do plano de fundo.

### Shadow Vocabulary

- **Contato** (`0 1px 2px rgba(7, 38, 27, 0.08)`): cartões e controles que precisam se separar minimamente do fundo.
- **Flutuação** (`0 12px 30px rgba(7, 38, 27, 0.10)`): hero e toast; nunca em grades inteiras de cartões.
- **Modal** (`0 26px 80px rgba(5, 35, 25, 0.28)`): reservado ao diálogo sobre backdrop.
- **Ação** (`0 5px 13px rgba(18, 99, 71, 0.20)`): reforço exclusivo da ação primária.

**The Structural Depth Rule.** Primeiro use tom e espaçamento; aplique sombra somente quando o elemento ocupa um plano interativo superior.

**The One Elevation Rule.** Um componente não combina borda decorativa com sombra ampla. Escolha a estrutura dominante.

## Components

Os componentes são refinados e táteis: dimensões compactas, estados inequívocos e resposta rápida sem elasticidade.

### Buttons

- **Shape:** cantos controlados (10px), altura mínima de 40px e área de toque preservada.
- **Primary:** Verde da Partida com texto branco e padding de 9px por 15px; apenas uma ação primária por grupo.
- **Hover / Focus:** hover escurece para Verde de Controle e sobe 1px; foco mantém contorno visível de 3px.
- **Secondary / Ghost:** o secundário usa Verde de Apoio; o ghost usa Branco do Placar com divisória e elevação de contato.
- **Danger:** Vermelho de Erro, reservado a consequências destrutivas e sempre acompanhado de confirmação quando irreversível.

### Chips

- **Style:** formato pill, altura mínima de 24px e padding de 4px por 8px; fundo tonal comunica estado sem virar botão primário.
- **State:** verde significa confirmação, ouro atenção, vermelho erro e azul informação.

### Cards / Containers

- **Corner Style:** cantos moderados (14px); diálogos podem chegar a 20px.
- **Background:** Branco do Placar sobre Fundo da Mesa, com Superfície Silenciosa em subdivisões.
- **Shadow Strategy:** elevação de contato; a hierarquia principal deve vir de agrupamento e espaçamento.
- **Border:** Divisória de 1px somente quando necessária para delimitar conteúdo.
- **Internal Padding:** 20px a 22px no desktop, reduzido com consistência em telas pequenas.

### Inputs / Fields

- **Style:** fundo branco, divisória de 1px, cantos de 10px, altura mínima de 42px e padding de 10px por 12px.
- **Focus:** contorno externo de 3px em verde translúcido, sem deslocar o layout.
- **Error / Disabled:** erro em Vermelho de Erro com mensagem textual; desabilitado reduz ênfase e mantém o rótulo legível.

### Navigation

A navegação lateral usa Verde do Salão, rótulos compactos e estados ativos de alto contraste. No mobile, transforma-se em drawer com backdrop e devolve o foco ao controle que a abriu. A topbar é fixa, clara e estrutural; blur só é aceito ali por reforçar o contexto de sobreposição.

### Match and Ranking Data

Placares, confrontos, rodadas e ranking são o componente assinatura. Nomes permanecem truncáveis sem quebrar a grade; números recebem alinhamento consistente; vitória, liderança e partida pendente nunca dependem apenas de cor. No público, esses dados podem participar de sequências de scroll, mas continuam visíveis sem animação.

## Do's and Don'ts

### Do:

- **Do** use Verde da Partida para ação ou estado e Verde do Salão para ancoragem institucional.
- **Do** mantenha o administrador rápido: ações frequentes ficam próximas do dado que alteram.
- **Do** preserve contraste WCAG AA, foco visível e leitura completa sem animação.
- **Do** trate ranking, rodada e placar como informação principal, não como decoração dentro de cartões.
- **Do** use movimento com easing de saída rápido e alternativa em `prefers-reduced-motion`.
- **Do** limite cartões a 14px e diálogos a 20px de raio.

### Don't:

- **Don't** faça a interface parecer um site de apostas ou cassino.
- **Don't** transforme o produto em um painel administrativo genérico.
- **Don't** use estética gamer carregada de neon.
- **Don't** use efeitos gratuitos ou animações que prejudiquem a leitura ou atrasem tarefas.
- **Don't** use texto em gradiente, glassmorphism decorativo, listras repetidas ou grids de fundo ornamentais.
- **Don't** use bordas laterais grossas como acento; estados devem usar fundo, contraste, ícone ou borda completa.
- **Don't** combine borda de 1px com sombra ampla no mesmo cartão.
- **Don't** esconda conteúdo até uma animação executar; o estado padrão já deve estar completo.
