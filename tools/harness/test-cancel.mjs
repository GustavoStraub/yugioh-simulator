/**
 * Verifica que dá para desistir de uma Invocação-Tributo no meio.
 *
 * O jogador escolhe "Invocar", o core pede os tributos — e é aí que costuma
 * bater o arrependimento ("esse não, ia perder o monstro errado"). O core
 * aceita `indicies: null` como desistência, mas só quando ele mesmo marca
 * `can_cancel`. Este teste confirma as duas metades: que a janela existe, e
 * que ao desistir o duelo VOLTA para o Main Phase com o campo intacto — em
 * vez de travar num RETRY, que é o que acontece quando se responde algo que
 * o core não esperava.
 *
 * Uso: node tools/harness/test-cancel.mjs
 */
import {
  OcgMessageType,
  OcgPosition,
  OcgResponseType,
  SelectIdleCMDAction,
} from "@n1xx1/ocgcore-wasm";

import { loadGoatPool } from "./env.mjs";
import { createDuel, STOP, Zone } from "./duel.mjs";

/** Monstros de nível 5+ do pool Goat — precisam de tributo para ser invocados. */
const TRIBUTAVEIS = ["Summoned Skull", "Jinzo", "Dark Magician", "Barrel Dragon"];
const FILLER = { ox: 5053103, elf: 15025844, imp: 41392891 };

async function testar(card) {
  const duel = await createDuel({
    place: [
      // Dois monstros em campo: material de tributo de sobra.
      { player: 0, zone: Zone.MZONE, code: FILLER.ox, sequence: 1, position: OcgPosition.FACEUP_ATTACK },
      { player: 0, zone: Zone.MZONE, code: FILLER.elf, sequence: 2, position: OcgPosition.FACEUP_ATTACK },
      { player: 0, zone: Zone.MZONE, code: FILLER.imp, sequence: 3, position: OcgPosition.FACEUP_ATTACK },
      { player: 0, zone: Zone.HAND, code: card.id },
      { player: 1, zone: Zone.MZONE, code: FILLER.ox, sequence: 3, position: OcgPosition.FACEUP_ATTACK },
    ],
    decks: [[FILLER.ox, FILLER.elf, FILLER.imp, FILLER.ox], [FILLER.ox, FILLER.elf]],
  });

  let ofereceuCancelar = null;
  let cancelou = false;
  let voltouAoIdle = false;
  let invocou = false;

  const outcome = duel.run((message) => {
    if (message.type === OcgMessageType.SELECT_TRIBUTE && message.player === 0) {
      ofereceuCancelar = message.can_cancel;
      if (message.can_cancel && !cancelou) {
        cancelou = true;
        // A desistência: o core recebe -1 e devolve o turno ao jogador.
        return { type: OcgResponseType.SELECT_TRIBUTE, indicies: null };
      }
      return null;
    }

    if (message.type !== OcgMessageType.SELECT_IDLECMD || message.player !== 0) return null;

    if (cancelou) {
      // De volta ao Main Phase depois de desistir: é isso que se quer provar.
      voltouAoIdle = true;
      return STOP;
    }

    const index = message.summons.findIndex((c) => c.code === card.id);
    if (index < 0) return STOP;
    return {
      type: OcgResponseType.SELECT_IDLECMD,
      action: SelectIdleCMDAction.SELECT_SUMMON,
      index,
    };
  });

  invocou = duel
    .of(OcgMessageType.SUMMONING)
    .some((m) => m.code === card.id);

  const monstrosEmCampo = duel.countIn(0, Zone.MZONE);

  duel.destroy();
  return { ofereceuCancelar, cancelou, voltouAoIdle, invocou, monstrosEmCampo, outcome };
}

const pool = loadGoatPool();
const porNome = new Map(pool.map((c) => [c.name, c]));

let falhas = 0;
for (const nome of TRIBUTAVEIS) {
  const card = porNome.get(nome);
  if (!card) {
    process.stdout.write(`${nome}: fora do pool\n`);
    continue;
  }

  const r = await testar(card);
  // Passa quando: o core ofereceu cancelar, aceitou a desistência, devolveu o
  // turno, NÃO invocou o monstro, e os três tributos continuam em campo.
  const ok =
    r.ofereceuCancelar === true &&
    r.cancelou &&
    r.voltouAoIdle &&
    !r.invocou &&
    r.monstrosEmCampo === 3;
  if (!ok) falhas += 1;

  process.stdout.write(
    `${nome.padEnd(16)} can_cancel=${r.ofereceuCancelar} desistiu=${r.cancelou} ` +
    `voltou-ao-main=${r.voltouAoIdle} invocou=${r.invocou} ` +
    `monstros-em-campo=${r.monstrosEmCampo} (${r.outcome})  ${ok ? "OK" : "FALHA"}\n`,
  );
}

process.stdout.write(`\nfalhas: ${falhas}\n`);
if (falhas > 0) process.exitCode = 1;
