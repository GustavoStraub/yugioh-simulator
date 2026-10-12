# Multiplayer em rede local

> Plano de implementação. Objetivo: abrir a URL do app em duas abas (ou em dois
> computadores da mesma rede) e duelar de verdade, um humano contra o outro.

## 1. O problema

Hoje o duelo inteiro roda **dentro da aba**:

```
src/lib/duel/duel-session.ts
  ├─ start()        cria o duelo, carrega os dois decks
  ├─ runLoop()      duelProcess → duelGetMessage → responde
  ├─ :503           if (prompt.player === 1) → botAutoResponse()   ← o bot
  └─ :780           readBoardState(core, handle, 0, light)          ← ótica fixa
```

O navegador guarda **tudo**: os dois decks, as duas mãos, a semente do RNG, o
estado completo do core. `readBoardState` esconde a mão do oponente *na hora de
desenhar* (`board-state.ts:126`), mas o dado bruto está a uma chamada de
`duelQueryLocation` de distância no console.

Duas coisas já foram escritas pensando em dois assentos e vão ser reaproveitadas:

- `readBoardState(core, handle, viewer, light)` — **já recebe `viewer`** e
  mascara certo para qualquer um dos dois lados.
- `fieldPlaceLabel(place, viewer)` (`field-places.ts:76`) — já é relativo.

## 2. A decisão: quem é dono do engine

| | **A. Servidor autoritativo** | **B. Um navegador hospeda** | **C. Lockstep nos dois** |
|---|---|---|---|
| Engine roda em | Node | aba do jogador 1 | as duas abas |
| Informação oculta | **protegida** | anfitrião vê tudo | **os dois veem tudo** ❌ |
| Anfitrião fecha a aba | segue | duelo morre | segue |
| Risco de dessincronia | nenhum | nenhum | irrecuperável |
| Reconexão / espectador | trivial | difícil | precisa de replay |

**Escolhido: A.** B custa o mesmo trabalho de roteamento com propriedades
piores. C parece barato até lembrar que `shuffled()` usa `Math.random()`
(`duel-session.ts:124`) e precisaria de RNG semeado e bit a bit idêntico nos
dois lados — e mesmo assim o adversário lê sua mão num heap snapshot.

A também preserva o modo bot de graça: um "assento bot" é só um assento cujo
respondedor é `botAutoResponse` em vez de um socket.

## 3. O que a investigação provou (rodando código, não lendo)

| Verificação | Resultado |
|---|---|
| ocgcore roda no Node | core sobe em **30 ms**; 3 duelos simultâneos num core só em 46 ms; 108 MB RSS |
| `createCore({ wasmBinary })` | funciona, **3 ms** — dispensa o *monkeypatch* de `fetch` do `tools/harness/env.mjs` |
| Módulos reais importáveis no Node | `duel-session`, `board-state`, `duel-actions`, `bot-responder`… todos ✓ via `tools/harness/ts-loader.mjs` |
| `JSON.stringify` numa mensagem do core | **estoura** — `HINT` real é `{ type: 2, hint_type: 1, player: 0, hint: 27n }` |
| Tamanho do tabuleiro serializado | **2 304 bytes** por ótica → mandar inteiro, sem protocolo de delta |
| `snapshot.field` (`OcgFieldState`) | **ninguém lê** na UI — 463 bytes de peso morto |

A consequência mais importante da terceira linha: **o servidor roda a mesma
`DuelSession` que o navegador**, não uma reimplementação. Node 26 apaga os
tipos sozinho e o `ts-loader` resolve o atalho `@/`.

## 4. Arquitetura

```
                    ┌──────────────────────────────────────┐
   aba 1  ──WS──►   │  server.mjs   (Node, fora do bundle) │
                    │   ├─ next()          → HTTP/HMR      │
   aba 2  ──WS──►   │   └─ WebSocketServer → /api/duel-ws  │
                    │        └─ DuelRoom                   │
                    │             ├─ DuelSession (ocgcore) │
                    │             └─ projeta por assento   │
                    └──────────────────────────────────────┘
```

- O engine roda uma vez, no servidor.
- Cada cliente recebe **só a sua ótica**: seu tabuleiro, seus prompts, seu log.
- O cliente continua sendo o `DuelBoard` de hoje, agora parametrizado por `me`.

### 4.1 Transporte: WebSocket com servidor customizado

O App Router **não** aceita upgrade de WebSocket num route handler — está na
doc empacotada (`01-app/02-guides/backend-for-frontend.md:927`). Mas o `next`
expõe `getUpgradeHandler()` (`node_modules/next/dist/server/next.d.ts:31`),
então um servidor customizado fica com `/api/duel-ws` e devolve o resto — o
socket de HMR do Next incluído:

```js
const server = createServer((req, res) => handle(req, res));
server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url, "http://x");
  if (pathname === WS_PATH) wss.handleUpgrade(req, socket, head, /* … */);
  else nextUpgrade(req, socket, head);
});
```

**Por que não SSE + POST** (que não exigiria ejetar o servidor): bidirecional,
menor latência, e — o motivo que decide — **detecção de desconexão de graça**.
Num duelo humano-vs-humano o core trava inteiro esperando um jogador; é
essencial saber quando o outro fechou a aba. Bônus: estado dono do `server.mjs`
vive fora do grafo de módulos do Next e **sobrevive ao HMR** — dentro de um
route handler, editar qualquer arquivo apagaria todas as salas em andamento.

### 4.2 Assentos substituem "jogador 0 é você"

`DuelSessionConfig` ganha `seats`, com padrão igual ao comportamento de hoje:

```ts
export type SeatKind = "local" | "remote" | "bot";
export interface SeatConfig {
  kind: SeatKind;
  /** Nome usado na narração do log. */
  name: string;
}

// padrão: [{ kind: "local", name: "Você" }, { kind: "bot", name: "O oponente" }]
```

E o desvio do bot em `runLoop` (`:503`) vira:

```ts
const promptPlayer = ("player" in prompt ? prompt.player : 0) as 0 | 1;
if (this.seats[promptPlayer].kind === "bot") { setResponse(botAutoResponse(prompt)); continue; }
const automatic = autoResponseFor(prompt);
if (automatic) { setResponse(automatic); continue; }
this.publishPrompt(prompt, promptPlayer);   // estaciona até o assento responder
```

A ordem importa e é a de hoje: **bot antes de `autoResponseFor`**.

### 4.3 Snapshot: um por ótica

```ts
export interface DuelLogEntry {
  text: string;
  /** Assento que pode ler a linha; null = os dois. */
  visibleTo: 0 | 1 | null;
}

export interface DuelSnapshot {
  /** Tabuleiro na ótica de cada assento; null onde ninguém olha (bot). */
  boards: [BoardState | null, BoardState | null];
  lifePoints: [number, number];
  turnPlayer: number | null;
  phase: number | null;
  log: DuelLogEntry[];
  winner: number | null;
  pendingPrompt: OcgMessage | null;
  /** De quem o engine espera resposta — a UI usa para "aguardando fulano". */
  promptPlayer: 0 | 1 | null;
  /** Identifica o prompt; a resposta precisa citá-lo (ver 4.5). */
  promptId: number;
  promptCard: number | null;
  isProcessing: boolean;
  error: string | null;
}
```

Sai `field: OcgFieldState` (peso morto, verificado). `board` vira `boards`.

`refreshField` passa a ler uma vez por assento não-bot — 2× as chamadas ao
WASM no caso online, e nenhuma mudança no caso local (o assento 1 é bot).

### 4.4 Projeção por assento (é aqui que a informação oculta se protege)

```ts
function projetar(master: DuelSnapshot, seat: 0 | 1): DuelSnapshot {
  const meuTurno = master.promptPlayer === seat;
  return {
    ...master,
    boards: seat === 0 ? [master.boards[0], null] : [null, master.boards[1]],
    pendingPrompt: meuTurno ? master.pendingPrompt : null,
    promptCard: meuTurno ? master.promptCard : null,
    log: master.log.filter((e) => e.visibleTo === null || e.visibleTo === seat),
  };
}
```

`promptPlayer` **fica** na projeção: saber que o adversário está sendo
perguntado é informação pública numa mesa de verdade, e é o que alimenta o
aviso "aguardando fulano".

Duas fugas de informação que o log tem hoje e que a projeção fecha:

- `CONFIRM_CARDS` / `CONFIRM_DECKTOP` narram **quais** cartas foram reveladas.
  Essas mensagens têm um campo `player` — a revelação é dirigida. Passam a
  entrar como `visibleTo: message.player`, e o outro assento recebe uma linha
  neutra ("fulano olhou 2 carta(s)").
- O evento transitório `reveal` (o overlay de cartas reveladas) ganha
  `visibleTo`, e só é entregue ao assento certo.

### 4.5 Protocolo

`src/lib/net/duel-protocol.ts` — importado pelos **dois** lados.

```
cliente → servidor   join{room, token, name, deck} · ready{ready} · respond{promptId, response}
servidor → cliente   joined{me, room} · lobby{seats} · snapshot{…} · event{DuelEvent}
                     · peer{seat, connected} · error{message}
```

**Codec de BigInt — obrigatório.** Verificado: `JSON.stringify` numa mensagem
real do core estoura com `Do not know how to serialize a BigInt`. Além de
`HINT.hint`, são bigint `SELECT_OPTION.options`, `SELECT_CHAIN.description`, os
opcodes de `ANNOUNCE_CARD` e `ANNOUNCE_RACE.races` **na resposta** — logo o
codec vale nas duas direções.

```ts
const encode = (v) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? { $b: x.toString() } : x));
const decode = (s) => JSON.parse(s, (_k, x) =>
  x && typeof x === "object" && typeof x.$b === "string" ? BigInt(x.$b) : x);
```

**`promptId`.** Contador monotônico, incrementado a cada prompt publicado.
`respond` rejeita id que não seja o corrente. Sem isso, um clique atrasado
responde a uma pergunta que o core já passou, e cai no laço de `RETRY` que o
`MAX_CONSECUTIVE_RETRIES` (`duel-session.ts:66`) existe para matar.

### 4.6 Salas e identidade por aba

O pedido literal — *abrir a URL duas vezes e ter duas contas* — exige
identidade **por aba**, não por navegador: `sessionStorage`, nunca
`localStorage`. O `duel-storage.ts` já usa `sessionStorage` ✓.

```
/duel/online          lobby: criar sala ou entrar por código; mostra a URL da LAN
/duel/online/[code]   sala + mesa
```

- Código de 4 caracteres, alfabeto sem ambiguidade (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`).
- Token do jogador em `sessionStorage` → reconexão volta para o mesmo assento.
- `next.config.ts` calcula `allowedDevOrigins` a partir de `os.networkInterfaces()`
  — o Next 16 bloqueia origem cruzada em dev por padrão.
- A URL de compartilhamento vem do servidor (`/api/duel/net-info`), porque o
  anfitrião costuma estar em `localhost`, que não serve para o amigo.

> O deck vive em **localStorage**, compartilhado entre abas. Para testar com
> dois decks diferentes, o lobby online oferece os decks prontos além do seu.

### 4.7 Onde cada coisa mora

```
server.mjs                        entrada: next() + http + upgrade  (JS puro)
src/server/duel/room.ts           uma sala: assentos, sessão, projeção, broadcast
src/server/duel/rooms.ts          registro de salas (Map em memória)
src/server/duel/socket.ts         WebSocketServer, join/respond/desconexão
src/server/duel/node-assets.ts    wasm/scripts/dados a partir do disco
src/lib/net/duel-protocol.ts      tipos + codec (cliente e servidor)
```

`src/server/**` fica sob `src/` de propósito: assim os imports usam `@/server/…`,
que o `ts-loader` resolve. O Next nunca compila esses arquivos porque nada em
`app/` os importa — mas o `tsc` os confere, porque o `tsconfig.include` pega
`**/*.ts`.

### 4.8 Assets injetáveis

O que hoje é buscado por URL relativa (`/api/scripts`, `/api/card-db`,
`/api/engine-strings`, `/ocgcore/*.wasm`) passa por uma interface:

```ts
export interface DuelAssets {
  loadCore(printErr: (m: string) => void): Promise<OcgCoreSync>;
  script(name: string): Promise<string | null>;
  cardDb(): Promise<OfficialCardDb>;
  engineStrings(): Promise<EngineStringsDb>;
}
```

- **Navegador** (`browser-assets.ts`): o que já existe, sem mudança de comportamento.
- **Node** (`node-assets.ts`): `wasmBinary` lido do `node_modules`, `card-db.json`
  e `engine-strings.json` lidos do disco, scripts Lua pelo mesmo código que a
  rota `/api/scripts` usa hoje — extraído para `src/lib/duel/script-source.ts`
  e compartilhado, para não existirem dois caminhos que possam divergir.

O catálogo (`CardRegistry`) continua vindo pelo `config`, como hoje; no servidor
ele é montado por `src/lib/domain/goat-cards.ts` — a lógica de busca extraída de
`src/app/api/cards/route.ts`, que passa a ser um invólucro fino.

## 5. Mudanças arquivo a arquivo

### Novos

| Arquivo | O que faz |
|---|---|
| `server.mjs` | servidor customizado: `next()`, `http`, roteamento de `upgrade` |
| `src/server/duel/room.ts` | `DuelRoom`: assentos, sessão, projeção, broadcast |
| `src/server/duel/rooms.ts` | registro em memória; criar/entrar/sair/limpar |
| `src/server/duel/socket.ts` | `WebSocketServer` e o dicionário de mensagens |
| `src/server/duel/node-assets.ts` | `DuelAssets` a partir do disco |
| `src/server/net-info.ts` | IPv4 não-interno da máquina, para a URL de convite |
| `src/lib/net/duel-protocol.ts` | tipos das mensagens + codec BigInt |
| `src/lib/duel/duel-assets.ts` | a interface `DuelAssets` |
| `src/lib/duel/browser-assets.ts` | implementação do navegador |
| `src/lib/duel/script-source.ts` | busca de script Lua no ProjectIgnis (compartilhada) |
| `src/lib/domain/goat-cards.ts` | catálogo Goat da YGOPRODeck (compartilhado) |
| `src/hooks/useOnlineDuel.ts` | socket → mesma forma de retorno do `useDuelEngine` |
| `src/components/duel/OnlineLobby.tsx` | criar/entrar em sala |
| `src/components/duel/OnlineDuelApp.tsx` | sala + mesa |
| `src/app/duel/online/page.tsx` | rota do lobby |
| `src/app/duel/online/[code]/page.tsx` | rota da sala |
| `src/app/api/duel/net-info/route.ts` | URL da LAN para compartilhar |
| `tools/harness/test-multiplayer.mjs` | duelo 2 assentos headless (ver §7) |

### Alterados

| Arquivo | Mudança |
|---|---|
| `duel-session.ts` | `seats`, `assets`, `boards[]`, `promptPlayer`, `promptId`, log com `visibleTo`, `seatName()` no lugar de `who()`/`playerLabel()` |
| `duel-events.ts` | `reveal` ganha `visibleTo` |
| `board-state.ts` | nenhuma — já é por ótica ✓ |
| `duel-actions.ts` | só `:541` ("Você precisa encadear") |
| `DuelBoard.tsx` | prop `me`; `:125-126`, `:262-272`, `:305`, `:1371`; aviso "aguardando" |
| `useDuelFeedback.ts` | parâmetro `me`; `:112,138,146,148,150,158,169` |
| `useDuelEngine.ts` | repassa `assets`/`seats`; devolve `me` |
| `DuelPlayApp.tsx` | `me={0}` |
| `AppNav.tsx` / `SiteHeader.tsx` | item "Online"; mesa cheia também em `/duel/online/*` |
| `api/cards/route.ts`, `api/scripts/[...path]/route.ts` | viram invólucros dos módulos extraídos |
| `next.config.ts` | `allowedDevOrigins` a partir das interfaces de rede |
| `package.json` | `ws`, `@types/ws`; `dev`/`start` apontam para `server.mjs` |

Também alterados, por causa da revisão (§10): `AttackFlight.tsx` e os
atributos de ancoragem dentro do `DuelBoard.tsx`.

**Intocados, e é a boa notícia**: `duel-actions.ts` (892 linhas de tradução
prompt→UI) já é agnóstico de ótica, fora a linha 541; `board-state.ts` já
recebe `viewer`; `DrawFlight.tsx` e `DuelCardSlot.tsx` só consomem os atributos
do DOM, então basta o `DuelBoard` emiti-los com o índice absoluto certo.

## 6. Armadilhas conhecidas

1. **O core trava num jogador só.** Não existe nenhum timeout no código. Se o
   amigo alt-tabar no meio de um prompt, o outro fica olhando um tabuleiro
   congelado sem explicação. Mínimo: aviso "aguardando fulano". Desistência
   automática fica fora do v1.
2. **PvP gera muito mais prompt que o modo bot.** `MODE_GOAT` inclui
   `OBSOLETE_IGNITION` (prioridade de 2005). Contra o bot, todo `SELECT_CHAIN`
   dirigido ao jogador 1 era engolido pelo `botAutoResponse`. Com um humano no
   assento 1, o core vai perguntar **o tempo todo**. O `autoResponseFor`
   (`auto-response.ts`) é o que torna isso suportável — é código de carga, não
   conveniência.
3. **Quem começa.** Hoje o jogador 0 sempre começa. Com dois humanos isso é
   vantagem de verdade para quem criou a sala. A sala sorteia o assento na hora
   de começar o duelo.
4. **Concorrência.** Um `createCore()` serve muitos `createDuel()` (verificado:
   3 duelos, 46 ms, `cardReader`/`scriptReader` são fechamentos por duelo). O
   `runLoop` de cada sala já é protegido contra reentrância por `this.running`.
5. **HMR em dev.** Estado de sala precisa ser dono do processo do `server.mjs`
   (via `src/server/**`, importado fora do grafo do Next). Se algum dia migrar
   para route handler, as salas somem a cada edição de arquivo.

## 7. Verificação

- `tools/harness/test-multiplayer.mjs`: monta uma `DuelRoom` com dois sockets
  falsos, responde os dois assentos com `botAutoResponse` e joga N turnos.
  Confere: roteamento por assento, `promptId` (rejeita resposta velha), codec
  BigInt de ida e volta, e — o que mais importa — que **a projeção do assento 0
  nunca contém `code` de carta da mão do assento 1**.
- `npx tsc --noEmit` e `npm run lint` limpos.
- Manual: duas abas em `localhost`, depois um segundo computador na LAN.

## 8. Fases

| Fase | Entrega |
|---|---|
| **1** | `DuelAssets` + assentos + `boards[]`/`promptPlayer`/`promptId` + log com `visibleTo`. O duelo local continua idêntico. |
| **2** | `me` no cliente (`DuelBoard`, `useDuelFeedback`). Ainda tudo local. |
| **3** | Protocolo, `node-assets`, salas, `socket.ts`, `server.mjs`. |
| **4** | Lobby online, rotas, navegação, URL de convite. |
| **5** | Teste headless, reconexão, aviso de desconexão, sorteio de quem começa. |

## 9. O que fica de fora de propósito

- Redis ou qualquer estado externo — LAN, um processo, `Map` na memória.
- Snapshot incremental/delta — 2,3 KB medidos; manda inteiro.
- WebRTC — atravessar NAT entre máquinas do mesmo switch é custo puro.
- Matchmaking, contas, ranking, side deck, revanche automática.

## 10. Revisão do plano

Passagem crítica sobre as seções 1–9, com o que foi **verificado rodando**.

### Bloqueadores confirmados

**RV1 — Módulos JSON não carregam no Node sem atributo de importação.**
`src/lib/data/preset-decks-catalog.ts:1` faz `import … from "@/data/preset-decks.json"`.
Verificado: falha com *`needs an import attribute of "type: json"`*. O servidor
precisa do `PRESET_DECKS` (o catálogo completa os passcodes que o filtro
`format=goat` da YGOPRODeck não devolve), então isso trava a fase 3.
**Correção**: o `resolve` de `tools/harness/ts-loader.mjs` passa a anexar
`importAttributes: { type: "json" }` quando a URL resolvida termina em `.json`.
Verificado funcionando — o catálogo carrega os 10 decks. Corrige para o harness
também, sem tocar em código de aplicação.

**RV2 — Route handlers não são importáveis do servidor puro.**
Verificado: `import("@/app/api/cards/route")` falha com
*`Cannot find module 'next/server'`* — esse atalho só existe dentro do bundler.
Confirma a decisão da §4.8: a lógica compartilhada tem que sair para módulos
sem dependência do Next (`goat-cards.ts`, `script-source.ts`), com as rotas
virando invólucros finos.

### Erros no próprio plano

**RV3 — A §5 dizia que `AttackFlight`/`DrawFlight` ficavam intocados. Errado.**
Os atributos de ancoragem são escritos **fixos** no `DuelBoard`:
`dataPile="deck-1"` (`:326`), `dataPile="deck-0"` (`:385`), `data-hand="0"`
(`:597`), `data-hand="1"` (`:861`). O `DrawFlight` os procura pelo índice
**absoluto** (`[data-pile="deck-${draw.player}"]`). Com `me === 1` a fileira de
baixo passa a ser o jogador 1, então o `DuelBoard` tem que emitir
`deck-${me}` / `data-hand="${me}"` embaixo e `${1 - me}` em cima. Sem isso a
carta comprada voa para o deck errado.

**RV4 — `AttackFlight` também depende da ótica.** Em `:99`, o ataque direto
mira `y = 6%` quando `attacker === 0` (topo da tela) e `94%` caso contrário.
Com `me === 1` isso inverte. Corrigido na origem em vez de espalhar `me`: o
`useDuelFeedback` já vai receber `me`, então ele calcula `mine: boolean` e o
`AttackFlight` passa a ler `flight.mine`.

**RV5 — `shake` idem.** Hoje é `0 | 1` e o `DuelBoard` mapeia
`shake === 0 ? "bottom-0" : "top-0"` (`:305`). Vira `"mine" | "theirs"`,
resolvido dentro do `useDuelFeedback`. Mesma razão: uma conversão só, no lugar
onde `me` já é conhecido.

**RV6 — `fieldPlaceLabel(place, viewer)` é código morto.** Verificado: nenhum
chamador em `src/`. Não custa trabalho nenhum de ótica — e não vale removê-lo
neste trabalho.

### Lacunas de projeto que faltavam

**RV7 — Ciclo de vida da sala.** `DuelSession.start()` é uma via só
(`if (this.started) return`). A sala só pode chamá-lo quando os **dois** decks
chegaram e os dois assentos estão prontos; antes disso a sala fica em lobby.

**RV8 — O deck vem de um cliente, e cliente não é confiável.** O servidor valida
tamanho e limites (`isDeckDuelReady`) antes de aceitar. Um `main` de 5 cartas
hoje derrubaria o duelo com um erro do core.

**RV9 — Sala cheia.** Terceiro socket recebe `error` e é fechado. Espectador
fica para depois.

**RV10 — Reconexão sai de graça.** `DuelSession.subscribe()` já entrega o
snapshot corrente ao assinar; o socket que volta recebe o estado inteiro sem
código novo. O que se perde são os eventos transitórios (animação e som) — não
há como reemiti-los, e não vale guardar histórico para isso.

**RV11 — Módulos compartilhados existem duas vezes.** `goat-cards.ts` e
`script-source.ts` são importados pelo grafo do Next (rotas) **e** pelo Node
puro (servidor). São duas instâncias de módulo, logo dois caches e, no pior
caso, duas buscas na YGOPRODeck. Desperdício aceitável; o que **não** pode é
alguém tratar esses caches como fonte única de verdade.

---

## 11. O que a implementação mudou no plano

Registro do que só apareceu ao escrever o código. Está aqui porque um plano que
não conta onde errou é um plano que ninguém confere na próxima vez.

### O servidor roda a `DuelSession` de verdade

A §4 dizia "a mesma `DuelSession`" como intenção; ficou melhor do que o
esperado. Verificado: `duel-session`, `board-state`, `duel-actions`,
`bot-responder` e o resto importam limpo no Node com o `ts-loader`, então o
servidor **não tem uma linha** do laço de mensagens. O que era para ser uma
extração virou uma injeção de quatro métodos (`DuelAssets`).

O `ts-loader` precisou de três correções para isso, todas descobertas com o
servidor recusando-se a subir:

1. **atributo de importação em JSON** (previsto em RV1);
2. **diretório não é módulo** — `@/lib/types` é `types/index.ts`, e aceitar o
   diretório dava `ERR_UNSUPPORTED_DIR_IMPORT`;
3. **relativos sem extensão** — `export * from "./duel"` dentro de `src/`;
4. **e o inverso**: o hook vale para TODA resolução do processo, inclusive a
   CommonJS interna do Next, que espera um caminho e não uma URL `file://`.
   Sem limitar o hook a `src/`, o `require("./cjs/react.development.js")` do
   próprio React recebia uma URL e o servidor morria antes de escutar.

### `wasmBinary` em vez do remendo em `fetch`

O plano herdaria do harness o truque de trocar `globalThis.fetch` para entender
`file://`. Ao ler o `Initializer` do binding apareceu `wasmBinary?: ArrayBuffer`:
o core aceita os bytes direto. Mais rápido (3 ms) e, principalmente, sem mexer
num global que o Next também usa.

### Prevista, mas o custo real foi outro: `getUpgradeHandler`

Ele existe (a §4.1 conferiu no `.d.ts`), mas **só depois de `app.prepare()`** —
pedi-lo antes estoura com "prepare() must be called before performing this
operation". Uma linha de diferença, e o servidor não sobe.

### O bug que o plano não previu: a mão do assento 1

A §5 listou os pontos de ótica do `DuelBoard` a partir de um `grep`. Faltou um,
e era o que quebrava o jogo: o componente `Hand` escrevia
`cardKey(0, HAND, sequence)` e `slotProps({ player: 0, ... })` **fixos**. A
chave da zona é absoluta, então para quem senta no assento 1 nenhuma carta da
mão casava com a ação que o engine oferecia — o jogador não conseguia invocar,
baixar nem ativar nada, e o duelo parava no primeiro turno dele.

Nada disso aparece como erro: sem exceção, sem log, apenas cartas que não
respondem ao clique. Foi o `test:browser-online` que pegou, e é a razão de ele
existir separado do `test:multiplayer` — o servidor estava perfeito o tempo
todo.

### O segundo bug que o plano não previu: contexto seguro

`crypto.randomUUID()` só existe em **contexto seguro** — https ou `localhost`.
O duelo em rede é jogado justamente onde ele não existe: o amigo abre
`http://192.168.x.y:3000`, http puro e não-localhost, e ali a função vem
`undefined`. Três chamadas estavam expostas (`deck-operations`,
`preset-decks`, e o token de aba que eu mesmo escrevi), e o sintoma não parecia
de rede: a página estourava no `module evaluation`, antes de renderizar
qualquer coisa.

Corrigido com `src/lib/random-id.ts`, que cai para `crypto.getRandomValues`
(esse **não** é restrito) mantendo o formato de UUID v4, para não invalidar os
ids já gravados no `localStorage`.

O erro passou por toda a bateria porque **todo teste rodava em `127.0.0.1`, que
é contexto seguro**. A correção que importa não é a do código: o
`test-browser-online` agora resolve o IP da rede pelo `/api/duel/net-info` e
abre o Chrome por ele, imprimindo em qual contexto está. Um teste de rede local
que nunca sai do localhost testa o cenário errado.

### Coalescência de envios (não estava no plano)

O `DuelSession` chama `update()` a cada linha de log e a cada mudança de LP:
dezenas de notificações por lote de mensagens, todas para o mesmo estado final.
A sala represa tudo num `queueMicrotask` e manda uma vez. O ganho que importa
não é banda — é **ordem**: o snapshot sai antes dos eventos daquele lote, que é
o que a animação de compra precisa (ela mede a mão já redesenhada).

### Peneira nos endereços de rede

`os.networkInterfaces()` devolve as pontes virtuais do Docker/OrbStack junto,
e elas respondem `192.168.x.y` sem alcançar ninguém — o primeiro endereço da
lista, que vira o link de convite, era justamente um deles. Duas peneiras
resolvem o caso comum: último octeto `0` é endereço de rede e não de máquina, e
interfaces `en*`/`eth*`/`wl*` vão para a frente.

### Verificação executada

| O que | Resultado |
|---|---|
| `npm run test:multiplayer` | 12/12 — 100 decisões entre dois assentos; nenhuma informação oculta atravessou a projeção |
| WebSocket de ponta a ponta contra o servidor de produção | 40 decisões, dano trocado, reconexão por token devolveu o estado |
| `npm run test:browser-online` | duas abas de Chrome **pelo IP da rede** (contexto inseguro), 60 ações, identidades distintas, ótica correta dos dois lados, 0 erro de console |
| `npm run test:browser` (duelo local vs bot) | 54 ações, 0 exceção — sem regressão |
| `npm run test:ui` | 10 duelos, 12 tipos de prompt, 0 prompt sem resposta possível |
| `npx tsc --noEmit`, `npm run lint`, `npm run build` | limpos |

### O que continua de fora

- Nenhum relógio: quem sai no meio de um prompt trava o duelo do outro. Há
  aviso de "aguardando" e de queda de conexão, mas não há desistência
  automática (§6.1 previa isso e continua valendo).
- Espectadores, revanche, side deck.
- Salas só sobrevivem enquanto o processo viver — é o desenho, não um descuido.

---

## 12. Depois da primeira versão

O que foi acrescentado depois de o duelo online já rodar, e por quê.

### A sala sobrevive ao duelo (revanche)

Terminar uma partida deixava a sala inútil: para jogar de novo era preciso
criar outra e reenviar o link. Agora o fim do duelo é um estado da sala
(`finished`), não o fim dela. Os dois pedem revanche, os assentos são
**sorteados de novo** e uma partida nova começa ali mesmo. Um pedido só não
recomeça nada — senão a tela de resultado sumiria por cima de quem ainda estava
lendo.

### Trocar de deck entre partidas

A revanche com o mesmo deck resolve metade; a outra metade é querer responder
ao que o outro fez. `setDeck` é aceito antes da primeira partida e entre
partidas (`podeTrocarDeck`), nunca no meio de um duelo — ali a troca não teria
efeito nenhum no engine, e uma opção que finge funcionar é pior do que uma
opção ausente. Trocar desfaz o "pronto" de quem trocou.

### O deck do adversário é oculto

A primeira versão mostrava o nome do deck de cada um no lobby. Está errado:
com essa informação dá para escolher justamente o deck que ganha do outro antes
de a partida começar. O recorte é feito no servidor (`seatInfos(para)`), não na
tela — o nome do deck alheio não chega a atravessar a rede. O que o outro vê é
só "deck escolhido".

### Nomes iguais na mesma sala

Com o nome vindo do perfil (que é por navegador), abrir duas abas põe duas
pessoas com o MESMO nome na sala, e a lista fica com duas linhas idênticas.
`nomeLivre` desambigua na entrada — "Fulano" e "Fulano (2)". A reconexão não
renegocia o nome, senão voltar de uma queda promoveria você a "(2)" sozinho.

### Queda no meio do duelo

A §6.1 anotou isto como lacuna conhecida e subestimou o tamanho dela. O que
acontecia de verdade:

1. quem ficava via **exatamente a mesma tela** de um duelo normal esperando o
   outro jogar — "Aguardando Fulano…", para sempre, sem nada dizendo que o
   Fulano tinha fechado a aba (o `connected: false` chegava no `lobby`, mas a
   mesa nunca lia essa informação);
2. não existia nenhum jeito de encerrar;
3. a sala nem era recolhida pela faxina, porque `isEmpty` só é verdade quando
   os **dois** somem.

Agora o assento continua guardado pelo token (uma oscilação de Wi-Fi não pode
custar a partida), mas com prazo: passados 45 segundos — `DUEL_DISCONNECT_GRACE_MS`,
lido a cada checagem para o harness poder encurtá-lo — quem ficou pode encerrar
a seu favor. O resultado é escrito no snapshot pela sala, não pelo engine: o
ocgcore está parado esperando uma resposta que não virá e não existe
"desistir" para mandar a ele. Com `promptPlayer` zerado, resposta atrasada que
ainda chegue é recusada.

A sala vira `finished`, então quem voltar vê o resultado e os dois podem pedir
revanche normalmente.

### Render-se

Clicar no próprio deck abre um painel com 🏳️ *Render-se*. O deck é a única
pilha que **não** se abre para consulta (o conteúdo é secreto), então sobrava
como o lugar natural para o gesto que encerra a partida — como empurrar o deck
na mesa. Pede confirmação no próprio botão, porque é a única ação da mesa sem
volta.

A rendição não passa pelo engine, e não podia passar: o ocgcore não tem
"desistir", e no instante em que alguém desiste ele está tipicamente **parado**
esperando uma resposta. Zerar os LP também não funcionaria — o core só declara
vitória processando dano de verdade. `DuelSession.surrender(seat)` escreve o
resultado no snapshot pelo mesmo caminho que a mensagem `WIN` usaria, e por
isso o som, o aviso e a tela de resultado saem de graça.

O abandono por queda (§ acima) passou a usar essa mesma função: quem não voltou
é tratado como quem desistiu. Um jeito só de terminar um duelo, em vez de dois.

### O bug que a rendição revelou: sessão zumbi na revanche

Ao encadear os cenários no harness (render-se → revanche → queda), a sala
começava a partida nova já marcada como **terminada**. O rastro mostrou um
snapshot chegando de uma sessão que não era mais a atual.

`reiniciar()` trocava `this.session` sem **desinscrever** a anterior. O
`runLoop` da partida velha podia estar dentro de uma pausa de animação quando a
nova começava e, ao acordar, publicava o snapshot antigo — com vencedor — por
cima do novo. Na prática: pedir revanche logo depois de um duelo acabar podia
mostrar o resultado da partida anterior no tabuleiro recém-criado.

Corrigido guardando os `unsubscribe` e chamando-os em `reiniciar()`, mais uma
guarda `if (this.session !== session) return` dentro dos dois observadores —
para que esquecer o desligamento no futuro não volte a corromper a sala.

### Jogar fora da rede local

Encaminhamento de porta resolve, mas depende de ser dono do roteador — e nem
sempre se é (provedor que configurou e não deu acesso, por exemplo). O túnel
não depende: ele abre a conexão de dentro para fora, como qualquer navegador.

`npm run public` (`scripts/publicar.mjs`) faz build, sobe o servidor, abre o
`cloudflared` e imprime o link já com `/duel/online`. Derruba os dois juntos no
`Ctrl+C`, e derruba o outro se um deles morrer — um túnel órfão apontando para
uma porta vazia é pior do que nenhum túnel.

Rodar em **produção** e não em `dev` é de propósito: em desenvolvimento o Next
recusa recursos vindos de origem cruzada, e o domínio do túnel é sempre cruzado.
Para quem preferir `dev` mesmo assim, `allowedDevOrigins` já traz os domínios de
túnel conhecidos e aceita mais pelo env `DEV_ORIGINS`.

### Batimento na conexão

Publicar na internet significa jogar atrás de um proxy, e proxy encerra
WebSocket ocioso. O nosso ficava **mudo** enquanto o jogador pensava: o servidor
só fala quando o estado muda. Um ping a cada 30 s (`DUEL_HEARTBEAT_MS`) mantém
a conexão viva.

O mesmo ping fechou a lacuna que estava anotada desde a queda-no-meio-do-duelo:
a **conexão meio-aberta**. Notebook que dorme, Wi-Fi que some sem mandar FIN — o
socket ficava aberto para sempre do lado do servidor, e quem ficou nunca via o
aviso nem podia encerrar. Sem pong, a conexão é derrubada e a sala trata como
saída normal.

`npm run test:connection` prova as duas coisas. A segunda exige um cliente que
faça o handshake e **não responda a nada**, o que nenhuma biblioteca de
WebSocket faz (todas respondem ao ping sozinhas) — daí o teste montar o quadro
do protocolo à mão sobre um socket TCP cru.

### Um caminho só depois do resultado

A tela de resultado tinha duas saídas — "jogar de novo com o mesmo deck" e
"trocar de deck" — e elas se atropelavam. A revanche mexia no `ready` por uma
rota (`rematch`) e a sala por outra (`setReady`), e a segunda **recusava** o
pedido depois do duelo: a guarda era `this.started`, que continua verdadeira até
`reiniciar()`. Na prática: quem voltava à sala e clicava "estou pronto" tinha o
clique descartado em silêncio, sem broadcast nenhum — os dois ficavam se
olhando, cada um convencido de ter confirmado e vendo o outro como "escolhendo".
Quem trocasse de deck ficava preso de vez, porque a troca também derruba o
`ready`.

Hoje é um caminho só: *Voltar à sala*. `setReady` vale sempre que a sala está
entre partidas (a mesma condição de `podeTrocarDeck`), e é ele que recomeça
quando os dois querem; `rematch` continua existindo como apelido para o cliente
antigo. `test:multiplayer` cobre justamente o gesto da tela — ficar pronto
depois do fim, o outro **ver** isso, e a partida começar com os dois.

### O prompt também esconde carta

A projeção por assento cuidava do tabuleiro e do log, mas o **prompt** ia
inteiro: o core manda o passcode de todo candidato de um `SELECT_CARD`,
inclusive das cartas na mão do adversário. Duas consequências, uma de jogo e uma
de rede — "O Espião Inexperiente" ("escolha e veja 1 card na mão do
adversário") abria a mão inteira na tela, e um `console.log` no navegador lia a
mão do outro num duelo online.

`maskHiddenCards` zera o `code` dos candidatos que o assento perguntado não
pode ver, **antes** de o prompt entrar no snapshot. O que separa esse caso do
Confisco (que revela a mão e só então pede a escolha) é a ordem das mensagens,
não a carta: a sessão guarda o que cada assento viu por `CONFIRM_CARDS` na
resolução corrente e zera esse conhecimento no fim dela. `test:hidden` prende os
dois lados — o Espião escolhendo pelo verso e o Confisco mostrando as faces.

### Quem começa é disputado, não sorteado

O primeiro turno saía de um `crypto.getRandomValues` dentro do servidor: ninguém
jogava nada e ninguém via nada acontecer. Agora, com os dois prontos, a sala
entra numa fase própria — pedra, papel e tesoura — e **quem ganha escolhe começar
ou não**, que é a decisão de verdade (contra certos decks o segundo turno é
melhor). Empate não decide nada: a rodada sobe e joga-se de novo.

A fase mora na sala (`DuelRoom.jokenpo`), antes de a sessão existir: é mais
simples que embutir no engine e sobrevive a reconexão, porque o estado é guardado
por **token** — assento só existe depois que a ordem é decidida, que é
justamente o que está sendo disputado.

O que exige cuidado é o recorte: `jokenpoState(player)` manda `opponentChose`
(que o outro já jogou) e nunca a jogada dele antes de a rodada fechar. Com a
jogada do adversário em mãos bastava esperar para ganhar sempre — e o
`test:multiplayer` confere isso lendo o JSON que atravessa a rede, não o estado
interno da sala.

Como o ocgcore sempre dá o primeiro turno ao jogador 0, "escolher começar" é
"escolher quem senta no assento 0" — `escolherOrdem` monta a lista nessa ordem e
`comecar` distribui os assentos.
