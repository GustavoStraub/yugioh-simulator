/** Efeito obrigatório sem escolha é automático; com alternativas, a ordem é do jogador. */
import assert from "node:assert/strict";
import {
  OcgDuelMode, OcgMessageType as M, OcgPosition as P, OcgResponseType as R,
  SelectIdleCMDAction as I,
} from "@n1xx1/ocgcore-wasm";
import { autoResponseFor } from "@/lib/duel/auto-response";
import { buildPromptPlan } from "@/lib/duel/duel-actions";
import { chainWindowSkip, TRIGGER_WINDOW_SPE_COUNT } from "@/lib/duel/chain-mode";
import { createDuel, STOP, Zone } from "./duel.mjs";

const SWORDS = 72302403;
const MST = 5318639;
const candidate = (code, sequence) => ({
  code, controller: 0, location: Zone.SZONE, sequence,
  position: P.FACEUP_ATTACK, description: 0n, client_mode: 0,
});
const mandatory = {
  type: M.SELECT_CHAIN, player: 0, spe_count: 1, forced: true,
  hint_timing: 0, hint_timing_other: 32, selects: [candidate(SWORDS, 0)],
};
assert.deepEqual(autoResponseFor(mandatory), { type: R.SELECT_CHAIN, index: 0 });
assert.equal(autoResponseFor({ ...mandatory, forced: false }), null, "efeito opcional único ainda é decisão");
const mixed = { ...mandatory, selects: [...mandatory.selects, candidate(MST, 1)] };
assert.equal(autoResponseFor(mixed), null, "não escolher a ordem pelo jogador");
for (const mode of ["auto", "always", "never"]) {
  assert.equal(chainWindowSkip(mixed, mode, { topLinkPlayer: null }), null);
}
const plan = buildPromptPlan(mixed);
assert.match(plan.instruction, /obrigatório.*primeiro/);
assert.doesNotMatch(plan.instruction, /encadear|corrente/);
assert.equal(plan.global.length, 0, "obrigatório não pode ser recusado");
assert.equal(plan.byCard.size, 2, "as alternativas continuam disponíveis");
assert.deepEqual([...plan.byCard.values()].map(([action]) => action.response.index), [0, 1]);
assert([...plan.byCard.values()].every(([action]) => action.label === "Usar efeito"));
const triggers = { ...mixed, spe_count: TRIGGER_WINDOW_SPE_COUNT };
assert.equal(autoResponseFor(triggers), null, "a ordem dos gatilhos obrigatórios também é escolha");
assert.match(buildPromptPlan(triggers).instruction, /qual entra agora na corrente/);
assert.equal(buildPromptPlan(triggers).byCard.values().next().value[0].label, "Ativar");
console.log("✓ sem escolha: automático; com alternativas: ordem preservada em todos os modos");

// A contagem da Espada não abre corrente. O core a resolve sozinho quando
// não há outra ação; com MST baixado, pergunta qual vem antes. No terceiro
// turno, escolher a contagem primeiro tira a Espada antes de MST poder usá-la
// como alvo. Escolher MST primeiro deve continuar legal.
for (const [format, mode] of [["goat", OcgDuelMode.MODE_GOAT], ["tcg", OcgDuelMode.MODE_MR5]]) {
  for (const order of ["sem alternativa", "espada primeiro", "mst primeiro"]) {
    const quick = order !== "sem alternativa";
    const duel = await createDuel({
      mode, decks: [Array(40).fill(25833572), Array(40).fill(25833572)],
      place: [
        { player: 0, zone: Zone.HAND, code: SWORDS },
        ...(quick ? [{ player: 0, zone: Zone.SZONE, sequence: 1, code: MST, position: P.FACEDOWN_DEFENSE }] : []),
      ],
    });
    try {
      let activated = false;
      let usedMst = false;
      const choices = [];
      const checkedTurns = new Set();
      const result = duel.run((message, d) => {
        const turn = d.messages.filter(m => m.type === M.NEW_TURN).length;
        if ([3, 5, 7].includes(turn) && !checkedTurns.has(turn)) {
          checkedTurns.add(turn);
          assert.equal(d.query(0, Zone.SZONE).some(c => c?.code === SWORDS), turn < 7,
            `a Espada permanece após a primeira/segunda contagem e sai após a terceira (turno ${turn})`);
        }
        if (turn > 6) return STOP;
        if (message.type === M.SELECT_IDLECMD) {
          const index = !activated && message.player === 0
            ? message.activates.findIndex(c => c.code === SWORDS) : -1;
          if (index >= 0) {
            activated = true;
            return { type: R.SELECT_IDLECMD, action: I.SELECT_ACTIVATE, index };
          }
          return { type: R.SELECT_IDLECMD, action: I.TO_EP, index: null };
        }
        if (message.type === M.SELECT_CHAIN) {
          const swords = message.selects.findIndex(c => c.code === SWORDS);
          if (swords >= 0) {
            choices.push(turn);
            assert(message.forced && message.selects.some(c => c.code === MST));
            assert.equal(autoResponseFor(message), null);
            const actions = [...buildPromptPlan(message).byCard.values()].flat();
            const code = order === "mst primeiro" && turn === 6 ? MST : SWORDS;
            usedMst ||= code === MST;
            return actions.find(a => a.code === code).response;
          }
          return { type: R.SELECT_CHAIN, index: message.forced ? 0 : null };
        }
        if (message.type === M.SELECT_CARD && usedMst) {
          const index = message.selects.findIndex(c => c.code === SWORDS);
          if (index >= 0) return { type: R.SELECT_CARD, indicies: [index] };
        }
        return autoResponseFor(message);
      });
      assert.equal(result, "STOPPED");
      assert.deepEqual(duel.errors, []);
      assert.equal(duel.retriesTotal, 0);
      assert.equal(duel.bindingErrorsTotal, 0);
      assert(activated);
      assert.deepEqual([...checkedTurns], [3, 5, 7]);
      assert.deepEqual(choices, quick ? [2, 4, 6] : [], "só perguntar quando há ordem a escolher");
      const chaining = duel.messages.filter(m => m.type === M.CHAINING);
      assert.equal(chaining.filter(m => m.code === SWORDS).length, 1, "só a ativação inicial abre corrente, não a contagem");
      assert.equal(chaining.filter(m => m.code === MST).length, order === "mst primeiro" ? 1 : 0);
      assert(!duel.query(0, Zone.SZONE).some(c => c?.code === SWORDS));
      assert(duel.query(0, Zone.GRAVE).some(c => c?.code === SWORDS));
      console.log(`✓ ${format}, ${order}: ordem respeitada, Espada sai no terceiro turno, sem corrente de contagem`);
    } finally {
      duel.destroy();
    }
  }
}
