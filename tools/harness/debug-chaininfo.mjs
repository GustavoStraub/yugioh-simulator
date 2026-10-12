/**
 * Modo de depuração — NÃO faz parte do caminho normal do harness.
 *
 * Descobre qual `CHAININFO_*` a engine rejeita com
 * "[string \"chain.lua\"]:85: Passed invalid CHAININFO flag." ao ativar Charm
 * of Shabti / Strike Ninja. Nenhum dos dois scripts chama `Chain.*` ou
 * `Duel.GetChainInfo` diretamente — o erro vem de uma função genérica que a
 * engine chama por baixo dos panos. Este script troca `Duel.GetChainInfo` por
 * um wrapper Lua (injetado via `loadScript`, sem tocar nos scripts
 * vendorizados em `.cache/`) que embrulha a chamada original em `pcall` e, se
 * ela falhar, relança o erro com o valor de `info` embutido na mensagem — essa
 * mensagem chega ao `errorHandler` do harness do mesmo jeito que o erro
 * original.
 *
 * Uso: node tools/harness/debug-chaininfo.mjs [passcode] [zona]
 *   zona: "mao" (padrão), "campo" ou "baixada"
 *   LP=800 no ambiente para cartas que só existem com pouca vida (Last Turn)
 */
import { OcgMessageType, OcgResponseType, SelectIdleCMDAction } from "@n1xx1/ocgcore-wasm";

import { createDuel, Zone } from "./duel.mjs";

const CODE = Number(process.argv[2] ?? 50412166); // Charm of Shabti
const ZONAS = { mao: Zone.HAND, campo: Zone.MZONE, baixada: Zone.SZONE };
const ZONE = ZONAS[process.argv[3] ?? "mao"] ?? Zone.HAND;

/** Mesmo scaffold do test-cards.mjs, com um segundo TREVAS no cemitério — o
 * custo do Strike Ninja (2 monstros TREVAS de face para cima) precisa disso
 * disponível de imediato, sem ter que simular batalhas para gerá-lo. */
const FILLER = { elf: 15025844, ox: 5053103, imp: 41392891, mammoth: 40374923, fang: 90357090 };
function scaffold() {
  return [
    { player: 0, zone: Zone.MZONE, code: FILLER.elf, sequence: 3 },
    { player: 0, zone: Zone.MZONE, code: FILLER.ox, sequence: 4 },
    { player: 0, zone: Zone.GRAVE, code: FILLER.imp },
    { player: 0, zone: Zone.GRAVE, code: FILLER.imp },
    { player: 0, zone: Zone.GRAVE, code: FILLER.mammoth },
    { player: 0, zone: Zone.HAND, code: FILLER.fang },
    { player: 1, zone: Zone.MZONE, code: FILLER.fang, sequence: 3 },
    { player: 1, zone: Zone.MZONE, code: FILLER.mammoth, sequence: 4 },
    { player: 1, zone: Zone.GRAVE, code: FILLER.elf },
  ];
}
const DECK = Array.from({ length: 12 }, () => FILLER.ox);

// Lua puro, injetado depois que o core já existe (troca só o valor do campo
// na tabela global `Duel` — `chaininfo_fn` em chain.lua lê `Duel.GetChainInfo`
// a cada chamada, então não importa que o override venha depois do load).
const HOOK = `
local real_get_chain_info = Duel.GetChainInfo
Duel.GetChainInfo = function(ch, info, ...)
	local ok, result = pcall(real_get_chain_info, ch, info, ...)
	if not ok then
		error("[debug-chaininfo] info=" .. tostring(info) .. " ch=" .. tostring(ch) .. " -- " .. tostring(result), 0)
	end
	return result
end
`;

async function main() {
  const duel = await createDuel({
    place: [...scaffold(), { player: 0, zone: ZONE, code: CODE, sequence: 0 }],
    decks: [DECK, DECK],
    // Algumas cartas só têm condição com pouca vida — Last Turn exige 1000
    // LP ou menos, e num duelo em 8000 ela nunca chega a ser oferecida.
    lifePoints: [Number(process.env.LP ?? 8000), 8000],
  });

  const loaded = await duel.core.loadScript(duel.handle, "debug_hook.lua", HOOK);
  if (!loaded) throw new Error("o core rejeitou o hook de depuração");

  let acted = false;
  const outcome = duel.run((message) => {
    if (message.type !== OcgMessageType.SELECT_IDLECMD || message.player !== 0) return null;
    if (acted) return null;
    const index = message.activates.findIndex((c) => c.code === CODE);
    if (index >= 0) {
      acted = true;
      return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_ACTIVATE, index };
    }
    return null;
  });

  const nomeDaZona =
    Object.entries(ZONAS).find(([, v]) => v === ZONE)?.[0] ?? String(ZONE);
  console.log(`carta: ${CODE}  zona: ${nomeDaZona}`);
  console.log("outcome:", outcome);
  console.log("acted:", acted);
  console.log("erros capturados:");
  for (const e of duel.errors) if (e && e.trim()) console.log(" ", e);

  duel.destroy();
}

await main();
