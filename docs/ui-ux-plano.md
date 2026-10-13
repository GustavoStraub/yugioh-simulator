# UI/UX da partida — o que o Master Duel e o Tag Force ensinam, e o plano

> Investigação de 13/10/2026. Pedido do Gustavo: pesquisar o que há de bom no
> **Yu-Gi-Oh! Master Duel** (Konami, 2022) e na série **GX Tag Force** (PSP),
> comparar com a nossa tela e montar um plano geral de melhoria da jogabilidade
> "e afins". Regra acrescentada no meio da investigação, e que vale para todo o
> resto: **todo popup tem de poder ser escondido** para avaliar campo,
> Cemitério e Extra Deck — a tela nunca pode impedir o jogador de ver aquilo de
> que a decisão depende.
>
> Base: as capturas de `.cache/shots/` (1440×900, 1280×720, 1024×640, Goat e
> TCG), a leitura do código da mesa (`DuelBoard.tsx`, `DuelCardSlot.tsx`,
> `duel-session.ts`, `duel-actions.ts`, `auto-response.ts`, `pacing.ts`) e uma
> sonda no engine real (§7) para a única proposta que depende de como o core
> se comporta — o modo automático de respostas na corrente.

## 1. Resumo

- **O maior problema não é visual, é de ritmo de decisão.** Com uma única
  Magia Rápida baixada (Scapegoat), a tela pergunta "Deseja responder com
  algum efeito?" **35 vezes em 4 turnos**; o próprio core marca só **5**
  dessas janelas como relevantes (o ataque e a End Phase do oponente). O
  Master Duel resolveu isso com o seletor *Automático / Ligado / Desligado* e
  o gesto de segurar para forçar a pergunta; o EDOPro, com os botões de
  corrente. Nós perguntamos sempre. É a mudança de maior efeito do plano
  (Fase 2), e o core já entrega o dado que a decide (`spe_count`).
- **Popups prendem a mesa.** Só o modal de sim/não tem "👁 Ver o tabuleiro".
  Escolher carta do Deck/Cemitério, declarar nome, distribuir contadores,
  ordenar cartas e o resultado do duelo cobrem o campo sem saída (Fase 1).
- **"Ativar" não diz o quê.** Toda jogada de efeito tem o mesmo rótulo; carta
  com dois efeitos mostra dois botões "Ativar" iguais. O core manda a
  descrição de cada efeito e nós descartamos (Fase 3).
- **Destruir, mandar ao Cemitério e banir não aparecem.** A carta some e o
  topo do Cemitério troca; o histórico também não registra — quem piscou não
  sabe o que aconteceu (Fase 4).
- **A mesa desperdiça espaço e fala "engenharia".** Rótulos `Mon1`,
  `M/A5 · P`; painel de leitura vazio na maior parte do tempo ("Passe o mouse
  sobre uma carta"); histórico com linhas de carregamento e dicas internas;
  no Goat em 1440×900 a pilha de banidas **cobre os botões BP/M2** da trilha de
  fases (bug, §4). Fase 6.
- **Não há configuração nenhuma** além do volume: nem velocidade, nem modo de
  resposta, nem atalho. Fase 7.
- Fim de duelo, lobby e construtor têm lacunas menores e bem conhecidas
  (revanche contra o bot, quem começa, mão de teste, importar/exportar deck).
  Fases 8–10.

**Ordem proposta:** Fases 1–8 primeiro — são todas dentro do duelo, juntas
mudam a sensação de jogar, e nenhuma depende de dado novo. Fases 9–12 depois.

## 2. Como foi feita a pesquisa

- **Master Duel:** notas de atualização (YGOrganization, Master Duel Meta),
  guias de interface (gameplay.tips, outof.games, itemlevel), um passo a passo
  completo da aba de configurações de duelo (Toutiao) e reclamações da
  comunidade (Steam, multiplayer.it, SciFi Bloggers, indiecator). Lista em
  [Fontes](#fontes).
- **Tag Force:** FAQs e respostas do GameFAQs (lidas pelo Wayback — o site
  bloqueia robôs), os wikis japoneses de cada jogo (gcmatome, atwiki), a
  Yugipedia, análises da época (Worth Playing, GamesRadar, GameVortex, com a
  captura da tela do TF1) e o anúncio do remake. Lista em [Fontes](#fontes).
- **Limites.** Nenhum dos dois jogos foi jogado nesta investigação; detalhes
  puramente visuais (o desenho exato do número de elo, a contagem do LP) não
  estão em texto em lugar nenhum e foram marcados como *a conferir em vídeo*
  quando aparecem. O que o plano copia é o **comportamento** — que está bem
  documentado —, não a arte.
- **Nossa tela:** capturas de `.cache/shots/` e leitura do código, com
  `arquivo:linha` em cada achado. A única proposta que depende do engine (o
  modo automático da Fase 2) foi medida no core real (§7).

## 3. O que vale copiar

### 3.1 Master Duel

| O que o MD faz | Por que funciona | Nós hoje |
|---|---|---|
| **Confirmação de ativação** em três modos: *Automático* (pergunta em invocação, declaração de ataque, ativação do oponente e antes de o turno dele acabar), *Ligado* (toda janela legal) e *Desligado* (só o obrigatório). Segurar o botão do mouse/dedo força *Ligado*; um botão no canto alterna os três. Desde a 1.7.1 o modo forçado volta ao normal no fim do turno. | O jogador para quando importa e não vira "clicador de Não responder". | Sempre *Ligado*, sem opção (`duel-actions.ts:581`). |
| **Auto-corrente** (*Self Chain*): no automático, não pergunta se você quer encadear no seu próprio efeito — só se o oponente responder. | A janela "responder a mim mesmo" é quase sempre um "não". | Pergunta sempre. |
| **Ordem de ativação** opcional para gatilhos simultâneos. | Quem quer controlar a ordem pede; quem não quer não vê. | Sempre automática, nunca mostrada (`auto-response.ts:82`). |
| **Comandos ao lado da carta** (Invocar, Baixar, Ativar), com o **efeito** que será ativado destacado na leitura da carta. | Clicar e ver o que vai acontecer é a mesma ação. | Menu ao lado da carta ✔, mas todo efeito vira "Ativar" (`duel-actions.ts:344`). |
| **Moldura por intenção:** azul = pode atacar, amarela = pode ativar; as duas juntas quando a carta pode as duas coisas. Ícone de "não pode ativar agora". | Varre-se a mesa com o olho e já se sabe o que dá para fazer. | Dourado = jogada, ciano = alvo ✔ (`DuelCardSlot.tsx:28`). Ataque não tem cor própria. |
| **Lista de cartas** com ícone de origem (mão, Deck, Cemitério…), cor por dono, **clique duplo confirma** a escolha única, mais botões "Cancelar". | Escolher um alvo custa um gesto, não dois. | Seleção única exige clicar a carta **e** "Confirmar". |
| **Painel de detalhes fixável** (desde a 2.4: "fechar automaticamente" desligável), com alternância valores atuais × originais e ícone "efeito já usado neste turno". | Ler a carta é o que mais se faz num duelo. | Some ao tirar o mouse (`DuelCardSlot.tsx:219`); o painel passa a maior parte do tempo vazio. |
| **Histórico** em painel, registrando também as cartas escolhidas por efeitos sem alvo e a zona escolhida. Lista "!" de efeitos que restringem jogadas; lista de efeitos "neste turno" no canto. | "O que aconteceu?" e "por que não posso?" têm resposta na tela. | Histórico ✔, mas sem destruição/envio/banimento; avisos de jogador sob o LP ✔ (`DuelBoard.tsx:2986`). |
| **Contagem do deck** só aparece com ≤ 10 cartas. | O número só vira informação quando está perto de acabar. | Sempre visível, nunca destacada. |
| **Corte de animações:** desligar as animações de invocação, tocar uma vez por duelo, clique pula. | Duelo longo não fica arrastado. | Sem controle — mas o MD **não** tem velocidade geral, e é a reclamação nº 1 dele. Aqui dá para fazer melhor. |
| **Posição de carta** manual ou automática (a automática erra com setas Link). | Opção para quem não liga para a zona. | Zona sempre manual quando há escolha ✔. |
| **Botão de fase** único à direita: tocar mostra "Battle Phase" / "End Phase", com confirmação. | Avançar de fase nunca é por acidente. | Trilha DP…EP com os pips clicáveis ✔ (`DuelBoard.tsx:1394`); "EP" encerra o turno sem confirmação. |
| **Relógio de xadrez** por jogador (300 s, +60/+30 por turno). | Ranked sem anti-jogo. | Nenhum relógio (`docs/multiplayer.md:555`). Só faz sentido online, e depois. |

**Reclamações do MD que o plano evita de propósito:** animações base lentas e
sem ajuste de velocidade; turnos longos; a pausa de quem tem resposta denuncia
a carta na mão (ver §3.3); listas de Cemitério minúsculas; clique errado que
não se desfaz.

### 3.2 Tag Force

A tela do Tag Force (PSP, 480×272) é **uma só, do começo ao fim do duelo**: o
terço esquerdo é um inspetor de carta permanente (arte grande, ATK/DEF, texto
com rolagem) para o que estiver sob o cursor; os dois terços da direita são o
campo em perspectiva; a mão em leque embaixo, por cima do campo, com a carta
apontada levantada e de borda amarela; LP, nomes e turno numa faixa no topo;
a trilha DP SP M1 BP M2 EP no meio do campo. Foi daí que veio o desenho da
nossa mesa (`DuelBoard.tsx:676`, "LP nos cantos, estilo Tag Force").

| O que o TF faz | Por que funciona | Nós hoje |
|---|---|---|
| **Inspetor fixo** que nunca fica vazio — mostra sempre a carta sob o cursor. | O olho sabe onde ler; nenhuma jogada é decidida sem o texto. | Mesmo lugar ✔, mas esvazia ao tirar o mouse (D7). |
| **Confirmação de ativação** com padrão *Auto* (TF3: Auto / Todas; TF6: *Tudo OFF / Próprio OFF / Próprio ON / Tudo ON*, separando o seu turno do turno do oponente) + **segurar o botão de confirmar** para parar onde quiser (a Draw Phase do oponente, encadear no próprio efeito). | Mesmo princípio do MD, uma geração antes: o jogo pergunta quando importa, e o jogador pede o resto. | Pergunta sempre (D1). O "L/R para checar a corrente" que se costuma lembrar é do **Master Duel**, não do TF; no TF, L/R eram atalhos fora do duelo. |
| **Velocidade da animação em 4 níveis** (TF6: Lenta / Normal / Rápida / Muito rápida), efeitos e filmes de monstro como opções separadas, **○ pula a animação** em curso. | O duelo de 30 minutos não se arrasta; quem quer espetáculo mantém. | Sem controle (D11). |
| Nível sempre à vista no campo (TF4), branco nos normais e **amarelo nos Reguladores**; efeitos inativos esmaecidos (Gêmeos). | O que decide Sincro está na mesa, sem abrir carta. | Selo de Nível só no TCG ✔; Regulador sem cor própria; carta negada fica cinza ✔. |
| **Posição de carta** Automática/Manual; **compra automática**; **pular o pedra-papel-tesoura** (TF4). | Cada confirmação sem decisão some. | Zona só é perguntada quando há escolha ✔; jokenpô só online ✔. |
| **Ajuda contextual no START** e aulas na "Duel Academy"; duelos de espectador (a máquina contra ela mesma) para aprender. | Aprender sem sair do jogo. | Nada (Fase 12). |
| Depois de perder um duelo da história, o jogo **oferece trocar de deck** para a revanche; resultado com tempo de duelo, dano causado; desafios. | A derrota leva direto à próxima tentativa. | Resultado só com "Voltar ao lobby" no local (D13). |

**Lições pelas críticas ao TF** (e o que cada uma vira aqui):

- *Cut-ins que não se pulam* (TF1) → nada nosso dura mais do que o ritmo
  permite, e o clique pula (Fase 5).
- *Confirmações demais* (TF1 perguntava a cada passo) → Fase 2.
- *Cursor de alvo começando nas próprias cartas*, o que fazia o jogador
  destruir a si mesmo (TF1) → num alvo de efeito, as cartas do oponente vêm
  primeiro na lista do seletor, e as do jogador ficam identificadas.
- *Declarar uma carta rolando a lista inteira* (TF1 a TFSP) → já temos a
  busca no "declarar nome" ✔ (`AnnounceCardModal.tsx`).
- *Sem como desistir de uma Invocação-Sincro já começada* (TF3) → onde o core
  permite cancelar, a tela oferece ✔ ("Cancelar invocação"); mantido.
- *Tela poluída, submenu sem escurecer o fundo* (TF2, TF4) → a Fase 6 *tira*
  texto da mesa em vez de pôr.
- Não há registro de **histórico de duelo** nem de replay em nenhum Tag Force:
  aqui o nosso já é melhor que a referência, e a Fase 4 o deixa legível.

Também vale saber: a Konami anunciou um remake, *Yu-Gi-Oh! TAG FORCE GX*
(Switch, Switch 2 e Steam, 16/02/2027), com elementos de interface do Master
Duel — atributos de monstro sempre à vista e o texto da carta mantido à
esquerda. As duas referências convergem para o mesmo desenho.

### 3.3 O que não copiar

- **Cut-ins longos de invocação** (MD): é o que mais reclamam. Nossa linha é
  a oposta — destaque curto, e um controle de velocidade que o MD não tem.
- **Relógio de xadrez** agora: não há ranked, e contra o bot ele só pune.
- **Posição automática de zona**: o próprio MD erra com setas Link; nossa
  regra "a zona só é perguntada quando há escolha" já tira o atrito.
- **O vazamento pela pausa.** Em qualquer modo de resposta, o core só
  pergunta a quem *tem* resposta legal — então, online, a demora do outro
  lado denuncia uma carta na mão. O MD tem o mesmo problema e nunca o
  resolveu. Não é piorado por este plano (o modo automático *reduz* as
  pausas), mas fica registrado como lacuna conhecida para o online.

## 4. Onde estamos — diagnóstico

Severidade: **A** = atrapalha decidir/jogar; **B** = atrito constante;
**C** = acabamento.

| # | Problema | Evidência | Sev. |
|---|---|---|---|
| D1 | Toda janela com resposta legal abre o modal "Deseja responder?" — 35 perguntas em 4 turnos com um Scapegoat baixado, 5 relevantes. | §7; `duel-actions.ts:581-605`, `auto-response.ts:26-36` | A |
| D2 | Popups sem saída para a mesa: seletor de cartas (busca no Deck/Cemitério), declarar nome, contadores, ordenar cartas, resultado. Só o `PromptModal` tem "Ver o tabuleiro". | `DuelBoard.tsx:1034-1111`, `2251` | A |
| D3 | Todo efeito é "Ativar"; dois efeitos = dois botões idênticos. O core manda `description` em `activates[]`, `selects[]` (corrente) e já sabemos traduzir (`engineStrings.describeOption`). | `duel-actions.ts:344-353`, `engine-strings.ts` | A |
| D4 | Destruição, envio ao Cemitério, banimento e volta à mão não têm animação nem linha no histórico; o evento `destroy` existe e nunca é emitido. | `duel-session.ts:1126-1131`, `duel-events.ts:30` | A |
| D5 | Ataque no histórico sem nomes ("⚔ O oponente declarou ataque"); compras não registradas. | `duel-session.ts:1200-1205` | B |
| D6 | Histórico com ruído: "Carregando engine…", "3 carta(s) usando script do passcode original.", e cada dica de seleção do core (💬 "Selecione o(s) card(s) para usar como Matéria de Sincro") vira linha do jogo. | capturas `jogo-*.png` | B |
| D7 | Leitura da carta some ao tirar o mouse: o maior painel da tela fica vazio quase o tempo todo. | `DuelCardSlot.tsx:218-219`, todas as capturas | B |
| D8 | Rótulos técnicos nas zonas vazias (`Mon1`, `M/A5 · P`, `Cemit.`), que não ajudam a jogar. | `DuelBoard.tsx:1215,1234` | C |
| D9 | **Bug:** no Goat em 1440×900 a pilha de banidas fica sobre os botões BP/M2 da trilha de fases (a fileira Goat é mais larga e o teto de largura não conta a pilha pendurada). | `viewport-goat-1440x900.png`, `movimento-reduzido.png`; `DuelBoard.tsx:729`, `1280-1302` | A |
| D10 | Seleção de alvo único exige clique na carta + "Confirmar". | `DuelBoard.tsx:2477-2538` | B |
| D11 | Sem configuração de velocidade; o desconto "turno próprio" é `turnPlayer === 0`, então online o assento 0 vê tudo rápido e o assento 1 tudo lento, nos dois sentidos. | `duel-session.ts:819`, `pacing.ts:96` | B |
| D12 | "Movimento reduzido" do sistema não alcança o voo do ataque, a compra (Web Animations) nem a moeda/dado. | `globals.css:366-380, 497-518`, `AttackFlight.tsx:160` | B |
| D13 | O resultado do duelo cobre a tela e não se fecha para ver a mesa final; contra o bot não há revanche. | `DuelBoard.tsx:2617-2683` | B |
| D14 | Barra de LP diz "TURNO" no lado de quem joga e "Você"/"Oponente" no outro — lê-se como rótulo, não como estado. Nada indica "o oponente está jogando" no turno do bot. | `DuelBoard.tsx:2736`, `travou-*.png` | B |
| D15 | Cartas da mão pequenas: a arte não se lê sem ir ao painel. | capturas 1024×640 | C |
| D16 | Modais sem `role="dialog"`, sem foco, sem Esc; o único atalho é Enter/Espaço numa carta focada. | `DuelCardSlot.tsx:221-233` | C |
| D17 | Nome de carta em idiomas misturados: a pilha da corrente segue o seletor PT/EN, o histórico é sempre PT. | `corrente-*.png` | C |
| D18 | Lobby contra o bot: o humano sempre começa; não há prévia do deck do bot. | `DuelPlayApp.tsx:91` | C |
| D19 | Construtor: "Limpar" apaga o deck sem confirmação; sem mão de teste, sem importar/exportar `.ydk`/`ydke://`, sem estatísticas. | `useDeck.ts:238-241` | C |

O que já está bom e fica: menu ao lado da carta, realce por intenção, pilhas
que brilham quando têm jogada, destaque da corrente com carimbo NEGADO, marcas
nas cartas, leitura com ATK/DEF atual × original, avisos de jogador sob o LP,
histórico de revelações, rendição em dois cliques, modais nascendo só sobre a
coluna do campo (os trilhos ficam legíveis).

## 5. Princípios

1. **A mesa nunca fica refém.** Todo popup de decisão pode ser escondido sem
   responder (botão "👁 Ver a mesa" e Esc) e volta pelo mesmo lugar, com o que
   já foi marcado intacto. Enquanto escondido, Cemitério, banidas, Extra Deck,
   materiais e a leitura de carta continuam clicáveis.
2. **Perguntar só quando a resposta pode mudar algo** — e deixar o jogador
   pedir mais perguntas quando quiser (segurar Ctrl / modo "Sempre").
3. **Nomear a jogada** pelo que ela faz, não pelo verbo genérico.
4. **Todo acontecimento visível tem rastro:** animação curta no lugar onde
   aconteceu e uma linha legível no histórico.
5. **Velocidade é do jogador.** Nenhuma animação longa sem um jeito de
   encurtar; nenhuma informação só existe dentro de uma animação.
6. **Informação oculta continua oculta.** Toda linha nova de histórico e todo
   evento novo passam pela mesma ótica por assento (`visibleTo`,
   `projectSnapshot`).

## 6. O plano, por fase

Cada fase lista o porquê, o que muda, onde, e como se prova. As Fases 1–8 são
a primeira entrega; 9–12 ficam para depois.

### Fase 1 — Nenhum popup prende a mesa  (D2, D10, D13, D16)

- **Esconder qualquer decisão.** Um estado só, "decisão espiada", no
  `DuelBoard`, para *todo* modal de prompt: `PromptModal`, seletor de cartas,
  declarar nome, contadores, ordenar cartas, posição. O modal fica **montado e
  oculto** (não desmontado) — o que já foi digitado no "declarar nome", os
  contadores distribuídos e a ordem montada sobrevivem. No lugar dele aparece
  a barra "Voltar à decisão" com o resumo do que se está decidindo.
- **Resultado do duelo também se esconde**: "Ver a mesa" encolhe o resultado
  para uma faixa com "Voltar ao resultado".
- **Esc** esconde/mostra a decisão e fecha pilhas e menus; `role="dialog"` e
  `aria-modal` nos modais, foco no primeiro botão ao abrir.
- **Alvo único em dois cliques no mesmo lugar:** quando a escolha é de
  exatamente 1 carta, clicar de novo na carta marcada confirma (na mesa e no
  seletor), como o clique duplo do MD. "Confirmar" continua lá.
- **Oponente primeiro no seletor:** num alvo de efeito, as cartas do oponente
  vêm antes das suas e cada uma diz de quem é — a lição do cursor do TF1, que
  começava nas próprias cartas e fazia o jogador destruir a si mesmo.
- Onde: `DuelBoard.tsx` (estado e barra), `AnnounceCardModal.tsx`,
  `SortCardModal.tsx`, `CounterSelectModal`, `CardPickerModal`,
  `ResultOverlay`.
- Prova: teste de navegador abre cada tipo de modal, esconde, abre o Cemitério
  com a decisão pendente, volta e confere que o estado sobreviveu.

### Fase 2 — Respostas na corrente: Automático / Sempre / Nunca  (D1)

- **Três modos**, como o MD, o Tag Force (TF3: Auto / Todas) e o EDOPro:
  - **Automático (padrão):** pergunta se a resposta é obrigatória; se o
    **oponente** acabou de ativar algo (há corrente e o último elo é dele); ou,
    fora de corrente, se o core marca a janela como relevante (`spe_count > 0`
    — algum candidato tem *timing* que casa com este momento: invocação,
    ataque, End Phase…). Não pergunta para encadear no próprio efeito.
  - **Sempre:** o comportamento de hoje — toda janela com resposta legal.
  - **Nunca:** só o obrigatório.
- **Segurar Ctrl** força "Sempre" enquanto estiver pressionado (o *Hold* do
  MD, o "segurar ○" do Tag Force); um botão de corrente na mesa mostra o modo
  atual e alterna entre os três — o modo fica sempre à vista, para ninguém
  esquecer o "Nunca" ligado.
- O TF6 separa o próprio turno do turno do oponente (*Próprio ON/OFF*). Aqui
  isso já sai do critério: no próprio turno o core quase nunca marca janela
  relevante fora da End Phase, então o automático já cala o próprio turno.
- Onde: `auto-response.ts` (a regra pura, testável), `duel-session.ts`
  (preferência por assento, trocável no meio do duelo), protocolo online
  (`duel-protocol.ts` → `room.ts`: o servidor é quem roda o engine), botão na
  mesa.
- Gatilhos opcionais (`SELECT_EFFECTYN`) continuam perguntando sempre — são
  decisões, não janelas.
- Prova: teste de sessão com os cenários da §7 (Ash contra Reforço, Mirror
  Force no ataque, Solemn na invocação, Scapegoat na End Phase) em cada modo, e
  a contagem de perguntas por duelo antes/depois em partidas inteiras.

### Fase 3 — Jogadas com nome  (D3)

- O rótulo vira o efeito: "Ativar — Special Summon 1 monster…" (texto da
  string da carta, em inglês como o ProjectIgnis a escreve; o resto da
  interface segue em PT) quando o core informa `description` e a carta tem
  mais de um efeito, ou quando a string existe. Sem string, fica "Ativar".
- O mesmo nas respostas da corrente ("Ativar em resposta — …") e no menu de
  batalha.
- Onde: `buildPromptPlan` já recebe `engineStrings`; o rótulo é calculado lá
  (o bot e o harness não usam rótulo).
- Prova: teste de regra com uma carta de dois efeitos ativáveis; `test:ui` e
  `test:ui-rare` continuam passando.

### Fase 4 — Ver o que aconteceu  (D4, D5, D6, D17)

- **Movimento com motivo.** Cada `MOVE` do campo para Cemitério, banidas, mão
  ou Deck vira um evento `leave` com a zona de origem e o motivo (destruída em
  batalha, destruída por efeito, enviada, tributada, usada como material,
  banida, devolvida). O motivo vem de uma consulta `REASON` à carta no
  destino — o binding descarta o `reason` do `MOVE`. A mesa desenha um
  fantasma da carta na zona de origem: estilhaço vermelho na destruição,
  esmaecimento violeta no banimento, subida na volta à mão.
- **Histórico que conta o jogo:** "Gemini Elf foi destruída em batalha",
  "Sangan foi enviada ao Cemitério", "Você atacou Sangan com Gemini Elf",
  "O oponente comprou 1 carta". Linhas de carregamento saem do histórico (vão
  para a tela de carga); dicas internas de seleção (💬) não entram mais —
  elas já aparecem onde servem, na barra da seleção. Cada linha guarda os
  códigos das cartas citadas: passar o mouse mostra a carta na leitura.
  Separador por turno.
- Informação oculta: carta virada para baixo que volta à mão ou ao Deck sai
  como "uma carta baixada"; o nome só aparece quando o destino é público
  (Cemitério, banida face para cima) ou a carta já era pública.
- Onde: `duel-session.ts` (`MOVE`, `ATTACK`, `DRAW`), `duel-events.ts`,
  `useDuelFeedback.ts`, uma camada `LeaveFlight` como a `AttackFlight`,
  `DuelLog`.
- Prova: `test:hidden` estendido (nome de carta baixada devolvida não vaza),
  teste de sessão para cada motivo, `test:multiplayer` (projeção).

### Fase 5 — Ritmo sob controle  (D11, D12)

- **Velocidade:** Normal / Rápida / Muito rápida, multiplicando as pausas da
  sessão *e* a duração das animações (destaque da corrente, voo do ataque,
  compra, fantasma da Fase 4) — as duas têm de andar juntas, senão o engine
  segue com a carta ainda no ar (o motivo de `pacing.ts` existir). Local:
  preferência do jogador. Online: o ritmo é da sala (o servidor roda o laço).
- **Desconto do "turno próprio" só quando ninguém mais assiste:** jogador
  local contra o bot. Online os dois são humanos — quem não clicou precisa do
  tempo inteiro.
- **Clique pula:** clicar no destaque da ativação (ou em qualquer aviso
  grande) encerra a animação e a pausa em curso — o ○ do Tag Force, o clique
  do MD. Só no duelo local: online a pausa é da sala.
- **Movimento reduzido de verdade:** o sistema pedindo menos movimento corta
  também os voos (Web Animations) e a moeda/dado.
- Onde: `pacing.ts`, `duel-session.ts`, `useDuelFeedback.ts`,
  `AttackFlight.tsx`, `DrawFlight.tsx`, `globals.css`.

### Fase 6 — Mesa limpa e legível  (D7, D8, D9, D14, D15)

- **Leitura fixa:** o painel continua mostrando a última carta lida; uma
  carta que sai de cena é trocada pela próxima que o mouse tocar. Antes da
  primeira, o painel mostra o que se está decidindo agora.
- **Zonas sem jargão:** zona vazia sem texto; Pêndulo com um "P" discreto;
  Campo, Cemitério e banidas com ícone/rótulo curto em PT; a zona ganha rótulo
  só quando é candidata de uma escolha.
- **Banidas fora da trilha de fases** (bug D9): o teto de largura das cartas
  passa a contar a pilha pendurada; teste de viewport passa a medir a
  interseção das banidas com a trilha.
- **Mão legível:** passar o mouse aumenta a carta da mão (cresce e sobe, sem
  empurrar as vizinhas), como a carta "levantada" do Tag Force.
- **De quem é a vez, sem ambiguidade:** selo "SUA VEZ" / "VEZ DO OPONENTE" na
  barra de LP de quem joga; no turno do bot, um "O oponente está jogando…"
  discreto quando nada é clicável.
- **Deck acabando:** contador do Deck fica vermelho com ≤ 5 cartas (com ≤ 10
  no MD ele só então aparece).
- **Regulador à vista:** o selo de Nível de um Regulador fica amarelo (TF4),
  porque é o que decide a Invocação-Sincro.

### Fase 7 — Configurações do duelo e atalhos  (D1, D11, D16)

- Uma engrenagem na barra do topo do duelo reúne: **Respostas** (Automático /
  Sempre / Nunca), **Velocidade**, **Som** (o controle atual), **Atalhos**.
  Guardado no navegador (é conveniência de quem joga, não dado do duelo).
- Atalhos: **Esc** esconde/mostra a decisão e fecha o que estiver aberto;
  **Enter** confirma uma seleção válida; **Ctrl segurado** força perguntar.
  A lista aparece na própria engrenagem.

### Fase 8 — Fim de duelo  (D13)

- "Ver a mesa" (Fase 1), **Revanche** contra o bot com os mesmos decks, e um
  resumo curto: turnos, LP final dos dois, motivo do fim.

### Fase 9 — Lobby contra o bot  (D18) — feita (§12)

- Quem começa: primeiro / segundo / moeda. Hoje o engine dá o primeiro turno
  ao assento 0, que é sempre o humano no duelo local — trocar exige montar o
  duelo com o humano no assento 1 (a mesa já sabe desenhar `me = 1`, é o que o
  online faz). Prévia do deck do bot.

### Fase 10 — Construtor de deck  (D19) — feita (§12)

- Confirmar "Limpar"; desfazer; **mão de teste** (compra 5, +1), como o MD;
  importar/exportar `.ydk` e `ydke://` (o formato do EDOPro/YGOPRODeck);
  estatísticas (monstros/magias/armadilhas, curva de nível); arrastar para
  adicionar/remover.

### Fase 11 — Toque e telas pequenas — feita (§12)

- Toque longo = ler a carta; menu de ação maior; layout retrato (o MD nunca
  fez — só paisagem). A mesa hoje não tem nenhum tratamento de toque.

### Fase 12 — Aprender jogando — feita (§12)

- Dicas de primeira vez (como os "Duel Academy" do Tag Force e os portões do
  MD), puzzles de duelo, glossário de termos na leitura da carta.

## 7. A medição que embasa a Fase 2

Sonda no core real (o mesmo wasm e os mesmos scripts do app), MR5, 4 turnos,
oponente jogando com o piloto automático, assento 0 passando toda janela.
`spe_count` é o número de candidatos cujo *hint timing* casa com o momento —
é o que o cliente do YGOPro/EDOPro usa para decidir se pergunta.

| Cenário | Janelas com resposta legal | Com `spe_count > 0` | Onde caíram as relevantes |
|---|---|---|---|
| Ash Blossom na mão; oponente ativa Reforço do Exército | 1 | 1 | a ativação do oponente |
| Mirror Force + Sakuretsu baixadas; oponente ataca | 3 | 3 | as declarações de ataque |
| Solemn Judgment baixada; oponente invoca | 2 | 2 | as invocações |
| Effect Veiler na mão; oponente com Sangan | 6 | 6 | invocação e Main Phase dele |
| Eu ativo Reforço com MST baixado | 1 | 1 | encadear no **próprio** efeito |
| MST + Book of Moon baixados | 35 | 19 | Standby, invocação, ataque, End Phase |
| **Scapegoat baixado** | **35** | **5** | ataques e End Phase do oponente |

Conclusões: armadilhas de gatilho (Mirror Force, Solemn) e hand traps já são
perguntadas só na hora certa — o core nem as oferece fora dela. O spam vem das
**Magias Rápidas e efeitos rápidos de uso amplo**, oferecidos em toda troca de
fase dos dois turnos; para elas o `spe_count` corta de 35 para 5–19. E a
única janela de "encadear no próprio efeito" é exatamente a que o MD tira do
automático. Os números de partidas inteiras (antes/depois) vão para o §11 na
implementação.

## 8. Verificação

- `npx tsc --noEmit`, `npm run lint`.
- Engine/sessão: `test:ui`, `test:ui-rare`, `test:prompt-rules`, `test:marks`,
  `test:hidden`, `test:formats`, `test:endgame`, `test:multiplayer`,
  `test:sort-card`, `test:modern-summons`, `test:presets -- --skip-duels` e
  um teste novo de modos de resposta.
- Navegador (app no ar): `test:browser` (Goat e `PRESET=tcg-…`),
  `test:browser-chain`, `test:browser-cancel`, `test:browser-announce`,
  `test:modern-play`, `test:board-modern`, `test:viewports`,
  `test:browser-online`, e um teste novo para "esconder qualquer popup".
- Capturas antes/depois das mesmas telas (`.cache/shots/`), olhadas uma a
  uma.

## 9. Riscos

- **Modo automático escondendo uma resposta que o jogador queria.** É o risco
  do MD também; mitigado pelo "segurar Ctrl", pelo botão de modo na mesa e
  pela regra de sempre perguntar quando o oponente ativa algo. O teste da
  Fase 2 fixa os cenários clássicos.
- **Fantasma da Fase 4 fora de sincronia com a mesa.** O `MOVE` chega depois
  que o engine já mudou o estado; o fantasma é desenhado a partir do último
  tabuleiro desenhado, não do novo — mesma técnica do voo do ataque.
- **Online:** toda preferência nova que muda o engine (modo de resposta)
  atravessa o protocolo; o que é só visual (velocidade das animações, leitura
  fixa) fica no navegador.

## 10. Fora do escopo desta rodada

Relógio de partida, espectadores no online, replays, ranking, música,
tutoriais roteirizados — registrados aqui, não esquecidos. (O layout para
celular e o bot × bot para assistir entraram nas Fases 11 e 12.)

## 11. Implementação — primeira entrega (Fases 1–8)

Branch `ui-ux-partida`, a partir da `main`. As Fases 9–12 e o D17 vieram
na segunda entrega, no mesmo PR (§12).

### Fase 1 — nenhum popup prende a mesa

- `DecisionShell` (`components/duel/DecisionShell.tsx`) é o casco de **todo**
  diálogo de decisão: perguntas (sim/não, efeito, corrente, posição), seletor
  de cartas, declarar nome, contadores e ordenar. Com `hidden` ele continua
  montado — o nome digitado, os contadores distribuídos, a ordem montada e as
  cartas marcadas sobrevivem à espiada. Ganhou também papel de diálogo,
  `aria-modal`, rótulo e foco ao abrir.
- "👁 Ver a mesa (Esc)" no rodapé de cada um; a barra "Voltar à decisão"
  vale para todos. **Esc** fecha primeiro o que é consulta (menu, pilha,
  reveladas, outras jogadas, deck) e depois alterna a decisão.
- O resultado do duelo também se esconde ("Ver a mesa final").
- Alvo único: clicar de novo na carta marcada confirma (na mesa e no
  seletor); **Enter** confirma uma seleção pronta — mas não quando o foco está
  numa carta ou botão, que é de quem o Enter é (confirmar junto mandaria a
  seleção de antes do clique).
- No seletor, as cartas do oponente vêm primeiro e, quando a lista mistura
  os dois lados, cada carta diz de quem é (a lição do cursor do TF1).

### Fase 2 — perguntar "deseja responder?" só quando importa

- Regra em `lib/duel/chain-mode.ts`, aplicada na sessão antes de a pergunta
  chegar à tela (só para assento humano). Online a preferência vai pelo socket
  (mensagem `prefs`, validada pela sala, guardada no jogador e reaplicada a
  cada partida; quem cai com o Ctrl apertado é solto).
- **Medição em partidas inteiras** (`test:chain-mode`, §6 do teste: decks
  pré-montados, os dois lados no piloto automático, a mesma partida contada
  nos três modos):

  | Formato | Partidas | Janelas com resposta legal (= Sempre) | Automático | Corte | Ativações do oponente com resposta possível | Perguntadas no Automático |
  |---|---|---|---|---|---|---|
  | Goat | 8 (248 turnos) | 390 | 50 | −87% | 23 | 23 |
  | TCG | 8 (266 turnos) | 370 | 82 | −78% | 22 | 22 |

  Nos cenários: Scapegoat baixado, 30 perguntas em 4 turnos no Sempre, 4 no
  Automático (ataques e End Phase do oponente); a Ash continua oferecida na
  busca do oponente; encadear no próprio Reforço deixa de ser perguntado.
- **Mudou em relação ao plano:** o botão de modo na mesa alterna os três
  modos persistentes e fica sempre à vista ("⛓ Auto/Sempre/Nunca", vermelho
  no Nunca, "Parando" com o Ctrl). Não há o "Sempre até o fim do turno" do
  MD: o Ctrl segurado cobre o caso de parar numa janela específica.

### Fase 3 — jogadas com nome

- O rótulo continua sendo o verbo ("Ativar") e o efeito vai embaixo, em
  `CardAction.detail` — no menu da carta, na pilha e na resposta da corrente.
  Mudar o rótulo em si quebraria quem acha a ação pelo verbo (os testes de
  navegador e o olho). Strings do sistema que só dizem "Activate" não viram
  detalhe; "Activate it as a Pendulum Spell" vira "Como Escala de Pêndulo".

### Fase 4 — ver o que aconteceu

- `narrateFieldExit` na sessão: cada saída do campo vira linha com motivo e o
  evento `leave`. O motivo vem de uma consulta `REASON` à carta **no
  destino**, conferindo que é a mesma carta (o binding lê o `MOVE` sem o
  `reason`). Pêndulo destruído indo ao Extra Deck conta como destruição.
- `LeaveFlightLayer` desenha o fantasma pela **zona** e pelo código, não pelo
  elemento antigo: no online o tabuleiro novo chega antes do evento. Sons
  novos: estilhaço (destruição) e sumiço (banimento), um por instante num
  Raigeki.
- Histórico: linhas tipadas (`turn`, `phase`, `hint`, `system`), cartas
  citadas (`codes`) e quem agiu (`actor`). A tela tira as linhas de carga e
  as dicas de seleção, faz do turno um separador e pinta cada linha com a cor
  do lado; passar o mouse mostra a carta. Ataque com nomes; compra por
  efeito registrada (a da Draw Phase e a mão inicial, não).
- **Achado no caminho:** este binding não marca matéria Xyz com o bit
  `OVERLAY` na localização — manda a zona do monstro Xyz e um
  `overlay_sequence`. Na Invocação-Xyz a matéria é anexada ao Xyz ainda no
  Extra Deck, e a primeira versão do histórico dizia "Battle Ox foi para o
  Extra Deck". Corrigido (e coberto em `test:duel-log`). O mesmo detalhe
  escondia um defeito antigo: desanexar uma matéria apagava as marcas do
  próprio monstro Xyz (contadores, avisos), porque a matéria "saía" da zona
  dele. Também corrigido.
- **D17 ficou para a segunda entrega:** o histórico continuava em PT com as
  cartas em EN — o texto é montado na sessão (no online, no servidor). Feito
  em §12, pelos `codes` das linhas.

### Fase 5 — ritmo

- Velocidade Normal / Rápida / Muito rápida (1 / 0,6 / 0,3) no duelo local:
  a mesma escala vai para as pausas da sessão (`setPace`) e para as
  animações (destaque, voo do ataque, compra, saída, moeda/dado). Online o
  ritmo é da sala, e a engrenagem diz isso.
- Clicar no destaque de uma ativação pula a animação e a pausa (`hurry`).
- O desconto do turno próprio passou a valer só para humano local contra o
  bot (`ownTurnDiscount`) — antes o assento 0 de um duelo online via tudo
  acelerado e o 1 tudo lento.
- Movimento reduzido: voos e fantasmas não rodam; moeda e dado param no CSS.

### Fase 6 — mesa limpa

- Leitura fixa: o painel fica na última carta lida, com os valores atuais
  quando ela continua na mesma zona (senão, a carta impressa); antes da
  primeira, mostra o elo da corrente ou a carta da pergunta.
- Zonas vazias sem "Mon1"/"M/A5 · P" — só "P" nas de Pêndulo.
- **Bug das banidas:** o teto de largura das cartas passou a contar as
  pilhas penduradas fora da fileira (`(100cqw − 64px) / 8,3`). O
  `test:viewports` não pegava porque Cemitério e banidas não tinham
  `data-pile`; agora todas as pilhas têm, e uma sonda com a fórmula antiga
  aplicada na página acusa `banished-0` e `banished-1` sobre os trilhos.
- Mão: a carta cresce 45% e sobe ao passar o mouse (sem crescer com o menu
  aberto, para o menu não crescer junto).
- Selo "Sua vez"/"Vez do oponente" na barra de LP de quem joga; "Fulano está
  jogando…" quando a mesa anda sozinha (entra com atraso no CSS, sem piscar).
- Deck com ≤ 5 cartas em vermelho; Regulador com selo "★N R" amarelo.

### Fases 7 e 8 — engrenagem e fim de duelo

- Engrenagem (`DuelSettings.tsx`): respostas, velocidade, lista de atalhos;
  preferências no navegador (`duel-prefs.ts`, `useDuelPrefs`). Esc fecha.
- Fim de duelo: turnos e LP finais, **Revanche** (contra o bot: a mesa é
  remontada com os mesmos decks), "Trocar de deck" e "Ver a mesa final".

### Verificação executada

Na branch final, com a app em produção (`npm run build` + `server.mjs`):

| Camada | Teste | Resultado |
|---|---|---|
| Tipos e lint | `tsc --noEmit`, `eslint src tools/harness` | limpos |
| Regra e sessão | `test:chain-mode` (novo) | regra caso a caso, sessão real nos três modos, medição da tabela acima |
| | `test:duel-log` (novo) | ataque com nomes, batalha × efeito, compra, matéria Xyz, marcas do Xyz, carta baixada sem nome |
| | `test:prompt-rules` | inclui os rótulos de efeito (Soldado do Lustro Negro, Pêndulo, Ash) |
| | `test:ui` (10 duelos), `test:ui-rare`, `test:presets` (110 partidas bot × bot em MR5) | 0 prompt sem resposta; 110 vitórias, 0 RETRY |
| | `test:hidden`, `test:marks`, `test:endgame`, `test:formats`, `test:multiplayer` (com a preferência pela rede), `test:modern-summons`, `test:sort-card`, `test:cancel`, `test:patches`, `test:deck-library` | verdes |
| Navegador | `test:browser-peek` (novo) | esconder cada popup, Cemitério com decisão pendente, estado preservado, engrenagem, revanche |
| | `test:browser-chain`, `-cancel`, `-announce`, `test:modern-play`, `test:board-modern`, `test:draw`, `test:attack` | verdes |
| | `test:browser` Goat e `PRESET=tcg-ys17`, `test:browser-online` Goat e `FORMATO=tcg` | duelos até o fim, sem exceção nem erro de console |
| | `test:viewports` | 6 telas + movimento reduzido, nada sob os trilhos (e acusa o bug antigo) |

Os testes de navegador também ganharam correções próprias no caminho: o de
declarar nome procurava um nome que o catálogo já não usa e cobria 1 dos 6
prompts (agora escolhe pelo passcode); vários laços clicavam botões de
consulta ("👁", "Ver a mesa") em vez de jogar — esses controles agora têm
`data-table-control`, que os laços ignoram.

**O que não foi verificado por ninguém além de mim:** a sensação — se as
durações da velocidade "Muito rápida" ainda deixam ler o destaque, se o
fantasma de saída pesa demais num Raigeki, se o zoom da mão incomoda. Isso
pede uma partida jogada por gente.

## 12. Implementação — segunda entrega (Fases 9–12 e D17)

Mesma branch e mesmo PR. O que cada fase virou, e o que ficou de fora.

### Fase 9 — quem começa e a prévia do deck do bot

- No lobby, **Quem começa: Eu / O bot / Moeda**. O core sempre dá o turno 1
  ao assento 0; "o bot começa" põe o humano no assento 1 (`humanSeat`), e a
  mesa — que já sabia desenhar `me = 1` por causa do online — vira junto. A
  moeda é sorteada a cada partida (a revanche sorteia de novo) e o resultado
  abre o histórico.
- **Prévia do deck do bot** (`DeckPreview`): os tipos (monstros, magias,
  armadilhas) e as cartas principais, com "ver a lista completa".
- Achado no caminho: com o humano no assento 1, as Magias de Campo eram
  desenhadas trocadas (a minha de cabeça para baixo, a do oponente de pé) —
  a regra era "dono = 1", não "dono = oponente". Corrigido.

### Fase 10 — construtor de deck

- **Desfazer** (botão e Ctrl+Z), por deck, até 50 passos; renomear não conta.
- **"Limpar" em dois cliques** (o segundo, em até 3 s, confirma — e o
  Desfazer ainda traz o deck de volta).
- **Mão de teste**: embaralha e compra 5, com "+1" para ver o turno seguinte.
- **Estatísticas**: monstros/magias/armadilhas e a curva de nível (a cor das
  barras passou no validador de paleta sobre o painel escuro).
- **Importar/exportar** `.ydk` e `ydke://` (`deck-codec.ts`). Importar abre um
  deck **novo**, nunca escreve por cima do aberto.
- **Arrastar** do catálogo para o deck e do deck de volta para remover.

### Fase 11 — toque e telas pequenas

- **Toque longo** (450 ms) numa carta abre a leitura; toque simples continua
  sendo "clicar".
- **Mesa estreita** (≤ 900 px): a leitura vira uma folha que sobe de baixo e
  o histórico um painel aberto por botão (os dois botões ficam no fim da
  trilha de fases), deixando a largura para as cartas.
- **Mesa baixa** (celular deitado): a trilha de fases rola em vez de cortar o
  turno e o EP; navegação e cabeçalho compactos.
- Alvos de toque maiores em `pointer: coarse`.
- `test:viewports` passou a medir 768×1024, 844×390 e 390×844 (além das
  anteriores) e o toque longo.

### Fase 12 — aprender jogando

- **Dicas de primeira vez** (`tips.ts`): uma por vez, no momento em que
  servem (responder a uma corrente, esconder um diálogo, selecionar na mesa,
  Battle Phase, como jogar, como ler). "Entendi" some com ela para sempre;
  "Desligar dicas" (também na engrenagem) cala todas; "Rever todas" recomeça.
  A dica não aparece para quem só assiste, nem enquanto a decisão está
  escondida para ver a mesa.
- **Duelos-problema** *(removidos em 2026-10-13 — a página, o modo na sessão
  e o `test:puzzles` saíram; o que segue é o registro de como era)*
  (`/duel/puzzles`, `puzzles.ts`): a mesa vem montada e
  é preciso vencer **neste turno** — "Raio final" (Raigeki), "Abra caminho"
  (Tufão na Força do Espelho) e "Mudança de opinião". O objetivo fica num
  painel minimizável (no celular começa fechado num selo), com uma dica a um
  clique; passar o turno sem vencer encerra o problema, e só então a
  solução fica disponível. Resolvidos ganham ✓ na lista. No core: sem mão
  inicial, LP do problema e `ATTACK_FIRST_TURN` (atacar no turno 1).
- **Glossário** (`glossary.ts`): 30 termos (Invocação-Tributo, alvo, Corrente,
  Cemitério, banir…), em PT e EN, sublinhados na leitura da carta (mesa e
  construtor); um clique abre a definição. Só a primeira ocorrência de cada
  termo, a grafia mais longa ganha, e nunca dentro de outra palavra
  ("Settle" não acha "Set").
- **Assistir bot × bot**: o seu deck, pilotado pelo bot, contra o deck
  escolhido. A mesa é a do assento 0 (`watchSeat`), sem perguntas, sem
  rendição, e os avisos dizem "VEZ DE …" em vez de "SEU TURNO".

### D17 — histórico no idioma das cartas

As linhas do histórico que citam cartas carregam os `codes` delas (ataque,
efeito, compra revelada, aviso de carta inerte, contadores, equipamento,
alvo, carta/tipo/atributo/número declarado, revelações). A tela troca o nome
em PT pelo do idioma escolhido (`localizeLogText`, nomes mais longos
primeiro, para "Dragão Branco" não comer o começo de "Dragão Branco de Olhos
Azuis"). No online a sessão do servidor continua escrevendo em PT, e cada
cliente traduz para si.

### Achados da verificação

- **O glossário enganava os testes de navegador.** Os termos sublinhados são
  botões; com Libertar Almas na leitura, o "Cemitério" do texto vinha antes,
  no DOM, da carta "Cemitério" do seletor, e o laço do `test:browser` clicou
  no termo 240 vezes — e passou, porque o teste só imprimia as últimas ações
  para alguém ler. Os termos agora são `data-table-control` (ajuda de
  leitura, como o "👁 Ver a mesa"), o `clickAction` prefere botões de jogo e
  só recorre aos controles da mesa quando nenhum casa, e o `test:browser`
  reprova 25 cliques iguais seguidos (acusou o laço na versão anterior).
- **Celular:** o selo "Sua vez" vazava da barra de LP sobre a do oponente; o
  item novo "Puzzles" empurrava o PT/EN para fora da janela de 390 px, e no
  cabeçalho fora da mesa "Puzzles" e "Online" ficavam escondidos na parte
  que rola. A navegação rola sem levar o idioma, encurta "Deck Builder" para
  "Deck", e o cabeçalho empilha. O `test:viewports` mede as três coisas (e
  acusa a versão anterior de cada uma).
- **Dica e objetivo se tapavam** no celular (a dica de 80% cobria o objetivo
  inteiro e metade do campo): o objetivo começa fechado num selo e a dica para
  antes dele.
- **Bot × bot dizia "SEU TURNO"** a quem só assiste: o aviso agora diz "VEZ DE
  …" com o nome.

### Pedidos do teste manual

- **Nível em número na leitura:** "Nv. 3 ★★★" (o mesmo "Nv." do
  construtor), como o Rank e o Link já faziam — e "Link 1" antes das setas.
  Nível mudado por efeito ganha a cor do ATK/DEF alterado.
- **O que a carta ativada faz, mesmo sem corrente.** O texto do elo só
  aparecia no diálogo "deseja responder?", que no modo Automático quase nunca
  abre; o destaque mostrava a carta por um segundo e nada mais. Agora o
  destaque traz o efeito ativado e três linhas do texto, e a **leitura da
  esquerda segue cada ativação** ("⛓ Elo 2 — Oponente ativou da mão", o
  efeito, o texto inteiro com o glossário) e fica nela até o jogador passar o
  mouse em outra carta. O efeito vem do core (`strings.conf`), que só existe
  em inglês — "Negate that effect" —; o texto da carta, logo abaixo, segue o
  PT/EN.
- Os ajudantes dos testes (`clickText`, `clickAction`) preferem botões de
  jogo: o glossário sublinha "Invocar por Invocação-Especial" e "Baixar" no
  texto das cartas, e o termo na leitura ganhava do "Invocar" do menu (o
  `test:board-modern` deixou de invocar o Breaker por isso). O `test:attack`,
  o `test:draw` e o `shots` também passaram a ignorar os controles da mesa
  (o `test:attack` rodou 200 s clicando no glossário sem ver ataque).
- O `test:browser-decks` saía com código 0 quando a biblioteca nem aparecia
  (um `return` antecipado pulava o relatório) — com o servidor fora do ar,
  contava como verde. Agora reprova.

### O que ficou de fora

- Espectador no online (assistir a sala de outros) e replays.
- Mais duelos-problema: três ensinam as ideias básicas; o formato
  (`DuelPuzzle`) aceita mais sem código novo.
- Tutoriais roteirizados (aulas passo a passo).

### Verificação executada

Na branch final, com a app em produção (`npm run build` + `server.mjs`):

| Camada | Teste | Resultado |
|---|---|---|
| Tipos e lint | `tsc --noEmit`, `eslint src tools/harness` | limpos |
| Sessão e dados | `test:learning`, `test:puzzles`, `test:deck-codec` (novos) | 20, 13 e 12 checagens; cada puzzle vence só pela solução |
| | `test:duel-log` | 35 checagens: `codes` em toda linha que cita carta, nomes em inglês, bot começando (assento 1) |
| | `test:ui` (10 duelos), `test:ui-rare`, `test:presets` (110 partidas bot × bot em MR5) | 0 prompt sem resposta; 110 vitórias, 0 RETRY |
| | `test:chain-mode`, `test:prompt-rules`, `test:hidden`, `test:marks`, `test:endgame`, `test:formats`, `test:multiplayer`, `test:modern-summons`, `test:sort-card`, `test:cancel`, `test:patches`, `test:deck-library`, `test:triggers`, `test:remaining`, `test:archetypes`, `test:token-images`, `test:tcg-pool`, `test:cards`, `test:connection` | verdes |
| Navegador | `test:browser-learning` (novo) | 26 checagens: puzzle resolvido por cliques, erro → solução → tentar de novo, objetivo minimizável, glossário, dicas, celular, bot × bot |
| | `test:browser-builder` (novo) | 26 checagens: construtor e lobby (Fases 9 e 10) |
| | `test:viewports` | 12 telas (Goat e TCG, de 1440×900 a 390×844), toque longo, cabeçalho fora da mesa e movimento reduzido |
| | `test:browser` Goat (5 partidas) e `PRESET=tcg-ys17` (2), `test:browser-online` Goat e `FORMATO=tcg` | duelos até o fim, sem laço, sem exceção nem erro de console |
| | `test:browser-peek`, `-chain`, `-cancel`, `-announce`, `-decks`, `test:modern-play`, `test:board-modern`, `test:draw`, `test:attack` | verdes |

Nenhum teste deixou arquivo em `.data/decks`.

**O que não foi verificado por ninguém além de mim:** se as dicas ajudam ou
cansam quem está aprendendo, se os três problemas têm a dificuldade certa, e
como a mesa se sente num celular de verdade (a medição é com toque emulado
no Chrome). Isso pede gente jogando.

## Fontes

Master Duel:
- [gameplay.tips — tela de duelo, menus e ícones](https://gameplay.tips/guides/yu-gi-oh-master-duel-duel-screen-info-guide-duel-field-menu-and-icons.html)
- [outof.games — Activation Confirmation](https://outof.games/yu-gi-oh/guides/225-activation-confirmation-toggle-function-how-to-make-the-most-of-master-duels-prompts/)
- [outof.games — lendo as cartas do oponente](https://outof.games/realms/yugioh/guides/224-reading-your-opponents-cards-how-to-glean-information-on-handtraps-more-in-master-duel/)
- [outof.games — melhorias de qualidade de vida](https://outof.games/news/5582-yu-gi-oh-master-duel-adds-quality-of-life-improvements-to-the-game-including-the-ability-to-export-decks-and-to-delete-multiple-decks-at-once/)
- [Toutiao — aba de configurações de duelo, item a item](https://www.toutiao.com/zixun/7493305073066641423/)
- [YGOrg — versão 1.5.1](https://ygorganization.com/master-duel-version-1-5-1-update) ·
  [1.7.1](https://ygorganization.com/master-duel-new-version-updates/) ·
  [2.1.0](https://ygorganization.com/master-duel-2-1-0-version-update/) ·
  [2.7.0](https://ygorganization.com/master-duel-version-2-7-0-update/) ·
  [atualização de 8/ago](https://ygorganization.com/master-duel-august-8th-update/) ·
  [atualização de 6/fev](https://ygorganization.com/master-duel-february-6th-update/)
- [Master Duel Meta — relógio](https://www.masterduelmeta.com/articles/quick-news/september-2022/timer-update/) ·
  [atualização de jul/2025](https://www.masterduelmeta.com/articles/news/july-30-2025/master-duel-update/)
- [Steam — velocidade das animações](https://steamcommunity.com/app/1449850/discussions/0/601897212769797807) ·
  [modo de confirmação](https://steamcommunity.com/app/1449850/discussions/0/5595187488977629948) ·
  ["por que não posso ativar?"](https://steamcommunity.com/app/1449850/discussions/0/4534563767366439755)
- [multiplayer.it — três coisas a melhorar](https://multiplayer.it/articoli/yu-gi-oh-master-duel-tre-cose-da-migliorare-al-piu-presto.html) ·
  [SciFi Bloggers](https://scifibloggers.com/five-thoughts-on-yu-gi-oh-master-duel-part-1/amp) ·
  [indiecator](https://indiecator.org/2022/03/11/the-problem-with-yu-gi-oh-master-duel/)

Tag Force:
- [GameVortex — análise do TF1 com a tela do duelo](https://www.psillustrated.com/psillustrated/soft_rev.php/3326/yugioh-gx-tag-force-psp.html)
- [gcmatome — TF1](https://w.atwiki.jp/gcmatome/pages/2378.html) ·
  [TF3](https://w.atwiki.jp/gcmatome/pages/4849.html) ·
  [TF4](https://w.atwiki.jp/gcmatome/pages/5067.html) ·
  [TF6](https://w.atwiki.jp/gcmatome/pages/4873.html) ·
  [TFSP](https://w.atwiki.jp/gcmatome/pages/6003.html)
- [Wiki do TF6 — configurações de duelo](https://w.atwiki.jp/1548908-tf6/pages/13.html) ·
  [atalhos do TF6](https://tf6-4ever.com/knowledge/)
- [note.com — o "chain dialog" do TF3](https://note.com/adnauseam/n/nc4800c2b993b)
- [GameFAQs — TF4: ativar no turno do oponente](https://gamefaqs.gamespot.com/psp/960317-yu-gi-oh-5ds-tag-force-4/answers/142366-how-do-i-activate-trap-cards-and-quick-play-spell-cards-on-my-opponents-turn) ·
  [TF6: confirmação de ativação](https://gamefaqs.gamespot.com/psp/634323-yu-gi-oh-5ds-tag-force-6/answers/293840-battle-animations)
- [Yugipedia — GX Tag Force](https://yugipedia.com/wiki/Yu-Gi-Oh!_GX_Tag_Force) ·
  [5D's Tag Force 4](https://yugipedia.com/wiki/Yu-Gi-Oh!_5D%27s_Tag_Force_4)
- [Worth Playing — TF2](https://www.worthplaying.com/article/2007/12/1/reviews/47125-psp-review-yu-gi-oh-gx-tag-force-2/) ·
  [TF4](https://www.worthplaying.com/article/2010/6/2/reviews/74642-psp-review-yu-gi-oh-5ds-tag-force-4/) ·
  [GamesRadar — TF1](https://www.gamesradar.com/yu-gi-oh-gx-tag-force-review/2/)
- [TGS 2026 — o remake TAG FORCE GX nas mãos](https://saiganak.com/review/tgs2026-yugioh-tagforcegx-hands-on/331770/)
- Comparação: [Cubed3 — Legacy of the Duelist: Link Evolution](https://www.cubed3.com/games/reviews/nintendo-switch/yu-gi-oh-legacy-of-the-duelist-link-evolution)
