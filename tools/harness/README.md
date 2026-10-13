# Harness de testes do duelo

Roda o **ocgcore de verdade** — o mesmo wasm que o app usa, com os mesmos
scripts Lua do ProjectIgnis — fora do navegador. Serve para responder, carta a
carta, a pergunta que antes só se respondia jogando: *este efeito funciona?*

## Preparar

```bash
node tools/harness/sync-fixtures.mjs      # clona CardScripts + baixa o pool Goat
node scripts/build-card-db.mjs            # gera src/data/card-db.json
```

Ambos escrevem em `.cache/` (fora do controle de versão). O CardScripts fica
**no commit fixo** de `src/lib/duel/cardscripts-pin.ts` — o mesmo que o app lê
pela rota `/api/scripts` e pelo servidor online. Subir esse commit é decisão
(junto com a versão do binding, seguida da bateria inteira); o harness avisa
quando o clone está em outro commit.

## Os testes

Há atalhos no `package.json` para todos eles (`npm run test:cards`,
`test:archetypes`, `test:ui`, `test:ui-rare`, `test:browser`, `fixtures`,
`build:card-db`, `build:engine-strings`).

| comando | o que responde |
|---|---|
| `node tools/harness/test-cards.mjs` | Para cada uma das ~1.700 cartas do pool Goat: o script carrega sem erro de Lua? A carta é oferecida para ativar/invocar no Main Phase 1? |
| `npm run test:tcg-pool` | O mesmo do `test-cards`, para as ~13 mil cartas TCG com script, em Master Rule 2020 e com os monstros de Extra Deck no Extra Deck. Roda em 4 processos (`--jobs N`). Falhas já conhecidas ficam listadas no próprio arquivo e não reprovam. |
| `npm run test:modern-summons` | Sincro, Xyz, Link e Pêndulo pelo caminho da tela (`autoResponseFor` → `buildPromptPlan`, `decodeFieldMask`, `readBoardState`), mais a leitura de volta das escalas e setas que o core guardou. |
| `npm run test:board-modern` | Navegador: mesa TCG montada por `scenario` (Link em cada Zona Extra, escalas, Xyz, Pêndulo destruído indo para o Extra Deck do oponente). Confere setas, zonas apontadas, selos, o Extra Deck público e a leitura da carta com o número antes dos símbolos ("Nv. 4 ★★★★", "Rank 4 ☆☆☆☆", "Link 1"); fotos em `.cache/shots/tcg-*.png`. Precisa da app no ar (`APP_URL`). |
| `npm run test:modern-play` | Navegador, só cliques: Sincro, Xyz e Link pelo Extra Deck que brilha, efeito de Cemitério, escalas + Invocação-Pêndulo e declaração de nome de arquétipo. Fotos de cada passo em `.cache/shots/jogo-*.png`. Precisa da app no ar (`APP_URL`). |
| `npm run test:marks` | Marcas das cartas (contador, turnos, declaração, aviso, equipamento, alvo, negação, aviso de jogador, zona interditada) na `DuelSession` real, nas duas óticas e na projeção por assento. |
| `npm run test:formats` | A `DuelSession` roda as regras do formato pedido (Goat compra no 1º turno, TCG não). |
| `npm run test:presets` | Os decks pré-montados: validação de todos (Main/Extra, zona certa, dados oficiais e script, prova cruzada Goat × Yugipedia) e **uma partida bot × bot por deck TCG** em MR5, com cada prompt do assento 0 passando pela régua do `test:ui`. `--only id1,id2` repete partidas; `--skip-duels` só valida. Em massa: `--rodadas N --fatia i/n --json saída` (rode n processos; os dois assentos passam pela régua, e o resumo conta RETRY e `eof` recuperados, partidas longas e as mensagens que o binding não leu). |
| `npm run test:token-images` | Toda ficha do banco oficial tem nome no catálogo e imagem (arte da YGOPRODeck ou a face desenhada quando ela não tem); com `APP_URL`, carrega as duas pela rota num Chrome e grava a face em `.cache/shots/ficha-sem-arte.png`. |
| `npm run test:sort-card` | "Recoloque as cartas do topo na ordem que quiser": a resposta é aceita (conserto do binding no `postinstall`) e a ordem escolhida na tela é a que fica no Deck. |
| `node tools/harness/test-archetypes.mjs` | Cartas de arquétipo, com companheiros do mesmo `setcode` em campo/mão/deck: o efeito **enxerga** os parceiros? |
| `node tools/harness/test-ui-prompts.mjs` | Joga duelos inteiros e submete cada pergunta do engine ao mesmo código que a tela usa. Acha prompts que a UI não sabe responder — a causa de duelo congelado. |
| `node tools/harness/test-ui-rare-prompts.mjs` | Força os prompts raros (ANNOUNCE_*, SELECT_SUM, SORT_CARD, SELECT_DISFIELD) pondo na mão a carta que produz cada um. São justamente os que passam despercebidos num duelo comum. |
| `node tools/harness/test-browser.mjs` | Ponta a ponta num Chrome real: abre o lobby, começa o duelo e joga clicando. `PRESET=tcg-ys17` joga um deck TCG (contra um deck TCG do bot). Ao travar, mostra botões, modais, a mesa e grava uma foto em `.cache/shots/travou-*.png`; sair da mesa também reprova, e o mesmo clique 25 vezes seguidas (um laço: o botão não faz o que o teste acha) também. |
| `node tools/harness/test-browser-announce.mjs` | Igual, mas com um deck montado só com as cartas dos prompts raros — é o que faz o modal de declarar raça/carta e o texto real das opções aparecerem na tela de verdade. |
| `node tools/harness/screenshot.mjs [n]` | Fotos do duelo em `.cache/shots/`. Ler o DOM diz se a tela funciona; só olhando dá para dizer se está boa. |
| `node tools/harness/test-triggers.mjs` | Cartas reativas: constrói o EVENTO (ataque, invocação, ativação do oponente) em vez de só o tabuleiro. |
| `node tools/harness/test-remaining.mjs` | As cartas com condição própria e específica — cada uma com o cenário exato lido do seu Lua. |
| `node tools/harness/test-patches.mjs` | Vigia as emendas de `script-patches.ts`: âncora ainda casa, tolera reindentação, e as cartas que dependem dela seguem funcionando. |
| `node tools/harness/test-bot.mjs [partidas] [passivo\|guloso] [goat\|tcg]` | O bot joga melhor? Cenários dirigidos (não ataca de peito aberto, compra antes de invocar, responde ao ataque; no TCG: não troca monstro bom por Link fraco, faz o Xyz que vale, põe escala de Pêndulo só com faixa útil, não encadeia hand trap na própria jogada) e depois um placar contra dois adversários de referência. `tcg` usa os ~100 decks pré-montados em MR5. `--partidas 59,100` repete partidas específicas; num RETRY_LOOP o relatório mostra a resposta recusada e de quem era. |
| `node tools/harness/test-cancel.mjs` | Desistir de uma Invocação-Tributo: o core aceita e o campo fica intacto. |
| `node tools/harness/test-browser-cancel.mjs` | O mesmo, mas pela tela — o botão aparece e devolve o turno. |
| `npm run test:chain-mode` | Quando a tela pergunta "deseja responder?" (`chain-mode.ts`): a regra caso a caso, a `DuelSession` real nos três modos (Ash contra Reforço, Scapegoat no ataque e na End Phase, encadear no próprio efeito, Ctrl segurado, troca no meio do duelo) e a medição em partidas inteiras de decks pré-montados — quantas perguntas cada modo faria, e que nenhuma ativação do oponente com resposta possível deixa de ser perguntada. `CHAIN_MODE_PARTIDAS=N` muda o tamanho da medição. |
| `npm run test:duel-log` | O histórico conta o jogo: ataque com nomes, destruição em batalha × por efeito, compra por efeito, o evento `leave` com a zona de origem — e a carta baixada devolvida à mão sai sem nome nem código (linha e evento atravessam a rede). Confere também os tipos de linha (`system`, `hint`, `turn`, `phase`), que toda linha que cita carta leva os `codes` dela (é o que a tela usa para mostrar o nome no idioma escolhido) e o duelo com o bot começando (humano no assento 1). |
| `npm run test:browser-peek` | Navegador: nenhum popup prende a mesa. Esconde o seletor de cartas com uma carta marcada, abre o Cemitério com a decisão pendente, volta pelo Esc com a marca intacta e confirma clicando de novo; o mesmo na declaração de nome (a busca digitada sobrevive); engrenagem e botão de modo de resposta; rendição → "Ver a mesa final" → Revanche. Fotos em `.cache/shots/popup-*.png`. Precisa da app no ar (`APP_URL`). |
| `node tools/harness/test-browser-chain.mjs` | A corrente pela tela (`npm run test:browser-chain`): ativo Reforço do Exército, o bot encadeia Ash Blossom da mão. Confere o destaque de cada elo (quem ativou, de onde, o número, o texto da carta), a leitura da esquerda seguindo cada ativação ("Elo 2 — Oponente ativou da mão", e a Ash continua lá depois da corrente), a pilha da corrente (resolvendo / efeito negado), o carimbo NEGADO e o histórico. Fotos em `.cache/shots/corrente-*.png`. |
| `node tools/harness/test-draw-landing.mjs` | Mede onde a carta comprada pousa: tem que ser o slot real da mão. |
| `node tools/harness/test-attack-rotation.mjs` | O monstro do oponente não pode se endireitar ao atacar. |
| `node tools/harness/test-viewports.mjs` | Telas menores e "movimento reduzido" ligado: 1440×900 até celular em pé (390×844) e deitado (844×390), Goat e TCG. Mede também se alguma zona ou pilha (inclusive as banidas, penduradas fora da fileira) cai sob os trilhos laterais ou sai da janela, se algo vaza da barra de LP, se todo item da navegação e o PT/EN estão à vista (também no cabeçalho fora da mesa) e se o toque longo abre a leitura. |
| `npm run test:deck-codec` | Importar/exportar deck (`deck-codec.ts`): `.ydk` e `ydke://` contra um vetor conhecido, ida e volta sem perder cópia nem trocar zona, os arquivos "sujos" que circulam (CRLF, comentário, nome depois do passcode) e passcode desconhecido contado à parte. |
| `npm run test:browser-builder` | Navegador, construtor e lobby (Fases 9 e 10): desfazer (botão e Ctrl+Z), "Limpar" com confirmação que o desfazer traz de volta, estatísticas que batem com o deck, mão de teste (5 e +1), exportar `ydke://` e importar o mesmo link como deck novo, arrastar nos dois sentidos; no lobby, a prévia do deck do bot, "o bot começa" (turno 1 dele, humano no assento 1, revanche mantém a ordem) e a linha do sorteio da moeda. Apaga as bibliotecas de teste de `.data/decks` ao fim. Precisa da app no ar (`APP_URL`). |
| `npm run test:puzzles` | Os duelos-problema na `DuelSession` real: a solução de cada um vence no turno 1, a mesa começa sem mão comprada, o caminho ingênuo não vence, e no "Abra caminho" é a Força do Espelho do bot que pune o ataque de peito aberto. |
| `npm run test:learning` | As peças do "aprender jogando": glossário (PT e EN, grafia mais longa, nunca dentro de outra palavra), a ordem das dicas, o progresso dos puzzles lido com cuidado e o bot × bot na sessão real (ninguém é perguntado, só o assento assistido é lido). |
| `npm run test:browser-learning` | Navegador: resolver um puzzle só com cliques (e o ✓ na lista), errar outro e ver a solução e o "Tentar de novo", o objetivo minimizável (fechado no celular, sem a dica por cima), o glossário na leitura da carta, as dicas (somem depois de vistas, desligam na engrenagem) e o bot × bot (sem perguntas; o aviso diz "VEZ DE …", nunca "SEU TURNO"). Precisa da app no ar (`APP_URL`). |

Os dois testes de UI precisam do carregador de TypeScript (é assim que eles
exercitam o código real da tela, em vez de uma cópia em JS):

```bash
node --import ./tools/harness/ts-loader-register.mjs tools/harness/test-ui-prompts.mjs
node --import ./tools/harness/ts-loader-register.mjs tools/harness/test-ui-rare-prompts.mjs
```

⚠️ Os dois usam um `planIsActionable()` que lista os campos do `PromptPlan`
capazes de dar uma ação ao jogador. **Um campo novo no `PromptPlan` precisa ser
adicionado ali nos dois arquivos** — senão o teste acusa travamento onde a tela
na verdade sabe responder.

O teste de navegador precisa da app no ar:

```bash
npx next build && npx next start -p 3100
APP_URL=http://127.0.0.1:3100 node tools/harness/test-browser.mjs
```

Passe `--headed` para assistir.

## Duelo roteirizado (`duel.mjs`)

`createDuel({ place, decks, mode, ... })` monta o campo já arrumado:

- `mode` — regras do core (`OcgDuelMode`); Goat por padrão, `MODE_MR5` para o
  pool TCG.
- O Extra Deck de `place` nasce **virado para baixo**, como no app. Virado para
  cima, o core de Master Rule 4/5 só libera a Zona de Monstro Extra para
  Sincro/Xyz — o teste pareceria mostrar um bug que o jogo não tem.
- O piloto automático troca de resposta quando o core recusa a anterior
  (RETRY): ataca com quem é obrigado a atacar, declara quantos valores o
  ANNOUNCE pede, procura soma exata no SELECT_SUM.

O cenário farto da varredura carta a carta mora em `card-scan.mjs`, usado pelo
`test-cards` (pool Goat) e pelo `test-tcg-pool` (pool TCG).

## Flags comuns

- `--json arquivo.json` — relatório completo em JSON.
- `--verbose` — detalhe por carta.
- `--slice 0/8` — roda uma fatia (para dividir entre processos).
- `12345 67890` — só esses passcodes.

## Emendas nos scripts base

`src/lib/duel/script-patches.ts` corrige scripts do ProjectIgnis que usam algo
que o `ocgcore` compilado aqui não conhece. O harness aplica as MESMAS emendas
(veja `readScriptFile` em `env.mjs`) — senão ele testaria um jogo diferente do
que o jogador joga. Para ver o erro original que uma emenda esconde:

```bash
SKIP_SCRIPT_PATCHES=1 node tools/harness/debug-chaininfo.mjs 50412166 mao
```

## Modo "antes do conserto"

`LEGACY_CARD_DATA=1` faz o harness descartar `setcode` e `alias`, reproduzindo o
adaptador antigo. Serve para medir o efeito de uma correção:

```bash
LEGACY_CARD_DATA=1 node tools/harness/test-archetypes.mjs --json antes.json
node tools/harness/test-archetypes.mjs --json depois.json
node tools/harness/test-archetypes.mjs --compare antes.json depois.json
```

## Peças

- `env.mjs` — dá ao core, fora do navegador, o que ele buscaria por HTTP: o
  wasm, os scripts Lua e o banco oficial de cartas.
- `duel.mjs` — `createDuel({place, decks})` monta um duelo com o campo já
  arrumado; `HarnessDuel.run(policy)` avança até o duelo pedir algo que a
  política não responda. `autoPilot` responde qualquer prompt de forma legal
  (com `{play: true}` ele realmente joga, em vez de passar o turno).
- `browser.mjs` — driver CDP mínimo. Sem Playwright de propósito: o Chrome já
  está instalado e o Node já tem WebSocket. A porta de depuração varia por
  processo, então dois testes de navegador podem rodar ao mesmo tempo.
- `debug-binding-crash.mjs` / `debug-chaininfo.mjs` — ferramentas pontuais que
  instrumentam o binding e o Lua para achar a causa de uma falha específica.
  Não fazem parte da bateria; ficam por documentarem como investigar.
- `ts-loader.mjs` / `ts-loader-register.mjs` — deixam o Node importar os
  módulos `@/...` do app direto do `src/`, para o teste de UI exercitar o
  código de verdade em vez de uma cópia.

## Duelo online

Dois testes cobrem o multiplayer, e eles se dividem no ponto em que um erro
custa caro de achar de outro jeito:

| Comando | O que prova |
|---|---|
| `npm run test:multiplayer` | O **servidor**: sala, jokenpô do primeiro turno (inclusive que a jogada do outro não atravessa a rede antes da hora), `promptId` contra resposta atrasada, codec de BigInt e — o mais importante — que a projeção de um assento nunca carrega a mão, o Extra Deck, o prompt nem o log do outro. Não abre navegador nem socket. |
| `npm run test:browser-online` | O **resto do caminho**: lobby, `sessionStorage` por aba, WebSocket do navegador e a mesa desenhada na ótica do assento **1**. Precisa do app rodando (`APP_URL=http://127.0.0.1:3000`). `FORMATO=tcg` joga a sala inteira com decks TCG. |

Um terceiro cobre o construtor:

| Comando | O que prova |
|---|---|
| `npm run test:browser-decks` | Que o deck **sobrevive**: montado numa visita, ele continua lá depois de recarregar e depois de limpar os dados do navegador — porque mora num arquivo do servidor, não no `localStorage`. Cobre também a portaria de nome, o seletor PT/EN e apagar deck. |

## Informação oculta, finais e biblioteca

Três baterias curtas, cada uma sobre um jeito diferente de errar em silêncio:

| Comando | O que prova |
|---|---|
| `npm run test:hidden` | O que o jogador **vê e não vê**: o descarte aparece no log (Goblin Larápio acertava e nada mudava na tela), o Espião Inexperiente escolhe pelo verso, o Confisco mostra as faces (ele revela ANTES de pedir a escolha), e o dono de uma carta virada por Boneca Chamariz também fica sabendo qual era. Roda a `DuelSession` de verdade. |
| `npm run test:endgame` | Os códigos de `WIN.reason` do core (LP a zero, deck vazio, efeito) e a frase que cada um vira. Não são documentados em lugar nenhum: uma renumeração faria o app explicar a derrota errada com toda a confiança. |
| `npm run test:deck-library` | A parte que **move arquivos**: a coleção gravada sob id aleatório é adotada pelo apelido, apelidos iguais em caixas diferentes são a mesma pessoa, trocar de nome leva os decks, e vários arquivos do mesmo apelido são juntados (com `.bak` do original). Um erro aqui apaga deck de gente. |

Os dois exercitam a **queda no meio do duelo**. A tolerância real é de 45
segundos; encurte com `DUEL_DISCONNECT_GRACE_MS` (o `test:multiplayer` já a
aperta sozinho, e o servidor a relê a cada checagem):

```bash
DUEL_DISCONNECT_GRACE_MS=4000 npm run start          # num terminal
DUEL_DISCONNECT_GRACE_MS=4000 npm run test:browser-online
```

`npm run test:connection` cobre a saúde do socket — batimento numa conexão
parada e detecção de conexão meio-aberta. Precisa do servidor de pé com
batimento curto:

```bash
DUEL_HEARTBEAT_MS=1000 PORT=3210 npm run start
PORT=3210 npm run test:connection
```

O segundo existe por um motivo concreto: o tabuleiro inteiro foi escrito quando
"você" era sempre o jogador 0, e um resquício disso não quebra nada visível —
apenas deixa de tornar as cartas clicáveis para quem está no assento 1. Foi
exatamente esse o primeiro bug que ele pegou.
