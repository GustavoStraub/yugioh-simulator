/**
 * Como o duelo acaba — e se a tela consegue dizer por quê.
 *
 * A tela de resultado mostra o motivo embaixo do nome do vencedor ("os pontos
 * de vida de X chegaram a 0", "Exodia obliterou"). Esse texto sai de um número
 * que o core manda em `WIN.reason`, e o número não é documentado em lugar
 * nenhum: foi lido rodando cada final. É exatamente o tipo de constante que
 * uma versão nova do ocgcore renumera sem avisar — e aí o app passa a mostrar,
 * com toda a confiança, o motivo errado da derrota.
 *
 * Este teste prende os três finais que o formato Goat produz de verdade a cada
 * partida, e confere que cada um vira a frase certa.
 *
 * Uso: npm run test:endgame
 */
import {
  OcgMessageType,
  OcgResponseType,
  SelectBattleCMDAction,
  SelectIdleCMDAction,
} from "@n1xx1/ocgcore-wasm";

import {
  describeWinReason,
  WIN_REASON,
  EXODIA_PECAS,
} from "@/lib/duel/win-reason";

import { createDuel, Zone } from "./duel.mjs";

/** Summoned Skull — 2500 de ataque, o suficiente para um final por dano. */
const CAVEIRA = 70781052;
/** Battle Ox — enche deck e mão sem nenhum efeito no caminho. */
const BOI = 5053103;

const falhas = [];
function conferir(condicao, descricao, detalhe = "") {
  if (condicao) {
    console.log(`  ✓ ${descricao}`);
  } else {
    falhas.push(descricao);
    console.log(`  ✗ ${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

/** Roda um cenário e devolve a mensagem WIN que o core emitiu. */
async function vitoria(config, politica) {
  const duel = await createDuel(config);
  duel.run(politica ?? (() => null), { play: false });
  const win = duel.of(OcgMessageType.WIN).at(0) ?? null;
  const erros = duel.errors.slice();
  duel.destroy();
  return { win, erros };
}

/** Vai para a Battle Phase e ataca — o caminho do final por dano. */
const atacarSempre = (message) => {
  if (message.type === OcgMessageType.SELECT_IDLECMD) {
    return {
      type: OcgResponseType.SELECT_IDLECMD,
      action: message.to_bp
        ? SelectIdleCMDAction.TO_BP
        : SelectIdleCMDAction.TO_EP,
      index: null,
    };
  }
  if (message.type === OcgMessageType.SELECT_BATTLECMD && message.attacks.length > 0) {
    return {
      type: OcgResponseType.SELECT_BATTLECMD,
      action: SelectBattleCMDAction.SELECT_BATTLE,
      index: 0,
    };
  }
  return null;
};

const NOMES = { winner: "Você", loser: "O oponente" };

console.log("\nPontos de vida a zero");
{
  const { win, erros } = await vitoria(
    {
      place: [{ player: 0, zone: Zone.MZONE, code: CAVEIRA, sequence: 0 }],
      decks: [Array(10).fill(BOI), Array(10).fill(BOI)],
      lifePoints: [8000, 1000],
    },
    atacarSempre,
  );
  conferir(win?.player === 0, "quem atacou venceu", JSON.stringify(win));
  conferir(
    win?.reason === WIN_REASON.LP_ZERO,
    `o motivo é LP_ZERO (${win?.reason})`,
  );
  conferir(
    describeWinReason(win?.reason ?? -1, NOMES) ===
      "Os pontos de vida de O oponente chegaram a 0.",
    "e a frase fala dos pontos de vida",
    describeWinReason(win?.reason ?? -1, NOMES) ?? "(sem frase)",
  );
  conferir(erros.length === 0, "sem erro do core");
}

console.log("\nDeck vazio");
{
  const { win } = await vitoria({ decks: [Array(20).fill(BOI), []] });
  conferir(win?.player === 0, "vence quem ainda tinha deck", JSON.stringify(win));
  conferir(
    win?.reason === WIN_REASON.DECK_EMPTY,
    `o motivo é DECK_EMPTY (${win?.reason})`,
  );
  conferir(
    describeWinReason(win?.reason ?? -1, NOMES) ===
      "O oponente ficou sem cartas para comprar.",
    "e a frase fala da compra",
  );
}

console.log("\nExodia reunido");
{
  const { win } = await vitoria({
    place: EXODIA_PECAS.map((code) => ({ player: 0, zone: Zone.HAND, code })),
    decks: [Array(10).fill(BOI), Array(10).fill(BOI)],
  });
  conferir(win?.player === 0, "vence quem juntou as cinco partes", JSON.stringify(win));
  conferir(
    win?.reason === WIN_REASON.EFFECT,
    `o motivo é EFFECT (${win?.reason})`,
  );
  conferir(
    describeWinReason(win?.reason ?? -1, NOMES, true)?.includes("Exodia"),
    "e a frase nomeia o Exodia",
  );
  conferir(
    describeWinReason(win?.reason ?? -1, NOMES, false) ===
      "Você venceu pelo efeito de uma carta.",
    "sem as cinco partes, a frase fica genérica em vez de mentir",
  );
}

console.log("");
if (falhas.length > 0) {
  console.log(`${falhas.length} falha(s):`);
  for (const falha of falhas) console.log(`  - ${falha}`);
  process.exit(1);
}
console.log("Finais de duelo: tudo certo.");
process.exit(0);
