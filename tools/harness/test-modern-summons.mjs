/**
 * Invocações modernas pelo caminho da tela — Sincro, Xyz, Link e Pêndulo.
 *
 * É a medição das §3.2 e §3.3 de `docs/tcg-completo.md` promovida a teste. Cada
 * cenário monta o campo, pede a invocação ao engine em Master Rule 2020 e passa
 * TODA pergunta feita ao jogador pelo mesmo código que a mesa usa
 * (`findPromptMessage` → `autoResponseFor` → `buildPromptPlan`). Depois da
 * invocação, lê o tabuleiro com `readBoardState`, como a tela faz.
 *
 * O que ele vigia, e por quê:
 *
 * 1. **Plano vazio.** Uma pergunta que a tela não sabe responder congela o
 *    duelo — era o que acontecia com a Invocação-Link, cujo SELECT_PLACE só
 *    oferece as Zonas de Monstro Extra.
 * 2. **Zona que o engine oferece e a tela não enxerga.** `field_mask` libera
 *    as zonas 5–6 (Zonas Extra); se `decodeFieldMask` lê só cinco, o jogador
 *    nunca consegue escolher a Zona Extra.
 * 3. **Monstro invocado que não aparece na mesa.** Um Link na zona 5 existe
 *    para o engine e não existe para quem joga.
 * 4. **Dados que o core guardou.** Escala direita de Pêndulo e setas Link são
 *    escritas pelo binding no struct do core; lidas de volta com `duelQuery`,
 *    têm que bater com o banco oficial. A 0.1.3 do binding gravava as duas em
 *    offsets errados, e a Invocação-Pêndulo nunca era oferecida.
 *
 * Uso: npm run test:modern-summons
 */
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  OcgDuelMode,
  OcgLocation,
  OcgMessageType,
  OcgPosition,
  OcgQueryFlags,
  OcgResponseType,
  SelectIdleCMDAction,
} from "@n1xx1/ocgcore-wasm";

import { autoResponseFor } from "@/lib/duel/auto-response";
import { readBoardState } from "@/lib/duel/board-state";
import { findPromptMessage } from "@/lib/duel/bot-responder";
import { buildPromptPlan } from "@/lib/duel/duel-actions";
import { decodeFieldMask } from "@/lib/duel/field-places";
import { isCandidateOnBoard, needsCardPicker } from "@/lib/duel/prompt-reach";

import { messageName } from "./card-scan.mjs";
import { REPO, loadCardDb } from "./env.mjs";
import { STOP, Zone, autoPilot, createDuel } from "./duel.mjs";

const CARD = {
  elf: 15025844, // Mystical Elf — Normal, LUZ, Nível 4
  ox: 5053103, // Battle Ox — Normal, TERRA, Nível 4
  junkSynchron: 63977008, // Regulador Nível 3
  blackRose: 73580471, // Sincro Nível 7
  utopia: 84013237, // Xyz Rank 4
  linkSpider: 98978921, // Link-1, seta para baixo
  decodeTalker: 1861629, // Link-3, setas 0x85
  oddEyes: 16178681, // Pêndulo, escalas 4/4
  stargazer: 94415058, // Pêndulo, escalas 1/1
  timegazer: 20409757, // Pêndulo, escalas 8/8
  skull: 70781052, // Summoned Skull — Normal, Nível 6
  darkMagician: 46986414, // Dark Magician — Normal, Nível 7
};

/** Nomes das cartas do teste, do `cards.cdb` — só para o relatório ser legível. */
const NAMES = (() => {
  try {
    const db = new DatabaseSync(join(REPO, ".cache/cards.cdb"), { readOnly: true });
    const codes = Object.values(CARD);
    const rows = db
      .prepare(`select id, name from texts where id in (${codes.map(() => "?").join(",")})`)
      .all(...codes);
    db.close();
    return new Map(rows.map((row) => [Number(row.id), { name: row.name }]));
  } catch {
    return new Map();
  }
})();

/** Deck neutro dos dois lados: o duelo precisa ter o que comprar. */
const FILLER_DECK = Array.from({ length: 20 }, (_, i) => (i % 2 ? CARD.ox : CARD.elf));

/** Mesma regra de "o jogador tem o que fazer" do `test-ui-prompts`. */
function planIsActionable(plan, viewer = 0) {
  if (plan.selection) {
    const { candidates } = plan.selection;
    if (candidates.length === 0) return false;
    return (
      needsCardPicker(candidates, viewer) ||
      candidates.every((c) => isCandidateOnBoard(c, viewer))
    );
  }
  return (
    plan.byCard.size > 0 ||
    plan.global.length > 0 ||
    plan.places.length > 0 ||
    plan.sorting !== null ||
    (plan.announce?.options.length ?? 0) > 0 ||
    plan.announceCard !== null ||
    plan.placeSelection !== null
  );
}

/**
 * Zonas que o `field_mask` libera, lidas direto dos bits — a verdade contra a
 * qual a decodificação da tela é comparada.
 *
 * Só zonas que existem de fato em Master Rule 2020: monstro 0–6 (5 e 6 são as
 * Zonas Extra) e magia/armadilha 0–5 (5 é a Zona de Campo).
 */
function freeZones(mask, asked) {
  const groups = [
    { base: 0, player: asked, location: OcgLocation.MZONE, count: 7 },
    { base: 8, player: asked, location: OcgLocation.SZONE, count: 6 },
    { base: 16, player: 1 - asked, location: OcgLocation.MZONE, count: 7 },
    { base: 24, player: 1 - asked, location: OcgLocation.SZONE, count: 6 },
  ];
  const out = [];
  for (const group of groups) {
    for (let sequence = 0; sequence < group.count; sequence += 1) {
      if ((mask & (1 << (group.base + sequence))) === 0) {
        out.push(`${group.player}:${group.location}:${sequence}`);
      }
    }
  }
  return out;
}

/**
 * Resposta do jogador 0 nas perguntas de material (e nos efeitos opcionais).
 *
 * O piloto automático do harness responde SELECT_UNSELECT_CARD sempre com o
 * índice 0 e nunca conclui; para material de Sincro/Xyz/Link isso pode girar
 * para sempre. Aqui: marca o próximo candidato enquanto não der para concluir,
 * e conclui assim que o core deixa.
 */
function materialChoice(message) {
  // Efeito opcional do monstro recém-invocado é recusado: o que se mede aqui é
  // a invocação. Black Rose Dragon, por exemplo, destruiria o campo inteiro —
  // inclusive a si mesmo — e o monstro "sumiria" da mesa por motivo legítimo.
  if (message.type === OcgMessageType.SELECT_EFFECTYN) {
    return { type: OcgResponseType.SELECT_EFFECTYN, yes: false };
  }
  if (message.type !== OcgMessageType.SELECT_UNSELECT_CARD) return null;
  if (message.can_finish) return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: null };
  return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: 0 };
}

/**
 * Roda um cenário e devolve as falhas encontradas.
 *
 * @param steps lista de `{ list, code, action }`: em cada SELECT_IDLECMD do
 *   jogador 0, a próxima jogada a fazer (procura `code` na lista `list` da
 *   mensagem). Esgotadas as jogadas, o cenário termina no próximo IDLECMD.
 * @param expectSummoned passcodes que precisam estar na mesa no fim.
 */
async function scenario({ name, place, hand = [], steps, expectSummoned }) {
  const findings = [];
  const duel = await createDuel({
    mode: OcgDuelMode.MODE_MR5,
    place: [
      ...place,
      ...hand.map((code) => ({ player: 0, zone: Zone.HAND, code })),
    ],
    decks: [FILLER_DECK, FILLER_DECK],
    cards: NAMES,
  });

  let stepIndex = 0;
  const outcome = duel.run((message) => {
    if (!("player" in message) || message.player !== 0) return null;

    if (message.type === OcgMessageType.SELECT_IDLECMD) {
      const step = steps[stepIndex];
      if (!step) return STOP;
      const list = message[step.list];
      const index = list.findIndex(
        (card) => card.code === step.code && (step.location === undefined || card.location === step.location),
      );
      if (index < 0) {
        findings.push(`jogada ${stepIndex + 1} não oferecida: ${step.label}`);
        return STOP;
      }
      stepIndex += 1;
      return { type: OcgResponseType.SELECT_IDLECMD, action: step.action, index };
    }

    // Toda outra pergunta passa pelo caminho da tela antes de ser respondida.
    if (!findPromptMessage([message])) {
      findings.push(`prompt não reconhecido: ${messageName(message.type)}`);
      return null;
    }
    if (message.type === OcgMessageType.SELECT_PLACE || message.type === OcgMessageType.SELECT_DISFIELD) {
      const offered = freeZones(message.field_mask, message.player);
      const seen = new Set(
        decodeFieldMask(message.field_mask, message.player).map(
          (place) => `${place.player}:${place.location}:${place.sequence}`,
        ),
      );
      const missing = offered.filter((key) => !seen.has(key));
      if (missing.length) findings.push(`zonas oferecidas e invisíveis para a tela: ${missing.join(", ")}`);
    }
    if (!autoResponseFor(message)) {
      const plan = buildPromptPlan(message);
      if (!planIsActionable(plan)) {
        findings.push(`plano vazio em ${messageName(message.type)} (${plan.instruction})`);
      }
    }
    return materialChoice(message) ?? autoPilot(message, { play: false });
  });

  if (stepIndex < steps.length && !findings.length) {
    findings.push(`parou antes das jogadas (desfecho ${outcome})`);
  }
  if (!["STOPPED", "WIN", "END"].includes(outcome)) findings.push(`desfecho ${outcome}`);
  if (duel.errors.length) findings.push(`erros do core: ${duel.errors.join(" | ")}`);

  const board = readBoardState(duel.core, duel.handle, 0);
  const onBoard = new Set(
    board.players[0].monsters.filter(Boolean).map((card) => card.code),
  );
  const summoned = new Set(
    [...duel.of(OcgMessageType.SPSUMMONING), ...duel.of(OcgMessageType.SUMMONING)].map((m) => m.code),
  );
  for (const code of expectSummoned) {
    if (!summoned.has(code)) findings.push(`${duel.name(code)} não foi invocado`);
    else if (!onBoard.has(code)) {
      const where = duel
        .query(0, OcgLocation.MZONE)
        .findIndex((card) => card?.code === code);
      findings.push(`${duel.name(code)} invocado (zona ${where}) mas invisível na mesa`);
    }
  }

  duel.destroy();
  return { name, findings };
}

/** Lê do core as escalas e as setas de cada carta, depois de entregues. */
async function readback() {
  const db = loadCardDb();
  const codes = [CARD.oddEyes, CARD.stargazer, CARD.timegazer, CARD.decodeTalker, CARD.linkSpider];
  const findings = [];
  for (const code of codes) {
    const duel = await createDuel({
      mode: OcgDuelMode.MODE_MR5,
      place: [{ player: 0, zone: Zone.MZONE, code, sequence: 0, position: OcgPosition.FACEUP_ATTACK }],
      decks: [FILLER_DECK, FILLER_DECK],
      cards: NAMES,
    });
    const info = duel.core.duelQuery(duel.handle, {
      flags: OcgQueryFlags.LSCALE | OcgQueryFlags.RSCALE | OcgQueryFlags.LINK,
      controller: 0,
      location: OcgLocation.MZONE,
      sequence: 0,
      overlaySequence: 0,
    });
    const official = db.get(code);
    const isLink = (official.type & 0x4000000) !== 0;
    const expected = isLink
      ? { lscale: 0, rscale: 0, rating: official.level, marker: official.def }
      : { lscale: official.lscale, rscale: official.rscale, rating: 0, marker: 0 };
    const got = {
      lscale: info?.leftScale ?? -1,
      rscale: info?.rightScale ?? -1,
      rating: info?.link?.rating ?? -1,
      marker: info?.link?.marker ?? -1,
    };
    const wrong = Object.keys(expected).filter((key) => expected[key] !== got[key]);
    if (wrong.length) {
      findings.push(
        `${duel.name(code)} (${code}): ` +
          wrong.map((key) => `${key} esperado ${expected[key]}, core ${got[key]}`).join("; "),
      );
    }
    duel.destroy();
  }
  return { name: "Leitura de volta (escalas e setas)", findings };
}

const IDLE = {
  special: { list: "special_summons", action: SelectIdleCMDAction.SELECT_SPECIAL_SUMMON },
  activate: { list: "activates", action: SelectIdleCMDAction.SELECT_ACTIVATE },
};

const SCENARIOS = [
  {
    name: "Sincro — Junk Synchron + Mystical Elf → Black Rose Dragon",
    place: [
      { player: 0, zone: Zone.MZONE, code: CARD.junkSynchron, sequence: 0 },
      { player: 0, zone: Zone.MZONE, code: CARD.elf, sequence: 1 },
      { player: 0, zone: Zone.EXTRA, code: CARD.blackRose },
    ],
    steps: [{ ...IDLE.special, code: CARD.blackRose, label: "Invocar Black Rose Dragon" }],
    expectSummoned: [CARD.blackRose],
  },
  {
    name: "Xyz — Mystical Elf + Battle Ox → Number 39: Utopia",
    place: [
      { player: 0, zone: Zone.MZONE, code: CARD.elf, sequence: 0 },
      { player: 0, zone: Zone.MZONE, code: CARD.ox, sequence: 1 },
      { player: 0, zone: Zone.EXTRA, code: CARD.utopia },
    ],
    steps: [{ ...IDLE.special, code: CARD.utopia, label: "Invocar Utopia" }],
    expectSummoned: [CARD.utopia],
  },
  {
    name: "Link — Mystical Elf → Link Spider",
    place: [
      { player: 0, zone: Zone.MZONE, code: CARD.elf, sequence: 2 },
      { player: 0, zone: Zone.EXTRA, code: CARD.linkSpider },
    ],
    steps: [{ ...IDLE.special, code: CARD.linkSpider, label: "Invocar Link Spider" }],
    expectSummoned: [CARD.linkSpider],
  },
  {
    name: "Pêndulo — escalas 4 e 8, Níveis 6 e 7 na mão",
    place: [],
    hand: [CARD.oddEyes, CARD.timegazer, CARD.skull, CARD.darkMagician],
    steps: [
      { ...IDLE.activate, code: CARD.oddEyes, label: "Ativar Odd-Eyes como escala" },
      { ...IDLE.activate, code: CARD.timegazer, label: "Ativar Timegazer como escala" },
      {
        ...IDLE.special,
        code: CARD.oddEyes,
        location: OcgLocation.SZONE,
        label: "Invocação-Pêndulo (oferecida pela escala)",
      },
    ],
    expectSummoned: [CARD.skull, CARD.darkMagician],
  },
];

async function main() {
  const results = [];
  for (const spec of SCENARIOS) results.push(await scenario(spec));
  results.push(await readback());

  let failures = 0;
  for (const { name, findings } of results) {
    const ok = findings.length === 0;
    if (!ok) failures += 1;
    process.stdout.write(`${ok ? "✓" : "✗"} ${name}\n`);
    for (const finding of findings) process.stdout.write(`    - ${finding}\n`);
  }
  process.stdout.write(`\n${results.length - failures}/${results.length} cenários sem falha.\n`);
  if (failures) process.exitCode = 1;
}

await main();
