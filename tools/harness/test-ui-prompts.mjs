/**
 * Verifica a camada de UI: todo prompt que o engine faz ao jogador tem
 * resposta possível na tela?
 *
 * É um teste diferente dos outros. Os demais perguntam "o efeito funciona no
 * engine?"; este pergunta "e o jogador consegue responder?". A distinção
 * importa porque as duas falhas se parecem: um prompt que o `buildPromptPlan`
 * não reconhece vira um plano vazio — modal sem botão, tabuleiro sem nada
 * clicável — e o duelo congela. Da cadeira do jogador, "a carta não funciona".
 *
 * O teste joga duelos inteiros com os decks de verdade e submete cada prompt
 * dirigido ao jogador 0 ao mesmo caminho de código que a tela usa:
 *
 *   1. `findPromptMessage` reconhece a mensagem como pergunta?
 *   2. `autoResponseFor` responde sozinho (aí nem chega ao jogador)?
 *   3. senão, `buildPromptPlan` devolve algo acionável?
 *
 * Falhar em (1) trava o duelo em "aguardando"; falhar em (2) e (3) juntos
 * mostra uma pergunta sem resposta.
 *
 * Uso: node --import ./tools/harness/ts-loader-register.mjs tools/harness/test-ui-prompts.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { OcgMessageType } from "@n1xx1/ocgcore-wasm";

import { autoResponseFor } from "@/lib/duel/auto-response";
import { findPromptMessage } from "@/lib/duel/bot-responder";
import { buildPromptPlan } from "@/lib/duel/duel-actions";

import { REPO, loadGoatPool } from "./env.mjs";
import { createDuel } from "./duel.mjs";
import { planIsActionable } from "./ui-audit.mjs";

const MESSAGE_NAMES = Object.fromEntries(
  Object.entries(OcgMessageType)
    .filter(([key]) => Number.isNaN(Number(key)))
    .map(([key, value]) => [value, key]),
);
const messageName = (type) => MESSAGE_NAMES[type] ?? `TYPE_${type}`;

/**
 * Joga um duelo inteiro examinando cada pergunta feita ao jogador 0.
 *
 * O piloto automático responde por ele — o objetivo não é jogar bem, é
 * percorrer o máximo de situações possíveis e ver se alguma trava.
 */
function auditDuel(duel, findings, seen) {
  return duel.run((message) => {
    // Só o jogador humano tem tela; o bot responde por outro caminho.
    if (!("player" in message) || message.player !== 0) return null;

    const type = message.type;
    seen.add(type);

    // (1) A sessão só entrega ao jogador o que `findPromptMessage` reconhece.
    if (!findPromptMessage([message])) {
      findings.push({ kind: "NAO_RECONHECIDO", type: messageName(type) });
      return null;
    }

    // (2) Prompts sem escolha real são respondidos sozinhos.
    if (autoResponseFor(message)) return null;

    // (3) O que sobra precisa virar um plano acionável.
    let plan;
    try {
      plan = buildPromptPlan(message);
    } catch (error) {
      findings.push({ kind: "PLANO_ESTOUROU", type: messageName(type), detail: String(error?.message ?? error) });
      return null;
    }

    if (!planIsActionable(plan)) {
      findings.push({
        kind: "PLANO_VAZIO",
        type: messageName(type),
        instruction: plan.instruction,
      });
    }
    return null;
  }, { play: true });
}

function presetDecks() {
  const presets = JSON.parse(
    readFileSync(join(REPO, "src/data/preset-decks.json"), "utf8"),
  );
  return presets;
}

async function main() {
  const argv = process.argv.slice(2);
  const roundsAt = argv.indexOf("--rounds");
  const rounds = roundsAt >= 0 ? Number(argv[roundsAt + 1]) : 10;

  const presets = presetDecks();
  const pool = new Set(loadGoatPool().map((card) => card.id));

  const findings = [];
  const seen = new Set();
  const outcomes = {};

  for (let round = 0; round < rounds; round += 1) {
    const a = presets[round % presets.length];
    // Emparelhar decks distantes na lista mistura arquétipos (starter x
    // structure), o que produz situações mais variadas que starter x starter.
    const b = presets[(round + 3) % presets.length];
    // Cartas fora do pool Goat não têm dados oficiais garantidos; o duelo do
    // app também não as usaria.
    const deckOf = (preset) => preset.main.filter((code) => pool.has(code));

    const duel = await createDuel({
      decks: [deckOf(a), deckOf(b)],
      seed: BigInt(1000 + round * 7),
    });
    const outcome = auditDuel(duel, findings, seen);
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    process.stderr.write(
      `duelo ${round + 1}/${rounds} (${a.name} vs ${b.name}): ${outcome}, ${duel.steps} passos\n`,
    );
    duel.destroy();
  }

  process.stdout.write(`\n=== prompts vistos (${seen.size}) ===\n`);
  process.stdout.write([...seen].map(messageName).sort().join(", ") + "\n");

  process.stdout.write(`\n=== desfechos ===\n`);
  for (const [key, count] of Object.entries(outcomes)) {
    process.stdout.write(`${key}: ${count}\n`);
  }

  process.stdout.write(`\n=== problemas de UI (${findings.length}) ===\n`);
  if (findings.length === 0) {
    process.stdout.write("nenhum prompt ficou sem resposta possível.\n");
  } else {
    const grouped = {};
    for (const finding of findings) {
      const key = `${finding.kind} ${finding.type}`;
      grouped[key] = (grouped[key] ?? 0) + 1;
    }
    for (const [key, count] of Object.entries(grouped).sort((a, b) => b[1] - a[1])) {
      process.stdout.write(`${count.toString().padStart(4)}x  ${key}\n`);
    }
    process.exitCode = 1;
  }

  /**
   * Cobertura: um tipo de prompt que nenhum duelo produziu não foi testado.
   * Dizer isso em voz alta evita ler "nenhum problema" como "está tudo certo".
   */
  const HANDLED_BY_UI = [
    OcgMessageType.SELECT_IDLECMD, OcgMessageType.SELECT_BATTLECMD,
    OcgMessageType.SELECT_EFFECTYN, OcgMessageType.SELECT_YESNO,
    OcgMessageType.SELECT_OPTION, OcgMessageType.SELECT_CARD,
    OcgMessageType.SELECT_CHAIN, OcgMessageType.SELECT_PLACE,
    OcgMessageType.SELECT_POSITION, OcgMessageType.SELECT_TRIBUTE,
    OcgMessageType.SELECT_COUNTER, OcgMessageType.SELECT_SUM,
    OcgMessageType.SELECT_DISFIELD, OcgMessageType.SORT_CARD,
    OcgMessageType.SELECT_UNSELECT_CARD, OcgMessageType.ROCK_PAPER_SCISSORS,
    OcgMessageType.ANNOUNCE_RACE, OcgMessageType.ANNOUNCE_ATTRIB,
    OcgMessageType.ANNOUNCE_CARD, OcgMessageType.ANNOUNCE_NUMBER,
  ];
  const untested = HANDLED_BY_UI.filter((type) => !seen.has(type)).map(messageName);
  process.stdout.write(`\n=== não exercitados nestes duelos (${untested.length}) ===\n`);
  process.stdout.write(untested.join(", ") + "\n");
}

await main();
