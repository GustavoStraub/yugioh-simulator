/**
 * Exercita os prompts raros — os que um duelo comum quase nunca produz.
 *
 * O `test-ui-prompts.mjs` joga decks de verdade e cobre bem o que acontece
 * todo turno. O problema é justamente o que **não** acontece todo turno:
 * ANNOUNCE_RACE, ANNOUNCE_CARD, SELECT_SUM, SORT_CARD... são exatamente os
 * prompts que ninguém tinha implementado, porque ninguém os via. Um duelo
 * aleatório pode rodar mil turnos sem tirar um deles.
 *
 * Aqui a carta que produz cada prompt é colocada na mão de propósito, ativada,
 * e o prompt resultante passa pelo mesmo caminho da tela.
 *
 * Uso: node --import ./tools/harness/ts-loader-register.mjs tools/harness/test-ui-rare-prompts.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { OcgMessageType, OcgPosition, OcgResponseType, SelectIdleCMDAction } from "@n1xx1/ocgcore-wasm";

import { autoResponseFor } from "@/lib/duel/auto-response";
import { findPromptMessage } from "@/lib/duel/bot-responder";
import { announceCardMatches, buildPromptPlan } from "@/lib/duel/duel-actions";
import { EngineStringsDb } from "@/lib/duel/engine-strings";

import { REPO, loadCardDb, loadGoatPool } from "./env.mjs";

const cardDb = loadCardDb();
import { createDuel, STOP, Zone } from "./duel.mjs";

/**
 * Cartas escolhidas por produzirem um prompt específico.
 *
 * Os passcodes vêm do pool Goat; o prompt esperado foi levantado lendo a
 * chamada correspondente no script Lua da carta (`Duel.AnnounceRace`,
 * `Duel.SelectSum`, `Duel.SortDecktop`...).
 */
const CASOS = [
  { prompt: "ANNOUNCE_RACE", cartas: ["Tribe-Infecting Virus", "DNA Surgery", "Rivalry of Warlords", "The Regulation of Tribe", "Array of Revealing Light"] },
  { prompt: "ANNOUNCE_ATTRIB", cartas: ["DNA Transplant", "Abyssal Designator"] },
  { prompt: "ANNOUNCE_CARD", cartas: ["Prohibition", "Mind Crush", "Archfiend's Oath", "D.D. Designator", "Dark Designator"] },
  { prompt: "ANNOUNCE_NUMBER", cartas: ["Reasoning", "Wall of Revealing Light", "Bark of Dark Ruler", "Ancient Telescope"] },
  // Invocação-Ritual. Historicamente o tributo por soma de níveis era um
  // SELECT_SUM, mas os `proc_ritual.lua` atuais do ProjectIgnis resolvem por
  // SELECT_UNSELECT_CARD — verificado montando o ritual completo (magia +
  // monstro na mão + cinco monstros em campo) e listando os prompts emitidos:
  // saem SELECT_CARD e SELECT_UNSELECT_CARD, nunca SELECT_SUM.
  //
  // Ou seja: SELECT_SUM parece inalcançável neste pool. O tratamento dele
  // continua no código por segurança (o core ainda pode emiti-lo), mas ele
  // NÃO está coberto por teste — e é bom que isso apareça aqui em vez de
  // passar por cobertura silenciosa.
  { prompt: "SELECT_UNSELECT_CARD", cartas: ["Black Luster Ritual", "Curse of the Masked Beast", "Contract with the Abyss"], ritual: true },
  { prompt: "SORT_CARD", cartas: ["Big Eye", "Spellbook Organization", "Fruits of Kozaky's Studies"] },
  { prompt: "SELECT_DISFIELD", cartas: ["Ground Collapse"] },
  { prompt: "SELECT_OPTION", cartas: ["Poison of the Old Man", "Dark Coffin", "Ordeal of a Traveler", "Magic Drain"] },
];

const MESSAGE_NAMES = Object.fromEntries(
  Object.entries(OcgMessageType).filter(([k]) => Number.isNaN(Number(k))).map(([k, v]) => [v, k]),
);

const FILLER = { ox: 5053103, elf: 15025844, imp: 41392891, aqua: 3643300, light: 95956346, spell: 55144522 };

/** Monstro que cada magia de ritual invoca — precisa estar na mão junto. */
const RITUAL_ALVO = {
  "Black Luster Ritual": 5405694, // Soldado do Brilho Negro, nível 8
  "Curse of the Masked Beast": 49064413, // Fera Mascarada, nível 8
  "Contract with the Abyss": 97642679, // Mestre das Trevas - Zorc, nível 8
};

/**
 * Um plano só é jogável se oferecer alguma coisa para o jogador fazer.
 *
 * A lista precisa acompanhar os campos do `PromptPlan`: um campo novo que a
 * tela saiba renderizar mas que não seja checado aqui vira falso negativo — o
 * teste acusa travamento onde não há.
 */
/** As strings do engine, lidas do arquivo gerado — mesma fonte que a tela usa. */
let stringsCache = null;
function engineStrings() {
  stringsCache ??= new EngineStringsDb(
    JSON.parse(readFileSync(join(REPO, "src/data/engine-strings.json"), "utf8")),
  );
  return stringsCache;
}

function planIsActionable(plan) {
  return (
    plan.byCard.size > 0 ||
    plan.global.length > 0 ||
    plan.places.length > 0 ||
    plan.selection !== null ||
    plan.sorting !== null ||
    (plan.announce?.options.length ?? 0) > 0 ||
    plan.announceCard !== null ||
    plan.placeSelection !== null ||
    plan.counters !== null
  );
}

/**
 * Ativa a carta e examina o primeiro prompt do tipo procurado.
 *
 * Devolve o veredicto do ponto de vista da tela — não do engine: o que
 * interessa é se o jogador teria como responder.
 */
async function exercitar(card, promptAlvo, pool, caso) {
  /**
   * O ritual precisa do monstro correspondente na mão e de material em campo
   * com níveis variados — sem isso a magia nem chega a ser ativável, e o
   * prompt de soma nunca acontece.
   */
  const extras = caso?.ritual
    ? [
        { player: 0, zone: Zone.HAND, code: RITUAL_ALVO[card.name] ?? 5405694 },
        { player: 0, zone: Zone.MZONE, code: FILLER.ox, sequence: 1, position: OcgPosition.FACEUP_ATTACK },
        { player: 0, zone: Zone.MZONE, code: FILLER.aqua, sequence: 2, position: OcgPosition.FACEUP_ATTACK },
      ]
    : [];

  const duel = await createDuel({
    place: [
      ...extras,
      { player: 0, zone: Zone.MZONE, code: FILLER.elf, sequence: 3, position: OcgPosition.FACEUP_ATTACK },
      { player: 0, zone: Zone.MZONE, code: FILLER.ox, sequence: 4, position: OcgPosition.FACEUP_ATTACK },
      { player: 0, zone: Zone.GRAVE, code: FILLER.imp },
      { player: 0, zone: Zone.GRAVE, code: FILLER.light },
      { player: 0, zone: Zone.HAND, code: FILLER.aqua },
      { player: 0, zone: Zone.HAND, code: FILLER.spell },
      // A mesma carta em três lugares: cada tipo ativa de um lugar diferente
      // e o teste não sabe (nem precisa saber) qual é qual. Magia ativa da
      // mão, armadilha só do campo depois de baixada, e o efeito de ignição
      // de um monstro (Vírus Infectante da Tribo, por exemplo) só existe com
      // ele já em campo — testar só a mão fazia esses monstros parecerem
      // inertes.
      { player: 0, zone: Zone.HAND, code: card.id },
      { player: 0, zone: Zone.SZONE, code: card.id, sequence: 1, position: OcgPosition.FACEDOWN },
      { player: 0, zone: Zone.MZONE, code: card.id, sequence: 0, position: OcgPosition.FACEUP_ATTACK },
      { player: 1, zone: Zone.MZONE, code: FILLER.ox, sequence: 3, position: OcgPosition.FACEUP_ATTACK },
      { player: 1, zone: Zone.SZONE, code: FILLER.spell, sequence: 3, position: OcgPosition.FACEDOWN },
      { player: 1, zone: Zone.GRAVE, code: FILLER.elf },
    ],
    decks: [
      [FILLER.ox, FILLER.elf, FILLER.imp, FILLER.aqua, FILLER.light, FILLER.spell, FILLER.ox, FILLER.elf],
      [FILLER.ox, FILLER.elf, FILLER.imp, FILLER.ox, FILLER.elf, FILLER.imp],
    ],
  });

  let visto = null;
  let acionou = false;

  duel.run((message) => {
    if (MESSAGE_NAMES[message.type] === promptAlvo && !visto) {
      // O mesmo caminho que a tela percorre.
      const reconhecido = Boolean(findPromptMessage([message]));
      const automatico = Boolean(autoResponseFor(message));
      let plano = null;
      let erro = null;
      try {
        plano = buildPromptPlan(message, engineStrings());
      } catch (e) {
        erro = String(e?.message ?? e);
      }
      // ANNOUNCE_CARD é o único prompt cuja tela pode ficar acionável e ainda
      // assim ser um beco sem saída: se o filtro de nomes não deixar passar
      // nenhuma carta, o jogador abre a busca e não encontra nada.
      let candidatos = null;
      if (plano?.announceCard) {
        // Com os dados oficiais: a mesma conta do core (`announce-filter.ts`).
        candidatos = pool.filter((c) =>
          announceCardMatches(
            plano.announceCard.opcodes,
            { passcode: c.id, name: c.name, type: c.type, frameType: c.frameType, desc: "", images: [] },
            cardDb.get(c.id),
          ),
        ).length;
      }

      visto = {
        reconhecido,
        automatico,
        candidatos,
        acionavel: plano ? planIsActionable(plano) : false,
        instrucao: plano?.instruction ?? "",
        opcoes: plano
          ? [
              ...plano.global.map((g) => g.label),
              ...(plano.announce?.options.map((o) => o.label) ?? []),
              ...(plano.announceCard ? ["<busca por nome de carta>"] : []),
            ].slice(0, 5)
          : [],
        erro,
      };
      return null;
    }
    if (message.type !== OcgMessageType.SELECT_IDLECMD || message.player !== 0) return null;
    if (acionou) return visto ? STOP : null;
    const index = message.activates.findIndex((c) => c.code === card.id);
    if (index >= 0) {
      acionou = true;
      return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_ACTIVATE, index };
    }
    return STOP;
  });

  duel.destroy();
  return { acionou, visto };
}

async function main() {
  const pool = loadGoatPool();
  const porNome = new Map(pool.map((c) => [c.name, c]));

  let falhas = 0;
  let coberto = 0;

  for (const caso of CASOS) {
    process.stdout.write(`\n=== ${caso.prompt} ===\n`);
    let algumViu = false;

    for (const nome of caso.cartas) {
      const card = porNome.get(nome);
      if (!card) {
        process.stdout.write(`  ${nome}: NÃO ESTÁ NO POOL GOAT\n`);
        continue;
      }

      const { acionou, visto } = await exercitar(card, caso.prompt, pool, caso);
      if (!visto) {
        process.stdout.write(`  ${nome}: prompt não ocorreu${acionou ? " (carta ativou)" : " (carta não ativou)"}\n`);
        continue;
      }

      algumViu = true;
      const ok =
        visto.reconhecido &&
        (visto.automatico || visto.acionavel) &&
        !visto.erro &&
        visto.candidatos !== 0;
      if (!ok) falhas += 1;
      process.stdout.write(
        `  ${nome}: ${ok ? "OK" : "FALHA"}` +
        ` reconhecido=${visto.reconhecido} auto=${visto.automatico} acionável=${visto.acionavel}` +
        `${visto.candidatos === null ? "" : ` nomes válidos=${visto.candidatos}`}` +
        `${visto.erro ? " ERRO=" + visto.erro : ""}\n` +
        (visto.instrucao ? `      "${visto.instrucao}"${visto.opcoes.length ? " -> " + visto.opcoes.join(" | ") : ""}\n` : ""),
      );
    }

    if (algumViu) coberto += 1;
    else process.stdout.write(`  (nenhuma carta produziu ${caso.prompt} neste cenário)\n`);
  }

  process.stdout.write(`\n=== resumo ===\n`);
  process.stdout.write(`tipos de prompt exercitados: ${coberto}/${CASOS.length}\n`);
  process.stdout.write(`falhas de UI: ${falhas}\n`);
  if (falhas > 0) process.exitCode = 1;
}

await main();
