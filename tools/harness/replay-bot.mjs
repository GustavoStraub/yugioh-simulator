/** Reaplica respostas privadas ao core e falha na primeira divergência. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OcgDuelMode } from '@n1xx1/ocgcore-wasm';
import { createDuel, Zone } from './duel.mjs';
import { SCRIPTS_DIR } from './env.mjs';
import { parse, promptHash, runtimeIdentity } from './bot-evaluation-artifacts.mjs';

const replay = parse(readFileSync(process.argv[2],'utf8'));
const current = runtimeIdentity(SCRIPTS_DIR);
for (const key of ['dataHash','coreHash','scriptsHash','patchesHash','patchesDisabled']) {
  assert.equal(current[key], replay.identity[key], `Ambiente diferente: ${key}`);
}
const duel = await createDuel({ mode:replay.format==='tcg'?OcgDuelMode.MODE_MR5:OcgDuelMode.MODE_GOAT,
  decks:replay.main, seed:BigInt(replay.game.seed), startingDraw:replay.startingDraw,
  place:replay.lists.flatMap((deck,player)=>deck.extra.map(code=>({player,zone:Zone.EXTRA,code}))) });
let cursor = 0;
try {
  const outcome = duel.run(prompt=> {
    const saved = replay.responses[cursor++];
    assert.ok(saved, `Resposta ausente no prompt ${cursor}`);
    assert.equal(promptHash(prompt),saved.promptHash,`Prompt divergente em ${cursor}`);
    assert.equal(prompt.player===1?1:0,saved.seat);
    return saved.response;
  });
  assert.equal(cursor,replay.responses.length);
  assert.equal(outcome,replay.game.outcome);
  assert.equal(duel.winner,replay.game.winner);
  assert.equal(duel.retriesTotal,replay.game.rejected);
  assert.equal(duel.errors.length,replay.game.errors);
  console.log(`Replay confirmado: ${replay.game.id} (${cursor} respostas, ${outcome})`);
} finally { duel.destroy(); }
