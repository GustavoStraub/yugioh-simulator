/**
 * Testa as cartas de arquétipo — as que perguntam "esta outra carta é do meu
 * grupo?".
 *
 * O teste carta-a-carta não pega essa classe de bug: uma "Gravekeeper's Spy"
 * *ativa* normalmente num campo vazio, ela só não *acha ninguém* para invocar.
 * O erro aparece na contagem de candidatos, não na ativação. Por isso aqui o
 * campo é montado com companheiros do mesmo `setcode` da carta em teste, e o
 * que se mede é quantas cartas o efeito conseguiu enxergar.
 *
 * Rodando com `LEGACY_CARD_DATA=1` reproduz o comportamento antigo (setcode e
 * alias descartados), o que permite comparar os dois e provar a correção.
 *
 * Uso:
 *   node tools/harness/test-archetypes.mjs --json out.json
 *   LEGACY_CARD_DATA=1 node tools/harness/test-archetypes.mjs --json antes.json
 *   node tools/harness/test-archetypes.mjs --compare antes.json depois.json
 */
import { readFileSync, writeFileSync } from "node:fs";

import { OcgMessageType, OcgPosition, OcgResponseType, SelectIdleCMDAction } from "@n1xx1/ocgcore-wasm";

import { loadCardDb, loadGoatPool } from "./env.mjs";
import { createDuel, STOP, Zone } from "./duel.mjs";

const OCG_TYPE = { MONSTER: 0x1, SPELL: 0x2, TRAP: 0x4 };

/** Agrupa o pool Goat pelo primeiro setcode de cada carta. */
function groupBySetcode(pool, db) {
  const groups = new Map();
  for (const card of pool) {
    const official = db.get(card.id);
    if (!official?.setcodes.length) continue;
    for (const setcode of official.setcodes) {
      // O setcode de 16 bits tem 12 bits de "família" e 4 de "sub-grupo";
      // agrupar pela família é o que junta, por exemplo, todas as Harpias.
      const family = setcode & 0xfff;
      if (!groups.has(family)) groups.set(family, []);
      groups.get(family).push({ ...card, official });
    }
  }
  return groups;
}

/**
 * Monta o cenário de um arquétipo: companheiros no deck, na mão e em campo.
 *
 * Muito efeito de busca só olha o Deck, e muito efeito de invocação só olha a
 * mão — cobrir os dois evita marcar como quebrado o que só não tinha alvo.
 */
function scenarioFor(subject, family) {
  const partners = family.filter((c) => c.id !== subject.id);
  const monsters = partners.filter((c) => c.official.type & OCG_TYPE.MONSTER).slice(0, 6);
  const others = partners.filter((c) => !(c.official.type & OCG_TYPE.MONSTER)).slice(0, 3);

  const place = [];
  const deck = [];

  monsters.forEach((card, index) => {
    if (index < 2) place.push({ player: 0, zone: Zone.HAND, code: card.id });
    else if (index === 2)
      place.push({ player: 0, zone: Zone.GRAVE, code: card.id });
    else deck.push(card.id);
  });
  others.forEach((card) => deck.push(card.id));

  // Um companheiro em campo: efeitos contínuos de arquétipo precisam de alvo.
  const onField = monsters[0];
  if (onField) {
    place.push({
      player: 0, zone: Zone.MZONE, code: onField.id,
      sequence: 4, position: OcgPosition.FACEUP_ATTACK,
    });
  }

  // Um monstro do oponente: destravamento de ataque/alvo.
  place.push({
    player: 1, zone: Zone.MZONE, code: 5053103, sequence: 4,
    position: OcgPosition.FACEUP_ATTACK,
  });

  while (deck.length < 10) deck.push(5053103);
  return { place, deck };
}

/** Onde a carta em teste entra, pelo tipo. */
function placementFor(type) {
  if (type & OCG_TYPE.TRAP) return { zone: Zone.SZONE, position: OcgPosition.FACEDOWN };
  if (type & OCG_TYPE.SPELL) return { zone: Zone.HAND };
  return { zone: Zone.HAND };
}

async function testSubject(subject, family) {
  const { place, deck } = scenarioFor(subject, family);
  const spot = placementFor(subject.official.type);

  let duel;
  try {
    duel = await createDuel({
      place: [...place, { player: 0, zone: spot.zone, code: subject.id, position: spot.position, sequence: 0 }],
      decks: [deck, [5053103, 5053103, 5053103, 5053103, 5053103, 5053103]],
    });
  } catch (error) {
    return { id: subject.id, name: subject.name, verdict: "CRASH", detail: String(error?.message ?? error) };
  }

  let acted = false;
  /** Maior número de candidatos que o efeito chegou a oferecer. */
  let candidates = 0;
  let selectPrompts = 0;

  const outcome = duel.run((message) => {
    if (message.type === OcgMessageType.SELECT_CARD || message.type === OcgMessageType.SELECT_UNSELECT_CARD) {
      const list = message.selects ?? message.select_cards ?? [];
      candidates = Math.max(candidates, list.length);
      selectPrompts += 1;
      return null;
    }
    if (message.type !== OcgMessageType.SELECT_IDLECMD || message.player !== 0) return null;
    if (acted) return STOP;
    for (const [list, action] of [
      [message.activates, SelectIdleCMDAction.SELECT_ACTIVATE],
      [message.special_summons, SelectIdleCMDAction.SELECT_SPECIAL_SUMMON],
      [message.summons, SelectIdleCMDAction.SELECT_SUMMON],
    ]) {
      const index = list.findIndex((c) => c.code === subject.id);
      if (index >= 0) {
        acted = true;
        return { type: OcgResponseType.SELECT_IDLECMD, action, index };
      }
    }
    return STOP;
  });

  const result = {
    id: subject.id,
    name: subject.name,
    setcodes: subject.official.setcodes,
    acted,
    candidates,
    selectPrompts,
    /** Cartas que mudaram de zona: a prova de que o efeito fez alguma coisa. */
    moves: duel.of(OcgMessageType.MOVE).length,
    chained: duel.of(OcgMessageType.CHAINING).length,
    outcome,
    verdict: acted ? "ACTED" : "NOT_OFFERED",
  };
  duel.destroy();
  return result;
}

function compare(beforePath, afterPath) {
  const before = new Map(JSON.parse(readFileSync(beforePath, "utf8")).map((r) => [r.id, r]));
  const after = JSON.parse(readFileSync(afterPath, "utf8"));

  const changed = [];
  for (const now of after) {
    const then = before.get(now.id);
    if (!then) continue;
    if (
      then.verdict !== now.verdict ||
      then.candidates !== now.candidates ||
      then.moves !== now.moves
    ) {
      changed.push({ now, then });
    }
  }

  process.stdout.write(`cartas de arquétipo comparadas: ${after.length}\n`);
  process.stdout.write(`mudaram de comportamento: ${changed.length}\n\n`);
  for (const { now, then } of changed) {
    process.stdout.write(
      `${now.id} ${now.name}\n` +
      `   antes: ${then.verdict} candidatos=${then.candidates} movimentos=${then.moves}\n` +
      `   depois: ${now.verdict} candidatos=${now.candidates} movimentos=${now.moves}\n`,
    );
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const compareAt = argv.indexOf("--compare");
  if (compareAt >= 0) return compare(argv[compareAt + 1], argv[compareAt + 2]);

  const jsonAt = argv.indexOf("--json");
  const jsonOut = jsonAt >= 0 ? argv[jsonAt + 1] : null;

  const db = loadCardDb();
  const pool = loadGoatPool();
  const groups = groupBySetcode(pool, db);

  const results = [];
  let done = 0;
  for (const [, family] of groups) {
    // Um arquétipo de uma carta só não tem interação para testar.
    if (family.length < 2) continue;
    for (const subject of family) {
      results.push(await testSubject(subject, family));
      done += 1;
      if (done % 50 === 0) process.stderr.write(`  ${done}\n`);
    }
  }

  const acted = results.filter((r) => r.verdict === "ACTED").length;
  const withCandidates = results.filter((r) => r.candidates > 0).length;
  process.stdout.write(
    `\ncartas de arquétipo testadas: ${results.length}\n` +
    `ativaram/invocaram: ${acted}\n` +
    `efeito enxergou pelo menos um alvo: ${withCandidates}\n` +
    `total de candidatos oferecidos: ${results.reduce((t, r) => t + r.candidates, 0)}\n` +
    `total de movimentos de carta: ${results.reduce((t, r) => t + r.moves, 0)}\n`,
  );

  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify(results, null, 1));
    process.stdout.write(`relatório em ${jsonOut}\n`);
  }
}

await main();
