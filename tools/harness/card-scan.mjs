/**
 * Varredura carta a carta contra o engine — o miolo de `test-cards.mjs` (pool
 * Goat) e de `test-tcg-pool.mjs` (pool TCG inteiro, Master Rule 2020).
 *
 * Duas perguntas por carta:
 *  1. **O script carrega?** — `initial_effect` roda sem estourar em Lua. Uma
 *     falha aqui deixa a carta inerte no duelo sem nenhum aviso na tela.
 *  2. **Dá para ativar/invocar?** — a carta aparece entre as ações que o core
 *     oferece no Main Phase 1. É o que o jogador chama de "o efeito funciona".
 *
 * Mora num módulo à parte porque as duas baterias precisam do MESMO cenário:
 * se cada uma montasse o seu, uma diferença de número entre o pool Goat e o
 * TCG poderia ser o cenário, e não a carta.
 */
import {
  OcgLocation,
  OcgMessageType,
  OcgPosition,
  OcgResponseType,
  SelectIdleCMDAction,
} from "@n1xx1/ocgcore-wasm";

import { createDuel, STOP, Zone } from "./duel.mjs";

/**
 * Peças de apoio do cenário.
 *
 * A variedade aqui não é decorativa: um custo como "descarte 1 monstro de
 * ÁGUA" ou "bana 2 monstros de LUZ do cemitério" simplesmente não pode ser
 * pago num cenário só de baunilhas de TERRA, e a carta apareceria como
 * "não ativável" por falta do cenário, não por estar quebrada.
 */
export const FILLER = {
  /** Mystical Elf — LUZ / Mago / 800 / 2000. */
  elf: 15025844,
  /** Battle Ox — TERRA / Guerreiro-Fera / 1700 / 1000. */
  ox: 5053103,
  /** Feral Imp — TREVAS / Demônio / 1300 / 1400. */
  imp: 41392891,
  /** Mammoth Graveyard — TERRA / Dinossauro / 1200 / 800. */
  mammoth: 40374923,
  /** Silver Fang — TERRA / Besta / 1200 / 800. */
  fang: 90357090,
  /** The Legendary Fisherman — ÁGUA / Peixe: paga custos de descarte ÁGUA. */
  aqua: 3643300,
  /** Shining Angel — LUZ / Fada: dá LUZ no cemitério e em mão. */
  light: 95956346,
  /** Sangan — TREVAS / Demônio, nível 3. */
  dark: 26202165,
  /** Pot of Greed — Magia Normal: custo de "descarte 1 Magia". */
  spell: 55144522,
  /** Trap Hole — Armadilha Normal: custo de "descarte 1 Armadilha". */
  trap: 4206964,
  /** Gaia the Dragon Champion — Monstro de Fusão para o Extra Deck. */
  fusion: 66889139,
};

export const OCG_TYPE = {
  MONSTER: 0x1,
  SPELL: 0x2,
  TRAP: 0x4,
  FUSION: 0x40,
  RITUAL: 0x80,
  SYNCHRO: 0x2000,
  TOKEN: 0x4000,
  XYZ: 0x800000,
  PENDULUM: 0x1000000,
  LINK: 0x4000000,
};

/** Tipos que moram no Extra Deck. */
export const EXTRA_DECK_TYPES =
  OCG_TYPE.FUSION | OCG_TYPE.SYNCHRO | OCG_TYPE.XYZ | OCG_TYPE.LINK;

/**
 * Onde a carta entra para ser testada.
 *
 * Armadilhas e magias precisam estar **baixadas** para poderem ser ativadas do
 * campo; magias também ativam direto da mão. Monstros vão para a mão (para
 * testar invocação) e uma cópia para o campo (para efeitos de campo/ignição).
 *
 * @param extraDeck quando ligado, um monstro de Extra Deck entra no **Extra
 *   Deck** (virado para baixo, como o app cria) em vez da mão. A bateria Goat
 *   mantém a mão para continuar comparável com os relatórios antigos; a do
 *   pool TCG precisa do Extra Deck, senão Sincro/Xyz/Link nunca seriam
 *   oferecidos para invocar.
 */
export function placementsFor(type, { extraDeck = false } = {}) {
  if (type & OCG_TYPE.TRAP) return [{ zone: Zone.SZONE, position: OcgPosition.FACEDOWN }];
  if (type & OCG_TYPE.SPELL) {
    return [
      { zone: Zone.HAND },
      { zone: Zone.SZONE, position: OcgPosition.FACEDOWN },
    ];
  }
  if (extraDeck && type & EXTRA_DECK_TYPES) {
    return [
      { zone: Zone.EXTRA, position: OcgPosition.FACEDOWN },
      { zone: Zone.MZONE, position: OcgPosition.FACEUP_ATTACK },
    ];
  }
  return [
    { zone: Zone.HAND },
    { zone: Zone.MZONE, position: OcgPosition.FACEUP_ATTACK },
  ];
}

/**
 * Campo de apoio, igual para toda carta testada.
 *
 * Farto de propósito — monstros dos dois lados, cemitério com atributos
 * variados, magia e armadilha na mão, Extra Deck povoado. Num campo pobre a
 * maioria dos efeitos daria "não ativável" por falta de alvo ou de custo, e
 * esse falso negativo esconderia as cartas de fato quebradas.
 */
export function scaffold() {
  return [
    { player: 0, zone: Zone.MZONE, code: FILLER.elf, sequence: 3, position: OcgPosition.FACEUP_ATTACK },
    { player: 0, zone: Zone.MZONE, code: FILLER.ox, sequence: 4, position: OcgPosition.FACEUP_ATTACK },
    // Cemitério com LUZ, TREVAS, TERRA e ÁGUA: custos de banimento por
    // atributo são comuns e todos exigiriam um cemitério diferente.
    { player: 0, zone: Zone.GRAVE, code: FILLER.imp },
    { player: 0, zone: Zone.GRAVE, code: FILLER.mammoth },
    { player: 0, zone: Zone.GRAVE, code: FILLER.light },
    { player: 0, zone: Zone.GRAVE, code: FILLER.elf },
    { player: 0, zone: Zone.GRAVE, code: FILLER.aqua },
    { player: 0, zone: Zone.GRAVE, code: FILLER.spell },
    // Mão com um de cada tipo: "descarte 1 Magia" e "descarte 1 monstro de
    // ÁGUA" são custos frequentes no pool Goat.
    { player: 0, zone: Zone.HAND, code: FILLER.fang },
    { player: 0, zone: Zone.HAND, code: FILLER.aqua },
    { player: 0, zone: Zone.HAND, code: FILLER.light },
    { player: 0, zone: Zone.HAND, code: FILLER.spell },
    { player: 0, zone: Zone.HAND, code: FILLER.trap },
    // Sem Extra Deck, cartas como o Cyber-Stein não têm o que invocar.
    { player: 0, zone: Zone.EXTRA, code: FILLER.fusion },
    { player: 1, zone: Zone.MZONE, code: FILLER.fang, sequence: 3, position: OcgPosition.FACEUP_ATTACK },
    { player: 1, zone: Zone.MZONE, code: FILLER.mammoth, sequence: 4, position: OcgPosition.FACEUP_DEFENSE },
    // Uma magia baixada do oponente: alvo para remoção de magia/armadilha.
    { player: 1, zone: Zone.SZONE, code: FILLER.spell, sequence: 3, position: OcgPosition.FACEDOWN },
    { player: 1, zone: Zone.GRAVE, code: FILLER.elf },
    { player: 1, zone: Zone.GRAVE, code: FILLER.dark },
  ];
}

/** Deck variado: efeitos de busca por tipo/atributo precisam de alvo lá dentro. */
export const DECK = [
  FILLER.ox, FILLER.elf, FILLER.imp, FILLER.mammoth, FILLER.fang,
  FILLER.aqua, FILLER.light, FILLER.dark, FILLER.spell, FILLER.trap,
  FILLER.ox, FILLER.elf, FILLER.imp, FILLER.aqua, FILLER.light,
];

/** A carta em teste aparece entre as ações oferecidas no Main Phase 1? */
function offeredIn(idle, code) {
  const buckets = {
    activate: idle.activates,
    summon: idle.summons,
    special: idle.special_summons,
    set: [...idle.monster_sets, ...idle.spell_sets],
    position: idle.pos_changes,
  };
  const hit = [];
  for (const [label, list] of Object.entries(buckets)) {
    if (list.some((card) => card.code === code)) hit.push(label);
  }
  return hit;
}

/**
 * O core loga muita coisa que não é falha.
 *
 * Além dos avisos do carregador do wasm, "script not found" é esperado: todo
 * monstro baunilha entra no duelo sem script e o core lida com isso sozinho.
 */
const NOISE = /^\s*$|no such file|script not found|wasm streaming|ArrayBuffer instantiation|falling back/i;
export function isRealError(text) {
  return Boolean(text) && !NOISE.test(text);
}

const ZONE_NAMES = {
  [OcgLocation.HAND]: "mão",
  [OcgLocation.MZONE]: "campo",
  [OcgLocation.SZONE]: "baixada",
  [OcgLocation.GRAVE]: "cemitério",
  [OcgLocation.EXTRA]: "extra",
};
export const zoneName = (zone) => ZONE_NAMES[zone] ?? String(zone);

const MESSAGE_NAMES = Object.fromEntries(
  Object.entries(OcgMessageType).filter(([k]) => Number.isNaN(Number(k))).map(([k, v]) => [v, k]),
);
export const messageName = (type) => MESSAGE_NAMES[type] ?? `TYPE_${type}`;

/**
 * Roda uma carta e devolve o veredicto.
 *
 * A política do teste intercepta o primeiro `SELECT_IDLECMD` do jogador 0: é
 * ali que se descobre se o core oferece a carta. Se oferecer, ativa/invoca e
 * deixa o piloto automático resolver o resto — é resolvendo que os erros de
 * Lua aparecem.
 *
 * @param mode regras do duelo (`OcgDuelMode`); omitido = Goat.
 * @param extraDeck ver `placementsFor`.
 */
export async function testCard(card, db, { mode, extraDeck = false } = {}) {
  const official = db.get(card.id);
  const type = official?.type ?? 0;
  const results = [];

  for (const placement of placementsFor(type, { extraDeck })) {
    let duel;
    try {
      duel = await createDuel({
        mode,
        place: [
          ...scaffold(),
          { player: 0, zone: placement.zone, code: card.id, position: placement.position, sequence: 0 },
        ],
        decks: [DECK, DECK],
      });
    } catch (error) {
      results.push({ placement: zoneName(placement.zone), verdict: "CRASH", detail: String(error?.message ?? error) });
      continue;
    }

    let offered = null;
    let acted = false;

    const outcome = duel.run((message) => {
      if (message.type !== OcgMessageType.SELECT_IDLECMD || message.player !== 0) return null;
      if (offered === null) offered = offeredIn(message, card.id);
      // Com a jogada feita e a corrente resolvida, o resto do duelo não diz
      // mais nada sobre esta carta — deixar rodar até o deck acabar só custa.
      if (acted) return STOP;

      // Prioridade: ativar o efeito > invocação especial > invocação > baixar.
      const order = [
        [message.activates, SelectIdleCMDAction.SELECT_ACTIVATE],
        [message.special_summons, SelectIdleCMDAction.SELECT_SPECIAL_SUMMON],
        [message.summons, SelectIdleCMDAction.SELECT_SUMMON],
        [message.spell_sets, SelectIdleCMDAction.SELECT_SPELL_SET],
      ];
      for (const [list, action] of order) {
        const index = list.findIndex((c) => c.code === card.id);
        if (index >= 0) {
          acted = true;
          return { type: OcgResponseType.SELECT_IDLECMD, action, index };
        }
      }
      return null;
    });

    const luaErrors = duel.errors.filter(isRealError);
    results.push({
      placement: zoneName(placement.zone),
      verdict:
        outcome === "BINDING_ERROR"
          ? "BINDING_ERROR"
          : luaErrors.length
            ? "LUA_ERROR"
            : outcome === "STUCK"
              ? "STUCK"
              : outcome === "RETRY_LOOP"
                ? "RETRY_LOOP"
                : acted
                  ? "ACTIVATED"
                  : "NOT_OFFERED",
      offered: offered ?? [],
      outcome,
      errors: luaErrors,
      unanswered: [...new Set(duel.unanswered)].map(messageName),
      bindingError: duel.bindingError ?? null,
      // Num laço de RETRY, a pergunta que o core não parou de repetir — é o
      // que separa "o piloto respondeu errado" de "a carta pede o impossível".
      retryPrompt: outcome === "RETRY_LOOP" ? messageName(duel.lastPrompt?.type) : null,
      chained: duel.of(OcgMessageType.CHAINING).some((m) => m.code === card.id),
      summoned: [
        ...duel.of(OcgMessageType.SUMMONING),
        ...duel.of(OcgMessageType.SPSUMMONING),
      ].some((m) => m.code === card.id),
    });
    duel.destroy();
  }

  return { id: card.id, name: card.name, type: card.type, results };
}

/** Lê `--json`, `--slice`, `--verbose` e passcodes soltos da linha de comando. */
export function parseScanArgs(argv) {
  const jsonAt = argv.indexOf("--json");
  const sliceAt = argv.indexOf("--slice");
  // Flags que levam valor: o número depois de `--jobs 6` não é um passcode.
  const valued = new Set(["--json", "--slice", "--jobs"]);
  const explicit = argv
    .filter((arg, index) => /^\d+$/.test(arg) && !valued.has(argv[index - 1]))
    .map(Number);
  return {
    jsonOut: jsonAt >= 0 ? argv[jsonAt + 1] : null,
    slice: sliceAt >= 0 ? argv[sliceAt + 1] : null,
    verbose: argv.includes("--verbose"),
    explicit,
  };
}

/** Aplica `--slice i/n` — fatia por resto, para dividir entre processos. */
export function applySlice(cards, slice) {
  if (!slice) return cards;
  const [index, total] = slice.split("/").map(Number);
  return cards.filter((_, i) => i % total === index);
}

/**
 * Roda a varredura e imprime o resumo por veredito.
 *
 * @returns o relatório completo (uma entrada por carta).
 */
export async function runScan(cards, db, options = {}) {
  process.stderr.write(`testando ${cards.length} cartas...\n`);
  const report = [];
  for (const [index, card] of cards.entries()) {
    report.push(await testCard(card, db, options));
    if ((index + 1) % 25 === 0) process.stderr.write(`  ${index + 1}/${cards.length}\n`);
  }
  return report;
}

/** Imprime o resumo por veredito e o detalhe das falhas de verdade. */
export function printScanSummary(report, { verbose = false } = {}) {
  const flat = report.flatMap((r) => r.results.map((x) => ({ ...r, ...x })));
  const byVerdict = {};
  for (const row of flat) (byVerdict[row.verdict] ??= []).push(row);

  if (verbose) {
    process.stdout.write("\n=== detalhe ===\n");
    for (const row of flat) {
      process.stdout.write(
        `${row.id} ${row.name}\n  [${row.placement}] ${row.verdict} outcome=${row.outcome} ` +
        `oferecido=${row.offered?.join("/") || "-"} encadeou=${row.chained} invocou=${row.summoned}` +
        `${row.unanswered?.length ? " travou-em=" + row.unanswered.join(",") : ""}` +
        `${row.errors?.length ? "\n  erros: " + row.errors.join("\n  erros: ") : ""}\n`,
      );
    }
  }

  process.stdout.write("\n=== resumo ===\n");
  for (const [verdict, rows] of Object.entries(byVerdict).sort((a, b) => b[1].length - a[1].length)) {
    process.stdout.write(`${verdict}: ${rows.length}\n`);
  }

  for (const verdict of ["CRASH", "BINDING_ERROR", "LUA_ERROR", "STUCK", "RETRY_LOOP"]) {
    const rows = byVerdict[verdict] ?? [];
    if (!rows.length) continue;
    process.stdout.write(`\n--- ${verdict} (${rows.length}) ---\n`);
    for (const row of rows) {
      process.stdout.write(
        `${row.id} ${row.name} [${row.placement}] ${row.retryPrompt ?? ""} ${row.unanswered?.join(",") ?? ""} ${row.bindingError ?? ""} ${(row.errors ?? []).slice(0, 2).join(" | ")} ${row.detail ?? ""}\n`,
      );
    }
  }
  return byVerdict;
}
