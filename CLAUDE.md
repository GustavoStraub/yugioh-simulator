# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

Yu-Gi-Oh! Goat-format (April 2005) deck builder and duel simulator. Duels run the real EDOPro engine (ocgcore, through the `@n1xx1/ocgcore-wasm` WebAssembly binding) with the ProjectIgnis Lua card scripts — against a bot in the browser, or online with the engine on the server. Next.js 16 App Router plus a custom Node server (`server.mjs`) for the WebSocket.

Code comments, UI text, docs and commit messages are in Portuguese (pt-BR), and comments explain the *why* at length — match that style.

## Commands

```bash
npm install                # postinstall copies the engine wasm to public/ocgcore/ (git-ignored) and patches the binding (mod.js default export; SORT_CARD response encoding; per-message parse guard)
npm run dev                # custom server (server.mjs) + WebSocket on :3000 — the normal way to develop
npm run dev:next           # plain `next dev`, without the online duel
npm run build && npm start # production mode, same custom server
npm run public             # build + server + cloudflared quick tunnel (needs `cloudflared`)
npm run lint               # eslint
npx tsc --noEmit           # typecheck (no npm script)
```

Node 22.18+ (developed on 26): `server.mjs` and the harness run `.ts` modules directly through Node's type stripping, with `tools/harness/ts-loader-register.mjs` resolving the `@/` alias.

### Tests

There is no test runner: each test is a standalone Node script in `tools/harness/` that drives the real wasm engine headless. `tools/harness/README.md` has the full table.

```bash
npm run fixtures                   # once: clones CardScripts at the pinned commit + downloads the Goat pool into .cache/ (engine tests read scripts from there)
npm run test:cards                 # every Goat card: does the script load, is it offered in Main Phase 1?
npm run test:cards -- 12345 67890  # only these passcodes; also --slice 0/8, --json out.json, --verbose
npm run test:ui                    # plays whole duels and feeds every prompt to the UI's prompt code — finds freezes
npm run test:multiplayer           # rooms, per-seat projection (hidden info), codec — no browser
```

Full TCG pool and modern mechanics: `npm run test:tcg-pool` (every TCG card with a script, MR5, 4 processes, ~1 min) and `npm run test:modern-summons` (Synchro/Xyz/Link/Pendulum through the UI code path, plus Pendulum scale / Link arrow readback).

Also: `test:archetypes`, `test:triggers`, `test:remaining`, `test:patches`, `test:ui-rare`, `test:hidden`, `test:endgame`, `test:cancel`, `test:bot`, `test:deck-library`, `test:connection`, `test:chain-mode` (when the "respond?" prompt reaches the player, plus a whole-duel measurement), `test:duel-log` (log lines and the `leave` event, hidden info included; every line naming a card carries its `codes`), `test:deck-codec` (`.ydk`/`ydke://`), `test:puzzles` (each puzzle's solution wins on turn 1, the naive line doesn't), `test:learning` (glossary, tip order, bot × bot session).

Browser tests (`test:browser*` — `test:browser-peek` covers hiding every decision popup, `test:browser-builder` the deck builder and the bot lobby, `test:browser-learning` puzzles, tips, glossary and bot × bot —, `test:attack`, `test:draw`, `test:viewports`, `shots`) drive a real Chrome over CDP and need the app running at `APP_URL` (default `http://127.0.0.1:3000`). In-duel clicks go through `page.clickAction` (game buttons first — `clickText` matches the first element on the page containing the text, nav links included); buttons that only help reading the table (peek/"Ver a mesa", 👁, glossary terms, tips) carry `data-table-control`, which the click loops skip and `clickAction` only falls back to — an unmarked one gets clicked forever (the glossary's "Cemitério" once beat the picker card of the same name). `test:browser` fails on 25 identical clicks in a row; `PRESET=tcg-…` makes `test-browser` play a TCG deck, `FORMATO=tcg` does the same for `test-browser-online`. Tests that create a profile must delete its file from `.data/decks` (real user data) when done. `test:browser-online` needs the custom server (`npm run dev` / `npm start`); `test:browser` can use `npx next build && npx next start -p 3100` with `APP_URL=http://127.0.0.1:3100`.

Diagnostic env flags: `SKIP_SCRIPT_PATCHES=1` shows the original error a script patch hides; `LEGACY_CARD_DATA=1` drops setcode/alias to measure their effect.

Generated data is committed; regenerate with `npm run build:presets` (`src/data/preset-decks-tcg.json`, the ~100 TCG preset decks, from Yugipedia lists cached in `.cache/yugipedia/` + YGOPRODeck set codes; it validates every deck and fails loudly), `npm run build:card-db` (`src/data/card-db.json` from ProjectIgnis BabelCDB: `cards.cdb` plus every `release-*.cdb`, all from one BabelCDB commit; `-- --refresh` re-downloads and writes `.cache/cdb-manifest.json`, which the engine-strings build, the catalog's TCG fill-in and `test:tcg-pool` read too; `prerelease-*.cdb` are skipped — temporary passcodes) and `npm run build:engine-strings` (`src/data/engine-strings.json`; `-- --refresh` refetches `strings.conf`). Updating card data = `build:card-db -- --refresh`, bump `CARDSCRIPTS_COMMIT` + `npm run fixtures`, `build:engine-strings -- --refresh`, `build:catalog -- --refresh`, `build:presets`, `sync:images`, then the whole battery.

## Architecture

### One duel loop, two hosts

`DuelSession` (`src/lib/duel/duel-session.ts`) owns the engine loop — `duelProcess` → messages → prompt → response — and is the same code in the browser (vs bot, through `useDuelEngine`) and on the server (online rooms; the client side is `useOnlineDuel`, which returns the same shape). What differs is injected:

- **`DuelAssets`** (`duel-assets.ts`): `browserAssets` fetches the wasm, scripts and card data over HTTP (`/ocgcore/*.wasm`, `/api/scripts/*`, `/api/card-db`, `/api/engine-strings`); `src/server/duel/node-assets.ts` reads them from disk, falling back to GitHub for scripts.
- **Seats** (`SeatConfig`): `local` and `remote` park and publish `pendingPrompt` with a `promptId` (late answers are rejected); `bot` is answered in-process by `bot/bot-brain.ts` (heuristics), with `bot-responder.ts` as the always-legal fallback. The session hands the bot turn, phase and the current chain controller (`BotContext.chainPlayer` — so it never answers its own chain link with a hand trap); the harness drivers (`test-bot.mjs`, `test-preset-decks.mjs`) rebuild the same context from messages. Measure bot changes with an A/B, not a feeling: copy the previous brain into `src/` and run `BOT_RIVAL=<module> … test-bot.mjs N cerebro tcg [--extra 3]`.

Modules imported by both the Next graph and the plain-Node server must not import `next/server` — that is why `server/catalog/catalog-store.ts` and `lib/duel/script-source.ts` live outside the route handlers that wrap them.

### Prompt pipeline

Engine message → `findPromptMessage` (`bot-responder.ts`) → `autoResponseFor` (`auto-response.ts`, answers prompts with no real choice) → for humans, `buildPromptPlan` (`duel-actions.ts`) turns it into a `PromptPlan` (per-card actions, field places, selections, counter distribution, modals) that `components/duel/DuelBoard.tsx` renders. Actions on cards off the drawn table are reached through glowing piles (Extra Deck, GY, banished) or the "Outras jogadas" fallback — `actionReach` in `prompt-reach.ts`. Rules that must match the core exactly are mirrored from ygopro-core: `announce-filter.ts` (`is_declarable`) and `sum-selection.ts` (SELECT_SUM exact vs. at-least, two-value cards); the bot and the harness pilot use the same modules. A plan with nothing actionable freezes the duel; `test:ui` and `test:ui-rare` exist to catch that. Before a human sees a SELECT_CHAIN, the session runs `chainWindowSkip` (`chain-mode.ts`): per-seat mode `auto` (default — ask when the opponent just activated, or when the core flags the window with `spe_count > 0`; never for chaining onto your own effect) / `always` / `never`, plus `forceAsk` (Ctrl held). Online the preference travels as the `prefs` client message. Every decision modal renders through `DecisionShell` and must stay hideable ("Ver a mesa"/Esc, mounted while hidden) — a popup may never trap the player away from the field, GY or Extra Deck. **When `PromptPlan` gains a field, update `planIsActionable` in both `tools/harness/ui-audit.mjs` (shared by `test:ui` and `test:presets`) and `test-ui-rare-prompts.mjs`.**

### Modern board (TCG)

`DuelSnapshot.format` drives the table: Goat keeps the 2005 layout; TCG adds the Extra Monster Zone row (shared zones — the left one is `me` seq 5 *or* the opponent's seq 6, drawn from the viewer's perspective), Link arrows, pointed-zone outlines (`link-geometry.ts`), Level/Rank/LINK badges, Pendulum scales on S/T zones 0 and 4, Xyz material badges, and a public face-up Extra Deck. `BoardPlayer.monsters` has 7 entries (5–6 are the Extra Zones). Never add `OcgQueryFlags.TYPE` to a query — the binding can't parse it (throws `eof`, and misaligns combined queries). Local duels accept a test-only `scenario` (cards placed at start) via the stored setup; `test:board-modern` uses it.

### Card marks

Two sources, merged into each viewer's `BoardCard`: **queries** on every board read (`COUNTERS`, `EQUIP_CARD`, `TARGET_CARD`, `STATUS` → `negated`) and **messages** tracked by the session (`CARD_HINT` per field zone — moves with the card on `MOVE`, dropped when it leaves the field; `PLAYER_HINT` → `snapshot.playerHints`; `FIELD_DISABLED` → `snapshot.disabledZones`, player-0 perspective). A card hidden from the viewer carries no marks. `card-marks.ts` turns them into slot chips and reading-panel sentences; `test:marks` covers them in both viewpoints and in `projectSnapshot`.

### Chain display

The session keeps `snapshot.chainLinks` (one `DuelChainLink` per link: code, player, origin `from`, zone, `state` pending → resolving → resolved | negated | disabled) from `CHAINING`/`CHAIN_SOLVING`/`CHAIN_SOLVED`/`CHAIN_NEGATED`/`CHAIN_DISABLED`, cleared on `CHAIN_END` and `NEW_TURN`. `CHAIN_DISABLED n` (effect negated, e.g. Ash Blossom) arrives *during the negating link's resolution*, before link n resolves. It also emits `chainLink`/`chainNegated` events (the resolving state travels in the snapshot); `useDuelFeedback` turns them into the centre `ChainSpotlight` (activation, then the "NEGADO" stamp), `ChainStack` (left rail) lists the links, and field slots get a chain-number badge (`chainBadge`). Their beats are in `pacing.ts` (CHAINING 950 ms, NEGATED/DISABLED 900 ms). `test:browser-chain` plays the Reinforcement × Ash case on screen.

### Local duel variants

All set up in `DuelPlayApp` from the stored setup and run by the same `DuelSession`:

- **Who goes first** (`humanSeat`): the core always gives turn 1 to seat 0, so "the bot starts" puts the human in seat 1 — the board already draws `me = 1` (online does it).
- **Puzzles** (`/duel/puzzles`, data in `src/lib/data/puzzles.ts`): `DuelSessionConfig.puzzle` = no starting hand, the puzzle's LP and `ATTACK_FIRST_TURN`; the `scenario` places the cards. Reaching turn 2 without a winner ends it as a loss. A new puzzle needs a solution in `test-puzzles.mjs`.
- **Bot × bot** (`watchSeat`): both seats are bots; only the watched seat's board is read. The board gets `spectating` (no prompts, no surrender, no tips, turn banners name the player).

The log is written in PT by the session (on the server, online); lines that name cards carry `codes`, and the screen swaps PT names for the chosen language (`localizeLogText`, `log-names.ts`). A new log line that names a card must set `codes`, or it stays in PT. First-time tips (`tips.ts`) and the rules glossary (`glossary.ts`, underlined in the card reader) are pure modules. Narrow/short tables switch layout through `NARROW_TABLE_QUERY` / `SHORT_TABLE_QUERY` (`useMediaQuery.ts`); `test:viewports` measures phone sizes, the LP bars and the nav.

### Hidden information

Board reads are per viewer (`readBoardState(core, handle, viewer)` in `board-state.ts`); prompt candidates are masked (`maskHiddenCards`, `prompt-mask.ts`); online, `projectSnapshot` (`src/server/duel/room.ts`) strips everything a seat may not see before sending. Design rationale: `docs/multiplayer.md`.

### Card data comes from two places

- **Catalog** (`src/server/catalog/catalog-build.ts` → `.cache/catalog/catalog.json` → `/api/cards` → `CardRegistry.fromCatalog`): names, PT/EN text, types, Link/Pendulum/Rank, banlists (`ban_tcg`, `ban_goat`), Goat-pool flag — display and search only. Built once from YGOPRODeck (`npm run build:catalog`, `-- --refresh` to update; the server builds it lazily if missing), indexed by the **official** passcode with every alternate art resolvable (YGOPRODeck sometimes uses an alt art as the main id). Cards without official data (`playable: false`, released after our `cards.cdb` snapshot) are display-only. `/api/cards` is precompressed (brotli/gzip) with an ETag.
- **Images** are served from disk by `/card-images/<small|full|cropped>/<passcode>.jpg` (`card-images.ts`): each is fetched from YGOPRODeck once, rate-limited, then cached in `.cache/card-images/` — never hotlinked. When YGOPRODeck has no art (a `.missing` marker, rechecked after 7 days) the route serves a generated SVG card face (`fallbackCardSvg`: frame by card type, name, Level, ATK/DEF) instead of a 404. Tokens: YGOPRODeck lists only ~110 of the ~240 the engine can create, so the catalog adds the rest from the cdb (`tokensFromCdb`); `test:token-images` checks every token has a name and an image.
- **Official engine data** (`src/data/card-db.json`, read by `official-card-data.ts`): type bitfields, setcodes, alias, level/scales. The engine must get this (`card-adapter.ts`); data derived from YGOPRODeck strings silently breaks every `IsSetCard` check.

### Scripts

CardScripts is pinned to one commit (`src/lib/duel/cardscripts-pin.ts`) for the app route, the online server and the harness clone alike; bump it only together with the binding, then run the whole battery. The core's `scriptReader` is synchronous, so every script must be cached before the duel starts (`script-reader.ts`: `preloadCoreScripts`, `preloadDuelScripts`). Alternate-art passcodes use the original card's script (`OfficialCardDb.scriptPasscode`). `script-patches.ts` patches upstream scripts that the compiled core can't run, using whitespace-tolerant anchors; an unapplied patch is reported, never silent. The harness imports it without the loader, so it can't use the `@/` alias or runtime-only TS features.

### Online and persistence

`server.mjs` (custom Next server, binds `0.0.0.0`) → `src/server/duel/socket.ts` (WebSocket at `/api/duel-ws`; messages and BigInt-safe codec in `src/lib/net/duel-protocol.ts`) → `DuelRoom` (`room.ts`: seats held by token, rock-paper-scissors for the first turn, reconnection with a grace period). Rooms live in memory in that one process. Deck libraries are JSON files per nickname written by the server (`src/server/decks/store.ts` → `.data/decks/`, git-ignored — real user data, not fixtures).

### Formats

Each `DeckList` has `format: "goat" | "tcg"` (missing = Goat via `formatOf`/`normalizeDeck`); it travels inside `DuelDeckPayload.format` to local duels and online rooms (a room won't start Goat × TCG). `deck-rules.ts` holds per-format limits (`deckLimits`), pool membership (`isInFormatPool`: Goat pool vs. any card with official data), and the per-format banlist (`banStatus`, `banlistSummary`) — information only; the only hard rule is 3 copies. Preset decks: `src/data/preset-decks.json` (10 hand-built Goat decks) + `src/data/preset-decks-tcg.json` (generated — never hand-edit, rerun `build:presets`), merged in `lib/data/preset-decks-catalog.ts`; `test:presets` validates all of them and plays one bot × bot MR5 duel per TCG deck.

## Gotchas

- In the harness, `createDuel({ place })` creates Extra Deck cards **face-down**, as the app does; a face-up Extra Deck under MR4/MR5 confines Synchro/Xyz to the Extra Monster Zone. `createDuel({ mode })` picks the rules (Goat by default).
- `@n1xx1/ocgcore-wasm` must stay ≥ 0.1.4: 0.1.3 wrote the Pendulum right scale and Link markers at the wrong struct offsets (both reached the core as 0, so Pendulum Summon was never offered). On our side, a Link monster's `def` column in `cards.cdb` holds its **arrows** — `card-adapter.ts` (`linkFields`) and the harness `toOcgData` send it as `link_marker` with `defense: 0`. `test:modern-summons` reads both back from the core.
- Duel rules come from the format: `DuelSessionConfig.format` (`"goat"` default → `MODE_GOAT`, `"tcg"` → `MODE_MR5`); per-format deck rules live in `FORMAT_RULES` (`types/duel.ts`). `test:formats` checks the session really runs each ruleset.
- The binding sometimes throws `Error: eof` while deserializing a message (e.g. `SHUFFLE_SET_CARD`); both loops treat it as recoverable, with a cap — keep that.
- The binding throws on a message it can't parse (always `SHUFFLE_SET_CARD`, ~1 per 19 TCG duels) and used to drop the whole batch with it; `copy-ocgcore-wasm.mjs` also patches `duelGetMessage` to skip just that message (it warns `failed to parse a message: 36`). The loops' `eof` cap stays as a safety net.
- The binding (0.1.4) prefixes the SORT_CARD/SORT_CHAIN response with a length byte the core doesn't read, so every explicit order got RETRY forever; `scripts/copy-ocgcore-wasm.mjs` patches `dist/index.js` at postinstall (a running dev server needs a restart to pick it up). The core reads the order as "position of each card", not "card at each position" — build UI orders through `sortOrderForCore`. `test:sort-card` covers both.
- To stop a server you started, kill it by port or PID — never `pkill -f server.mjs`, which also kills the user's dev server.
- `.env.github` (git-ignored) may hold a GitHub token used for pushes — never print it.

## Docs

- `docs/multiplayer.md` — online duel design (server-owned engine, per-seat projection).
- `docs/tcg-completo.md` — findings and phased plan for moving to the full TCG card pool (binding bug, missing Extra Monster Zone/Link/Pendulum UI, card "marks", catalog size, preset decks, TCG banlist).
