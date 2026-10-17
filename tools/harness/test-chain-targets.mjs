import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OcgLocation as L, OcgPosition as P, OcgMessageType as M, OcgResponseType as R, SelectIdleCMDAction as A } from "@n1xx1/ocgcore-wasm";
import { createDuelSession } from "@/lib/duel/duel-session";
import { CardRegistry } from "@/lib/domain/card-registry";
import { nodeAssets } from "@/server/duel/node-assets";
import { projectSnapshot } from "@/server/duel/room";
import { botAutoResponse } from "@/lib/duel/bot-responder";
import { decodeFieldMask } from "@/lib/duel/field-places";
import { isLiveChainLink } from "@/lib/duel/chain-targets";
import { REPO } from "./env.mjs";

const registry = CardRegistry.fromCatalog(JSON.parse(readFileSync(join(REPO, ".cache/catalog/catalog.json"), "utf8")));
const deck = { main: Array(40).fill(5053103), extra: [], side: [] };
const book = 14087893, mst = 5318639, elf = 15025844;
const monster = (player, sequence) => ({ player, location: L.MZONE, sequence, code: elf, position: P.FACEUP_ATTACK });

async function run({ scenario, activate, chainAgain = false, pick, inspect = () => {}, override = () => null }) {
  const session = createDuelSession();
  let snap;
  const seen = [];
  session.subscribe((next) => { snap = next; seen.push(next); });
  try {
    await session.start({ playerName: "Ana", opponentName: "Bruno", playerDeck: deck, opponentDeck: deck,
      registry, assets: nodeAssets, format: "tcg", pace: 0, cutIns: false, scenario,
      seats: [{ kind: "local", name: "Ana", chainMode: "always" }, { kind: "local", name: "Bruno", chainMode: "always" }],
    });
    let activated = false, chained = false;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      assert(!snap.error, snap.error);
      if (!snap.pendingPrompt || snap.isProcessing) { await new Promise((resolve) => setTimeout(resolve, 1)); continue; }
      const p = snap.pendingPrompt;
      inspect(snap, p);
      let response = override(snap, p);
      if (response) { /* Resposta específica deste cenário. */ }
      else if (p.type === M.SELECT_IDLECMD && p.player === 0) {
        if (activated) return seen;
        const index = p.activates.findIndex((card) => card.code === activate);
        assert(index >= 0, `carta ${activate} ativável`);
        activated = true;
        response = { type: R.SELECT_IDLECMD, action: A.SELECT_ACTIVATE, index };
      } else if (p.type === M.SELECT_CHAIN) {
        const index = activated && chainAgain && !chained && p.player === 0 ? p.selects.findIndex((card) => card.code === activate) : -1;
        if (index >= 0) chained = true;
        response = { type: R.SELECT_CHAIN, index: index >= 0 ? index : null };
      } else if (p.type === M.SELECT_CARD) {
        response = { type: R.SELECT_CARD, indicies: pick(p, snap) };
      } else if (p.type === M.SELECT_PLACE || p.type === M.SELECT_DISFIELD) {
        response = { type: p.type === M.SELECT_PLACE ? R.SELECT_PLACE : R.SELECT_DISFIELD, places: decodeFieldMask(p.field_mask, p.player).slice(0, p.count) };
      } else response = botAutoResponse(p);
      assert(response, `resposta para ${p.type}`);
      await session.respond(response, snap.promptId);
    }
    throw new Error("duelo não concluiu a corrente");
  } finally { session.dispose(); }
}

{
  const seen = await run({
    scenario: [{ player: 0, location: L.HAND, code: book }, { player: 0, location: L.HAND, code: book }, monster(1, 0), monster(1, 1)],
    activate: book, chainAgain: true,
    pick: (prompt, snap) => [prompt.selects.findIndex((card) => card.controller === 1 && card.sequence === snap.chainLinks.length - 1)],
  });
  const both = seen.find((snap) => snap.chainLinks.length === 2 && snap.chainLinks.every((link) => link.targets.length === 1));
  assert(both, "dois elos recebem seus próprios alvos");
  assert.deepEqual(both.chainLinks.map((link) => link.targets[0].zone.sequence), [0, 1], "monstros iguais são distinguidos pela zona");
  assert(both.chainLinks.every((link) => link.targets[0].code === elf));
  for (const seat of [0, 1]) assert.deepEqual(projectSnapshot(both, seat).chainLinks, both.chainLinks, "reconexão preserva os alvos públicos");
  assert(seen.some((snap) => snap.chainLinks[1]?.state === "resolving"));
  assert.equal(seen.at(-1).chainLinks.length, 0, "fim da corrente limpa os alvos");
  console.log("✓ Corrente de dois elos, cópias iguais, resolução e projeção online");
}
{
  const seen = await run({
    scenario: [{ player: 0, location: L.HAND, code: mst }, { player: 1, location: L.SZONE, sequence: 0, code: 44095762, position: P.FACEDOWN_DEFENSE }],
    activate: mst, pick: () => [0],
  });
  const targeted = seen.find((snap) => snap.chainLinks[0]?.targets.length);
  assert(targeted, "MST anuncia seu alvo");
  assert.equal(targeted.chainLinks[0].targets[0].code, null, "alvo baixado não revela identidade");
  assert(seen.some((snap) => snap.chainLinks[0]?.targets[0]?.present === false), "sair da zona desfaz o marcador");
  console.log("✓ Alvo baixado permanece oculto e perde a mira ao sair da zona");
}
{
  let cost = false;
  const seen = await run({
    scenario: [{ player: 0, location: L.SZONE, sequence: 0, code: 53567095 },
      ...[0, 1].map((sequence) => ({ player: 0, location: L.MZONE, sequence, code: 76812113 })), monster(1, 0), monster(1, 1)],
    activate: 53567095,
    inspect: (snap, prompt) => {
      if (snap.chainLinks.length && prompt.type === M.SELECT_UNSELECT_CARD) {
        cost = true;
        assert.equal(snap.chainLinks[0].targets.length, 0, "tributo de custo não é alvo");
      }
    },
    pick: (prompt, snap) => {
      if (prompt.min === 1 && prompt.selects.some((card) => card.controller === 0 && card.code === 76812113)) {
        cost = true;
        assert.equal(snap.chainLinks[0].targets.length, 0, "tributo de custo não é alvo");
        return [prompt.selects.findIndex((card) => card.code === 76812113)];
      }
      return prompt.selects.flatMap((card, index) => card.controller === 1 ? [index] : []).slice(0, prompt.min);
    },
  });
  assert(cost, "Icarus escolheu um tributo");
  const targeted = seen.find((snap) => snap.chainLinks[0]?.targets.length === 2);
  assert(targeted, "efeito com vários alvos guarda todos");
  assert(targeted.chainLinks[0].targets.every((target) => target.zone.controller === 1));
  console.log("✓ Custo de tributo não recebe mira; os dois alvos do efeito recebem");
}
{
  const seen = await run({
    scenario: [{ player: 0, location: L.HAND, code: 19613556 }, { player: 1, location: L.SZONE, code: 44095762 }],
    activate: 19613556, pick: () => [0],
  });
  assert(seen.some((snap) => snap.chainLinks.length));
  assert(seen.every((snap) => snap.chainLinks.every((link) => link.targets.length === 0)), "Tempestade Pesada não declara alvos");
  console.log("✓ Efeito sem alvo não inventa miras");
}
{
  let negated = false;
  const seen = await run({
    scenario: [{ player: 0, location: L.HAND, code: mst }, { player: 1, location: L.SZONE, sequence: 0, code: 44095762 }, { player: 1, location: L.SZONE, sequence: 1, code: 41420027 }],
    activate: mst, pick: (prompt) => [prompt.selects.findIndex((card) => card.sequence === 0)],
    override: (_snap, prompt) => {
      if (!negated && prompt.type === M.SELECT_CHAIN && prompt.player === 1) {
        const index = prompt.selects.findIndex((card) => card.code === 41420027);
        if (index >= 0) { negated = true; return { type: R.SELECT_CHAIN, index }; }
      }
      return null;
    },
  });
  const link = seen.flatMap((snap) => snap.chainLinks).find((link) => link.link === 1 && link.state === "negated");
  assert(link, "Julgamento Solene negou MST");
  assert(!isLiveChainLink(link), "elo negado não mantém mira ativa");
  console.log("✓ Elo negado perde o realce de alvo");
}
