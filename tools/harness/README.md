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
| `npm run test:board-modern` | Navegador: mesa TCG montada por `scenario` (Link em cada Zona Extra, escalas, Xyz, Pêndulo destruído indo para o Extra Deck do oponente). Confere setas, zonas apontadas, selos e o Extra Deck público; fotos em `.cache/shots/tcg-*.png`. Precisa da app no ar (`APP_URL`). |
| `npm run test:modern-play` | Navegador, só cliques: Sincro, Xyz e Link pelo Extra Deck que brilha, efeito de Cemitério, escalas + Invocação-Pêndulo e declaração de nome de arquétipo. Fotos de cada passo em `.cache/shots/jogo-*.png`. Precisa da app no ar (`APP_URL`). |
| `npm run test:marks` | Marcas das cartas (contador, turnos, declaração, aviso, equipamento, alvo, negação, aviso de jogador, zona interditada) na `DuelSession` real, nas duas óticas e na projeção por assento. |
| `npm run test:formats` | A `DuelSession` roda as regras do formato pedido (Goat compra no 1º turno, TCG não). |
| `node tools/harness/test-archetypes.mjs` | Cartas de arquétipo, com companheiros do mesmo `setcode` em campo/mão/deck: o efeito **enxerga** os parceiros? |
| `node tools/harness/test-ui-prompts.mjs` | Joga duelos inteiros e submete cada pergunta do engine ao mesmo código que a tela usa. Acha prompts que a UI não sabe responder — a causa de duelo congelado. |
| `node tools/harness/test-ui-rare-prompts.mjs` | Força os prompts raros (ANNOUNCE_*, SELECT_SUM, SORT_CARD, SELECT_DISFIELD) pondo na mão a carta que produz cada um. São justamente os que passam despercebidos num duelo comum. |
| `node tools/harness/test-browser.mjs` | Ponta a ponta num Chrome real: abre o lobby, começa o duelo e joga clicando. |
| `node tools/harness/test-browser-announce.mjs` | Igual, mas com um deck montado só com as cartas dos prompts raros — é o que faz o modal de declarar raça/carta e o texto real das opções aparecerem na tela de verdade. |
| `node tools/harness/screenshot.mjs [n]` | Fotos do duelo em `.cache/shots/`. Ler o DOM diz se a tela funciona; só olhando dá para dizer se está boa. |
| `node tools/harness/test-triggers.mjs` | Cartas reativas: constrói o EVENTO (ataque, invocação, ativação do oponente) em vez de só o tabuleiro. |
| `node tools/harness/test-remaining.mjs` | As cartas com condição própria e específica — cada uma com o cenário exato lido do seu Lua. |
| `node tools/harness/test-patches.mjs` | Vigia as emendas de `script-patches.ts`: âncora ainda casa, tolera reindentação, e as cartas que dependem dela seguem funcionando. |
| `node tools/harness/test-bot.mjs [partidas] [passivo\|guloso]` | O bot joga melhor? Cenários dirigidos (não ataca de peito aberto, compra antes de invocar, responde ao ataque) e depois um placar contra dois adversários de referência. |
| `node tools/harness/test-cancel.mjs` | Desistir de uma Invocação-Tributo: o core aceita e o campo fica intacto. |
| `node tools/harness/test-browser-cancel.mjs` | O mesmo, mas pela tela — o botão aparece e devolve o turno. |
| `node tools/harness/test-draw-landing.mjs` | Mede onde a carta comprada pousa: tem que ser o slot real da mão. |
| `node tools/harness/test-attack-rotation.mjs` | O monstro do oponente não pode se endireitar ao atacar. |
| `node tools/harness/test-viewports.mjs` | Telas menores e "movimento reduzido" ligado. |

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
| `npm run test:browser-online` | O **resto do caminho**: lobby, `sessionStorage` por aba, WebSocket do navegador e a mesa desenhada na ótica do assento **1**. Precisa do app rodando (`APP_URL=http://127.0.0.1:3000`). |

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
