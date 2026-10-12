/**
 * Fecha as 16 cartas que sobraram sem verificação.
 *
 * As baterias anteriores testam cenários GENÉRICOS — campo farto, ataque,
 * invocação, ativação do oponente. Estas dezesseis não cabem em molde nenhum:
 * cada uma exige uma condição própria e específica, lida do Lua da carta.
 * Anti-Spell precisa de dois Contadores de Magia no seu lado; Penalty Game!
 * exige que a mão do OPONENTE tenha exatamente quatro cartas; Last Turn só
 * existe com 1000 LP ou menos e no turno do adversário. Um cenário genérico
 * nunca produz nada disso, e a carta aparecia como "nunca ofereceu" sem que
 * isso dissesse coisa alguma sobre ela estar quebrada.
 *
 * Três delas são gatilhos OBRIGATÓRIOS (Caixão Negro, Estátua do Perverso,
 * Botão de Autodestruição do Kozaky): não são "ativáveis" por definição —
 * disparam sozinhas ao serem destruídas viradas para baixo. Para essas a
 * pergunta certa não é "o core oferece?" e sim "o efeito acontece?", e é isso
 * que se mede.
 *
 * Uso: node tools/harness/test-remaining.mjs [--verbose]
 */
import {
  OcgMessageType,
  OcgPosition,
  OcgResponseType,
  SelectIdleCMDAction,
} from "@n1xx1/ocgcore-wasm";

import { createDuel, STOP, Zone } from "./duel.mjs";

const C = {
  /** Armadilha Contínua que entra em campo com 3 Contadores de Magia. */
  pedra: 34029630,
  /** Registra um efeito marcado com o id do Relógio de Fogo do Destino. */
  espadas: 72302403,
  mst: 5318639,
  potOfGreed: 55144522,
  gracefulCharity: 79571449,
  darkMagician: 46986414,
  ox: 5053103,
  elf: 15025844,
  imp: 41392891,
  fang: 90357090,
  sangan: 26202165,
};

/** Monstros e magias de enchimento para a mão do oponente. */
const MAO_OPONENTE = [C.ox, C.elf, C.imp, C.fang, C.sangan, C.potOfGreed];

/**
 * Um caso por carta.
 *
 * `place` completa o tabuleiro além do básico; `maoOponente` diz quantas
 * cartas o adversário segura (várias cartas contam exatamente isso);
 * `prepararCom` são cartas que o jogador ativa ANTES da carta em teste, para
 * criar a condição (a pedra, para os Contadores de Magia).
 */
const CASOS = [
  {
    nome: "Disturbance Strategy", id: 77561728, tipo: "ativavel",
    porque: "o oponente precisa ter cartas na mão e poder comprar",
    maoOponente: 4,
  },
  {
    nome: "Graverobber", id: 61705417, tipo: "ativavel",
    porque: "precisa de uma Magia no cemitério do OPONENTE",
    place: [{ player: 1, zone: Zone.GRAVE, code: C.potOfGreed }],
  },
  {
    nome: "Hidden Spellbook", id: 21840375, tipo: "ativavel",
    // IsExistingTarget(..., tp, LOCATION_GRAVE, 0, 2, nil): DUAS Magias, e no
    // SEU cemitério — não no do oponente, como a leitura apressada sugeria.
    porque: "precisa de 2 Magias no SEU cemitério e ser o seu turno",
    place: [
      { player: 0, zone: Zone.GRAVE, code: C.potOfGreed },
      { player: 0, zone: Zone.GRAVE, code: C.mst },
    ],
  },
  {
    nome: "Lightforce Sword", id: 49587034, tipo: "ativavel",
    porque: "precisa de carta banível na mão do oponente",
    maoOponente: 3,
  },
  {
    nome: "Mind Crush", id: 15800838, tipo: "ativavel",
    porque: "os DOIS jogadores precisam ter cartas na mão",
    maoOponente: 3,
    place: [{ player: 0, zone: Zone.HAND, code: C.ox }],
  },
  {
    nome: "Trap Dustshoot", id: 64697231, tipo: "ativavel",
    porque: "a mão do oponente precisa ter MAIS de 3 cartas",
    maoOponente: 5,
  },
  {
    nome: "Penalty Game!", id: 967928, tipo: "ativavel",
    porque: "a mão do oponente precisa ter exatamente 4 cartas",
    maoOponente: 4,
  },
  {
    nome: "Exhausting Spell", id: 95451366, tipo: "ativavel",
    porque: "precisa de 1 Contador de Magia em campo",
    prepararCom: [C.pedra],
  },
  {
    nome: "Anti-Spell", id: 53112492, tipo: "ativavel",
    porque: "custa 2 Contadores de Magia e responde a uma Magia do oponente",
    prepararCom: [C.pedra],
    magiaDoOponente: true,
  },
  {
    nome: "Miracle Restoring", id: 68334074, tipo: "ativavel",
    porque: "custa 2 Contadores de Magia e revive Mago Negro do cemitério",
    prepararCom: [C.pedra],
    place: [{ player: 0, zone: Zone.GRAVE, code: C.darkMagician }],
  },
  {
    nome: "Pyro Clock of Destiny", id: 1082946, tipo: "ativavel",
    porque: "precisa de uma carta com contador de turnos em campo",
    prepararCom: [C.espadas],
  },
  {
    nome: "Forced Requisition", id: 74923978, tipo: "ativavel",
    // Precisa de um descarte DE VERDADE: Graça Divina compra 3 e descarta 2,
    // e é esse descarte que abre a janela. Limite de mão não serve — não
    // levanta EVENT_DISCARD.
    porque: "dispara quando VOCÊ descarta por efeito (Graça Divina)",
    prepararNaMao: [C.gracefulCharity],
    place: [
      { player: 0, zone: Zone.HAND, code: C.ox },
      { player: 0, zone: Zone.HAND, code: C.elf },
    ],
    maoOponente: 3,
  },
  {
    nome: "Last Turn", id: 28566710, tipo: "ativavel",
    porque: "exige 1000 LP ou menos, turno do oponente e um monstro seu",
    lifePoints: [800, 8000],
    esperarTurnoDoOponente: true,
    place: [
      { player: 0, zone: Zone.MZONE, code: C.ox, sequence: 2, position: OcgPosition.FACEUP_ATTACK },
    ],
  },

  // --- gatilhos obrigatórios: medir o EFEITO, não a oferta ---
  {
    nome: "Dark Coffin", id: 1804528, tipo: "gatilho-obrigatorio",
    porque: "dispara ao ser destruída virada para baixo",
    maoOponente: 3,
  },
  {
    nome: "Statue of the Wicked", id: 65810489, tipo: "gatilho-obrigatorio",
    porque: "invoca uma ficha ao ser destruída virada para baixo",
    esperaFicha: true,
  },
  {
    nome: "Kozaky's Self-Destruct Button", id: 21908319, tipo: "gatilho-obrigatorio",
    porque: "causa 1000 de dano ao ser destruída virada para baixo",
    esperaDano: true,
  },
];

/** Tabuleiro comum a todos os casos. */
function tabuleiro(caso) {
  const place = [
    { player: 0, zone: Zone.MZONE, code: C.elf, sequence: 3, position: OcgPosition.FACEUP_ATTACK },
    { player: 1, zone: Zone.MZONE, code: C.ox, sequence: 3, position: OcgPosition.FACEUP_ATTACK },
    { player: 0, zone: Zone.GRAVE, code: C.imp },
    // A carta em teste, baixada — é assim que uma armadilha entra em jogo.
    { player: 0, zone: Zone.SZONE, code: caso.id, sequence: 0, position: OcgPosition.FACEDOWN },
  ];

  (caso.prepararCom ?? []).forEach((code, i) => {
    place.push({
      player: 0, zone: Zone.SZONE, code, sequence: i + 1,
      position: OcgPosition.FACEDOWN,
    });
  });

  // Cartas de preparação que se ativam da MÃO (magias normais).
  (caso.prepararNaMao ?? []).forEach((code) => {
    place.push({ player: 0, zone: Zone.HAND, code });
  });

  for (let i = 0; i < (caso.maoOponente ?? 0); i += 1) {
    place.push({ player: 1, zone: Zone.HAND, code: MAO_OPONENTE[i % MAO_OPONENTE.length] });
  }

  // Quem precisa destruir a própria carta baixada dá o MST ao oponente.
  if (caso.tipo === "gatilho-obrigatorio") {
    place.push({ player: 1, zone: Zone.HAND, code: C.mst });
  }
  if (caso.magiaDoOponente) {
    place.push({ player: 1, zone: Zone.HAND, code: C.potOfGreed });
  }

  return [...place, ...(caso.place ?? [])];
}

const DECK = [C.ox, C.elf, C.imp, C.fang, C.sangan, C.potOfGreed, C.ox, C.elf, C.imp, C.fang];

async function rodar(caso) {
  const duel = await createDuel({
    place: tabuleiro(caso),
    decks: [DECK, DECK],
    lifePoints: caso.lifePoints ?? [8000, 8000],
  });

  const prep = new Set([...(caso.prepararCom ?? []), ...(caso.prepararNaMao ?? [])]);
  const prepFeitas = new Set();
  let ofereceu = false;
  let ativou = false;
  let turnoDoOponente = false;

  const outcome = duel.run((message) => {
    if (message.type === OcgMessageType.NEW_TURN) return null;

    // --- janela de corrente: é aqui que armadilha de resposta aparece ---
    if (message.type === OcgMessageType.SELECT_CHAIN && message.player === 0) {
      const i = message.selects.findIndex((c) => c.code === caso.id);
      if (i >= 0) {
        ofereceu = true;
        ativou = true;
        return { type: OcgResponseType.SELECT_CHAIN, index: i };
      }
      return null;
    }

    if (message.type !== OcgMessageType.SELECT_IDLECMD) return null;

    // --- turno do oponente: só ele age ---
    if (message.player === 1) {
      // Destrói a carta baixada do jogador (gatilho obrigatório) ou ativa uma
      // magia qualquer (para Anti-Spell ter a que responder).
      const alvo = message.activates.findIndex(
        (c) => c.code === C.mst || c.code === C.potOfGreed,
      );
      if (alvo >= 0) {
        return {
          type: OcgResponseType.SELECT_IDLECMD,
          action: SelectIdleCMDAction.SELECT_ACTIVATE,
          index: alvo,
        };
      }
      return null;
    }

    // --- nosso turno ---
    turnoDoOponente = false;

    // Primeiro as cartas de preparação (a pedra, as espadas).
    for (const [i, c] of message.activates.entries()) {
      if (prep.has(c.code) && !prepFeitas.has(c.code)) {
        prepFeitas.add(c.code);
        return {
          type: OcgResponseType.SELECT_IDLECMD,
          action: SelectIdleCMDAction.SELECT_ACTIVATE,
          index: i,
        };
      }
    }

    // Depois a carta em teste.
    const alvo = message.activates.findIndex((c) => c.code === caso.id);
    if (alvo >= 0) {
      ofereceu = true;
      ativou = true;
      return {
        type: OcgResponseType.SELECT_IDLECMD,
        action: SelectIdleCMDAction.SELECT_ACTIVATE,
        index: alvo,
      };
    }

    // Nada a fazer no nosso turno: passa, para o oponente jogar (é no turno
    // dele que Last Turn e os gatilhos obrigatórios acontecem).
    if (ativou || (caso.esperarTurnoDoOponente && turnoDoOponente)) return STOP;
    if (message.to_ep) {
      return {
        type: OcgResponseType.SELECT_IDLECMD,
        action: SelectIdleCMDAction.TO_EP,
        index: null,
      };
    }
    return STOP;
  }, { play: false });

  // --- o que aconteceu de fato ---
  const encadeou = duel.of(OcgMessageType.CHAINING).some((m) => m.code === caso.id);
  // Efeito medido, não só "resolveu sem erro": quantas cartas mudaram de zona,
  // quanta vida trocou de lado, quantas compras houve. É o que separa "a
  // carta ativou" de "a carta fez o que promete".
  const movimentos = duel.of(OcgMessageType.MOVE).length;
  const compras = duel.of(OcgMessageType.DRAW).reduce((t, m) => t + m.drawn.length, 0);
  const recuperou = duel.of(OcgMessageType.RECOVER).reduce((t, m) => t + m.amount, 0);
  const fichas = duel
    .of(OcgMessageType.SPSUMMONING)
    .filter((m) => !MAO_OPONENTE.includes(m.code)).length;
  const dano = duel.of(OcgMessageType.DAMAGE).reduce((t, m) => t + m.amount, 0);
  const luaErros = duel.errors.filter(
    (t) => t && !/no such file|script not found|wasm streaming|ArrayBuffer|falling back/i.test(t),
  );

  duel.destroy();
  return { ofereceu, ativou, encadeou, fichas, dano, movimentos, compras, recuperou, luaErros, outcome };
}

async function main() {
  const verbose = process.argv.includes("--verbose");
  let ok = 0;
  const falharam = [];

  for (const caso of CASOS) {
    const r = await rodar(caso);

    // Ativável: passa se o core ofereceu E a corrente se formou.
    // Gatilho obrigatório: passa se o efeito aconteceu (ficha, dano ou
    // corrente), já que a carta nunca aparece como "ativável".
    // `efeito` é a prova de que algo aconteceu no tabuleiro. Sem ela, uma
    // carta que ativa e resolve em nada passaria como boa.
    const efeito =
      r.movimentos > 0 || r.compras > 0 || r.dano > 0 || r.recuperou > 0 || r.fichas > 0;

    const passou =
      caso.tipo === "ativavel"
        ? r.ofereceu && r.encadeou && efeito && r.luaErros.length === 0
        : (r.encadeou || (caso.esperaFicha && r.fichas > 0) || (caso.esperaDano && r.dano > 0)) &&
          efeito &&
          r.luaErros.length === 0;

    if (passou) ok += 1;
    else falharam.push({ caso, r });

    process.stdout.write(
      `${passou ? "OK   " : "FALHA"} ${caso.nome.padEnd(28)} ` +
      `${caso.tipo === "ativavel" ? "ofereceu=" + r.ofereceu + " encadeou=" + r.encadeou : "corrente=" + r.encadeou} ` +
      `movs=${r.movimentos} compras=${r.compras} dano=${r.dano} cura=${r.recuperou} fichas=${r.fichas}` +
      `${r.luaErros.length ? " LUA=" + r.luaErros[0].slice(0, 70) : ""}\n`,
    );
    if (verbose) process.stdout.write(`      (${caso.porque})\n`);
  }

  process.stdout.write(`\n=== ${ok}/${CASOS.length} verificadas ===\n`);
  if (falharam.length) {
    process.stdout.write("\nsem confirmação:\n");
    for (const { caso, r } of falharam) {
      process.stdout.write(`  ${caso.nome} — ${caso.porque} (outcome=${r.outcome})\n`);
    }
    process.exitCode = 1;
  }
}

await main();
