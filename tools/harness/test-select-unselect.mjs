/**
 * SELECT_UNSELECT_CARD — "marque quantas quiser, desmarque, e conclua".
 *
 * O caso que expôs o problema: Duque Penumbra, o Senhor das Sombras Sinistro
 * ("Tribute any number of DARK monsters") com Covil das Trevas no campo, que
 * deixa usar 1 monstro do oponente no tributo. O script (via
 * `Duel.SelectReleaseGroupCost`) pergunta UMA carta por vez e refaz a lista a
 * cada passo. A tela pedia "Confirmar" a cada carta — parecia um laço de
 * prompts repetidos, e "Concluir" ao lado de "Confirmar" encerrava sem a carta
 * recém-marcada. Agora cada clique já é a resposta (`selection.immediate`).
 *
 * O teste responde pelo MESMO caminho da tela (`buildPromptPlan(...)
 * .selection.build([índice])` e o "Concluir" de `plan.global`) e confere o
 * resultado no campo: quem foi tributado e o ATK do Duque.
 *
 * Uso: npm run test:select-unselect
 */
import {
  OcgDuelMode, OcgLocation, OcgMessageType, OcgPosition, OcgResponseType, SelectIdleCMDAction,
} from "@n1xx1/ocgcore-wasm";

import { buildPromptPlan } from "@/lib/duel/duel-actions";

import { createDuel, STOP, Zone } from "./duel.mjs";

const DUKE = 12766474;
const LAIR = 59160188;
const BATTLE_OX = 5053103;
const DARK_MAGICIAN = 46986414;

const falhas = [];
function conferir(condicao, descricao, detalhe = "") {
  console.log(condicao ? `  ✓ ${descricao}` : `  ✗ ${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  if (!condicao) falhas.push(descricao);
}

/**
 * Ativa o Duque e responde cada SELECT_UNSELECT_CARD com o próximo passo:
 * `[jogador, zona]` clica nessa carta (marca ou desmarca), `"fim"` aperta o
 * "Concluir".
 */
async function tributar(passos) {
  const duel = await createDuel({
    mode: OcgDuelMode.MODE_MR5,
    decks: [Array(5).fill(BATTLE_OX), Array(5).fill(BATTLE_OX)],
    place: [
      { player: 0, zone: Zone.HAND, code: DUKE },
      { player: 0, zone: Zone.SZONE, sequence: 5, code: LAIR, position: OcgPosition.FACEUP },
      { player: 0, zone: Zone.MZONE, sequence: 0, code: BATTLE_OX },
      { player: 0, zone: Zone.MZONE, sequence: 1, code: DARK_MAGICIAN },
      { player: 1, zone: Zone.MZONE, sequence: 0, code: BATTLE_OX },
      { player: 1, zone: Zone.MZONE, sequence: 1, code: DARK_MAGICIAN },
    ],
  });
  let ativou = false;
  let passo = 0;
  const marcadasPorPasso = [];
  let semImediata = false;
  let semConcluir = false;
  const desfecho = duel.run((message) => {
    if (message.type === OcgMessageType.SELECT_IDLECMD && message.player === 0) {
      if (ativou) return STOP;
      const index = message.activates.findIndex((a) => a.code === DUKE);
      if (index < 0) return STOP;
      ativou = true;
      return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_ACTIVATE, index };
    }
    if (message.type === OcgMessageType.SELECT_UNSELECT_CARD) {
      const plan = buildPromptPlan(message);
      if (!plan.selection?.immediate) semImediata = true;
      marcadasPorPasso.push(plan.selection.alreadyChosen.length);
      const acao = passos[passo++];
      if (acao === "fim" || acao === undefined) {
        const concluir = plan.global.find((g) => g.label === "Concluir");
        if (!concluir) {
          semConcluir = true;
          return STOP;
        }
        return concluir.response;
      }
      const [jogador, zona] = acao;
      const index = plan.selection.candidates.findIndex(
        (c) => c.controller === jogador && c.location === OcgLocation.MZONE && c.sequence === zona,
      );
      if (index < 0) return STOP;
      return plan.selection.build([index]);
    }
    if (message.type === OcgMessageType.RETRY) return STOP;
    return null;
  });
  const campo = (jogador) => duel.query(jogador, OcgLocation.MZONE).map((c) => c?.code ?? 0);
  const duque = duel.query(0, OcgLocation.MZONE).find((c) => c?.code === DUKE);
  const resultado = {
    desfecho, semImediata, semConcluir, marcadasPorPasso,
    meu: campo(0), dele: campo(1), atk: duque?.attack ?? null,
  };
  duel.destroy();
  return resultado;
}

console.log("Três tributos (2 meus + 1 do oponente pelo Covil), sem confirmar carta a carta");
{
  const r = await tributar([[0, 0], [0, 1], [1, 0]]);
  conferir(!r.semImediata, "o plano é de seleção imediata (cada clique responde)");
  conferir(
    JSON.stringify(r.marcadasPorPasso) === "[0,1,2]",
    "cada clique conta como uma carta marcada no core",
    JSON.stringify(r.marcadasPorPasso),
  );
  conferir(r.atk === 2000, "o Duque desceu com 500 + 3 × 500 de ATK", `ATK ${r.atk}`);
  conferir(r.dele[0] === 0 && r.dele[1] === DARK_MAGICIAN, "só 1 monstro do oponente foi tributado", JSON.stringify(r.dele));
}

console.log("\nMarcar, desmarcar e concluir");
{
  const r = await tributar([[0, 0], [0, 0], [1, 1], "fim"]);
  conferir(!r.semConcluir, "\"Concluir\" aparece quando o core já aceita encerrar");
  conferir(
    JSON.stringify(r.marcadasPorPasso) === "[0,1,0,1]",
    "clicar de novo na marcada desfaz",
    JSON.stringify(r.marcadasPorPasso),
  );
  conferir(r.meu[0] === BATTLE_OX, "a carta desmarcada continua no campo", JSON.stringify(r.meu));
  conferir(r.dele[1] === 0, "o monstro do oponente escolhido foi tributado", JSON.stringify(r.dele));
  conferir(r.atk === 1000, "o Duque ganhou 500 por 1 tributo", `ATK ${r.atk}`);
}

if (falhas.length) {
  console.log(`\n${falhas.length} falha(s).`);
  process.exitCode = 1;
} else {
  console.log("\nSeleção marca/desmarca: tudo certo.");
}
