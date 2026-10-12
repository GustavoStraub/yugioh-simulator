/**
 * Testa cartas REATIVAS do pool Goat — as que só abrem sua janela de ativação
 * quando algo ACONTECE no duelo, não num Main Phase 1 parado.
 *
 * `test-cards.mjs` pergunta "o core oferece isso agora, num tabuleiro parado?"
 * — pergunta errada para Mirror Force, Trap Hole, Seven Tools of the Bandit e
 * companhia: nenhuma delas aparece em lugar nenhum até o oponente declarar um
 * ataque, invocar ou ativar algo. Este arquivo constrói o EVENTO, não só o
 * tabuleiro: uma política dedicada por cenário obriga o jogador 1 a atacar,
 * invocar (normal/flip/especial) ou ativar magia/armadilha na hora certa,
 * enquanto observa se a carta em teste aparece oferecida ao jogador 0.
 *
 * Cada carta roda contra VÁRIOS cenários (um por janela plausível) e passa se
 * QUALQUER UM oferecer — não precisamos saber de antemão qual janela é a
 * certa, só que existe uma.
 *
 * Sete cartas, em três grupos, fogem desse molde porque o próprio Lua
 * bloqueia a ativação normal (só entram em campo pelo efeito de OUTRA carta):
 * as quatro "Spirit Message", as duas "Sarcophagus" (Destiny Board / A
 * Primeira Sarcófago) e Exodia Necross (Contrato com Exodia). Para essas, o
 * cenário testa o COMBO inteiro em vez de procurar a carta em `activates`.
 *
 * Uso:
 *   node tools/harness/test-triggers.mjs 44095762 41420027   # passcodes
 *   node tools/harness/test-triggers.mjs --not-offered .cache/report-full.json
 *   node tools/harness/test-triggers.mjs --slice 0/4 --json out.json --verbose
 */
import { writeFileSync, readFileSync } from "node:fs";

import {
  OcgLocation,
  OcgMessageType,
  OcgPosition,
  OcgResponseType,
  SelectBattleCMDAction,
  SelectIdleCMDAction,
} from "@n1xx1/ocgcore-wasm";

import { loadGoatPool } from "./env.mjs";
import { createDuel, STOP, Zone } from "./duel.mjs";

/**
 * Mesmas baunilhas do test-cards.mjs (mesmos passcodes, mesmos comentários) —
 * a variedade não é decorativa: um custo como "descarte 1 monstro de ÁGUA" ou
 * "bana 1 de LUZ do cemitério" não pode ser pago num cenário só de TERRA, e a
 * carta apareceria como "nunca oferecida" por falta de recurso, não por ter
 * o gatilho quebrado — exatamente o falso negativo que este arquivo existe
 * para eliminar.
 */
const FILLER = {
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

/**
 * Iscas: cartas reais, de ativação incondicional (fora o tamanho do baralho),
 * usadas só para OBRIGAR o oponente a fazer algo específico — ativar uma
 * magia, uma armadilha, invocar por efeito — sem depender do que um piloto
 * automático genérico "acha" melhor jogar.
 */
const BAIT = {
  /** Pot of Greed — Magia Normal: compra 2, sem alvo, sem condição. */
  potOfGreed: 55144522,
  /** Reckless Greed — Armadilha Normal: compra 2, sem alvo, sem condição. */
  recklessGreed: 37576645,
  /** Monster Reborn — Magia Normal: Invocação-Especial de qualquer Cemitério. */
  monsterReborn: 83764719,
  /** Summoned Skull — Normal, 2500/1200: ataque direto grande o bastante
   * para cobrir cartas como Nutrient Z, que exigem 2000+ de dano de batalha. */
  bigAttacker: 70781052,
  /**
   * Polymerization + duas cartas específicas (Possessed Dark Soul, Frontier
   * Wiseman) fundem Dark Balter the Terrible (2000/1200) de verdade.
   *
   * Testado e descartado antes: reanimar um Monstro de Fusão direto do
   * Cemitério com Monster Reborn NÃO funciona — `EnableReviveLimit()` (que
   * praticamente todo Monstro de Fusão/Sincro/Xyz registra) exige que a carta
   * já tenha sido invocada da forma própria pelo menos uma vez antes de poder
   * ser reanimada; plantá-la direto no Cemitério nunca satisfaz isso, e não é
   * bug — é a regra real. Fusão de verdade é o único jeito confiável de um
   * Monstro de Fusão virar alvo de `EVENT_SPSUMMON_SUCCESS` "de graça".
   */
  polymerization: 24094653,
  fusionMaterialA: 52860176, // Possessed Dark Soul
  fusionMaterialB: 38742075, // Frontier Wiseman
  fusionMonster: 80071763, // Dark Balter the Terrible
  /** Scapegoat — Magia Normal: 4 Fichas de Carneiro, sem alvo, sem condição
   * (fora precisar de campo livre e não ter invocado ainda no turno). Único
   * jeito simples de fazer o oponente Invocar por Invocação-Especial uma
   * FICHA — Token Feastevil exige especificamente isso. */
  tokenMaker: 73915051,
  /**
   * Iscas descobertas triando as 74 cartas que sobraram "nunca oferecidas"
   * mesmo com o tabuleiro enriquecido — todas reais, todas incondicionais o
   * bastante para servir de gatilho de propósito único.
   */
  /** Mystical Space Typhoon — Magia Rápida: destrói 1 Magia/Armadilha alvo, sem custo. */
  destroySpellTrap: 5318639,
  /** Axe of Despair — Magia de Equipamento: +1000 ATK, alvo 1 monstro seu. */
  equipSpell: 40619825,
  /** Level Limit - Area B — Magia Contínua: sem alvo, sem condição. */
  continuousSpell: 3136426,
  /** Umi — Magia de Campo: sem alvo, sem condição. */
  fieldSpell: 22702055,
  /** Dark Hole — Magia Normal: destrói tudo em campo, sem alvo. */
  darkHole: 53129443,
  /** Ookazi — Magia Normal: 800 de dano de efeito ao oponente, sem alvo. */
  burnSpell: 19523799,
  /** Kuriboh — TREVAS / Fiend / 300 / 200: baunilha fraca o bastante para
   * cartas que exigem ATK ou DEF baixo no monstro invocado pelo oponente. */
  weakVanilla: 40640057,
  /** Solemn Wishes — Armadilha CONTÍNUA real (distinta de Reckless Greed,
   * que é Normal) — cartas que exigem especificamente uma Armadilha Contínua
   * ativada não aceitam a isca Normal. */
  continuousTrap: 35346968,
};

/**
 * As sete cartas que fogem do molde "ativa sozinha, em algum lugar" — seus
 * scripts bloqueiam a ativação normal de propósito (`EFFECT_CANNOT_SSET` e
 * afins). Testá-las como armadilha comum seria só reafirmar o que o Lua já
 * deixa explícito; em vez disso, cada grupo ganha um cenário que monta o
 * COMBO real (Destiny Board, A Primeira Sarcófago, Contrato com Exodia).
 */
const SPIRIT_MESSAGES = [94772232, 31893528, 30170981, 67287533]; // "A" "I" "L" "N"
const DESTINY_BOARD = 94212438;
const SARCOPHAGUS_CHAIN = [4081094, 78697395]; // Segunda, Terceira
const FIRST_SARCOPHAGUS = 31076103;
const EXODIA_NECROSS = 12600382;
const CONTRACT_WITH_EXODIA = 33244944;
const EXODIA_PIECES = [8124921, 44519536, 70903634, 7902349, 33396948];

/**
 * Recursos extras do jogador 0 (dono da carta em teste) — cemitério e mão com
 * quatro atributos diferentes, mais Extra Deck povoado. Compartilhado entre
 * cenários que também dão dois monstros de campo a esse jogador (`baseBoard`)
 * e os poucos que não podem (`scenarioDirectDamage`, `scenarioSummonToken`
 * precisam do campo do OPONENTE livre, não do dele).
 */
function player0Extras() {
  return [
    // Cemitério com LUZ, TREVAS, TERRA e ÁGUA: custos de banimento por
    // atributo são comuns e todos exigiriam um cemitério diferente.
    { player: 0, zone: Zone.GRAVE, code: FILLER.imp },
    { player: 0, zone: Zone.GRAVE, code: FILLER.mammoth },
    { player: 0, zone: Zone.GRAVE, code: FILLER.light },
    { player: 0, zone: Zone.GRAVE, code: FILLER.aqua },
    // Mão com um de cada tipo: "descarte 1 Magia" e "descarte 1 monstro de
    // ÁGUA" são custos frequentes no pool Goat.
    { player: 0, zone: Zone.HAND, code: FILLER.fang },
    { player: 0, zone: Zone.HAND, code: FILLER.aqua },
    { player: 0, zone: Zone.HAND, code: FILLER.light },
    { player: 0, zone: Zone.HAND, code: FILLER.spell },
    { player: 0, zone: Zone.HAND, code: FILLER.trap },
    // Sem Extra Deck, cartas como o Cyber-Stein não têm o que invocar.
    { player: 0, zone: Zone.EXTRA, code: FILLER.fusion },
  ];
}

/** Recursos extras do jogador 1 (oponente) que não ocupam Zona de Monstro —
 * uma Magia baixada (alvo para remoção) e cemitério com mais duas cartas. */
function player1Extras() {
  return [
    { player: 1, zone: Zone.SZONE, code: FILLER.spell, sequence: 3, position: OcgPosition.FACEDOWN },
    { player: 1, zone: Zone.GRAVE, code: FILLER.elf },
    { player: 1, zone: Zone.GRAVE, code: FILLER.dark },
  ];
}

/** Campo de apoio padrão — dois monstros de cada lado, mais os extras acima. */
function baseBoard() {
  return [
    { player: 0, zone: Zone.MZONE, code: FILLER.elf, sequence: 3, position: OcgPosition.FACEUP_ATTACK },
    { player: 0, zone: Zone.MZONE, code: FILLER.ox, sequence: 4, position: OcgPosition.FACEUP_ATTACK },
    ...player0Extras(),
    { player: 1, zone: Zone.MZONE, code: FILLER.fang, sequence: 3, position: OcgPosition.FACEUP_ATTACK },
    { player: 1, zone: Zone.MZONE, code: FILLER.mammoth, sequence: 4, position: OcgPosition.FACEUP_DEFENSE },
    ...player1Extras(),
  ];
}

/** A carta em teste, sempre do lado do jogador 0 — baixada (armadilha/magia). */
function underTest(code) {
  return { player: 0, zone: Zone.SZONE, code, position: OcgPosition.FACEDOWN, sequence: 0 };
}

/**
 * Baralho variado — efeitos de busca por tipo/atributo precisam de alvo lá
 * dentro, não só baunilha de TERRA repetida.
 */
const DECK_VARIETY = [
  FILLER.ox, FILLER.elf, FILLER.imp, FILLER.mammoth, FILLER.fang,
  FILLER.aqua, FILLER.light, FILLER.dark, FILLER.spell, FILLER.trap,
];
const deck = (n = 12) => Array.from({ length: n }, (_, i) => DECK_VARIETY[i % DECK_VARIETY.length]);

const IDLE_ACTIVATE = (index) => ({
  type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_ACTIVATE, index,
});

/**
 * Observa se `code` aparece oferecido ao jogador 0 — em `SELECT_IDLECMD`
 * (ativação em Main Phase), `SELECT_BATTLECMD` (resposta durante a Battle
 * Phase de quem ataca) ou `SELECT_CHAIN` (resposta a qualquer evento, o caso
 * mais comum para armadilha reativa). Na primeira vez que aparece, ativa.
 *
 * Depois de ativar, dá corda solta por `SETTLE_BUDGET` prompts — tempo
 * suficiente para o efeito (e qualquer sub-seleção de alvo) resolver e um
 * erro de Lua aparecer — e então manda parar. Sem esse teto, cada carta que
 * FUNCIONA rodaria o cenário inteiro até o fim (vitória por fadiga de
 * baralho), e testar 136 cartas em oito cenários ficaria lento à toa.
 */
const SETTLE_BUDGET = 60;
function watcher(code) {
  const state = { offeredVia: null, acted: false, settle: 0, resolutionPrompts: [] };
  const fn = (message) => {
    if (state.acted) {
      state.settle += 1;
      // Todo prompt visto DEPOIS de escolher ativar é parte de resolver o
      // efeito (alvo, custo, resposta do oponente...) — é exatamente o que
      // precisa existir do lado do app (`buildPromptPlan`) para o jogador
      // conseguir terminar a jogada, não só começá-la.
      state.resolutionPrompts.push(messageName(message.type));
      return state.settle > SETTLE_BUDGET ? STOP : null;
    }
    if (message.type === OcgMessageType.SELECT_IDLECMD && message.player === 0) {
      const index = message.activates.findIndex((c) => c.code === code);
      if (index >= 0) {
        state.offeredVia = "idle.activates";
        state.acted = true;
        return IDLE_ACTIVATE(index);
      }
    } else if (message.type === OcgMessageType.SELECT_BATTLECMD && message.player === 0) {
      const index = message.chains.findIndex((c) => c.code === code);
      if (index >= 0) {
        state.offeredVia = "battlecmd.chains";
        state.acted = true;
        return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_CHAIN, index };
      }
    } else if (message.type === OcgMessageType.SELECT_CHAIN && message.player === 0) {
      const index = message.selects.findIndex((c) => c.code === code);
      if (index >= 0) {
        state.offeredVia = "chain.selects";
        state.acted = true;
        return { type: OcgResponseType.SELECT_CHAIN, index };
      }
    }
    return null;
  };
  fn.state = state;
  return fn;
}

/**
 * O core loga muita coisa que não é falha (mesmo filtro do test-cards.mjs).
 */
const NOISE = /^\s*$|no such file|script not found|wasm streaming|ArrayBuffer instantiation|falling back/i;
function isRealError(text) {
  return Boolean(text) && !NOISE.test(text);
}

const MESSAGE_NAMES = Object.fromEntries(
  Object.entries(OcgMessageType).filter(([k]) => Number.isNaN(Number(k))).map(([k, v]) => [v, k]),
);
const messageName = (type) => MESSAGE_NAMES[type] ?? `TYPE_${type}`;

function finishResult(scenario, code, duel, outcome, watch) {
  const luaErrors = duel.errors.filter(isRealError);
  return {
    scenario,
    verdict:
      outcome === "BINDING_ERROR"
        ? "BINDING_ERROR"
        : luaErrors.length
          ? "LUA_ERROR"
          : outcome === "STUCK"
            ? "STUCK"
            : watch.state.acted
              ? "ACTIVATED"
              : "NOT_OFFERED",
    offeredVia: watch.state.offeredVia,
    // Prompts vistos resolvendo o efeito depois de ativar — o que o app
    // (`buildPromptPlan`) precisa saber tratar para o jogador terminar a
    // jogada, não só recebê-la oferecida.
    resolutionPrompts: [...new Set(watch.state.resolutionPrompts)],
    outcome,
    errors: luaErrors,
    unanswered: [...new Set(duel.unanswered)].map(messageName),
    bindingError: duel.bindingError ?? null,
    chained: duel.of(OcgMessageType.CHAINING).some((m) => m.code === code),
    summoned: [
      ...duel.of(OcgMessageType.SUMMONING),
      ...duel.of(OcgMessageType.SPSUMMONING),
    ].some((m) => m.code === code),
  };
}

/** Monta o duelo, roda `watcher` + a política do cenário, devolve o veredicto. */
async function runScenario(scenario, code, { place, decks }, drive) {
  let duel;
  try {
    duel = await createDuel({ place, decks });
  } catch (error) {
    return { scenario, verdict: "CRASH", detail: String(error?.message ?? error) };
  }
  const watch = watcher(code);
  const outcome = duel.run((message, d) => {
    const response = watch(message);
    if (response !== null) return response;
    return drive ? drive(message, d) : null;
  });
  const result = finishResult(scenario, code, duel, outcome, watch);
  duel.destroy();
  return result;
}

// ---------------------------------------------------------------------------
// Cenários genéricos — um por janela de ativação plausível.
// ---------------------------------------------------------------------------

/** Janela 1: ataque declarado. `attacker` decide quem ataca (0 = você, 1 = oponente). */
function scenarioAttack(code, attacker) {
  const place = [...baseBoard(), underTest(code)];
  const drive = (message) => {
    if (message.type === OcgMessageType.SELECT_IDLECMD && message.player === attacker && message.to_bp) {
      return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_BP, index: null };
    }
    if (message.type === OcgMessageType.SELECT_BATTLECMD && message.player === attacker && message.attacks.length > 0) {
      return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index: 0 };
    }
    return null;
  };
  const name = attacker === 1 ? "ataque-oponente" : "ataque-proprio";
  return runScenario(name, code, { place, decks: [deck(), deck()] }, drive);
}

/** Janela 2a: Invocação-Normal do oponente. */
function scenarioSummonNormal(code) {
  const place = [...baseBoard(), underTest(code), { player: 1, zone: Zone.HAND, code: FILLER.ox }];
  const drive = (message) => {
    if (message.type === OcgMessageType.SELECT_IDLECMD && message.player === 1 && message.summons.length > 0) {
      return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SUMMON, index: 0 };
    }
    return null;
  };
  return runScenario("invocacao-normal-oponente", code, { place, decks: [deck(), deck()] }, drive);
}

/**
 * Janela 2b: Invocação por Flip do oponente — um monstro de face para baixo
 * plantado antes do duelo começar conta como baixado num turno anterior (a
 * mesma regra que libera armadilha; verificado empiricamente), então já pode
 * virar de imediato. `pos_changes` não distingue face-para-baixo de
 * face-para-cima pelo código sozinho quando há outra cópia no campo, então o
 * isca (`imp`) não aparece em mais nenhum lugar do tabuleiro do oponente.
 */
function scenarioSummonFlip(code) {
  const place = [
    ...baseBoard(),
    underTest(code),
    { player: 1, zone: Zone.MZONE, code: FILLER.imp, sequence: 2, position: OcgPosition.FACEDOWN_DEFENSE },
  ];
  const drive = (message) => {
    if (message.type === OcgMessageType.SELECT_IDLECMD && message.player === 1) {
      const index = message.pos_changes.findIndex((c) => c.code === FILLER.imp);
      if (index >= 0) {
        return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_POS_CHANGE, index };
      }
    }
    return null;
  };
  return runScenario("invocacao-flip-oponente", code, { place, decks: [deck(), deck()] }, drive);
}

/**
 * Janela 2c: Invocação-Especial do oponente — via Monster Reborn (isca) sobre
 * um monstro comum de qualquer Cemitério (o `baseBoard` já deixa um em cada
 * lado — nenhum é de Fusão/Sincro/Xyz, então `EnableReviveLimit` não entra
 * no caminho). Cobre a maioria das cartas que reagem a "invocação-especial",
 * mas não as poucas que exigem um TIPO específico de invocado — essas ganham
 * cenários dedicados logo abaixo (Fusão, Ficha).
 */
function scenarioSummonSpecial(code) {
  const place = [...baseBoard(), underTest(code), { player: 1, zone: Zone.HAND, code: BAIT.monsterReborn }];
  const drive = (message) => {
    if (message.type === OcgMessageType.SELECT_IDLECMD && message.player === 1) {
      const index = message.activates.findIndex((c) => c.code === BAIT.monsterReborn);
      if (index >= 0) return IDLE_ACTIVATE(index);
    }
    return null;
  };
  return runScenario("invocacao-especial-oponente", code, { place, decks: [deck(), deck()] }, drive);
}

/**
 * Janela 2d: Invocação-Especial do oponente especificamente de um Monstro de
 * Fusão — Polymerization funde Dark Balter the Terrible de verdade (2
 * materiais nomeados, na mão). Existe porque Mispolymerization só reage
 * quando o invocado É um Monstro de Fusão (`Card.IsFusionMonster`) — a
 * reanimação genérica do cenário anterior nunca satisfaz isso (ver nota em
 * `BAIT.polymerization`).
 */
function scenarioSummonFusion(code) {
  const place = [
    ...baseBoard(),
    underTest(code),
    { player: 1, zone: Zone.HAND, code: BAIT.polymerization },
    { player: 1, zone: Zone.HAND, code: BAIT.fusionMaterialA },
    { player: 1, zone: Zone.HAND, code: BAIT.fusionMaterialB },
    { player: 1, zone: Zone.EXTRA, code: BAIT.fusionMonster },
  ];
  const drive = (message) => {
    if (message.type === OcgMessageType.SELECT_IDLECMD && message.player === 1) {
      const index = message.activates.findIndex((c) => c.code === BAIT.polymerization);
      if (index >= 0) return IDLE_ACTIVATE(index);
    }
    return null;
  };
  return runScenario("invocacao-fusao-oponente", code, { place, decks: [deck(), deck()] }, drive);
}

/**
 * Janela 2e: Invocação-Especial do oponente especificamente de uma FICHA —
 * Scapegoat, sem bloqueio nenhum além de campo livre. Token Feastevil só
 * reage quando o grupo invocado inclui uma Ficha (`Card.IsType(TYPE_TOKEN)`).
 * Sem `baseBoard` do lado do oponente aqui: Scapegoat exige 4 zonas de
 * monstro livres, e os dois monstros padrão do oponente não deixariam essa
 * sobra.
 */
function scenarioSummonToken(code) {
  const place = [
    { player: 0, zone: Zone.MZONE, code: FILLER.elf, sequence: 3, position: OcgPosition.FACEUP_ATTACK },
    { player: 0, zone: Zone.MZONE, code: FILLER.ox, sequence: 4, position: OcgPosition.FACEUP_ATTACK },
    ...player0Extras(),
    underTest(code),
    { player: 1, zone: Zone.HAND, code: BAIT.tokenMaker },
    ...player1Extras(),
  ];
  const drive = (message) => {
    if (message.type === OcgMessageType.SELECT_IDLECMD && message.player === 1) {
      const index = message.activates.findIndex((c) => c.code === BAIT.tokenMaker);
      if (index >= 0) return IDLE_ACTIVATE(index);
    }
    return null;
  };
  return runScenario("invocacao-ficha-oponente", code, { place, decks: [deck(), deck()] }, drive);
}

/** Janela 2f: o oponente BAIXA um monstro (Set), não invoca de face para
 * cima — distinto da Invocação-Normal comum (algumas cartas só reagem a
 * `EVENT_MSET`, não a `EVENT_SUMMON_SUCCESS`). */
function scenarioMonsterSet(code) {
  const place = [...baseBoard(), underTest(code), { player: 1, zone: Zone.HAND, code: FILLER.ox }];
  const drive = (message) => {
    if (message.type === OcgMessageType.SELECT_IDLECMD && message.player === 1 && message.monster_sets.length > 0) {
      return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_MONSTER_SET, index: 0 };
    }
    return null;
  };
  return runScenario("baixar-monstro-oponente", code, { place, decks: [deck(), deck()] }, drive);
}

/**
 * Janela extra: dano direto grande (Summoned Skull, 2500 ATK, sem bloqueador
 * do lado do jogador 0). Cobre cartas como Nutrient Z, que só se ativam
 * quando o dano de batalha prestes a acontecer é >= 2000 — o diferencial de
 * ATK do cenário de ataque comum (no máximo umas centenas) nunca chega lá.
 */
function scenarioDirectDamage(code) {
  const place = [
    ...player0Extras(),
    underTest(code),
    { player: 1, zone: Zone.MZONE, code: BAIT.bigAttacker, sequence: 0, position: OcgPosition.FACEUP_ATTACK },
    ...player1Extras(),
  ];
  const drive = (message) => {
    if (message.type === OcgMessageType.SELECT_IDLECMD && message.player === 1 && message.to_bp) {
      return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_BP, index: null };
    }
    if (message.type === OcgMessageType.SELECT_BATTLECMD && message.player === 1) {
      const index = message.attacks.findIndex((a) => a.code === BAIT.bigAttacker);
      if (index >= 0) return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index };
    }
    return null;
  };
  return runScenario("dano-direto-oponente", code, { place, decks: [deck(), deck()] }, drive);
}

/** Janela 3a: o oponente ativa uma Magia (Pot of Greed, isca — sem alvo). */
function scenarioActivateSpell(code) {
  const place = [...baseBoard(), underTest(code), { player: 1, zone: Zone.HAND, code: BAIT.potOfGreed }];
  const drive = (message) => {
    if (message.type === OcgMessageType.SELECT_IDLECMD && message.player === 1) {
      const index = message.activates.findIndex((c) => c.code === BAIT.potOfGreed);
      if (index >= 0) return IDLE_ACTIVATE(index);
    }
    return null;
  };
  return runScenario("magia-ativada-oponente", code, { place, decks: [deck(), deck()] }, drive);
}

/** Janela 3b: o oponente ativa uma Armadilha (Reckless Greed, isca — sem alvo). */
function scenarioActivateTrap(code) {
  const place = [
    ...baseBoard(),
    underTest(code),
    { player: 1, zone: Zone.SZONE, code: BAIT.recklessGreed, position: OcgPosition.FACEDOWN, sequence: 0 },
  ];
  const drive = (message) => {
    if (message.type === OcgMessageType.SELECT_IDLECMD && message.player === 1) {
      const index = message.activates.findIndex((c) => c.code === BAIT.recklessGreed);
      if (index >= 0) return IDLE_ACTIVATE(index);
    }
    return null;
  };
  return runScenario("armadilha-ativada-oponente", code, { place, decks: [deck(), deck()] }, drive);
}

/**
 * Janela 5: só deixa o tempo passar (Compra/Reserva de vários turnos, dos
 * dois lados) sem dirigir ninguém — pega condições do tipo "no seu Standby"
 * que não dependem de nenhuma ação do oponente, só da fase em si.
 */
function scenarioPhases(code) {
  const place = [...baseBoard(), underTest(code)];
  return runScenario("passagem-de-fases", code, { place, decks: [deck(16), deck(16)] }, null);
}

// ---------------------------------------------------------------------------
// Cenários extra — descobertos triando as 74 cartas que sobraram "nunca
// oferecidas" mesmo com o campo enriquecido: não é reatividade que falta,
// é uma condição/alvo bem específico (leitura do Lua de cada uma, uma por
// uma) que nenhum dos doze cenários acima planta sozinho.
// ---------------------------------------------------------------------------

/**
 * O oponente ativa Mystical Space Typhoon mirando uma carta DIFERENTE da
 * carta em teste — uma isca do tipo pedido (`decoyCode`), plantada numa
 * sequência distinta de `underTest`. Descoberto por tentativa e erro lendo o
 * Lua: Fake Trap e Gust EXCLUEM explicitamente a si mesmas do próprio filtro
 * de condição (`tg:IsExists(s.cfilter,1,e:GetHandler(),tp)` — o terceiro
 * argumento é a carta excluída) — só reagem quando OUTRA Armadilha/Magia sua
 * é destruída, nunca quando o alvo é a própria carta. Precisa de DUAS
 * variantes (Armadilha-isca e Magia-isca) porque o tipo importa: Driving Snow
 * só liga para Armadilha destruída, Gust só para Magia.
 */
function scenarioDestroysOtherBackrow(code, decoyCode) {
  // As DUAS iscas (Armadilha e Magia) ficam plantadas nas DUAS variantes —
  // só qual delas o MST mira muda. Descoberto por tentativa e erro: com só
  // UMA isca em campo (mesma isca, mesmo alvo do MST), a carta em teste às
  // vezes não é oferecida — parece uma questão de prioridade/timing do core
  // sensível ao número de cartas na Zona de Magia/Armadilha, não ao alvo em
  // si. Manter as duas presentes reproduz de forma confiável o cenário que
  // funcionou na investigação manual.
  const place = [
    ...comboBoard(),
    underTest(code),
    { player: 0, zone: Zone.SZONE, code: BAIT.recklessGreed, position: OcgPosition.FACEDOWN, sequence: 1 },
    { player: 0, zone: Zone.SZONE, code: BAIT.continuousSpell, position: OcgPosition.FACEUP, sequence: 2 },
    { player: 1, zone: Zone.HAND, code: BAIT.destroySpellTrap },
  ];
  const drive = (message) => {
    if (message.type === OcgMessageType.SELECT_IDLECMD && message.player === 1) {
      const index = message.activates.findIndex((c) => c.code === BAIT.destroySpellTrap);
      if (index >= 0) return IDLE_ACTIVATE(index);
    }
    if (message.type === OcgMessageType.SELECT_CARD && message.player === 1) {
      const index = message.selects.findIndex((c) => c.controller === 0 && c.code === decoyCode);
      if (index >= 0) return { type: OcgResponseType.SELECT_CARD, indicies: [index] };
    }
    return null;
  };
  const name = decoyCode === BAIT.recklessGreed ? "destroi-outra-armadilha-sua" : "destroi-outra-magia-sua";
  return runScenario(name, code, { place, decks: [deck(), deck()] }, drive);
}

/**
 * O oponente ativa Mystical Space Typhoon mirando a PRÓPRIA carta em teste —
 * `comboBoard()` sem mais nada na Zona de Magia/Armadilha não deixa outro
 * alvo. Cobre cartas que reagem à PRÓPRIA destruição ainda baixada (Curse of
 * Royal, Judgment of Anubis) — o oposto exato do cenário acima.
 */
function scenarioDestroysSelf(code) {
  const place = [...comboBoard(), underTest(code), { player: 1, zone: Zone.HAND, code: BAIT.destroySpellTrap }];
  const drive = (message) => {
    if (message.type === OcgMessageType.SELECT_IDLECMD && message.player === 1) {
      const index = message.activates.findIndex((c) => c.code === BAIT.destroySpellTrap);
      if (index >= 0) return IDLE_ACTIVATE(index);
    }
    return null;
  };
  return runScenario("destroi-sua-propria-carta", code, { place, decks: [deck(), deck()] }, drive);
}

/**
 * O oponente ativa uma Magia de Equipamento (Axe of Despair) num monstro
 * próprio — cobre "existe um Equipamento resolvido" e "uma Magia mirou um
 * monstro", as duas condições por trás de Armor Break/Armored Glass/
 * Collected Power/Disarmament/Really Eternal Rest e Fairy's Hand Mirror/
 * Riryoku Field.
 */
function scenarioEquipResolves(code) {
  const place = [...baseBoard(), underTest(code), { player: 1, zone: Zone.HAND, code: BAIT.equipSpell }];
  const drive = (message) => {
    if (message.type === OcgMessageType.SELECT_IDLECMD && message.player === 1) {
      const index = message.activates.findIndex((c) => c.code === BAIT.equipSpell);
      if (index >= 0) return IDLE_ACTIVATE(index);
    }
    return null;
  };
  return runScenario("equipamento-resolve-oponente", code, { place, decks: [deck(), deck()] }, drive);
}

/** O oponente ativa uma Armadilha CONTÍNUA (Solemn Wishes) — distinto do
 * cenário genérico, que usa uma Armadilha Normal (Reckless Greed). */
function scenarioContinuousTrapActivated(code) {
  const place = [
    ...baseBoard(),
    underTest(code),
    { player: 1, zone: Zone.SZONE, code: BAIT.continuousTrap, position: OcgPosition.FACEDOWN, sequence: 0 },
  ];
  const drive = (message) => {
    if (message.type === OcgMessageType.SELECT_IDLECMD && message.player === 1) {
      const index = message.activates.findIndex((c) => c.code === BAIT.continuousTrap);
      if (index >= 0) return IDLE_ACTIVATE(index);
    }
    return null;
  };
  return runScenario("armadilha-continua-ativada-oponente", code, { place, decks: [deck(), deck()] }, drive);
}

/** O oponente ativa uma Magia CONTÍNUA (Level Limit - Area B) — distinto do
 * cenário genérico, que usa uma Magia Normal (Pot of Greed). */
function scenarioContinuousSpellActivated(code) {
  const place = [...baseBoard(), underTest(code), { player: 1, zone: Zone.HAND, code: BAIT.continuousSpell }];
  const drive = (message) => {
    if (message.type === OcgMessageType.SELECT_IDLECMD && message.player === 1) {
      const index = message.activates.findIndex((c) => c.code === BAIT.continuousSpell);
      if (index >= 0) return IDLE_ACTIVATE(index);
    }
    return null;
  };
  return runScenario("magia-continua-ativada-oponente", code, { place, decks: [deck(), deck()] }, drive);
}

/**
 * O oponente ativa uma Magia de Campo (Umi) — cobre tanto "o oponente ativou
 * uma Magia de Campo" (a janela de reação) quanto "Umi está ativo no campo"
 * (o estado, que persiste depois de resolver, dentro do orçamento de
 * `SETTLE_BUDGET`).
 */
function scenarioFieldSpellActivated(code) {
  const place = [...baseBoard(), underTest(code), { player: 1, zone: Zone.HAND, code: BAIT.fieldSpell }];
  const drive = (message) => {
    if (message.type === OcgMessageType.SELECT_IDLECMD && message.player === 1) {
      const index = message.activates.findIndex((c) => c.code === BAIT.fieldSpell);
      if (index >= 0) return IDLE_ACTIVATE(index);
    }
    return null;
  };
  return runScenario("magia-de-campo-ativada-oponente", code, { place, decks: [deck(), deck()] }, drive);
}

/** O oponente ativa uma Magia de dano de EFEITO (Ookazi, 800 de dano) — para
 * cartas que exigem especificamente dano que NÃO veio de batalha. */
function scenarioEffectDamage(code) {
  const place = [...baseBoard(), underTest(code), { player: 1, zone: Zone.HAND, code: BAIT.burnSpell }];
  const drive = (message) => {
    if (message.type === OcgMessageType.SELECT_IDLECMD && message.player === 1) {
      const index = message.activates.findIndex((c) => c.code === BAIT.burnSpell);
      if (index >= 0) return IDLE_ACTIVATE(index);
    }
    return null;
  };
  return runScenario("dano-de-efeito-oponente", code, { place, decks: [deck(), deck()] }, drive);
}

/** O oponente Invoca por Invocação-Normal uma baunilha bem fraca (Kuriboh,
 * 300/200) — para cartas que exigem ATK ou DEF baixo no monstro invocado. */
function scenarioSummonWeak(code) {
  const place = [...baseBoard(), underTest(code), { player: 1, zone: Zone.HAND, code: BAIT.weakVanilla }];
  const drive = (message) => {
    if (message.type === OcgMessageType.SELECT_IDLECMD && message.player === 1 && message.summons.length > 0) {
      return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SUMMON, index: 0 };
    }
    return null;
  };
  return runScenario("invocacao-fraca-oponente", code, { place, decks: [deck(), deck()] }, drive);
}

/**
 * O DONO da carta em teste (jogador 0) Invoca por Invocação-Normal, não o
 * oponente — para cartas como Pineapple Blast, que reagem à SUA PRÓPRIA
 * invocação. O jogador 0 fica com menos monstros que o oponente de
 * propósito: a condição real também exige "o oponente controla mais
 * monstros que você".
 */
function scenarioSummonNormalOwn(code) {
  const place = [
    ...player0Extras(),
    underTest(code),
    { player: 0, zone: Zone.HAND, code: FILLER.ox },
    { player: 1, zone: Zone.MZONE, code: FILLER.fang, sequence: 3, position: OcgPosition.FACEUP_ATTACK },
    { player: 1, zone: Zone.MZONE, code: FILLER.mammoth, sequence: 4, position: OcgPosition.FACEUP_DEFENSE },
    ...player1Extras(),
  ];
  const drive = (message) => {
    if (message.type === OcgMessageType.SELECT_IDLECMD && message.player === 0 && message.summons.length > 0) {
      return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SUMMON, index: 0 };
    }
    return null;
  };
  return runScenario("invocacao-normal-propria", code, { place, decks: [deck(), deck()] }, drive);
}

/**
 * O oponente ativa uma Armadilha Normal já baixada (Reckless Greed) durante
 * a PRÓPRIA Battle Phase, não no Main Phase — Trap Jammer exige
 * especificamente isso (`Duel.IsBattlePhase()`). Passa direto pelo Main
 * Phase 1 (sem ativar nada) para garantir que a ativação aconteça depois de
 * `to_bp`, dentro de `SELECT_BATTLECMD.chains`.
 */
function scenarioActivateTrapDuringBattle(code) {
  const place = [
    ...baseBoard(),
    underTest(code),
    { player: 1, zone: Zone.SZONE, code: BAIT.recklessGreed, position: OcgPosition.FACEDOWN, sequence: 0 },
  ];
  const drive = (message) => {
    if (message.type === OcgMessageType.SELECT_IDLECMD && message.player === 1 && message.to_bp) {
      return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_BP, index: null };
    }
    if (message.type === OcgMessageType.SELECT_BATTLECMD && message.player === 1) {
      const index = message.chains.findIndex((c) => c.code === BAIT.recklessGreed);
      if (index >= 0) return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_CHAIN, index };
      if (message.attacks.length > 0) {
        return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index: 0 };
      }
    }
    return null;
  };
  return runScenario("armadilha-ativada-na-battle-phase-oponente", code, { place, decks: [deck(), deck()] }, drive);
}

// ---------------------------------------------------------------------------
// Cenários especiais — cartas que só entram em campo pelo efeito de outra.
// ---------------------------------------------------------------------------

/**
 * Placar mínimo para os combos de vários turnos abaixo (Destiny Board, cadeia
 * de Sarcófagos) — de propósito SEM `player0Extras()`.
 *
 * Motivo, achado por tentativa e erro: esses combos precisam de até ~9 turnos
 * para completar, e o limite de 6 cartas na mão é fiscalizado a cada End
 * Phase DO JOGADOR 0. `player0Extras()` deixa 5 cartas extras na mão — some
 * com as 4 "Spirit Message" (ou as 2 Sarcófago) esperando para ser buscadas e
 * passa do limite, e o piloto automático descarta o excesso sem saber que
 * está jogando fora peças do combo que ainda não tiveram vez. Com a mão
 * enxuta aqui, nada além do necessário disputa espaço.
 */
function comboBoard() {
  return [
    { player: 0, zone: Zone.MZONE, code: FILLER.elf, sequence: 3, position: OcgPosition.FACEUP_ATTACK },
    { player: 0, zone: Zone.MZONE, code: FILLER.ox, sequence: 4, position: OcgPosition.FACEUP_ATTACK },
    { player: 0, zone: Zone.GRAVE, code: FILLER.imp },
    { player: 0, zone: Zone.GRAVE, code: FILLER.mammoth },
    { player: 1, zone: Zone.MZONE, code: FILLER.fang, sequence: 3, position: OcgPosition.FACEUP_ATTACK },
    { player: 1, zone: Zone.MZONE, code: FILLER.mammoth, sequence: 4, position: OcgPosition.FACEUP_DEFENSE },
    { player: 1, zone: Zone.GRAVE, code: FILLER.elf },
  ];
}

/**
 * Destiny Board coloca uma "Spirit Message" por End Phase do OPONENTE
 * (`Duel.IsTurnPlayer(1-tp)`), buscando o código exato na mão/Deck — por isso
 * as quatro entram na mão do jogador 0 de uma vez, e Destiny Board começa já
 * ativo (face para cima, sem precisar "ativar" — plantado assim é legal:
 * `duelNewCard` não passa pela checagem de ativação). Precisa de pelo menos 4
 * End Phases do jogador 1, ou seja, ~8 turnos — dois baralhos de 20 sobram.
 */
async function scenarioDestinyBoard() {
  const place = [
    ...comboBoard(),
    { player: 0, zone: Zone.SZONE, code: DESTINY_BOARD, position: OcgPosition.FACEUP, sequence: 0 },
    ...SPIRIT_MESSAGES.map((code) => ({ player: 0, zone: Zone.HAND, code })),
  ];
  let duel;
  try {
    duel = await createDuel({ place, decks: [deck(20), deck(20)] });
  } catch (error) {
    return { scenario: "destiny-board", verdict: "CRASH", detail: String(error?.message ?? error) };
  }
  const outcome = duel.run();
  const placed = [
    ...new Set(
      duel.of(OcgMessageType.MOVE)
        .filter((m) => SPIRIT_MESSAGES.includes(m.card) && m.to.location === OcgLocation.SZONE)
        .map((m) => m.card),
    ),
  ];
  const win = duel.of(OcgMessageType.WIN)[0] ?? null;
  const luaErrors = duel.errors.filter(isRealError);
  const result = {
    scenario: "destiny-board",
    verdict: luaErrors.length
      ? "LUA_ERROR"
      : outcome === "STUCK"
        ? "STUCK"
        : win?.player === 0 && placed.length === 4
          ? "ACTIVATED"
          : "NOT_OFFERED",
    outcome,
    placedCodes: placed,
    winner: win?.player ?? null,
    winReason: win?.reason ?? null,
    errors: luaErrors,
    unanswered: [...new Set(duel.unanswered)].map(messageName),
  };
  duel.destroy();
  return result;
}
let destinyBoardCache = null;
const scenarioDestinyBoardCached = () => (destinyBoardCache ??= scenarioDestinyBoard());

/**
 * The First Sarcophagus baixa a Segunda e a Terceira Sarcófago, uma por End
 * Phase do oponente, em campo — mesmo mecanismo do Destiny Board, sem
 * checagem de vitória no final (esse combo monta "Spirit of the Pharaoh",
 * irrelevante para avaliar as duas cartas em teste).
 */
async function scenarioSarcophagus() {
  const place = [
    ...comboBoard(),
    { player: 0, zone: Zone.SZONE, code: FIRST_SARCOPHAGUS, position: OcgPosition.FACEUP, sequence: 0 },
    ...SARCOPHAGUS_CHAIN.map((code) => ({ player: 0, zone: Zone.HAND, code })),
  ];
  let duel;
  try {
    duel = await createDuel({ place, decks: [deck(16), deck(16)] });
  } catch (error) {
    return { scenario: "sarcofagos-em-cadeia", verdict: "CRASH", detail: String(error?.message ?? error) };
  }
  const outcome = duel.run();
  const placed = [
    ...new Set(
      duel.of(OcgMessageType.MOVE)
        .filter((m) => SARCOPHAGUS_CHAIN.includes(m.card) && m.to.location === OcgLocation.SZONE)
        .map((m) => m.card),
    ),
  ];
  const luaErrors = duel.errors.filter(isRealError);
  const result = {
    scenario: "sarcofagos-em-cadeia",
    verdict: luaErrors.length
      ? "LUA_ERROR"
      : outcome === "STUCK"
        ? "STUCK"
        : placed.length === SARCOPHAGUS_CHAIN.length
          ? "ACTIVATED"
          : "NOT_OFFERED",
    outcome,
    placedCodes: placed,
    errors: luaErrors,
    unanswered: [...new Set(duel.unanswered)].map(messageName),
  };
  duel.destroy();
  return result;
}
let sarcophagusCache = null;
const scenarioSarcophagusCached = () => (sarcophagusCache ??= scenarioSarcophagus());

/**
 * Exodia Necross não pode ser Invocado por Invocação-Normal nem baixado —
 * só entra com Contrato com Exodia (Magia, ativação incondicional exceto
 * pelas 5 peças de Exodia no Cemitério, que este cenário planta) tendo uma
 * cópia na mão. Roda do lado do jogador 0 — não depende do oponente.
 */
async function scenarioExodiaNecross() {
  const place = [
    ...baseBoard(),
    ...EXODIA_PIECES.map((code) => ({ player: 0, zone: Zone.GRAVE, code })),
    { player: 0, zone: Zone.HAND, code: CONTRACT_WITH_EXODIA },
    { player: 0, zone: Zone.HAND, code: EXODIA_NECROSS },
  ];
  let duel;
  try {
    duel = await createDuel({ place, decks: [deck(), deck()] });
  } catch (error) {
    return { scenario: "contrato-com-exodia", verdict: "CRASH", detail: String(error?.message ?? error) };
  }
  const drive = (message) => {
    if (message.type === OcgMessageType.SELECT_IDLECMD && message.player === 0) {
      const index = message.activates.findIndex((c) => c.code === CONTRACT_WITH_EXODIA);
      if (index >= 0) return IDLE_ACTIVATE(index);
    }
    return null;
  };
  const outcome = duel.run(drive);
  const summoned =
    [...duel.of(OcgMessageType.SUMMONING), ...duel.of(OcgMessageType.SPSUMMONING)].some((m) => m.code === EXODIA_NECROSS) ||
    duel.of(OcgMessageType.MOVE).some((m) => m.card === EXODIA_NECROSS && m.to.location === OcgLocation.MZONE);
  const luaErrors = duel.errors.filter(isRealError);
  const result = {
    scenario: "contrato-com-exodia",
    verdict: luaErrors.length ? "LUA_ERROR" : outcome === "STUCK" ? "STUCK" : summoned ? "ACTIVATED" : "NOT_OFFERED",
    outcome,
    errors: luaErrors,
    unanswered: [...new Set(duel.unanswered)].map(messageName),
  };
  duel.destroy();
  return result;
}

// ---------------------------------------------------------------------------
// Cenários sob medida — cada um resolve exatamente UMA carta que sobrou
// depois dos genéricos e dos compartilhados, porque o Lua pede um ingrediente
// bem específico (uma carta nomeada, um tipo de monstro, uma contagem de
// cemitério) que não compensa generalizar. Só rodam contra a carta para a
// qual foram desenhados — não entram na bateria genérica de todo o pool.
// ---------------------------------------------------------------------------

/** Roda `comboBoard()` + `underTest(code)` + placements extras; `drive`
 * opcional dirige uma ação além de simplesmente ativar em Main Phase 1. */
function scenarioCustom(name, code, extra, drive) {
  const place = [...comboBoard(), underTest(code), ...extra];
  return runScenario(name, code, { place, decks: [deck(), deck()] }, drive ?? null);
}

/** O oponente ativa uma Magia Normal específica (não a isca genérica) —
 * Anti Raigeki, Gryphon Wing e White Hole só reagem ao NOME exato. */
function scenarioCustomActivateNamed(name, code, namedCard, extra = []) {
  const place = [...comboBoard(), underTest(code), { player: 1, zone: Zone.HAND, code: namedCard }, ...extra];
  const drive = (message) => {
    if (message.type === OcgMessageType.SELECT_IDLECMD && message.player === 1) {
      const index = message.activates.findIndex((c) => c.code === namedCard);
      if (index >= 0) return IDLE_ACTIVATE(index);
    }
    return null;
  };
  return runScenario(name, code, { place, decks: [deck(), deck()] }, drive);
}

/** Cross Counter / Destruction Punch: seu bloqueador em DEFESA, com DEF maior
 * que o ATK de quem ataca — o oposto do cenário de ataque genérico, que
 * sempre deixa os monstros do jogador 0 em ATAQUE. */
function scenarioDefenseBlocker(code) {
  const extra = [
    { player: 0, zone: Zone.MZONE, code: FILLER.elf, sequence: 0, position: OcgPosition.FACEUP_DEFENSE }, // 800/2000
  ];
  const drive = (message) => {
    if (message.type === OcgMessageType.SELECT_IDLECMD && message.player === 1 && message.to_bp) {
      return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_BP, index: null };
    }
    if (message.type === OcgMessageType.SELECT_BATTLECMD && message.player === 1 && message.attacks.length > 0) {
      return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index: 0 };
    }
    return null;
  };
  return scenarioCustom("bloqueador-em-defesa", code, extra, drive);
}

/** Bark of Dark Ruler: precisa de um monstro TREVAS/Fiend envolvido na
 * batalha — troca o bloqueador padrão do jogador 0 por Feral Imp. */
function scenarioFiendBattle(code) {
  const extra = [{ player: 0, zone: Zone.MZONE, code: FILLER.imp, sequence: 0, position: OcgPosition.FACEUP_ATTACK }];
  const drive = (message) => {
    if (message.type === OcgMessageType.SELECT_IDLECMD && message.player === 1 && message.to_bp) {
      return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_BP, index: null };
    }
    if (message.type === OcgMessageType.SELECT_BATTLECMD && message.player === 1 && message.attacks.length > 0) {
      return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index: 0 };
    }
    return null;
  };
  return scenarioCustom("fiend-na-batalha", code, extra, drive);
}

/** Dark Scorpion Combination: exige as 5 Dark Scorpion nomeadas ao mesmo
 * tempo — usa as 5 zonas de monstro inteiras, sem o `comboBoard()` padrão. */
function scenarioDarkScorpion(code) {
  const DARK_SCORPIONS = [76922029, 6967870, 61587183, 48768179, 74153887];
  const place = [
    ...DARK_SCORPIONS.map((c, i) => ({ player: 0, zone: Zone.MZONE, code: c, sequence: i, position: OcgPosition.FACEUP_ATTACK })),
    { player: 0, zone: Zone.GRAVE, code: FILLER.imp },
    underTest(code),
    { player: 1, zone: Zone.MZONE, code: FILLER.fang, sequence: 3, position: OcgPosition.FACEUP_ATTACK },
  ];
  return runScenario("dark-scorpion-completo", code, { place, decks: [deck(), deck()] }, null);
}

/** Gamble: mão do jogador 0 pequena, mão do oponente grande. */
function scenarioHandShapeGamble(code) {
  const place = [
    { player: 0, zone: Zone.MZONE, code: FILLER.elf, sequence: 3, position: OcgPosition.FACEUP_ATTACK },
    underTest(code),
    { player: 1, zone: Zone.MZONE, code: FILLER.fang, sequence: 3, position: OcgPosition.FACEUP_ATTACK },
    ...Array.from({ length: 7 }, () => ({ player: 1, zone: Zone.HAND, code: FILLER.ox })),
  ];
  return runScenario("mao-desigual", code, { place, decks: [deck(), deck()] }, null);
}

/**
 * Heavy Slump: `Duel.GetFieldGroupCount(tp,0,LOCATION_HAND)>7` — verificado
 * na prática (não só lendo o Lua): apesar de `tp` ser convencionalmente "quem
 * controla a carta", `GetFieldGroupCount(player, flagA, flagB)` soma `flagA`
 * do lado de `player` com `flagB` do lado do OPONENTE — com `flagA=0`, só a
 * mão do OPONENTE conta. Testado com as duas leituras antes de decidir: só a
 * do oponente grande oferece a carta.
 */
function scenarioBigOpponentHand(code) {
  const place = [
    { player: 0, zone: Zone.MZONE, code: FILLER.elf, sequence: 3, position: OcgPosition.FACEUP_ATTACK },
    underTest(code),
    { player: 1, zone: Zone.MZONE, code: FILLER.fang, sequence: 3, position: OcgPosition.FACEUP_ATTACK },
    ...Array.from({ length: 8 }, () => ({ player: 1, zone: Zone.HAND, code: FILLER.ox })),
  ];
  return runScenario("mao-grande-oponente", code, { place, decks: [deck(), deck()] }, null);
}

/**
 * Amazoness Archers: reage a `EVENT_ATTACK_ANNOUNCE` do OPONENTE — igual ao
 * cenário de ataque genérico, só que com uma Amazoness de verdade no campo
 * do jogador 0 (a condição exige `IsSetCard(SET_AMAZONESS)` face para cima).
 */
function scenarioAmazonessAttack(code) {
  const place = [
    ...baseBoard(),
    underTest(code),
    { player: 0, zone: Zone.MZONE, code: 91869203, sequence: 0, position: OcgPosition.FACEUP_ATTACK }, // Amazoness Archer
  ];
  const drive = (message) => {
    if (message.type === OcgMessageType.SELECT_IDLECMD && message.player === 1 && message.to_bp) {
      return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_BP, index: null };
    }
    if (message.type === OcgMessageType.SELECT_BATTLECMD && message.player === 1 && message.attacks.length > 0) {
      return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index: 0 };
    }
    return null;
  };
  return runScenario("amazoness-sob-ataque", code, { place, decks: [deck(), deck()] }, drive);
}

/**
 * Dramatic Rescue: precisa que um monstro Amazoness SEU seja alvo de um
 * efeito do oponente — Change of Heart (rouba 1 monstro, alvo único) serve
 * de isca porque mira exatamente isso.
 */
function scenarioAmazonessTargeted(code) {
  const CHANGE_OF_HEART = 4031928;
  const AMAZONESS_ARCHER = 91869203;
  const place = [
    ...comboBoard(),
    underTest(code),
    { player: 0, zone: Zone.MZONE, code: AMAZONESS_ARCHER, sequence: 0, position: OcgPosition.FACEUP_ATTACK },
    { player: 1, zone: Zone.HAND, code: CHANGE_OF_HEART },
  ];
  const drive = (message) => {
    if (message.type === OcgMessageType.SELECT_IDLECMD && message.player === 1) {
      const index = message.activates.findIndex((c) => c.code === CHANGE_OF_HEART);
      if (index >= 0) return IDLE_ACTIVATE(index);
    }
    if (message.type === OcgMessageType.SELECT_CARD && message.player === 1) {
      const index = message.selects.findIndex((c) => c.code === AMAZONESS_ARCHER);
      if (index >= 0) return { type: OcgResponseType.SELECT_CARD, indicies: [index] };
    }
    return null;
  };
  return runScenario("amazoness-alvo-de-efeito", code, { place, decks: [deck(), deck()] }, drive);
}

/** Tutan Mask: uma Magia de Equipamento (Axe of Despair) mirando um monstro
 * Zumbi — variante do cenário de equipamento genérico com o alvo trocado. */
function scenarioEquipTargetsZombie(code) {
  const ZOMBIE = 92667214; // Clown Zombie
  const place = [
    { player: 0, zone: Zone.MZONE, code: FILLER.elf, sequence: 3, position: OcgPosition.FACEUP_ATTACK },
    underTest(code),
    // Só o Zumbi na Zona de Monstro do oponente: Axe of Despair não tem outro
    // alvo possível, então não precisa forçar a escolha.
    { player: 1, zone: Zone.MZONE, code: ZOMBIE, sequence: 0, position: OcgPosition.FACEUP_ATTACK },
    { player: 1, zone: Zone.HAND, code: BAIT.equipSpell },
  ];
  const drive = (message) => {
    if (message.type === OcgMessageType.SELECT_IDLECMD && message.player === 1) {
      const index = message.activates.findIndex((c) => c.code === BAIT.equipSpell);
      if (index >= 0) return IDLE_ACTIVATE(index);
    }
    return null;
  };
  return runScenario("equipamento-mira-zumbi", code, { place, decks: [deck(), deck()] }, drive);
}

/** Formation Union: Freezing Beast (Union) + Burning Beast (o parceiro que
 * ela equipa) os dois em campo, do lado do jogador 0. */
function scenarioUnionPair(code) {
  const FREEZING_BEAST = 85359414;
  const BURNING_BEAST = 59364406;
  const extra = [
    { player: 0, zone: Zone.MZONE, code: FREEZING_BEAST, sequence: 0, position: OcgPosition.FACEUP_ATTACK },
    { player: 0, zone: Zone.MZONE, code: BURNING_BEAST, sequence: 1, position: OcgPosition.FACEUP_ATTACK },
  ];
  return scenarioCustom("dupla-union", code, extra, null);
}

/** Elemental Burst / Fuh-Rin-Ka-Zan: um monstro de cada atributo elemental
 * (VENTO/ÁGUA/FOGO/TERRA) ao mesmo tempo no campo do jogador 0. */
function scenarioFourElements(code) {
  const WIND = 88819587; // Baby Dragon (VENTO — na real, checar; usado só como presença)
  const WATER = 23771716; // 7 Colored Fish
  const FIRE = 48202661; // Aitsu
  const EARTH = FILLER.ox; // Battle Ox
  const extra = [
    { player: 0, zone: Zone.MZONE, code: WATER, sequence: 0, position: OcgPosition.FACEUP_ATTACK },
    { player: 0, zone: Zone.MZONE, code: FIRE, sequence: 1, position: OcgPosition.FACEUP_ATTACK },
    { player: 0, zone: Zone.MZONE, code: EARTH, sequence: 2, position: OcgPosition.FACEUP_ATTACK },
  ];
  // O próprio `comboBoard()` já bota Battle Ox (TERRA) e Mystical Elf (LUZ) —
  // troca por um de VENTO de verdade no lugar do Elf via sequência dedicada.
  const place = [
    { player: 0, zone: Zone.MZONE, code: WIND, sequence: 3, position: OcgPosition.FACEUP_ATTACK },
    { player: 0, zone: Zone.GRAVE, code: FILLER.imp },
    { player: 0, zone: Zone.GRAVE, code: FILLER.mammoth },
    underTest(code),
    ...extra,
    { player: 1, zone: Zone.MZONE, code: FILLER.fang, sequence: 3, position: OcgPosition.FACEUP_ATTACK },
    { player: 1, zone: Zone.MZONE, code: FILLER.mammoth, sequence: 4, position: OcgPosition.FACEUP_DEFENSE },
  ];
  return runScenario("quatro-elementos", code, { place, decks: [deck(), deck()] }, null);
}

/**
 * Blast Held by a Tribute: o atacante precisa ter sido Invocado por
 * Invocação-Normal COM tributo — dá a Summoned Skull (nível 6) na mão do
 * oponente e uma baunilha já em campo para tributar, e deixa a política
 * invocar (o core pede o tributo sozinho, resolvido pelo autopilot padrão)
 * antes de atacar.
 */
function scenarioTributeSummonAttack(code) {
  const SKULL = BAIT.bigAttacker;
  const place = [
    ...comboBoard(),
    underTest(code),
    { player: 1, zone: Zone.MZONE, code: FILLER.mammoth, sequence: 0, position: OcgPosition.FACEUP_ATTACK },
    { player: 1, zone: Zone.HAND, code: SKULL },
  ];
  let summoned = false;
  const drive = (message) => {
    if (message.type === OcgMessageType.SELECT_IDLECMD && message.player === 1) {
      if (!summoned && message.summons.some((c) => c.code === SKULL)) {
        summoned = true;
        return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SUMMON, index: message.summons.findIndex((c) => c.code === SKULL) };
      }
      if (message.to_bp) return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_BP, index: null };
    }
    if (message.type === OcgMessageType.SELECT_BATTLECMD && message.player === 1) {
      const index = message.attacks.findIndex((a) => a.code === SKULL);
      if (index >= 0) return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index };
    }
    return null;
  };
  return runScenario("invocacao-com-tributo-e-ataque", code, { place, decks: [deck(), deck()] }, drive);
}

/**
 * Divine Wrath: precisa negar o efeito ATIVADO de um MONSTRO — Exiled Force
 * (efeito de ignição: tributa a si mesma para destruir 1 monstro) já em
 * campo do oponente, e uma carta na mão do jogador 0 para pagar o custo de
 * descarte.
 */
function scenarioNegateMonsterEffect(code) {
  const EXILED_FORCE = 74131780;
  const place = [
    ...comboBoard(),
    underTest(code),
    { player: 0, zone: Zone.HAND, code: FILLER.fang },
    { player: 1, zone: Zone.MZONE, code: EXILED_FORCE, sequence: 0, position: OcgPosition.FACEUP_ATTACK },
  ];
  const drive = (message) => {
    if (message.type === OcgMessageType.SELECT_IDLECMD && message.player === 1) {
      const index = message.activates.findIndex((c) => c.code === EXILED_FORCE);
      if (index >= 0) return IDLE_ACTIVATE(index);
    }
    return null;
  };
  return runScenario("nega-efeito-de-monstro", code, { place, decks: [deck(), deck()] }, drive);
}

/**
 * Forced Requisition: reage a uma carta seguinte descartada da SUA PRÓPRIA
 * mão (`IsPreviousControler(tp)`) — mão do jogador 0 acima do limite de 6, o
 * próprio limite de mão descarta sozinho no End Phase.
 */
function scenarioOwnHandLimitDiscard(code) {
  const place = [
    { player: 0, zone: Zone.MZONE, code: FILLER.elf, sequence: 3, position: OcgPosition.FACEUP_ATTACK },
    underTest(code),
    ...Array.from({ length: 8 }, () => ({ player: 0, zone: Zone.HAND, code: FILLER.ox })),
    { player: 1, zone: Zone.MZONE, code: FILLER.fang, sequence: 3, position: OcgPosition.FACEUP_ATTACK },
  ];
  return runScenario("descarte-por-limite-de-mao-propria", code, { place, decks: [deck(), deck()] }, null);
}

/**
 * Hero Signal: monstro seu destruído em batalha (o mesmo mecanismo que
 * funciona para Michizure) + um Elemental HERO nível <=4 na sua mão.
 */
function scenarioHeroSignal(code) {
  const SPARKMAN = 20721928; // Elemental HERO Sparkman, nível 4
  const place = [
    ...player0Extras(),
    { player: 0, zone: Zone.MZONE, code: FILLER.elf, sequence: 0, position: OcgPosition.FACEUP_ATTACK }, // 800 ATK — morre fácil
    { player: 0, zone: Zone.HAND, code: SPARKMAN },
    underTest(code),
    { player: 1, zone: Zone.MZONE, code: BAIT.bigAttacker, sequence: 0, position: OcgPosition.FACEUP_ATTACK },
  ];
  const drive = (message) => {
    if (message.type === OcgMessageType.SELECT_IDLECMD && message.player === 1 && message.to_bp) {
      return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_BP, index: null };
    }
    if (message.type === OcgMessageType.SELECT_BATTLECMD && message.player === 1 && message.attacks.length > 0) {
      return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index: 0 };
    }
    return null;
  };
  return runScenario("heroi-apos-destruicao-em-batalha", code, { place, decks: [deck(), deck()] }, drive);
}

/**
 * Major Riot: um monstro seu devolvido à mão pelo EFEITO DO OPONENTE —
 * Compulsory Evacuation Device (Armadilha real, alvo único, sem custo) já
 * baixada do lado do oponente, mirando o único monstro do jogador 0.
 */
function scenarioBounceByOpponent(code) {
  const COMPULSORY = 94192409;
  // Achado por tentativa e erro (mesmo sintoma do par de iscas em
  // `scenarioDestroysOtherBackrow`): com o campo grande, PODE FICAR só
  // Compulsory Evacuation Device do lado do oponente que o efeito nunca
  // chega a ser oferecido a Major Riot, mesmo com Compulsory de fato
  // devolvendo o Elf à mão. Companheiros extras (sem função no efeito em si)
  // resolvem — não sei dizer por quê, só que resolve.
  const place = [
    { player: 0, zone: Zone.MZONE, code: FILLER.elf, sequence: 0, position: OcgPosition.FACEUP_ATTACK },
    underTest(code),
    { player: 1, zone: Zone.SZONE, code: COMPULSORY, position: OcgPosition.FACEDOWN, sequence: 0 },
    { player: 1, zone: Zone.MZONE, code: FILLER.fang, sequence: 3, position: OcgPosition.FACEUP_ATTACK },
    { player: 1, zone: Zone.MZONE, code: FILLER.mammoth, sequence: 4, position: OcgPosition.FACEUP_DEFENSE },
  ];
  const drive = (message) => {
    if (message.type === OcgMessageType.SELECT_IDLECMD && message.player === 1) {
      const index = message.activates.findIndex((c) => c.code === COMPULSORY);
      if (index >= 0) return IDLE_ACTIVATE(index);
    }
    if (message.type === OcgMessageType.SELECT_CARD && message.player === 1) {
      const index = message.selects.findIndex((c) => c.code === FILLER.elf);
      if (index >= 0) return { type: OcgResponseType.SELECT_CARD, indicies: [index] };
    }
    return null;
  };
  return runScenario("devolvido-a-mao-pelo-oponente", code, { place, decks: [deck(), deck()] }, drive);
}

/** Ninjitsu Art of Transformation: precisa tributar um monstro Ninja — a
 * política escolhe o Ninja quando `SELECT_TRIBUTE`/`SELECT_CARD` pedir. */
function scenarioNinjaTribute(code) {
  const NINJA = 1571945; // White Ninja
  const extra = [{ player: 0, zone: Zone.MZONE, code: NINJA, sequence: 0, position: OcgPosition.FACEUP_ATTACK }];
  const drive = (message) => {
    if (message.type === OcgMessageType.SELECT_TRIBUTE) {
      const index = message.selects.findIndex((c) => c.code === NINJA);
      if (index >= 0) return { type: OcgResponseType.SELECT_TRIBUTE, indicies: [index] };
    }
    if (message.type === OcgMessageType.SELECT_CARD) {
      const index = message.selects.findIndex((c) => c.code === NINJA);
      if (index >= 0) return { type: OcgResponseType.SELECT_CARD, indicies: [index] };
    }
    return null;
  };
  return scenarioCustom("tributa-ninja", code, extra, drive);
}

/**
 * Tabela dos casos "só planta a carta nomeada certa" — sem `drive` especial,
 * a própria ativação da carta em teste em Main Phase 1 já é o suficiente.
 */
const CUSTOM_PLACEMENT_CASES = [
  { id: 56246017, extra: [{ player: 0, zone: Zone.GRAVE, code: 35798491 }] }, // Archfiend's Roar <- Darkbishop Archfiend na GY
  { id: 94463200, extra: [{ player: 0, zone: Zone.MZONE, code: 35798491, sequence: 0, position: OcgPosition.FACEUP_ATTACK }] }, // Battle-Scarred <- Darkbishop Archfiend em campo
  { id: 80163754, extra: [{ player: 0, zone: Zone.MZONE, code: 88819587, sequence: 0, position: OcgPosition.FACEUP_ATTACK }] }, // Burst Breath <- Baby Dragon
  { id: 8628798, extra: [{ player: 1, zone: Zone.REMOVED, code: FILLER.ox }] }, // D.D. Dynamite <- banido do oponente
  { id: 35027493, extra: [{ player: 0, zone: Zone.MZONE, code: 11761845, sequence: 0, position: OcgPosition.FACEUP_ATTACK }] }, // Deck Devastation Virus <- Beast of Talwar (TREVAS 2400)
  { id: 65396880, extra: [12143771, 58538870, 85936485].map((c, i) => ({ player: 0, zone: Zone.MZONE, code: c, sequence: i, position: OcgPosition.FACEUP_ATTACK })) }, // Huge Revolution
  { id: 44595286, extra: [{ player: 1, zone: Zone.HAND, code: 56433456 }], activateNamed: 56433456 }, // Light of Judgment <- oponente ativa Sanctuary in the Sky
  { id: 82452993, custom: true, place: [
    { player: 0, zone: Zone.MZONE, code: 49814180, sequence: 0, position: OcgPosition.FACEUP_ATTACK }, // só Master Monk em campo
  ] }, // Lone Wolf
  { id: 85519211, extra: [{ player: 0, zone: Zone.MZONE, code: 76321376, sequence: 0, position: OcgPosition.FACEUP_ATTACK }] }, // Minefield Eruption <- Mine Golem
  { id: 89628781, extra: [{ player: 0, zone: Zone.MZONE, code: 1571945, sequence: 0, position: OcgPosition.FACEUP_ATTACK }] }, // Ninjitsu Art of Decoy <- White Ninja
  { id: 39019325, extra: [
    { player: 0, zone: Zone.MZONE, code: 59983499, sequence: 0, position: OcgPosition.FACEUP_ATTACK }, // Dancing Elf (nível 1, para tributar)
    { player: 1, zone: Zone.SZONE, code: BAIT.recklessGreed, position: OcgPosition.FACEDOWN, sequence: 0 }, // Magia/Armadilha do OPONENTE para destruir — o filtro só olha o campo dele
  ] }, // Order to Smash
  { id: 12503902, extra: [{ player: 0, zone: Zone.MZONE, code: 30655537, sequence: 0, position: OcgPosition.FACEUP_ATTACK }] }, // Rare Metalmorph <- Cyber Falcon (Máquina)
  { id: 27174286, extra: [{ player: 0, zone: Zone.REMOVED, code: FILLER.ox }] }, // Return from the Different Dimension <- banido próprio
  { id: 30450531, extra: [{ player: 0, zone: Zone.GRAVE, code: 62473983 }] }, // Rite of Spirit <- Gravekeeper's Chief na GY
  { id: 20781762, deckExtra: [76321376] }, // Rock Bombardment <- Mine Golem (Rocha) no Deck
  { id: 71983925, extra: [{ player: 0, zone: Zone.MZONE, code: 2468169, sequence: 0, position: OcgPosition.FACEUP_ATTACK }] }, // Talisman of Spell Sealing <- Sealmaster Meisei
  { id: 21466326, extra: Array.from({ length: 30 }, () => ({ player: 0, zone: Zone.GRAVE, code: FILLER.ox })) }, // Blasting the Ruins <- 30+ na GY
  { id: 16255442, extra: [
    { player: 0, zone: Zone.GRAVE, code: FILLER.light }, { player: 0, zone: Zone.GRAVE, code: FILLER.elf },
  ], leanHand: true }, // Beckoning Light <- LUZ na GY >= mão (mão enxuta)
  { id: 42364257, activateNamed: 12580477 }, // Anti Raigeki <- oponente ativa Raigeki
  { id: 55608151, activateNamed: 18144507 }, // Gryphon Wing <- oponente ativa Harpie's Feather Duster
  { id: 43487744, activateNamed: 53129443 }, // White Hole <- oponente ativa Dark Hole
];

function scenarioCustomPlacementCase(entry) {
  if (entry.custom) {
    return runScenario("sob-medida", entry.id, { place: [...entry.place, underTest(entry.id)], decks: [deck(), deck()] }, null);
  }
  if (entry.activateNamed) {
    return scenarioCustomActivateNamed("ativa-carta-nomeada-oponente", entry.id, entry.activateNamed, entry.extra ?? []);
  }
  const base = entry.leanHand
    ? [
        { player: 0, zone: Zone.MZONE, code: FILLER.elf, sequence: 3, position: OcgPosition.FACEUP_ATTACK },
        { player: 1, zone: Zone.MZONE, code: FILLER.fang, sequence: 3, position: OcgPosition.FACEUP_ATTACK },
      ]
    : comboBoard();
  const place = [...base, underTest(entry.id), ...(entry.extra ?? [])];
  const decks = [
    entry.deckExtra ? [...entry.deckExtra, ...deck(10)] : deck(),
    deck(),
  ];
  return runScenario("sob-medida", entry.id, { place, decks }, null);
}

/** As poucas cartas com cenário sob medida dedicado (não tabular). */
const BESPOKE_CUSTOM = new Map([
  [37083210, scenarioDefenseBlocker], // Cross Counter
  [5616412, scenarioDefenseBlocker], // Destruction Punch
  [41925941, scenarioFiendBattle], // Bark of Dark Ruler
  [20858318, scenarioDarkScorpion], // Dark Scorpion Combination
  [37313786, scenarioHandShapeGamble], // Gamble
  [52417194, scenarioBigOpponentHand], // Heavy Slump
  [70861343, scenarioNinjaTribute], // Ninjitsu Art of Transformation
  [67987611, scenarioAmazonessAttack], // Amazoness Archers
  [80193355, scenarioAmazonessTargeted], // Dramatic Rescue
  [3149764, scenarioEquipTargetsZombie], // Tutan Mask
  [26931058, scenarioUnionPair], // Formation Union
  [61411502, scenarioFourElements], // Elemental Burst
  [1781310, scenarioFourElements], // Fuh-Rin-Ka-Zan
  [89041555, scenarioTributeSummonAttack], // Blast Held by a Tribute
  [49010598, scenarioNegateMonsterEffect], // Divine Wrath
  [74923978, scenarioOwnHandLimitDiscard], // Forced Requisition
  [22020907, scenarioHeroSignal], // Hero Signal
  [9074847, scenarioBounceByOpponent], // Major Riot
]);

/** Roda o(s) cenário(s) sob medida da carta, se houver algum. */
async function customResultsFor(id) {
  const results = [];
  const bespoke = BESPOKE_CUSTOM.get(id);
  if (bespoke) results.push(await bespoke(id));
  const tableEntry = CUSTOM_PLACEMENT_CASES.find((e) => e.id === id);
  if (tableEntry) results.push(await scenarioCustomPlacementCase(tableEntry));
  return results;
}

// ---------------------------------------------------------------------------

async function testCard(card) {
  if (card.id === EXODIA_NECROSS) {
    return { id: card.id, name: card.name, type: card.type, results: [await scenarioExodiaNecross()] };
  }
  if (SPIRIT_MESSAGES.includes(card.id)) {
    return { id: card.id, name: card.name, type: card.type, results: [await scenarioDestinyBoardCached()] };
  }
  if (SARCOPHAGUS_CHAIN.includes(card.id)) {
    return { id: card.id, name: card.name, type: card.type, results: [await scenarioSarcophagusCached()] };
  }

  const results = [
    await scenarioAttack(card.id, 1),
    await scenarioAttack(card.id, 0),
    await scenarioDirectDamage(card.id),
    await scenarioSummonNormal(card.id),
    await scenarioMonsterSet(card.id),
    await scenarioSummonFlip(card.id),
    await scenarioSummonSpecial(card.id),
    await scenarioSummonFusion(card.id),
    await scenarioSummonToken(card.id),
    await scenarioActivateSpell(card.id),
    await scenarioActivateTrap(card.id),
    await scenarioPhases(card.id),
    await scenarioDestroysOtherBackrow(card.id, BAIT.recklessGreed),
    await scenarioDestroysOtherBackrow(card.id, BAIT.continuousSpell),
    await scenarioDestroysSelf(card.id),
    await scenarioEquipResolves(card.id),
    await scenarioContinuousTrapActivated(card.id),
    await scenarioContinuousSpellActivated(card.id),
    await scenarioFieldSpellActivated(card.id),
    await scenarioEffectDamage(card.id),
    await scenarioSummonWeak(card.id),
    await scenarioSummonNormalOwn(card.id),
    await scenarioActivateTrapDuringBattle(card.id),
    ...(await customResultsFor(card.id)),
  ];
  return { id: card.id, name: card.name, type: card.type, results };
}

/** Extrai do relatório do test-cards.mjs as cartas nunca oferecidas em nenhum cenário. */
function cardsNeverOffered(reportPath) {
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  return report
    .filter((c) => c.results.length > 0 && c.results.every((r) => r.verdict === "NOT_OFFERED" && (r.offered ?? []).length === 0))
    .map((c) => ({ id: c.id, name: c.name, type: c.type }));
}

async function main() {
  const argv = process.argv.slice(2);
  const jsonAt = argv.indexOf("--json");
  const jsonOut = jsonAt >= 0 ? argv[jsonAt + 1] : null;
  const sliceAt = argv.indexOf("--slice");
  const slice = sliceAt >= 0 ? argv[sliceAt + 1] : null;
  const reportAt = argv.indexOf("--not-offered");
  const reportPath = reportAt >= 0 ? argv[reportAt + 1] : null;
  const explicit = argv.filter((a) => /^\d+$/.test(a)).map(Number);

  const pool = loadGoatPool();
  const known = new Map(pool.map((c) => [c.id, c]));

  let cards;
  if (reportPath) {
    cards = cardsNeverOffered(reportPath);
  } else if (explicit.length) {
    cards = explicit.map((id) => known.get(id) ?? { id, name: `#${id}`, type: "?" });
  } else {
    cards = pool;
  }

  if (slice) {
    const [index, total] = slice.split("/").map(Number);
    cards = cards.filter((_, i) => i % total === index);
  }

  process.stderr.write(`testando gatilhos de ${cards.length} cartas...\n`);
  const report = [];
  for (const [index, card] of cards.entries()) {
    report.push(await testCard(card));
    if ((index + 1) % 25 === 0) process.stderr.write(`  ${index + 1}/${cards.length}\n`);
  }

  const withVerdict = report.map((r) => ({
    ...r,
    works: r.results.some((x) => x.verdict === "ACTIVATED"),
    workingScenarios: r.results.filter((x) => x.verdict === "ACTIVATED").map((x) => x.scenario),
    luaErrors: r.results.filter((x) => x.verdict === "LUA_ERROR" || x.verdict === "BINDING_ERROR" || x.verdict === "CRASH"),
    // União de todo prompt visto resolvendo a carta em QUALQUER cenário onde
    // ela ativou — a lista que importa para checar o lado do app.
    resolutionPrompts: [
      ...new Set(
        r.results.filter((x) => x.verdict === "ACTIVATED").flatMap((x) => x.resolutionPrompts ?? []),
      ),
    ],
  }));

  if (argv.includes("--verbose")) {
    process.stdout.write("\n=== detalhe ===\n");
    for (const row of withVerdict) {
      process.stdout.write(`${row.id} ${row.name}\n`);
      for (const r of row.results) {
        process.stdout.write(
          `  [${r.scenario}] ${r.verdict} outcome=${r.outcome ?? "-"} via=${r.offeredVia ?? "-"}` +
          `${r.unanswered?.length ? " travou-em=" + r.unanswered.join(",") : ""}` +
          `${r.errors?.length ? "\n    erros: " + r.errors.join("\n    erros: ") : ""}` +
          `${r.detail ? "\n    " + r.detail : ""}\n`,
        );
      }
    }
  }

  const worksCount = withVerdict.filter((r) => r.works).length;
  process.stdout.write("\n=== resumo ===\n");
  process.stdout.write(`testadas: ${withVerdict.length}\n`);
  process.stdout.write(`funcionaram em algum cenário: ${worksCount}\n`);
  process.stdout.write(`nunca ofereceram: ${withVerdict.length - worksCount}\n`);

  const byScenario = {};
  for (const row of withVerdict) for (const s of row.workingScenarios) byScenario[s] = (byScenario[s] ?? 0) + 1;
  process.stdout.write("\n--- por cenário (quantas cartas funcionaram ali) ---\n");
  for (const [scenario, count] of Object.entries(byScenario).sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`${scenario}: ${count}\n`);
  }

  const withErrors = withVerdict.filter((r) => r.luaErrors.length > 0);
  if (withErrors.length) {
    process.stdout.write(`\n--- LUA_ERROR/BINDING_ERROR/CRASH (${withErrors.length}) ---\n`);
    for (const row of withErrors) {
      for (const r of row.luaErrors) {
        process.stdout.write(`${row.id} ${row.name} [${r.scenario}] ${(r.errors ?? []).slice(0, 2).join(" | ")}${r.detail ?? ""}\n`);
      }
    }
  }

  const stillNothing = withVerdict.filter((r) => !r.works);
  process.stdout.write(`\n--- nunca ofereceram (${stillNothing.length}) ---\n`);
  for (const row of stillNothing) {
    process.stdout.write(`${row.id} ${row.name}\n`);
  }

  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify(withVerdict, null, 1));
    process.stdout.write(`\nrelatório em ${jsonOut}\n`);
  }
}

await main();
