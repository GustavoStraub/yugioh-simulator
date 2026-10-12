/**
 * Vigia as emendas locais nos scripts base.
 *
 * Uma emenda é ancorada num trecho exato do script do ProjectIgnis. Quando o
 * upstream reescreve esse trecho, a emenda deixa de casar — e a correção some
 * sem barulho: as cartas que ela consertava voltam a quebrar e nada na tela
 * diz por quê. Este teste falha nesse momento, que é quando ainda dá para
 * reescrever a âncora.
 *
 * Também confere o efeito prático: as cartas que dependem da emenda precisam
 * continuar ativando sem erro de Lua.
 *
 * Uso: node tools/harness/test-patches.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { OcgMessageType, OcgPosition, OcgResponseType, SelectIdleCMDAction } from "@n1xx1/ocgcore-wasm";

import {
  patchCoreScript,
  patchesNaoAplicados,
  totalDePatches,
} from "../../src/lib/duel/script-patches.ts";
import { SCRIPTS_DIR, loadGoatPool } from "./env.mjs";
import { createDuel, STOP, Zone } from "./duel.mjs";

/** Cartas que só funcionam com a emenda do chain.lua aplicada. */
const DEPENDEM_DA_EMENDA = [
  { nome: "Charm of Shabti", id: 50412166, zona: Zone.HAND },
  { nome: "Strike Ninja", id: 41006930, zona: Zone.MZONE },
  { nome: "Last Turn", id: 28566710, zona: Zone.SZONE, lifePoints: [800, 8000] },
];

const F = {
  ox: 5053103,
  elf: 15025844,
  /** Feral Imp — TREVAS. */
  imp: 41392891,
  aqua: 3643300,
  light: 95956346,
  /** Sangan — TREVAS. O Ninja Fulminante bane DOIS monstros de TREVAS do
   *  cemitério como custo; com um só ele nem é oferecido. */
  darkExtra: 26202165,
};
const RUIDO = /no such file|script not found|wasm streaming|ArrayBuffer|falling back/i;

async function ativar(card) {
  const posicao =
    card.zona === Zone.MZONE
      ? OcgPosition.FACEUP_ATTACK
      : card.zona === Zone.SZONE
        ? OcgPosition.FACEDOWN
        : OcgPosition.FACEUP;

  const duel = await createDuel({
    place: [
      { player: 0, zone: card.zona, code: card.id, sequence: 0, position: posicao },
      { player: 0, zone: Zone.MZONE, code: F.ox, sequence: 2, position: OcgPosition.FACEUP_ATTACK },
      { player: 0, zone: Zone.GRAVE, code: F.imp },
      { player: 0, zone: Zone.GRAVE, code: F.darkExtra },
      { player: 0, zone: Zone.GRAVE, code: F.light },
      { player: 0, zone: Zone.HAND, code: F.aqua },
      { player: 1, zone: Zone.MZONE, code: F.elf, sequence: 3, position: OcgPosition.FACEUP_ATTACK },
    ],
    decks: [[F.ox, F.elf, F.imp, F.aqua], [F.ox, F.elf, F.imp]],
    lifePoints: card.lifePoints ?? [8000, 8000],
  });

  let agiu = false;
  duel.run((message) => {
    if (message.type === OcgMessageType.SELECT_CHAIN && message.player === 0) {
      const i = message.selects.findIndex((c) => c.code === card.id);
      if (i >= 0) {
        agiu = true;
        return { type: OcgResponseType.SELECT_CHAIN, index: i };
      }
      return null;
    }
    if (message.type !== OcgMessageType.SELECT_IDLECMD || message.player !== 0) return null;
    if (agiu) return STOP;
    const i = message.activates.findIndex((c) => c.code === card.id);
    if (i >= 0) {
      agiu = true;
      return {
        type: OcgResponseType.SELECT_IDLECMD,
        action: SelectIdleCMDAction.SELECT_ACTIVATE,
        index: i,
      };
    }
    if (message.to_ep) {
      return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_EP, index: null };
    }
    return STOP;
  });

  const erros = duel.errors.filter((t) => t && !RUIDO.test(t));
  duel.destroy();
  return { agiu, erros };
}

let falhas = 0;

/** Testa a âncora contra uma variação de espaçamento do original. */
function ancoraTolerante(original) {
  // Reindentação típica de um reformat upstream: tabs viram espaços e a
  // quebra de linha muda. A emenda tem que sobreviver a isso.
  const reformatado = original.replace(
    /local function chaininfo_fn\(info\)[\s\S]*?\n\tend\nend/,
    "local function chaininfo_fn(info)\n    return function(ch)\n        return Duel.GetChainInfo(ch or 0,info)\n    end\nend",
  );
  if (reformatado === original) return "não consegui reformatar para testar";
  const saida = patchCoreScript("chain.lua", reformatado);
  return saida !== reformatado ? "sim" : "NÃO";
}

// 1. A âncora ainda existe no script baixado?
const original = readFileSync(join(SCRIPTS_DIR, "chain.lua"), "utf8");
const emendado = patchCoreScript("chain.lua", original);
const aplicou = emendado !== original && patchesNaoAplicados().length === 0;
process.stdout.write(
  `emendas declaradas: ${totalDePatches()} | aplicaram: ${aplicou ? "sim" : "NÃO"}` +
  `${patchesNaoAplicados().length ? " — sem âncora: " + patchesNaoAplicados().join(", ") : ""}\n`,
);
if (!aplicou) falhas += 1;

// 1b. A âncora sobrevive a uma reindentação do upstream?
const tolera = ancoraTolerante(original);
process.stdout.write(`âncora tolera reindentação: ${tolera}\n`);
if (tolera === "NÃO") falhas += 1;

// 1c. A emenda deixa passar SÓ as flags novas? Uma flag inventada tem que
// continuar estourando — erro real não pode virar silêncio.
const soAsNovas =
  emendado.includes("ocgcore_flags_novas[info]") &&
  emendado.includes("return Duel.GetChainInfo(ch or 0,info)");
process.stdout.write(
  `emenda restrita às flags novas: ${soAsNovas ? "sim" : "NÃO"}\n`,
);
if (!soAsNovas) falhas += 1;

// 2. As cartas que dependem dela continuam funcionando?
const pool = loadGoatPool();
const conhecidas = new Set(pool.map((c) => c.id));
for (const card of DEPENDEM_DA_EMENDA) {
  if (!conhecidas.has(card.id)) {
    process.stdout.write(`${card.nome}: fora do pool Goat\n`);
    continue;
  }
  const r = await ativar(card);
  const ok = r.agiu && r.erros.length === 0;
  if (!ok) falhas += 1;
  process.stdout.write(
    `${ok ? "OK   " : "FALHA"} ${card.nome.padEnd(18)} ativou=${r.agiu}` +
    `${r.erros.length ? " erro=" + r.erros[0].slice(0, 70) : " sem erro de Lua"}\n`,
  );
}

process.stdout.write(`\nfalhas: ${falhas}\n`);
if (falhas > 0) process.exitCode = 1;
