# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

Yu-Gi-Oh! Goat-format (April 2005) deck builder and duel simulator. Duels run the real EDOPro engine (ocgcore, through the `@n1xx1/ocgcore-wasm` WebAssembly binding) with the ProjectIgnis Lua card scripts — against a bot in the browser, or online with the engine on the server. Next.js 16 App Router plus a custom Node server (`server.mjs`) for the WebSocket.

Code comments, UI text, docs and commit messages are in Portuguese (pt-BR), and comments explain the *why* at length — match that style.

## Commands

```bash
npm install                # postinstall copies the engine wasm to public/ocgcore/ (git-ignored) and patches the binding's mod.js
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

Also: `test:archetypes`, `test:triggers`, `test:remaining`, `test:patches`, `test:ui-rare`, `test:hidden`, `test:endgame`, `test:cancel`, `test:bot`, `test:deck-library`, `test:connection`.

Browser tests (`test:browser*`, `test:attack`, `test:draw`, `test:viewports`, `shots`) drive a real Chrome over CDP and need the app running at `APP_URL` (default `http://127.0.0.1:3000`). `test:browser-online` needs the custom server (`npm run dev` / `npm start`); `test:browser` can use `npx next build && npx next start -p 3100` with `APP_URL=http://127.0.0.1:3100`.

Diagnostic env flags: `SKIP_SCRIPT_PATCHES=1` shows the original error a script patch hides; `LEGACY_CARD_DATA=1` drops setcode/alias to measure their effect.

Generated data is committed; regenerate with `npm run build:card-db` (`src/data/card-db.json` from ProjectIgnis BabelCDB `cards.cdb`) and `npm run build:engine-strings` (`src/data/engine-strings.json`).

## Architecture

### One duel loop, two hosts

`DuelSession` (`src/lib/duel/duel-session.ts`) owns the engine loop — `duelProcess` → messages → prompt → response — and is the same code in the browser (vs bot, through `useDuelEngine`) and on the server (online rooms; the client side is `useOnlineDuel`, which returns the same shape). What differs is injected:

- **`DuelAssets`** (`duel-assets.ts`): `browserAssets` fetches the wasm, scripts and card data over HTTP (`/ocgcore/*.wasm`, `/api/scripts/*`, `/api/card-db`, `/api/engine-strings`); `src/server/duel/node-assets.ts` reads them from disk, falling back to GitHub for scripts.
- **Seats** (`SeatConfig`): `local` and `remote` park and publish `pendingPrompt` with a `promptId` (late answers are rejected); `bot` is answered in-process by `bot/bot-brain.ts` (heuristics), with `bot-responder.ts` as the always-legal fallback.

Modules imported by both the Next graph and the plain-Node server must not import `next/server` — that is why `server/catalog/catalog-store.ts` and `lib/duel/script-source.ts` live outside the route handlers that wrap them.

### Prompt pipeline

Engine message → `findPromptMessage` (`bot-responder.ts`) → `autoResponseFor` (`auto-response.ts`, answers prompts with no real choice) → for humans, `buildPromptPlan` (`duel-actions.ts`) turns it into a `PromptPlan` (per-card actions, field places, selections, modals) that `components/duel/DuelBoard.tsx` renders. A plan with nothing actionable freezes the duel; `test:ui` and `test:ui-rare` exist to catch that. **When `PromptPlan` gains a field, update `planIsActionable` in both `test-ui-prompts.mjs` and `test-ui-rare-prompts.mjs`.**

### Hidden information

Board reads are per viewer (`readBoardState(core, handle, viewer)` in `board-state.ts`); prompt candidates are masked (`maskHiddenCards`, `prompt-mask.ts`); online, `projectSnapshot` (`src/server/duel/room.ts`) strips everything a seat may not see before sending. Design rationale: `docs/multiplayer.md`.

### Card data comes from two places

- **Catalog** (`src/server/catalog/catalog-build.ts` → `.cache/catalog/catalog.json` → `/api/cards` → `CardRegistry.fromCatalog`): names, PT/EN text, types, Link/Pendulum/Rank, banlists (`ban_tcg`, `ban_goat`), Goat-pool flag — display and search only. Built once from YGOPRODeck (`npm run build:catalog`, `-- --refresh` to update; the server builds it lazily if missing), indexed by the **official** passcode with every alternate art resolvable (YGOPRODeck sometimes uses an alt art as the main id). Cards without official data (`playable: false`, released after our `cards.cdb` snapshot) are display-only. `/api/cards` is precompressed (brotli/gzip) with an ETag.
- **Images** are served from disk by `/card-images/<small|full|cropped>/<passcode>.jpg` (`card-images.ts`): each is fetched from YGOPRODeck once, rate-limited, then cached in `.cache/card-images/` — never hotlinked.
- **Official engine data** (`src/data/card-db.json`, read by `official-card-data.ts`): type bitfields, setcodes, alias, level/scales. The engine must get this (`card-adapter.ts`); data derived from YGOPRODeck strings silently breaks every `IsSetCard` check.

### Scripts

CardScripts is pinned to one commit (`src/lib/duel/cardscripts-pin.ts`) for the app route, the online server and the harness clone alike; bump it only together with the binding, then run the whole battery. The core's `scriptReader` is synchronous, so every script must be cached before the duel starts (`script-reader.ts`: `preloadCoreScripts`, `preloadDuelScripts`). Alternate-art passcodes use the original card's script (`OfficialCardDb.scriptPasscode`). `script-patches.ts` patches upstream scripts that the compiled core can't run, using whitespace-tolerant anchors; an unapplied patch is reported, never silent. The harness imports it without the loader, so it can't use the `@/` alias or runtime-only TS features.

### Online and persistence

`server.mjs` (custom Next server, binds `0.0.0.0`) → `src/server/duel/socket.ts` (WebSocket at `/api/duel-ws`; messages and BigInt-safe codec in `src/lib/net/duel-protocol.ts`) → `DuelRoom` (`room.ts`: seats held by token, rock-paper-scissors for the first turn, reconnection with a grace period). Rooms live in memory in that one process. Deck libraries are JSON files per nickname written by the server (`src/server/decks/store.ts` → `.data/decks/`, git-ignored — real user data, not fixtures).

## Gotchas

- In the harness, `createDuel({ place })` creates Extra Deck cards **face-down**, as the app does; a face-up Extra Deck under MR4/MR5 confines Synchro/Xyz to the Extra Monster Zone. `createDuel({ mode })` picks the rules (Goat by default).
- `@n1xx1/ocgcore-wasm` must stay ≥ 0.1.4: 0.1.3 wrote the Pendulum right scale and Link markers at the wrong struct offsets (both reached the core as 0, so Pendulum Summon was never offered). On our side, a Link monster's `def` column in `cards.cdb` holds its **arrows** — `card-adapter.ts` (`linkFields`) and the harness `toOcgData` send it as `link_marker` with `defense: 0`. `test:modern-summons` reads both back from the core.
- Duel rules come from the format: `DuelSessionConfig.format` (`"goat"` default → `MODE_GOAT`, `"tcg"` → `MODE_MR5`); per-format deck rules live in `FORMAT_RULES` (`types/duel.ts`). `test:formats` checks the session really runs each ruleset.
- The binding sometimes throws `Error: eof` while deserializing a message (e.g. `SHUFFLE_SET_CARD`); both loops treat it as recoverable, with a cap — keep that.
- To stop a server you started, kill it by port or PID — never `pkill -f server.mjs`, which also kills the user's dev server.
- `.env.github` (git-ignored) may hold a GitHub token used for pushes — never print it.

## Docs

- `docs/multiplayer.md` — online duel design (server-owned engine, per-seat projection).
- `docs/tcg-completo.md` — findings and phased plan for moving to the full TCG card pool (binding bug, missing Extra Monster Zone/Link/Pendulum UI, card "marks", catalog size, preset decks, TCG banlist).
