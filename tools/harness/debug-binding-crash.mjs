/**
 * Modo de depuração — NÃO faz parte do caminho normal do harness.
 *
 * Reproduz um `BINDING_ERROR` isolado e instrumenta o parser de mensagens do
 * `@n1xx1/ocgcore-wasm` (que fica em node_modules, então não dá para colocar
 * um `console.log` nele) para descobrir exatamente qual mensagem estourou:
 * intercepta temporariamente os métodos de leitura de `DataView.prototype`
 * (é isso que a classe `F` do binding usa por baixo) só durante a chamada de
 * `duelGetMessage()` que falha, e despeja:
 *   - os bytes crus do lote de mensagens devolvido pelo core;
 *   - a sequência exata de leituras (método + valor) até o estouro.
 *
 * Uso: node tools/harness/debug-binding-crash.mjs [passcode]
 */
import {
  OcgMessageType,
  OcgPosition,
  OcgResponseType,
  SelectIdleCMDAction,
} from "@n1xx1/ocgcore-wasm";

import { createDuel, Zone } from "./duel.mjs";

const CODE = Number(process.argv[2] ?? 42994702); // Wandering Mummy

/** Mesmo scaffold do test-cards.mjs, para reproduzir o cenário "[campo]". */
const FILLER = { elf: 15025844, ox: 5053103, imp: 41392891, mammoth: 40374923, fang: 90357090 };
function scaffold() {
  return [
    { player: 0, zone: Zone.MZONE, code: FILLER.elf, sequence: 3, position: OcgPosition.FACEUP_ATTACK },
    { player: 0, zone: Zone.MZONE, code: FILLER.ox, sequence: 4, position: OcgPosition.FACEUP_ATTACK },
    { player: 0, zone: Zone.GRAVE, code: FILLER.imp },
    { player: 0, zone: Zone.GRAVE, code: FILLER.mammoth },
    { player: 0, zone: Zone.HAND, code: FILLER.fang },
    { player: 0, zone: Zone.HAND, code: FILLER.imp },
    { player: 1, zone: Zone.MZONE, code: FILLER.fang, sequence: 3, position: OcgPosition.FACEUP_ATTACK },
    { player: 1, zone: Zone.MZONE, code: FILLER.mammoth, sequence: 4, position: OcgPosition.FACEUP_DEFENSE },
    { player: 1, zone: Zone.GRAVE, code: FILLER.elf },
  ];
}
const DECK = Array.from({ length: 12 }, () => FILLER.ox);

// --- instrumentação -------------------------------------------------------
// A classe `F` (leitor binário) do binding chama `DataView.prototype.getXxx`
// diretamente. Interceptar aqui é a única forma de ver os bytes sem editar
// node_modules.
const METHODS = ["getUint8", "getInt8", "getUint16", "getInt16", "getUint32", "getInt32", "getBigUint64", "getBigInt64"];
const originals = {};
for (const name of METHODS) originals[name] = DataView.prototype[name];

let capturing = false;
let trace = [];
let batchBytes = null;

function install() {
  for (const name of METHODS) {
    DataView.prototype[name] = function (byteOffset, littleEndian) {
      if (capturing && batchBytes === null) {
        // Primeiro acesso desta chamada: `this` é o DataView que cobre o lote
        // inteiro de mensagens (antes de qualquer `sub()` recortar por tipo).
        batchBytes = new Uint8Array(this.buffer.slice(this.byteOffset, this.byteOffset + this.byteLength));
      }
      const value = originals[name].call(this, byteOffset, littleEndian);
      if (capturing) {
        trace.push({ method: name, relOffset: byteOffset, value: typeof value === "bigint" ? value.toString() : value });
      }
      return value;
    };
  }
}
function uninstall() {
  for (const name of METHODS) DataView.prototype[name] = originals[name];
}

const hex = (bytes) => Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join(" ");

async function main() {
  const duel = await createDuel({
    place: [...scaffold(), { player: 0, zone: Zone.MZONE, code: CODE, position: OcgPosition.FACEUP_ATTACK, sequence: 0 }],
    decks: [DECK, DECK],
  });

  // Envolve só `duelGetMessage`: zera o rastro a cada chamada, para o que
  // sobrar quando o erro estourar pertencer só à chamada que falhou.
  const original = duel.core.duelGetMessage.bind(duel.core);
  duel.core.duelGetMessage = (...args) => {
    trace = [];
    batchBytes = null;
    capturing = true;
    try {
      return original(...args);
    } finally {
      capturing = false;
    }
  };
  install();

  let acted = false;
  const outcome = duel.run((message) => {
    if (message.type !== OcgMessageType.SELECT_IDLECMD || message.player !== 0) return null;
    if (acted) return null;
    const order = [
      [message.activates, SelectIdleCMDAction.SELECT_ACTIVATE],
      [message.special_summons, SelectIdleCMDAction.SELECT_SPECIAL_SUMMON],
      [message.summons, SelectIdleCMDAction.SELECT_SUMMON],
    ];
    for (const [list, action] of order) {
      const index = list.findIndex((c) => c.code === CODE);
      if (index >= 0) {
        acted = true;
        return { type: OcgResponseType.SELECT_IDLECMD, action, index };
      }
    }
    return null;
  });

  uninstall();

  console.log(`carta: ${CODE}`);
  console.log("outcome:", outcome);
  console.log("bindingError:", duel.bindingError);
  console.log();
  if (batchBytes) {
    console.log(`lote de mensagens: ${batchBytes.length} bytes`);
    console.log(hex(batchBytes));
    console.log();
  }
  console.log(`rastro de leituras (${trace.length}):`);
  for (const t of trace) {
    console.log(`  ${t.method.padEnd(12)} off=${String(t.relOffset).padStart(4)}  valor=${t.value}`);
  }

  duel.destroy();
}

await main();
