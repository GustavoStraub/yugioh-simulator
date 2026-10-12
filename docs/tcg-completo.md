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
