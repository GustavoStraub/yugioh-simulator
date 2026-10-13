# Pool completo do TCG — achados e plano

> Investigação de 12/10/2026. Pergunta: quanto falta para o app ter **todas as
> cartas do TCG com efeito**, **todos os Structure Decks, Starter Decks,
> Legendary Decks** e afins, mostrar as **marcas das cartas** (contadores,
> turnos, declarações) e exibir a **banlist TCG atual** como informação.
>
> Nada no código do app foi alterado. As medições usaram scripts descartáveis
> que rodam **o mesmo wasm, os mesmos scripts Lua e o mesmo `card-db.json`** do
> app, e passam cada pergunta do engine pelo **mesmo código da tela**
> (`autoResponseFor` → `buildPromptPlan`). Como reproduzir: [Apêndice](#apêndice--como-reproduzir-as-medições).

## 1. Resumo

- **Os efeitos já estão praticamente prontos.** Os 13.319 scripts de cartas
  TCG com efeito rodaram nas regras atuais (Master Rule 2020) com **zero** erro
  de Lua: 24.591 cenários, 9.834 cartas ativadas/invocadas e resolvidas.
- **O trabalho está na mesa e nos dados:** Zona de Monstro Extra, Link/Xyz/
  Pêndulo na tela, invocar do Extra Deck e ativar do Cemitério, **marcas das
  cartas**, catálogo 8× maior, ~100 decks pré-montados com quantidade exata,
  banlist TCG.
- **Bug bloqueante no binding** `@n1xx1/ocgcore-wasm` 0.1.3: a escala direita
  de todo Pêndulo chega ao core como 0 e as setas Link nunca chegam — a
  Invocação-Pêndulo é impossível hoje. A 0.1.4 corrige (lido no código, ainda
  não executado).
- **Hoje uma Invocação-Link congela o duelo** na tela, e o monstro invocado
  ficaria invisível. Verificado passando a pergunta real do engine pelo código
  da tela; não foi clicado no navegador.
- **Estimativa**, no ritmo em que este app foi feito: **16–30 dias úteis** para
  humano × humano completo (≈ 3–6 semanas); **+5–10 dias** para um bot que jogue
  decks modernos com decência. Primeiro marco jogável (qualquer carta, decks
  montados à mão): **8–13 dias**.

## 2. O que já existe e serve

| Peça | Estado | Onde |
|---|---|---|
| ocgcore do EDOPro (API 11.0, a mesma do upstream) em wasm, no navegador e no servidor | pronto | `node_modules/@n1xx1/ocgcore-wasm`, `src/server/duel/node-assets.ts` |
| Scripts Lua de todas as cartas oficiais | pronto — 13.439 em `official/` | `.cache/CardScripts`, `src/lib/duel/script-source.ts` |
| Dados oficiais (tipo, setcode, alias, escalas) | pronto — `card-db.json` já tem as **14.724** linhas do `cards.cdb`, não só o Goat | `scripts/build-card-db.mjs` |
| Arte alternativa → script da original | pronto | `official-card-data.ts:117` |
| Perguntas do engine | 20 dos 21 tipos tratados (falta `SORT_CHAIN`) | `duel-actions.ts` |
| Escolha de materiais (`SELECT_UNSELECT_CARD`) | funciona para Sincro, Xyz e Link | §3.2 |
| Online autoritativo + máscara de informação oculta | pronto | `docs/multiplayer.md` |
| Harness headless | pronto e rápido — o pool TCG inteiro roda em ~1 min com 4 processos | `tools/harness` |

## 3. O que a investigação provou (rodando código)

### 3.1 Todas as cartas TCG contra o engine

Mesmo desenho do `test-cards.mjs` — campo farto, a carta na mão/campo/baixada/
Extra Deck, roda até a Main Phase 1, tenta ativar ou invocar e deixa o piloto
automático resolver — com três diferenças: `MODE_MR5`; pool = cartas TCG do
`cards.cdb` (`ot & 2`, sem fichas, sem arte alternativa, sem Normal sem efeito);
setas Link passadas ao core.

| Medida | Valor |
|---|---|
| Cartas (um script cada) | 13.319 |
| Cenários rodados | 24.591 |
| **Erros de Lua** | **0** |
| Ativadas/invocadas e resolvidas em ≥ 1 cenário | 9.834 |
| "Não oferecida" (o cenário não cumpre a condição — não é quebra) | 3.483 |
| Laço de RETRY | 3 — Earthshaker, Ancient Gear Gadget, Crossout Designator. Provavelmente o piloto do harness (resposta fixa a `ANNOUNCE_*`), não a carta; confirmar |
| Erro do binding (`eof`) | 1 — Wandering Mummy, já conhecido (`SHUFFLE_SET_CARD`, ver `duel.mjs`) |

**O detector funciona:** com as emendas desligadas (`SKIP_SCRIPT_PATCHES=1`),
Charm of Shabti volta a dar `Passed invalid CHAININFO flag`.

| Tipo | Cartas | Ativou/invocou | Não oferecida |
|---|---:|---:|---:|
| Magia | 2.736 | 2.729 | 6 |
| Monstro do Main Deck | 5.833 | 5.560 | 272 |
| Armadilha | 2.047 | 747 | 1.299 — a maioria espera um gatilho que o cenário não cria |
| Fusão | 546 | 85 | 461 |
| Sincro | 525 | 66 | 459 |
| Xyz | 589 | 107 | 482 |
| Link | 453 | 80 | 373 |
| Pêndulo | 366 | 357 | 9 |
| Ritual | 224 | 102 | 122 |

Os monstros de Extra Deck aparecem pouco como "ativou" porque o cenário não tem
os materiais certos: aqui fica provado que o script carrega e que as condições
rodam. A invocação em si foi testada à parte (§3.2).

**O que isto não prova:** combos de várias etapas, prompts raros entre duas
cartas modernas, timing de Damage Step. É ali que mora a cauda de bugs (Fase 9).

### 3.2 Invocações modernas pelo caminho da tela

Cada pergunta feita ao jogador passou por `autoResponseFor` → `buildPromptPlan`,
em `MODE_MR5`, com o Extra Deck virado para baixo como o app faz
(`duel-session.ts:582-584`).

| Mecânica | Engine | Tela hoje |
|---|---|---|
| Sincro (Junk Synchron + Mystical Elf → Black Rose Dragon) | ✓ materiais por `SELECT_UNSELECT_CARD`; oferece as zonas 0–6 | responde, mas só enxerga 5 zonas — não dá para escolher a Zona de Monstro Extra |
| Xyz (Mystical Elf + Battle Ox → Number 39: Utopia) | ✓ idem | idem |
| Link (Mystical Elf → Link Spider) | ✓ oferece **só** as Zonas Extra (bits 5–6) | **plano vazio → o duelo congela**; e o monstro, já na zona 5, **não é desenhado** |
| Pêndulo (escalas 4 e 8, monstros de Nível 6 e 7 na mão) | ativar as escalas ✓ (zonas M/A 0 e 4); **a Invocação-Pêndulo nunca é oferecida** | — |

A causa do Pêndulo está na §3.3.

### 3.3 O binding perde a escala direita e as setas Link

Dados enviados ao core e lidos de volta com `duelQuery`:

| Carta | Enviado | Guardado pelo core |
|---|---|---|
| Odd-Eyes Pendulum Dragon | escalas 4/4 | 4/**0** |
| Stargazer Magician | escalas 1/1 | 1/**0** |
| Timegazer Magician | escalas 8/8 | 8/**0** |
| Decode Talker | setas `0x85` | **0** |
| Link Spider | setas `0x02` | **0** |

**Causa:** em wasm32, o binding 0.1.3 escreve o `OCG_CardData` com `rscale` no
offset 48 e `link_marker` no 52. No struct do core (`ocgapi_types.h` do
upstream) eles ficam em 44 e 48. A escala direita sai sempre 0, e com ela some
a faixa da Invocação-Pêndulo. As setas também saem sempre 0, então nenhum Link
aponta para zona nenhuma.

**Correção:** a 0.1.4 (28/08/2026) escreve 44/48 e traz um wasm mais novo. O
`package.json` pede `^0.1.3`, que já admite a 0.1.4 — quem segura a 0.1.3 é o
lock. **Ainda não executada**; a Fase 1 faz isso com a bateria inteira.

**Do nosso lado também:** `card-adapter.ts:198` manda `link_marker: 0` e
`defense: official.def`. Nos monstros Link, a coluna `def` do `cards.cdb` **são**
as setas (Link Spider `0x02` = baixo; Decode Talker `0x85` = cima, baixo-esquerda,
baixo-direita). Mesmo com a 0.1.4, sem esse ajuste as setas continuam sem chegar.

### 3.4 Marcas das cartas: o engine informa, a tela descarta

O engine avisa tudo o que fica "marcado" numa carta ou num jogador. Nenhuma
dessas mensagens é consumida hoje: um `grep` em `src/` por `ADD_COUNTER`,
`CARD_HINT`, `PLAYER_HINT`, `EQUIP`, `CARD_TARGET` e `FIELD_DISABLED` não acha
nada. As consultas de `board-state.ts:62` também não pedem `COUNTERS`,
`OVERLAY_CARD`, `EQUIP_CARD`, `TARGET_CARD` nem `STATUS`. **Isso já falta no
Goat:** o jogador não vê o Spell Counter do Breaker the Magical Warrior, os
turnos que faltam em Swords of Revealing Light nem a carta declarada por
Prohibition.

| Marca | Como o engine informa | Goat | TCG | Exemplos |
|---|---|---:|---:|---|
| Contadores | `ADD_COUNTER`/`REMOVE_COUNTER` + consulta `COUNTERS` | 20 | 299 | Breaker the Magical Warrior, Royal Magical Library, Apprentice Magician |
| Contagem de turnos | `CARD_HINT` `TURN` | 11 | 52 | Swords of Revealing Light, Cocoon of Evolution, Different Dimension Capsule |
| Carta declarada | `CARD_HINT` `CARD` | 1 | 5 | Prohibition |
| Raça/atributo/número declarado | `CARD_HINT` `RACE`/`ATTRIBUTE`/`NUMBER` | 7 | 14 | DNA Surgery, DNA Transplant, Array of Revealing Light, Scroll of Bewitchment |
| Aviso na carta ("não pode atacar neste turno", "efeito já usado"…) | `CARD_HINT` `DESC_ADD`/`DESC_REMOVE` | 27 | 1.685 | Black Luster Soldier - Envoy of the Beginning, Chaos Emperor Dragon - Envoy of the End |
| Aviso no jogador ("não pode Invocar-Especial neste turno"…) | `PLAYER_HINT` | 4 | 257 | Deck Devastation Virus, Stray Lambs, Maharaghi |
| Equipada a | `EQUIP` + consulta `EQUIP_CARD` | 19 | 305 | Autonomous Action Unit, Blast with Chain |
| Alvo contínuo | `CARD_TARGET`/`CANCEL_TARGET` + consulta `TARGET_CARD` | 14 | 100 | Call of the Haunted, Aussa the Earth Charmer |
| Materiais Xyz | consulta `OVERLAY_CARD` | 0 | 431 | Number 39: Utopia |
| Carta negada | consulta `STATUS` | — | — | negação contínua (Skill Drain…) |
| Zonas inutilizadas | `FIELD_DISABLED` | — | — | cartas que bloqueiam zonas |

Contagem = scripts que contêm o padrão correspondente (`AddCounter`,
`SetTurnCounter`, `CHINT_*`, `EFFECT_FLAG_CLIENT_HINT`, `RegisterClientHint`,
`Duel.Equip`, `SetCardTarget`, `RemoveOverlayCard`…). É uma aproximação: uma
carta que só remove contadores de outra também conta.

### 3.5 Tamanho dos dados e regras da YGOPRODeck

| Dado | Hoje (Goat) | Pool TCG |
|---|---|---|
| Cartas no catálogo da YGOPRODeck | 1.690 (`format=goat`) | 14.049 (`format=tcg`), 10.701 com texto em PT |
| Resposta crua | ~2,8 MB por idioma | ~24 MB por idioma (extrapolado: 1.670 B/carta) |
| Só nome + texto em inglês | — | 4,9 MB (medido no `cards.cdb`) |
| Textos de opção de efeito (`str1..16`) | 568 cartas em `engine-strings.json` | 9.493 cartas, ~0,7 MB |
| `card-db.json` | já tem tudo (601 KB) | — |

Hoje o navegador recebe o catálogo inteiro de uma vez (`/api/cards`,
`CardRegistryProvider.tsx:43`) e o construtor desenha todas as cartas filtradas
(`DeckBuilderApp.tsx:184`). Com o pool TCG isso vira ~50 MB por visita.

Regras da YGOPRODeck (api-guide): 20 requisições/s, e quem passa disso fica 1 h
bloqueado. *"Please download and store all data pulled from this API
locally"*. Para imagens: *"Do not continually hotlink images directly from this
site… Failure to do so will result in an IP blacklist."* Hoje o app faz hotlink
de `image_url_small` (`DuelCardSlot.tsx:88` e outros) e baixa o catálogo de novo
a cada hora, em memória (`goat-cards.ts:38`). Com 8× mais cartas, o risco cresce
junto.

### 3.6 Produtos pré-montados do TCG

Do `cardsets.php` da YGOPRODeck (1.035 sets):

| Linha | Entradas | Decks jogáveis |
|---|---:|---:|
| Structure Deck | 62 | ~59 (3 entradas são edições especiais ou brindes) |
| Starter Deck / Starter Set | 29 | ~25 (5 são Speed Duel, outro formato, e 1 é brinde; os 2 sets de 2 jogadores valem 2 decks cada) |
| Legendary Decks (Yugi's, II, Dragon, Hero) | 4 caixas | 12 (3 por caixa) |
| Egyptian God Deck | 2 | 2 |
| **Total** | | **~95–100** |

Hoje são 10: 6 Starters e 4 Structure Decks de 2005, montados à mão
(`src/data/preset-decks.json`).

A API de sets dá quais cartas e o set code (`SDWD-EN017` → passcode), mas
**não dá a quantidade** de cada carta nem a qual dos 3 decks de uma caixa
Legendary ela pertence. Para isso precisa de uma segunda fonte (Fase 7).

## 4. Lacunas no código

| Área | Onde | O que falta |
|---|---|---|
| Regras | `duel-session.ts:198`, `tools/harness/duel.mjs:472` | `MODE_GOAT` fixo |
| Regras | `types/duel.ts:21`, `types/deck.ts:18` | `format: "goat"` literal; Extra Deck 60 e Side "0 ou 15" (`deck-rules.ts:112`) são regra Goat |
| Engine | `card-adapter.ts:198` | setas Link = 0; `defense` de Link recebe as setas |
| Engine | lock do binding | 0.1.3 (§3.3) |
| Mesa | `field-places.ts:37` | decodifica 5 zonas por grupo: ignora as Zonas de Monstro Extra (bits 5–6 e 21–22) e a Zona de Campo (13 e 29) |
| Mesa | `board-state.ts:152`, `:62` | lê 5 zonas de monstro; não pede materiais, contadores, setas, escalas, nível/rank, status, equipada/alvo |
| Mesa | `board-state.ts:270` | Extra Deck do oponente sempre oculto — Pêndulo virado para cima no Extra Deck é público |
| Mesa | `prompt-reach.ts:12` | trata qualquer zona de monstro como clicável, inclusive as Extra, que a mesa não desenha |
| Mesa | `DuelBoard.tsx:93-94`, `FieldRow` | 5+5 fixos; sem fileira de Zonas Extra, setas, materiais, escalas nem marcas (§3.4) |
| Ações fora do campo | `DuelBoard.tsx:1318` (`PileModal`), `duel-actions.ts:217-219` | a Main Phase é `inline` e só slot desenhado é clicável; a pilha só mostra. **Não há como invocar do Extra Deck nem ativar do Cemitério/banidas.** No Goat isso quase não aparecia; nas cartas modernas é rotina |
| Prompts | `duel-actions.ts:841`, `:803` | ANNOUNCE_CARD trata "Extra Deck" como `frameType === "fusion"`; setcode/raça/atributo liberam tudo |
| Prompts | `duel-actions.ts:663` | SELECT_COUNTER dá 1 contador por carta escolhida — não expressa "remova 3 de uma carta só" |
| Prompts | `sum-selection.ts:36` | sempre "soma ≥ alvo"; a mensagem traz `select_max` (soma exata × "igual ou maior"), `min` e `max` (`index.d.ts:1243`), e a tela ignora os três. Verificar também cartas com dois níveis possíveis |
| Prompts | `bot-responder.ts` (`findPromptMessage`) | `SORT_CHAIN` não é pergunta reconhecida — se vier, congela |
| Textos | `scripts/build-engine-strings.mjs` | opções de efeito filtradas ao pool Goat (568 cartas); `!counter` do `strings.conf` descartado |
| Catálogo | `goat-cards.ts:16-28` | `format=goat`, refeito a cada hora em memória, em dois idiomas |
| Construtor | `DeckBuilderApp.tsx:184`, `card-filters.ts` | sem virtualização; sem filtro de Rank/Link/Escala/subtipo |
| Construtor | `deck-rules.ts:89`, `:93` | "Só monstros Fusion vão no Deck Extra" |
| Banlist | `DeckBuilderApp.tsx:588`, `card-filters.ts:100` | `ban_goat ?? ban_tcg` — ver §5 |
| Imagens | `DuelCardSlot.tsx:88`, `DeckBuilderApp.tsx:603`… | hotlink da YGOPRODeck |
| Decks | `preset-decks.ts:4`, `:37` | só `starter` e `structure`; `format: "goat"` fixo |
| Bot | `bot/bot-brain.ts:221-230` | Invocação-Especial pontuada só pelo ATK; sem linhas de Extra Deck, valor de material, Pêndulo ou hand trap |

## 5. Banlist TCG — só informação

Decidido: **a banlist exibida é a TCG vigente**, como ajuda para quem quer
montar um deck legal. **Nunca bloqueia** adicionar nem jogar. A única regra
dura continua sendo **3 cópias por deck** (`MAX_COPIES_PER_CARD`,
`deck-rules.ts:24`), a mesma política que `deck-rules.ts:13-23` e o README já
descrevem para o Goat.

- **Fonte:** `banlist_info.ban_tcg` da YGOPRODeck, que vem junto com o
  catálogo. A lista atual tem 222 cartas: 121 Proibidas, 93 Limitadas e
  8 Semi-limitadas. Ela se atualiza junto com o snapshot do catálogo (Fase 5).
- **Onde aparece:** selo na lista de cartas e no detalhe da carta, filtro
  "Status na banlist" e um resumo no deck: *"Legal na banlist TCG"* ou *"3
  avisos: 1 Proibida, 2 acima do limite"*.
- **Data de vigência:** a YGOPRODeck não informa. Se quisermos mostrar
  "vigente desde…", as listas do ProjectIgnis (LFLists) são datadas — verificar.
- **Bug atual:** quando a carta não tem `ban_goat`, a tela cai no `ban_tcg` de
  hoje e mostra esse status com o rótulo "lista de abril/2005". 24 cartas do
  pool Goat caem nisso — Cyber-Stein e Dimension Fusion, por exemplo, aparecem
  como "Proibida em abril/2005" porque estão proibidas no TCG de hoje. Com a
  banlist passando a ser a TCG, fonte e rótulo mudam juntos; se o Goat
  continuar como formato (§6), cada formato lê só a sua lista.

## 6. Decisões de escopo

| Decisão | Situação | Recomendação |
|---|---|---|
| Banlist | **decidido** (§5) | TCG vigente, só informação; 3 cópias é a única trava |
| Regras do duelo | — | `MODE_MR5` (Master Rule 2020), a regra vigente e a que o EDOPro usa |
| O formato Goat continua? | **a decidir** | Manter como segunda opção custa 1–2 dias (Fase 6). Os decks salvos hoje são Goat, e o modo Goat do core tem regras próprias (compra no 1º turno, Damage Step de 6 passos). Se sair, os decks salvos viram TCG e a Fase 6 encolhe |
| Speed Duel / Rush Duel | — | fora (outros formatos: 3 zonas, Skills, regras próprias) |
| Cartas sem texto em PT (~3,3 mil) | — | mostrar em inglês |
| Imagens | — | baixar uma vez e servir do nosso servidor (~13–14 mil imagens pequenas, ~150–200 MB) |
| Ambição do bot | — | "decente": invoca do Extra Deck, escolhe materiais, faz Pêndulo, guarda hand trap. "Bom" de verdade é projeto aberto (o EDOPro usa roteiro escrito à mão por deck) |
| Fonte da quantidade dos decks | — | Yugipedia (listas com quantidade e divisão das caixas) + set code da YGOPRODeck para chegar ao passcode. Licença CC BY-SA → citar a fonte |

## 7. Plano por fases

### Fase 0 — Preparação (0,5 dia)

- **Commitar o estado atual.** Hoje só existe o commit do `create-next-app`;
  o app inteiro está fora do git.
- Fixar o commit do CardScripts (hoje um `master` raso de 24/08). O core
  compilado anda atrás do `master` — é por isso que a emenda do `chain.lua`
  existe.
- Harness: `createDuel` aceita `mode`, e o Extra Deck passa a ser criado virado
  para baixo por padrão (ver §10).
- Promover as medições deste documento a testes:
  `tools/harness/test-tcg-pool.mjs` (§3.1) e
  `tools/harness/test-modern-summons.mjs` (§3.2 e §3.3, com a leitura de volta
  de escalas e setas).

**Pronto quando** os dois testes reproduzem os números da §3, inclusive as
falhas esperadas da §3.2 e da §3.3.

### Fase 1 — Motor e regras (0,5–1 dia)

- Binding 0.1.3 → 0.1.4 (lock). Rodar a bateria inteira: `test:cards`,
  `test:archetypes`, `test:triggers`, `test:remaining`, `test:patches`,
  `test:ui`, `test:ui-rare`, `test:hidden`, `test:multiplayer`, `test:bot`.
- Conferir a emenda do `chain.lua` com o core novo. Ela pode ter ficado
  desnecessária: o `pcall` passa a ter sucesso e o `test:patches` diz.
- `card-adapter.ts`: monstro Link recebe `link_marker = def` e `defense = 0`.
- O formato entra em `DuelSessionConfig` e escolhe as flags (`MODE_GOAT` ou
  `MODE_MR5`). Um objeto de regras por formato substitui `GOAT_FORMAT_RULES`
  onde ele é regra de formato.

**Pronto quando** a leitura de volta mostra escalas e setas certas, a
Invocação-Pêndulo é oferecida no `test-modern-summons` e a bateria Goat dá o
mesmo resultado de antes.

### Fase 2 — Mesa moderna (3–5 dias)

- `board-state.ts`: 7 zonas de monstro. Ler materiais (`OVERLAY_CARD`), setas e
  rating (`LINK`), escalas (`LSCALE`/`RSCALE`), nível/rank e tipo. Pêndulo
  virado para cima no Extra Deck fica visível aos dois.
- `field-places.ts`: decodificar monstros + Zonas Extra e M/A + campo, dos dois
  lados, com rótulos.
- `DuelBoard.tsx`:
  - fileira central com as 2 Zonas de Monstro Extra junto da trilha de fases
    (dono espelhado, ver §10);
  - setas Link no slot e destaque das zonas apontadas;
  - selo de materiais Xyz que abre a lista;
  - escalas nas zonas M/A 0 e 4;
  - "Rank N" e "Link-N" no lugar do nível;
  - pilha do Extra Deck mostrando os Pêndulos virados para cima.
- `prompt-reach.ts` acompanha o que a mesa passou a desenhar.
- Online: a projeção leva os campos novos; do Extra Deck do outro, só os
  virados para cima.

**Pronto quando** o `test-modern-summons` termina sem plano vazio,
`test:viewports` e `test:hidden` passam, e as capturas (`npm run shots`) mostram
um Link na Zona Extra, um Xyz com materiais e as duas escalas.

### Fase 3 — Marcas das cartas (1,5–3 dias)

Regra de desenho: **consultar quando o engine deixa; acompanhar mensagem só
onde não há consulta.** A consulta é a verdade e sobrevive a reconexão; uma
mensagem perdida deixa a marca errada para sempre.

| Marca | Como obter |
|---|---|
| Contadores, materiais, equipada a, alvo contínuo, negada | consulta a cada leitura do tabuleiro (`COUNTERS`, `OVERLAY_CARD`, `EQUIP_CARD`, `TARGET_CARD`, `STATUS`) |
| Turnos, carta/raça/atributo/número declarado, avisos na carta | `CARD_HINT`: a sessão guarda um mapa por posição, move a marca junto no `MOVE` e limpa quando a carta sai do campo |
| Avisos no jogador | `PLAYER_HINT`, por assento |
| Zonas inutilizadas | `FIELD_DISABLED` (a mensagem traz a máscara inteira; guardar a última) |

- O que é acompanhado por mensagem entra no `DuelSnapshot`, para o online e a
  reconexão receberem.
- **Visibilidade:** a marca segue a carta. Carta oculta para quem olha não
  mostra marca nenhuma (`projectSnapshot`). Cobrir isso no `test:hidden`.
- **Textos:** os avisos usam `description` (Stringid → `engine-strings`). Os
  nomes de contador vêm do `!counter` do `strings.conf`, que hoje é descartado,
  com tradução PT para os comuns.
- **Tela:** selos no slot (ícone + número por tipo de contador, relógio de
  turnos, carta declarada em miniatura); lista completa no painel de leitura
  ("Spell Counter ×2", "Declarado: Dragão", "Não pode atacar neste turno",
  "Equipada a X", "Negada"); avisos do jogador junto do LP; zonas inutilizadas
  hachuradas; linha no log ("X recebeu 1 Spell Counter").

**Pronto quando** um teste dirigido com Breaker, Swords of Revealing Light,
Prohibition, Call of the Haunted e um Xyz mostra as marcas certas nas duas
óticas, inclusive depois de reconectar.

### Fase 4 — Ações fora do campo e prompts (2–3 dias)

- Extra Deck, Cemitério e banidas viram pilhas "acionáveis": quando o
  `PromptPlan` tem ação numa carta de lá, a pilha brilha e o modal oferece o
  menu daquela carta (a mesma `CardAction`).
- ANNOUNCE_CARD avaliado com os bitfields do `card-db` (setcode, raça,
  atributo e tipo completo), que o navegador já carrega para o duelo.
- SELECT_SUM: soma exata × "igual ou maior", mais `min`/`max`.
- SELECT_COUNTER: distribuir N contadores entre as cartas.
- `SORT_CHAIN` reconhecido, com a ordem padrão como resposta, para nunca
  congelar.
- `engine-strings` cobre todas as cartas e é servido por duelo (só os passcodes
  em jogo).
- `planIsActionable`, nos dois testes de UI, acompanha os campos novos do
  `PromptPlan` (regra já registrada em `tools/harness/README.md`).

**Pronto quando** um duelo no navegador com Sincro, Xyz, Link, Pêndulo, efeito
de Cemitério e "declare um nome de arquétipo" vai até o fim só com cliques.

### Fase 5 — Catálogo completo, desempenho, imagens e banlist (2–4 dias)

- `scripts/build-catalog.mjs` baixa `format=tcg` (EN) e `language=pt` uma vez.
  Junta, enxuga (id, nomes, tipo, atributo, nível/rank/link, ATK/DEF, escalas,
  arquétipo, texto PT/EN, `ban_tcg`, se era Goat) e grava um snapshot local.
  O online usa o mesmo arquivo.
- Navegador: índice leve (~1–2 MB) + texto sob demanda, ou o texto inteiro
  comprimido se couber. O `CardRegistry` passa a vir desse índice.
- Construtor:
  - lista virtualizada;
  - filtros de Sincro/Xyz/Link/Pêndulo/Ritual, Rank, Link e Escala;
  - a busca continua PT/EN, sem acento.
- Banlist TCG conforme a §5: selo, filtro e resumo do deck, sem travar nada.
- `scripts/sync-images.mjs` baixa as imagens pequenas uma vez, respeitando
  20 req/s. O servidor serve `/card-images/<id>.jpg`; a imagem grande vem sob
  demanda e fica em cache.

**Pronto quando** a primeira carga do construtor ficar abaixo de um teto
medido antes/depois, nenhuma imagem for pedida à YGOPRODeck durante o duelo e
os selos da banlist baterem com `banlist=tcg` da API.

### Fase 6 — Formatos lado a lado (1–2 dias, se o Goat ficar)

- `format: "goat" | "tcg"` em `DeckList`. Deck salvo sem o campo = Goat.
- Regras TCG:
  - Main 40–60, Extra 0–15, Side 0–15;
  - 3 cópias por deck.
- Pool por formato (Goat = lista atual; TCG = `format=tcg`), seletor no
  construtor e na sala online. Os dois decks da sala precisam ser do mesmo
  formato.

**Pronto quando** `test:deck-library` e `test:browser-decks` cobrem os dois
formatos e um deck Goat antigo abre igual a antes.

### Fase 7 — ~100 decks pré-montados (3–5 dias)

- Meio dia de prova: confirmar a fonte com quantidade em 3 decks de eras
  diferentes e numa caixa Legendary.
- `scripts/build-preset-decks.mjs`, com as páginas em cache em `.cache/`:
  1. lista de produtos;
  2. listas com quantidade;
  3. set code → passcode, pelo `card_sets` da YGOPRODeck;
  4. grava em `src/data/preset-decks.json`.
- Validação automática:
  - Main 40–60 e Extra ≤ 15;
  - todo passcode existe no catálogo e tem script (ou é Normal);
  - a soma das cópias bate com o total do produto.
- `PresetDeckKind` ganha `legendary`, `egyptian-god` e `two-player`. Nome em PT
  quando houve lançamento brasileiro, senão em EN.
- Seletor com busca e agrupamento por linha e ano (100 itens não cabem numa
  lista plana).

**Pronto quando** os ~100 decks passam na validação e cada um joga uma partida
bot × bot sem travar.

### Fase 8 — Bot para decks modernos (5–10 dias, opcional)

- O bot passa a:
  - invocar do Extra Deck quando os materiais valem menos que o resultado,
    escolhendo os de menor valor;
  - fazer Invocação-Pêndulo;
  - guardar hand trap para o turno do oponente;
  - respeitar "uma vez por turno".
- Os tetos de decisão atuais continuam valendo.
- Medido com o `test:bot`, usando os decks da Fase 7.

**Pronto quando** bot × bot roda com os ~100 decks sem travar e o bot vence o
adversário "guloso" de referência na maioria das partidas.

### Fase 9 — QA e endurecimento (3–6 dias)

- `test-ui-prompts` com todos os decks da Fase 7 sob `MODE_MR5` (acha plano
  vazio sozinho).
- Bot × bot em massa, aos milhares de duelos, caçando RETRY em laço, `eof` do
  binding e travamentos.
- Os 3 RETRY e o `eof` da §3.1.
- Partidas humanas no navegador e online, mecânica por mecânica.

**Pronto quando** a bateria dá zero plano vazio e zero travamento, e as cartas
problemáticas estão resolvidas ou registradas.

## 8. Estimativa

**Calibragem:** o app atual nasceu em 20/08/2026 (commit do `create-next-app`),
e os arquivos foram modificados pela última vez entre 20 e 25/08. Ou seja,
~5 dias corridos para engine, construtor, online, bot e harness. Os números
abaixo supõem esse ritmo (você + Claude Code), em dias úteis.

| Fase | Dias |
|---|---:|
| 0 Preparação | 0,5 |
| 1 Motor e regras | 0,5–1 |
| 2 Mesa moderna | 3–5 |
| 3 Marcas das cartas | 1,5–3 |
| 4 Ações fora do campo e prompts | 2–3 |
| 5 Catálogo, desempenho, imagens, banlist | 2–4 |
| 6 Formatos lado a lado | 1–2 |
| 7 Decks pré-montados | 3–5 |
| 9 QA e endurecimento | 3–6 |
| **Humano × humano completo** | **16–30 (≈ 3–6 semanas)** |
| 8 Bot moderno "decente" | 5–10 |
| **Com bot** | **21–40 (≈ 4–8 semanas)** |

- **Primeiro marco:** Fases 0–4 + catálogo mínimo (trocar `format=goat` por
  `format=tcg` com cache em disco, sem otimizar) ≈ **8–13 dias**. Com isso já
  dá para duelar com qualquer carta TCG usando decks montados à mão.
- **O que comprime menos** que a integração: conferir os dados dos decks e
  jogar para achar bugs. As duas coisas pedem olho humano.
- **Se o Goat sair:** −1 a 2 dias (Fase 6).

## 9. Ordem sugerida

Fases 0 → 1 → 2 → 3 → 4 → (marco) → 5 → 6 → 7 → 9 → 8.

Logo depois do marco, rodar o `test-ui-prompts` com decks montados à mão: é o
jeito mais barato de achar congelamentos antes de investir nos 100 decks.

## 10. Armadilhas conhecidas

- **Extra Deck virado para cima não usa as zonas principais.** O core só
  libera `FSX_MMZONE` para carta `POS_FACEDOWN` (`get_rule_zone_fromex`). O app
  cria o Extra Deck virado para baixo; o `place` do harness, sem `position`,
  cria virado para cima (`duel.mjs:520-525`). Num teste isso faz Sincro e Xyz
  parecerem presos à Zona Extra — foi o que me enganou na primeira medição.
- **Coluna `def` do `cards.cdb`:** nos monstros Link ela guarda as setas, e
  `level` guarda o rating. As escalas de Pêndulo já são desempacotadas do
  `level` (`build-card-db.mjs:70`).
- **As Zonas Extra são compartilhadas:** a zona 5 de um jogador é a zona 6 do
  outro. A fileira central precisa ser desenhada pela ótica de quem olha.
- **`field_mask` é relativo ao jogador perguntado** (já documentado em
  `field-places.ts`): as Zonas Extra do oponente são os bits 21–22.
- **Marcas por mensagem precisam andar com a carta.** Elas seguem o `MOVE` e
  são limpas ao sair do campo. A posição sozinha não identifica a carta: a
  mesma zona recebe outra carta depois.
- **CardScripts `master` anda mais rápido que o core compilado.** Fixar o
  commit e só subir junto com o binding.
- **YGOPRODeck:** 20 req/s, bloqueio de 1 h, e nada de hotlink de imagem em
  volume.
- **`PromptPlan` com campo novo** → atualizar `planIsActionable` nos dois
  testes de UI.
- **Next 16.3:** ler `node_modules/next/dist/docs` antes de mexer em rota ou
  cache (`AGENTS.md`).
- **Projeção do online:** o teste exige que o Extra Deck do outro nunca vaze.
  A exceção (Pêndulo virado para cima) entra no teste; não fura a regra.

## 11. Confiança: 55/100 (plano e estimativa)

Probabilidade de o plano entregar tudo, sem surpresa e dentro da faixa.

**O que custa pontos:**

- A 0.1.4 foi lida, não executada. O core novo pode mudar algum comportamento
  que a bateria Goat cobre.
- O scan prova que os scripts carregam e que a primeira resolução funciona.
  Combos de várias etapas e prompts raros entre cartas modernas não foram
  exercitados, e é ali que mora a cauda de bugs.
- A lacuna das ações fora do campo foi lida no código, não clicada no navegador.
- A fonte de quantidades (Yugipedia) ainda não foi testada.
- O tamanho do catálogo é extrapolado, não medido na página.
- Mover marcas junto com a carta tem casos de borda (trocas de controle, cartas
  que voltam ao campo no mesmo turno) que só aparecem jogando.
- A ambição do bot está indefinida: "decente" e "bom" diferem em semanas.
- A estimativa foi calibrada pelo ritmo do primeiro build; UI e QA comprimem
  menos que integração.

**Nível de verificação:**

- Engine: testes automatizados rodados contra o core real.
- Mesa e prompts: código do app rodado contra mensagens reais do engine (Link,
  Sincro, Xyz, Pêndulo), mais leitura do código (ações fora do campo, marcas).
- Estimativa: raciocínio.

## Apêndice — como reproduzir as medições

Os scripts usados ficaram fora do repositório. A Fase 0 os traz para
`tools/harness/`. Para refazer à mão:

**Pool TCG** — o mesmo `sqlite3` que o projeto já usa:

```sql
-- .cache/cards.cdb (BabelCDB)
select count(*) from datas where (ot & 2) != 0 and (type & 16384) = 0;   -- 14.168 (sem fichas)
-- sem arte alternativa (alias a menos de 20 do id): 13.842; sem Normal sem efeito: 13.319 scripts
```

**Scan (§3.1):** `test-cards.mjs` com `flags: OcgDuelMode.MODE_MR5`, o pool
acima, Extra Deck no cenário e `link_marker` vindo do `def` dos Link. Em 4
fatias (`i % 4`) leva ~60 s.

**Leitura de volta (§3.3):**

```js
// cardReader devolve { lscale, rscale, link_marker } conhecidos; depois:
core.duelNewCard(h, { team: 0, duelist: 0, code: 16178681, controller: 0,
  location: OcgLocation.MZONE, sequence: 0, position: OcgPosition.FACEUP_ATTACK });
await core.startDuel(h);
core.duelQuery(h, { flags: OcgQueryFlags.LSCALE | OcgQueryFlags.RSCALE | OcgQueryFlags.LINK,
  controller: 0, location: OcgLocation.MZONE, sequence: 0, overlaySequence: 0 });
// 0.1.3 → { leftScale: 4, rightScale: 0, link: { rating: 0, marker: 0 } }
```

**Invocações pelo caminho da tela (§3.2):** rodar com
`--import ./tools/harness/ts-loader-register.mjs`. Para cada prompt do
jogador 0: `autoResponseFor(msg) ?? buildPromptPlan(msg)`, depois checar se o
plano é acionável (mesma regra do `test-ui-prompts.mjs`) e se
`decodeFieldMask` enxerga as zonas que o `field_mask` libera.

**Marcas (§3.4):** os padrões da tabela, procurados nos `official/c<id>.lua`
do pool Goat (`.cache/goat-pool.json`) e do pool TCG (acima).

## 12. Andamento

Branch `tcg-completo`, um commit por fase. Decisões tomadas antes de começar:
o **Goat continua** como segundo formato (Fase 6 entra), e o escopo é o plano
inteiro.

### Fase 0 — feita

- CardScripts fixo no commit `f1522e75` (`src/lib/duel/cardscripts-pin.ts`):
  rota `/api/scripts`, servidor online e clone do harness leem o mesmo
  conjunto. `npm run fixtures` leva o clone até ele; o harness avisa se o
  clone estiver em outro commit.
- Harness: `createDuel({ mode })` e Extra Deck virado para baixo por padrão.
  O piloto automático troca de resposta num RETRY (ataca com o monstro
  obrigado a atacar, declara quantos valores o ANNOUNCE pede, procura soma
  exata).
- `npm run test:tcg-pool` (§3.1): 13.318 cartas, 24.589 cenários, **0 erros de
  Lua**, 9.876 ativadas/invocadas. Os laços de RETRY eram quase todos do
  piloto (Karakuri e afins "devem atacar"; Earthshaker declara 2 atributos);
  sobram 2, ambos ANNOUNCE_CARD com filtro — o piloto declara nome fixo
  (Fase 4). O `eof` do Wandering Mummy não apareceu nesta rodada.
- `npm run test:modern-summons` (§3.2/§3.3) reproduz as falhas esperadas:
  zonas 5–6 invisíveis para a tela, plano vazio no SELECT_PLACE do Link, Link
  invisível na mesa, Invocação-Pêndulo não oferecida, escala direita e setas
  zeradas no core.
- Bateria Goat igual à de antes (0 vereditos mudaram em 3.108 cenários). O
  `test:hidden` falhava já no `main` — a Boneca Chamariz não tinha alvo porque
  o bot passou a ativar a magia que o teste esperava que ele baixasse; o
  oponente agora baixa Cilindro Mágico.

### Fase 1 — feita

- Binding 0.1.3 → **0.1.4**. Escala direita e setas Link chegam ao core (a
  leitura de volta do `test:modern-summons` bate com o banco oficial) e a
  **Invocação-Pêndulo é oferecida** e resolve com os dois monstros da faixa.
- `card-adapter.ts` (`linkFields`) e o `toOcgData` do harness mandam a coluna
  `def` dos Link como setas, com DEF 0.
- Formato no motor: `DuelSessionConfig.format` escolhe `MODE_GOAT` ou
  `MODE_MR5`, entra no `DuelSnapshot` (a mesa vai precisar dele) e as regras de
  construção viraram `FORMAT_RULES` por formato. `npm run test:formats` confere
  a regra observável de fora: Goat compra no 1º turno (6 cartas), TCG não (5).
- Bateria Goat no core novo: **0 vereditos mudaram** em 3.108 cenários;
  gatilhos, arquétipos, UI, bot, multiplayer e afins iguais. Pool TCG: 0 erros
  de Lua, só as 2 falhas conhecidas do piloto. Duelo no navegador (build de
  produção) com o wasm novo: 250 ações, 0 erros.
- A emenda do `chain.lua` ficou desnecessária com o core novo (Charm of Shabti
  resolve com `SKIP_SCRIPT_PATCHES=1`); continua como rede de segurança.
- O que sobra no `test:modern-summons` é a mesa (Fase 2): zonas 5–6 invisíveis
  para a tela, plano vazio no SELECT_PLACE do Link e o Link fora da mesa.

### Fase 5a — catálogo e imagens (adiantada)

Puxada para antes da mesa: para desenhar e testar Link, Xyz e Pêndulo na tela
é preciso ter as cartas TCG no catálogo (nome, imagem, Rank/Link/Escala).

- `npm run build:catalog` monta `.cache/catalog/catalog.json` a partir de quatro
  buscas à YGOPRODeck (TCG em inglês e em português, pool Goat, fichas), uma vez
  só; o servidor monta sozinho na primeira requisição se o arquivo faltar.
  14.021 cartas, 13.906 com dados oficiais. As 115 restantes são de coleções
  lançadas depois do snapshot do `cards.cdb` (24/08) — a maioria da coleção de
  08/10/2026 — e de impressões de Speed Duel: aparecem no catálogo, mas não
  entram em deck (sem dados nem script, entrariam como monstro qualquer).
- Indexado pelo passcode **oficial**, com todas as artes alternativas
  resolvíveis: a YGOPRODeck passou a usar uma arte alternativa como id
  principal de algumas cartas (o Mago Negro aparece como 46986420), e o feed do
  Goat lista outras só pela arte alternativa.
- `/api/cards` serve o catálogo pré-comprimido (1,6 MB em brotli, 2,4 MB em
  gzip; ~10 MB cru) com ETag — revisita é um 304.
- Imagens: `/card-images/<small|full|cropped>/<passcode>.jpg` baixa cada imagem
  da YGOPRODeck uma vez, em fila (~8/s) e sem duplicar downloads simultâneos, e
  serve do disco (`.cache/card-images/`) com cache de um ano. Fim do hotlink.
- O construtor continua no pool Goat (1.690 cartas) até a Fase 6 dar formato a
  cada deck; a declaração de nome (ANNOUNCE_CARD) segue o formato do duelo.

### Fase 2 — feita

- `board-state.ts`: 7 zonas de monstro (5–6 são as Zonas Extra), nível/rank
  atuais, rating e setas Link, escalas e materiais Xyz por carta em campo — nada
  disso vaza de carta oculta. Extra Deck do oponente: só os Pêndulos virados
  para cima (os outros nem entram na lista); `extraFaceUp` dá a contagem.
- ⚠ O binding não desserializa `OcgQueryFlags.TYPE` (lança `eof`; junto de
  outras flags desalinha a resposta inteira). O tipo vem do catálogo/banco
  oficial.
- `field-places.ts` decodifica monstro 0–6 e magia 0–5 (Zona de Campo). Medido
  em 20 duelos: no jogo normal o core nunca libera esses bits, nem no Goat nem
  em MR5 — só as invocações do Extra Deck. O Goat não muda.
- Mesa TCG (`format: "tcg"` no snapshot): fileira das Zonas Extra com a trilha
  de fases em grade no meio, alinhada às colunas 2 e 4 para as setas se lerem;
  ocupante da zona compartilhada desenhado pela ótica de quem olha (o do
  oponente de cabeça para baixo); setas no slot (giram com a carta); zonas
  apontadas tracejadas (`link-geometry.ts`, conferida contra o engine para os
  dois assentos); selo Nível/Rank/LINK; escalas ◂/▸ nas zonas 1 e 5; selo de
  materiais que abre a lista; ATK/LINK-n no lugar do DEF; Extra Deck com "↑N"
  e o do oponente abrindo só os públicos. A mesa Goat continua idêntica.
- Leitura da carta: linha de tipo moderna ([Dragão/Sincro/Regulador/Efeito]),
  Rank, Link com as setas, escalas e materiais.
- Modais de pilha passaram a seguir o tabuleiro vivo (antes guardavam a lista do
  momento do clique).
- Testes: `test:modern-summons` 8/8 (inclui materiais, geometria contra o
  engine e o Extra Deck do oponente); `test:board-modern` (navegador, mesa de
  teste montada pelo `scenario` da sessão) com capturas em 1440×900, 1280×720
  e 1024×640; `test:viewports`, `test:browser`, `test:browser-online`,
  `test:hidden`, `test:multiplayer` passando. O `test:multiplayer` tinha uma
  checagem de sanidade que reprovava ~1 em 6 vezes (lia só a mão do último
  snapshot); agora usa a maior mão vista.
- Ainda não dá para invocar do Extra Deck clicando — é a Fase 4.

### Fase 3 — feita

- **Por consulta** a cada leitura do tabuleiro (`board-state.ts`): contadores
  (`COUNTERS`), equipada a (`EQUIP_CARD`), alvos contínuos (`TARGET_CARD`) e
  negada (`STATUS_DISABLED`). É a verdade do core e sobrevive a reconexão.
- **Por mensagem** na sessão: `CARD_HINT` num mapa por zona (turnos, carta /
  Tipo / Atributo / número declarados, avisos de texto com contagem); anda com
  a carta no `MOVE` e some quando ela sai do campo. `PLAYER_HINT` por assento e
  `FIELD_DISABLED` (máscara na ótica do jogador 0) entram no `DuelSnapshot`
  (`playerHints`, `disabledZones`).
- As marcas entram no `BoardCard` de cada ótica — carta oculta para quem olha
  não carrega marca nenhuma — e por isso o online e a reconexão recebem tudo
  sem mudar a projeção.
- `engine-strings` agora cobre **todas** as cartas (9.717 com strings) e os
  134 tipos de contador; os ~75 avisos de sistema (3000–3314: "Não pode ser
  destruída em batalha", "Não pode atacar"…) e os contadores comuns têm
  português. As rotas de dados estáticos (catálogo, banco oficial, strings)
  passaram a sair comprimidas com ETag (`compressed-json.ts`).
- Mesa: selos no canto direito do slot (✦ contador, ⏱ turnos, 📢 declarado,
  ⓘ avisos, 🔗 equipada, 🎯 alvo, ⊘ negada), arte em cinza na carta negada,
  zonas interditadas hachuradas, avisos do jogador sob a barra de LP; a leitura
  da carta lista tudo por extenso ("Marcador de Magia ×1", "Equipada a Mystical
  Elf"). Log: contador ganho/perdido, equipamento, alvo e declarações (com o
  nome só quando a carta é pública).
- Achado: contador não-permanente **sai** quando a carta é negada (o Skill
  Drain tira o Marcador de Magia do Breaker) — o core faz isso, a mesa
  acompanha.
- `npm run test:marks`: Breaker, Proibição, Chamado do Assombrado, Machado do
  Desespero, Lança Proibida, Skill Drain, Espadas da Luz Reveladora, Ovelhas
  Perdidas e Desmoronamento, conferidos nas duas óticas e na projeção por
  assento (o que chega ao reconectar), mais a invariante "carta oculta não tem
  marca". `test:board-modern` invoca o Breaker clicando e confere selo e
  leitura no navegador.
- O `test:hidden` tinha mais dois roteiros dependentes de o bot NÃO ativar a
  Remédio Secreto do Goblin (Goblin Larápio e Espião, ~1 em 4 reprovando à
  toa); o oponente deles agora tem um deck que o bot não consegue jogar
  (Guardião do Portão), e o descarte do Goblin precisa vir depois de um ataque
  meu no mesmo turno. 8/8 execuções seguidas passando.

### Fase 4 — feita

- **Jogar de fora da mesa**: quando o prompt oferece jogada numa carta do
  Extra Deck, do Cemitério ou das banidas, a pilha brilha e abre com as cartas
  jogáveis em destaque e as jogadas delas; o que não mora numa pilha desenhada
  (Deck, material Xyz) vai para "⚡ Outras jogadas". A regra de onde cada jogada
  se alcança é `actionReach` (`prompt-reach.ts`), a mesma para tela e testes.
- **ANNOUNCE_CARD** avaliado pela mesma conta do core (`announce-filter.ts`,
  espelho de `is_declarable`: setcode com sub-arquétipo, alias e fichas só com
  as flags, as exceções do core). A busca recebe o banco oficial sob demanda e,
  quando o filtro deixa poucos nomes, já os lista. Bot e piloto do harness
  declaram um nome legal — os dois RETRY que sobravam no pool TCG sumiram (a
  lista de falhas conhecidas do `test:tcg-pool` ficou vazia).
- **SELECT_SUM** pelas regras do core: soma exata (de `min` a `max` cartas) ×
  "igual ou maior sem carta sobrando" (Ritual), e carta de dois valores
  (`o1 | o2 << 16`) — antes o `amount` cru entrava como 262148.
- **SELECT_COUNTER** vira distribuição (quantos sai de cada carta, até o que
  cada uma tem, somando N); a resposta automática só quando é preciso tirar
  todos.
- **SORT_CHAIN** reconhecido (app, bot e harness) e respondido com a ordem
  padrão do core — antes congelava.
- Seleção em passos (SELECT_UNSELECT_CARD): o material já escolhido aparece
  marcado; antes parecia igual aos que faltavam, e clicar nele de novo o tirava.
- A dica `SELECTMSG` do core vira a instrução da seleção ("Selecione o(s)
  card(s) para usar como Matéria de Sincro") e as ~60 dicas 500–579 estão em
  português; a linha da dica no log vai só para quem escolhe.
- Os modais do duelo (pilha, seletor, revelações) passaram a respeitar o idioma
  das cartas escolhido pelo jogador — usavam sempre o nome em português.
- `npm run test:modern-play` (navegador): Sincro, Xyz, Link, efeito de
  Cemitério, escalas + Invocação-Pêndulo e declaração de um nome "Gadget", **só
  com cliques**, com fotos de cada passo. Dois achados que eram do roteiro, não
  do app: Timegazer Magician exige não controlar monstros para ativar (o engine
  estava certo), e o gatilho de Invocação do Ancient Gear Gadget declara um
  TIPO — o nome "Gadget" é o efeito de Ignição.
- `npm run test:prompt-rules`: a conta do ANNOUNCE_CARD, do SELECT_SUM e do
  SELECT_COUNTER caso a caso (29 casos), sem engine.
- Três testes de navegador antigos (`test-browser-cancel`, `test-attack-
  rotation`, `test-draw-landing`) não passavam nem no `main`: não gravavam o
  perfil do jogador (a portaria do nome segurava o lobby) e clicavam em
  "Iniciar duelo" antes de ele existir. O de cancelar o Tributo também
  procurava "tributo" na mesa inteira — e o histórico, agora em português,
  também diz "Tributo". Os três passam.

### Fases 5 (resto) e 6 — feitas juntas

O construtor TCG e os formatos lado a lado dependem um do outro (o pool, os
limites e a banlist que aparecem vêm do formato do deck), então entraram
juntos.

- **Formato por deck** (`DeckList.format`): deck salvo antes do TCG não tem o
  campo e abre como Goat (`normalizeDeck`), igual a antes. O formato viaja no
  próprio `DuelDeckPayload` — duelo local, entrada na sala e troca de deck —,
  sem campo novo em cada mensagem.
- **Regras por formato** (`deck-rules.ts`): Main 40–60 nos dois; Extra até 60
  no Goat e 15 no TCG; Side "0 ou 15" no Goat e até 15 no TCG; 3 cópias é a
  única trava; carta fora do pool do formato não entra (Goat = pool de 2005;
  TCG = toda carta com dados oficiais).
- **Banlist só como informação**, cada formato com a sua lista: selo na carta,
  filtro e resumo do deck ("Legal na banlist TCG" / "1 aviso: 1 Proibida").
  Acabou o bug do Goat cair no `ban_tcg` de hoje (Cyber-Stein aparecia
  "Proibida em abril/2005"). Conferido contra `banlist=tcg` da API: 222 de 222
  — depois de corrigir o catálogo (abaixo).
- **Catálogo**: a lista `format=tcg` da YGOPRODeck deixa de fora 97 cartas TCG
  com script (Chaos Ruler, Bystial Druiswurm, Mudora…). A montagem agora
  completa pelo `cards.cdb` (`ot & 2`), buscando por id o que faltou: 14.118
  cartas, 14.003 jogáveis.
- **Construtor**: troca de formato no próprio deck (as cartas ficam; o que sai
  do pool aparece em vermelho e o deck não duela até sair), deck novo nasce no
  formato do aberto, catálogo **virtualizado** (13.800 cartas no TCG sem travar
  a busca), filtros de subtipo (Normal, Efeito, Ritual, Fusão, Sincro, Xyz,
  Link, Pêndulo, Regulador…), Nível, Rank, Link e Escala, busca também no texto
  em inglês, leitura da carta com Rank/Link/Escala.
- **Duelo local**: o bot usa um deck do mesmo formato — um pronto, ou um da
  sua biblioteca (o único adversário TCG até a Fase 7 trazer os decks prontos).
- **Online**: cada assento mostra o formato do deck; Goat × TCG não começa (a
  sala avisa), e a sessão nasce no formato dos dois.
- **Imagens**: fila de ~14/s para a YGOPRODeck e `npm run sync:images` para
  baixar tudo de antemão.
- **Carga**: o catálogo inteiro (14 mil cartas, texto PT+EN) sai em 1,6 MB
  (brotli). Antes eram ~5,6 MB sem compressão para as 1.690 cartas do Goat
  (2,8 MB por idioma, §3.5).
- Testes: `test:formats` (regras de deck dos dois formatos, banlist por
  formato, validação online, sala Goat × TCG); `test:browser-decks` com uma
  parte TCG (pool inteiro, Link no Extra com limite 15, resumo da banlist, a
  volta ao Goat marcando a carta fora do pool) — e ele agora apaga o perfil de
  teste que deixava em `.data/decks` a cada rodada.

### Fase 7 — feita

**107 decks pré-montados do TCG**, gerados por `npm run build:presets`
(`scripts/build-preset-decks.mjs`) em `src/data/preset-decks-tcg.json`:

| Linha | Decks |
|---|---:|
| Decks Iniciais (2002–2018, inclui Saber Force e Dark Legion) | 23 |
| Decks Estruturais (SD1 a SDWD) | 59 |
| Decks dos Deuses Egípcios | 2 |
| Kit para 2 jogadores (Synchro e Xyz) | 2 |
| Decks Lendários (YGLD, LDK2, LEDD, LEHD, L5DD, L26D — 3 por caixa) | 18 |
| Edições especiais (NKRT, CH01, CH02) | 3 |

- **Fonte**: as listas `Set Card Lists:<produto> (TCG-EN|NA)` da Yugipedia
  (quantidade por linha e um `== X Deck ==` por deck nas caixas), resolvidas
  para passcode pelo set code do `card_sets` da YGOPRODeck — com o nome como
  reserva para os 8 códigos que a YGOPRODeck não tem. As páginas ficam em
  `.cache/yugipedia/` (o build inteiro são ~10 requisições na primeira vez,
  User-Agent próprio, 1,2 s entre elas; zero depois). Texto CC BY-SA 4.0: a
  fonte vai em cada deck (`sourceUrl`) e no rodapé do seletor.
- **Armadilhas do formato** (todas cobertas no script, com o porquê): as
  colunas andam conforme o cabeçalho declara `print=`/`qty=`; sem `qty=`, três
  cópias são três linhas — nada pode deduplicar por código; seções "Bonus",
  "Promotional", "Tokens" e "Variant art cards" repetem códigos do deck (o
  SDCH contava os 4 Familiar-Possessed duas vezes); o Extra Deck não é marcado
  (sai do tipo da carta); os três Deuses do LDK2 aparecem na seção do Yugi mas
  são brinde da caixa.
- **Validação** (o build falha): Main 40–60, Extra ≤ 15, carta com dados
  oficiais e script (ou Normal), e a conta do produto — as cartas dos decks
  não passam do tamanho da caixa, e todas as linhas da lista não ficam abaixo
  dele (a igualdade exata não serve: a lista mostra todos os "1 de 6 bônus").
- **Fora**: os 3 decks do Legendary Arc-V Decks (2026) — cada um tem uma carta
  lançada depois do snapshot dos dados oficiais (Odd-Eyes Override Dragon,
  Lunalight Scarlet Tiger, Speedroid Darumaknocker). Voltam sozinhos quando o
  `card-db.json` for regenerado com elas.
- **Prova cruzada**: os 10 decks Goat, montados à mão anos antes de outra
  fonte, batem carta a carta com os mesmos produtos gerados (só muda a arte de
  algumas cartas).
- **Lacuna da fonte**: o Sky Striker do L26D soma 54 na Yugipedia (a caixa diz
  55: 1 Secreta + 6 Ultra + 48 Comuns; a lista tem 47 Comuns). Fica como está.
- **Seletor**: busca (PT, EN, set code, ano, sem acento), filtro por linha e a
  lista agrupada por linha em ordem de lançamento; os `<select>` do bot e da
  sala online agrupam por formato e linha.
- **Achados no caminho** (consertados, com teste):
  - **Ordenar cartas do topo do Deck travava o duelo** (SORT_CARD). O binding
    escrevia a quantidade antes da ordem; o core lê a ordem do byte 0 e
    respondia RETRY para sempre — na tela o duelo congelava, contra o bot era
    interrompido. Consertado no `postinstall` (`copy-ocgcore-wasm.mjs`, com
    aviso alto se a âncora sumir). Valia para o Goat também.
  - **E a ordem saía trocada**: a tela mandava "a carta de cada posição" e o
    core lê "a posição de cada carta" — com 3 cartas, a escolhida para o topo
    não ficava no topo. `sortOrderForCore`. Teste: `test:sort-card`.
  - **Red-Eyes Darkness Metal Dragon** entrava sem efeito no navegador: no
    commit fixado, o script só existe em `pre-errata/`, que o servidor online
    lia e o navegador não. `script-source.ts` agora tenta `pre-errata/` por
    último (só cartas sem script em `official/` chegam lá — é a única).
  - **Deck apagado voltava**: apagar logo depois de mexer (menos de 600 ms)
    deixava a gravação pendente chegar ao servidor depois do "apagar".
    Gravações e remoções agora vão em fila, e o apagar descarta a pendente.
    Coberto no `test:browser-decks` (falha sem o conserto).
- Testes: `test:presets` (validação de todos + **uma partida bot × bot por
  deck em MR5**, com cada prompt do assento 0 passando pela régua do
  `test:ui`) — 107 de 107 terminam, 19 tipos de prompt exercitados, nenhum
  sem resposta na tela; `test:sort-card`; `test:browser-decks` com o seletor
  (107 decks, grupos, busca por set code, Blue-Eyes White Destiny carregando
  40 + 10).
- Testes antigos acertados: `test:connection` nunca jogava o jokenpô (falhava
  em "o duelo começa" desde o primeiro commit) e apontava por padrão para a
  porta 3000 — o dev server de quem desenvolve; agora joga o jokenpô e usa a
  3210 do próprio roteiro. `test:browser-online` trocava para "o último deck
  da lista", que passou a ser um deck TCG — a sala, com razão, não abria
  Goat × TCG; agora pega o último dos grupos Goat.

### Fase 8 — feita (o "pronto quando" passou; ganho de força não comprovado)

O que o bot passou a fazer, cada coisa com um cenário dirigido no
`test:bot` (os quatro primeiros falham no bot anterior):

- **Extra Deck com conta**: invoca Sincro/Xyz/Link só se o resultado valer
  pelo menos 300 a mais que os materiais mais baratos do campo (Link: tantos
  quanto o Link Rating; Sincro/Xyz: 2; materiais de Xyz pesam 75%, ficam
  presos ao monstro). O bot anterior fazia toda Invocação do Extra Deck
  oferecida — trocava um Battle Ox de 1700 por um Link Spider de 1000.
- **Pêndulo**: põe a escala só se ela abre, com a outra escala (no campo ou
  outro Pêndulo da mão), um monstro da mão de Nível entre as duas; a
  Invocação-Pêndulo oferecida vale 112 (acima da Normal). Antes, Pêndulo na
  mão era "monstro com efeito" e ia para a escala sem faixa nenhuma — ou era
  invocado no lugar de abrir a faixa.
- **Hand trap**: nunca contra o próprio elo (a Ash Blossom negava a busca do
  próprio bot); vale contra elo do adversário, no turno dele ou na batalha. A
  sessão passa `chainPlayer` (quem ativou o último elo) ao bot.
- **Main Phase 1 antes da batalha**: magia não rápida, equipamento e efeito
  de ignição legais vão antes da Battle Phase quando há ataque que valha
  (antes ficavam abaixo dos 76 de "atacar" e só saíam na Main 2, depois dos
  ataques que mudariam).
- **Bot travava o duelo** numa Battle Phase sem saída (nem Main 2 nem End
  Phase oferecidas — um efeito obrigando a atacar, visto no SD6): pedia End
  Phase e o core respondia RETRY até a sessão interromper o duelo. Agora
  ataca; o respondedor de reserva também passou a pedir só o que foi
  oferecido. (O defeito era anterior à Fase 8.)
- Menores: declarar nome prefere as cartas que o adversário já mostrou;
  materiais por soma (Sincro, Ritual) pela combinação válida mais barata;
  seleção "até N" para no mínimo quando o que sobra é custo; `card-intel`
  conhece Link/Xyz/Pêndulo/Regulador (e não lê mais as setas de um Link como
  DEF).
- "Uma vez por turno" é do core: ele não oferece de novo o que já foi usado.
  O teto anti-laço do bot (2 ativações por carta por turno) continua.

**Medição** (`test:bot`, mesmos decks e sementes; o A/B carrega o bot
anterior com `BOT_RIVAL` e o rival `cerebro`):

| Confronto | Placar | Bot atual |
|---|---|---:|
| atual × anterior, 44 decks TCG com ≥ 3 no Extra (264) | 130 × 134 | 49,2% |
| atual × anterior, os 107 decks TCG (214) | 112 × 101 | 52,6% |
| atual × anterior, Goat (120) | 61 × 59 | 50,8% |
| atual × guloso, TCG (214) | 167 × 47 | 78,0% (anterior: 79,4%) |
| atual × guloso, Goat (120) | 85 × 35 | 70,8% |
| atual × passivo, Goat (60) | 45 × 15 | 75,0% |

Leitura honesta: **empate com o bot anterior**. As regras novas consertam
jogadas ruins específicas (os cenários provam), mas não movem o placar além
do ruído (±4–5 pontos nessas amostras). Uma ablação (cada regra desligada,
264 partidas cada) também ficou toda entre 46% e 49%: nenhuma regra sozinha
atrapalha nem ajuda de forma mensurável. O "pronto quando" do plano passou —
bot × bot roda os 107 decks sem travar (107/107) e vence o guloso em 78% —,
mas isso já era verdade antes da fase. Força de verdade em deck moderno pede
o que heurística por carta não dá: planejar combo (a ordem de invocações que
abre o Extra Deck), saber o que cada efeito busca. Fica como próximo passo,
fora deste plano.

Também no harness: o guloso de referência travava duelos sozinho (declarava
nome sem o banco oficial; tirava 0 marcadores quando o core pedia N) — isso
contava contra o bot no placar; `test:bot -- --partidas 59,100` repete uma
partida e o relatório mostra a resposta recusada e de quem era; partida que
bate o teto de passos com o jogo andando (SD7 × SD7, 67 turnos de muralha)
conta como longa, não como travada.

### Fase 9 — feita

**Bot × bot em massa** (`test:presets -- --rodadas 20`, 12 processos): 2.140
duelos TCG (os 107 decks, 20 adversários e sementes cada), **2.140
terminados**, 0 RETRY (nem recuperado, nem em laço), **0 plano vazio nos dois
assentos**, 0 erro de script, 19 tipos de prompt exercitados.

- **`eof` do binding**: 112 nesses duelos (~1 a cada 19), **todos
  `SHUFFLE_SET_CARD`** (mensagem 36, embaralhar cartas baixadas) — o mesmo
  defeito do Wandering Mummy da §3.1. O binding lançava e o lote inteiro
  daquele passo se perdia (dano, movimento, dica de carta, log). Novo conserto
  no `postinstall`: cada mensagem é lida à parte e só a ilegível cai (com
  aviso no console). Rodada de novo: **0 lote perdido**. A mensagem em si
  continua ilegível; a mesa não depende dela (é relida do core), e o
  `revealedTo` não é zerado por ela — resíduo pequeno de informação oculta,
  coberto pelo `CHAIN_SOLVED` logo em seguida na prática.
- **Os 3 RETRY da §3.1** (Earthshaker, Ancient Gear Gadget, Crossout
  Designator) eram do piloto do harness e já tinham caído na Fase 4.

**Baterias de carta, antes × depois**: as duas, rodadas no código atual e no
commit da Fase 7 (worktree), deram relatórios **idênticos byte a byte** — Goat:
1.690 cartas, 3.108 cenários (1.748 ativaram, 1.360 não oferecidas); TCG:
13.318 cartas, 24.589 cenários, **0 erro de Lua**, 9.879 ativadas/invocadas.
As mudanças de harness e binding desta fase não mudaram veredito nenhum.

**Partidas pela tela**: `test-browser` ganhou `PRESET=tcg-…` e o online
`FORMATO=tcg`. Duelos completos clicando, com 20 decks diferentes (Goat e TCG:
Link Strike, Codebreaker, Master of Pendulum, Pendulum Domination, Cyberse
Link, Powercode Link, HERO Strike, Synchron Extreme, Albaz, Crimson King,
Blue-Eyes White Destiny, Rokket Revolt, Dimensional Dragons, Sky Striker,
Yusei, os dois kits de 2 jogadores…): todos terminam, 0 exceção, 0 erro de
console; online Goat e TCG passam. Mais as suítes de mesa moderna, mecânicas
por clique, declaração, cancelamento, compra, rotação e construtor.

**Os testes de navegador escondiam travamentos** — consertados antes de valer
qualquer número acima:

1. O seletor de idioma das cartas (PT/EN) está sempre habilitado e o teste o
   clicava em vez de esperar: uma mesa parada virava "250 ações" e nunca era
   acusada. Idem os botões de "ver" (👁 reveladas, 👁 ver o tabuleiro).
2. `clickText` clica o primeiro elemento da PÁGINA que contém o texto: um
   "Deck" escolhido na mesa (candidato de busca no Deck) casava com o link
   "Deck Builder" da navegação — o teste saía do duelo e clicava "Novo" no
   construtor ~245 vezes (não gravou por sorte: o debounce não chegou a
   disparar). Agora as jogadas usam `clickAction` (só botões fora do
   cabeçalho, texto exato primeiro), e sair da mesa reprova o teste.
3. O diagnóstico de travamento passou a mostrar botões (até os
   desabilitados), modais, cartas ativas, a mesa e uma foto
   (`.cache/shots/travou-*.png`), e o fim da sequência de ações.
4. O `test-browser-announce` deixava um `locutor.json` em `.data/decks` (dado
   real) a cada rodada: agora apaga o próprio perfil; o resíduo foi removido.
5. O online testava a queda de conexão depois do fim do duelo (deck TCG acaba
   em ~50 ações): joga 24 antes da queda.
6. `test:connection` (Fase 7 já registrou): jogava o jokenpô nunca e mirava a
   porta 3000.
7. `test-draw-landing` só mede o caso que importa (compra de turno sobre mão
   com mais de 5 cartas), mas jogava cartas e mantinha a mão em 5: duas
   rodadas em três terminavam "sem medição". Agora passa o turno (carta só
   quando o jogo obriga) — 3 de 3 rodadas medem o caso.

**Registrado sem causa provada**: um "TRAVOU" no Yusei (L5DD) com o harness
antigo — botões de "ver" ainda clicáveis na época. Não se repetiu em 5
rodadas seguintes do mesmo deck com o diagnóstico novo nem nos outros 19
decks. A suspeita é o próprio harness, mas não ficou provado. *(Depois: a
causa provável apareceu — ver "Dados atualizados e fichas", abaixo: turno
ritmado do bot lido como mesa parada.)*

**Pronto quando**: zero plano vazio e zero travamento na bateria (2.140/2.140)
— sim; cartas problemáticas resolvidas ou registradas — sim (acima).

### Dados atualizados e fichas (depois da Fase 9)

**Atualização dos dados** — `card-db.json`, scripts, strings, catálogo e
decks prontos, tudo de novo a partir das fontes:

- **BabelCDB** (commit `01a32349`, 2026-10-12): `npm run build:card-db --
  --refresh` agora baixa o `cards.cdb` **e todos os `release-*.cdb`** do mesmo
  commit (set lançado, ainda não fundido no `cards.cdb`) e grava
  `.cache/cdb-manifest.json`; as strings do engine, o preenchimento TCG do
  catálogo e o `test:tcg-pool` leem a mesma lista. Os `prerelease-*` ficam de
  fora (passcode provisório). Resultado: **+121 cartas** (35 do `cards.cdb`,
  86 do `release-betb.cdb`), nenhuma removida, nenhuma linha antiga mudada.
- **CardScripts**: o commit fixo passou de `f1522e75` (24/08) para `a30bd15c`
  (12/10) — 162 commits, ~270 scripts de carta. As 119 cartas novas que não
  são ficha têm script (próprio ou o da arte original). O binding continua o
  0.1.4 (o mais novo publicado).
- **Strings do engine**: +119 cartas com strings próprias; 4 com texto
  corrigido no upstream.
- **Catálogo**: 14.086 cartas jogáveis (eram 14.003). As 3 cartas que
  barravam os decks do **Legendary Arc-V Decks** entraram — os decks prontos
  passam a **110** (os outros 107 iguais, deck por deck).
- **Ainda sem dados (32)**: 19 anunciadas e ainda em *prerelease* no
  BabelCDB (as do BETB em inglês, com passcode provisório — os scripts delas
  citam umas às outras pelo provisório, então ligá-las pelo nome deixaria as
  interações quebradas); 13 que nem estão no BabelCDB (os 501000000+ de
  videogame, "???", e quatro Link novíssimos). Entram sozinhas numa próxima
  atualização, quando o ProjectIgnis as lançar.

**Bateria depois da atualização**: `test:tcg-pool` 13.324 cartas, 24.601
cenários, **0 erro de Lua**, e **0 veredito mudado** nos 24.589 cenários que
já existiam (os 12 novos são as 6 cartas TCG novas com script); Goat: 3.108
cenários, **0 veredito mudado**. Suíte headless inteira passando
(`patches`, `modern-summons`, `ui`, `ui-rare`, `archetypes`, `triggers`,
`remaining`…).

**Fichas**: das 243 que o engine pode criar, **123 não estavam no catálogo**
(a lista da YGOPRODeck tem ~110) — entravam na mesa como imagem quebrada com o
nome "Carta" — e 30 não têm arte na YGOPRODeck. Agora:

- o catálogo completa as fichas pelo próprio `.cdb` (nome, texto, ATK/DEF,
  Nível, Tipo, Atributo): **243 de 243 com nome**;
- a rota de imagem, quando a YGOPRODeck não tem a arte, desenha uma **face de
  carta** (moldura cinza de ficha, nome, estrelas, ATK/DEF) em vez do 404 — e
  lembra o "não tem" por 7 dias, para não ir à origem a cada vez; vale para
  qualquer carta sem arte, não só ficha;
- `sync:images` baixa também as variações de ficha (as cores do Ojama, das
  Ovelhas…): **213 com a arte da YGOPRODeck, 30 com a face desenhada, 0 sem
  imagem**;
- `test:token-images` confere as 243 (e, com `APP_URL`, carrega as duas pela
  rota num Chrome); o `test:board-modern` põe uma ficha sem arte na mesa.

**Achados da bateria com os decks novos** (consertados, com teste):

- **SELECT_SUM com mais de 16 candidatos travava o bot.** Speedroid Wheel
  ("1 ou 2 Speedroid cujos Níveis somem o dado") olha a mão e o Deck — no
  deck Speedroid do Legendary Arc-V são 19 candidatos. Acima de 16 a busca
  caía numa gulosa "os maiores primeiro" que ignora a soma EXATA: com o dado
  em 1 ela mandava um Nível 5, o core recusava e a mesma resposta voltava
  (no app, o duelo seria interrompido). Agora uma busca pela regra de cada
  modo (exata: de `min` a `max` cartas, cada uma com um dos seus dois
  valores; igual ou maior: a menor quantidade que chega lá). Casos novos no
  `test:prompt-rules` (19 e 20 candidatos; falham sem o conserto) e a
  partida repetida termina. Valia para o bot, para o piloto do harness e
  para qualquer efeito que olhe o Deck inteiro.
- **"TRAVOU" falso no navegador**: o turno do bot é ritmado (cada ataque
  espera a investida inteira), e um turno com quatro ataques diretos passa
  dos 8 s em que o teste via "nada clicável". O teste procurava o texto
  "Processando" para saber que o motor trabalhava — texto que a tela não
  mostra mais. A mesa agora expõe `data-processing` e `data-waiting-foe`, e
  os testes leem isso. Era, muito provavelmente, o "TRAVOU" do Yusei acima.

Depois dos dois consertos: `test:presets` em massa com os **110** decks (5
rodadas, 550 duelos) — **550 terminados**, 0 RETRY, 0 `eof`, 0 plano vazio;
pela tela, 8 duelos completos (os três Arc-V novos, Yusei, Synchron Extreme,
Starter Kaiba), mesa moderna, declaração e online Goat e TCG passando.
