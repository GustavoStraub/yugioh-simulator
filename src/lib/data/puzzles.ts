import type { ScenarioCard } from "@/lib/duel/duel-session";
import type { DuelFormat } from "@/lib/types";

/**
 * Duelos-problema: "vença neste turno".
 *
 * O jeito de aprender que o Tag Force Special e os portões do Master Duel
 * usam — uma mesa montada, um objetivo, e a carta certa na hora certa. Cada
 * problema daqui tem a solução jogada no engine real pelo
 * `test:puzzles` (e, quando há uma, a armadilha que pune o caminho ingênuo):
 * um puzzle sem solução, ou com uma solução óbvia demais, não chega à tela.
 *
 * `scenario` é escrito do ponto de vista de quem joga (`player: 0`); os decks
 * só existem para o core ter de onde comprar — ninguém compra mão inicial no
 * modo puzzle.
 */
export interface DuelPuzzle {
  id: string;
  title: string;
  /** O que vencer significa aqui, em uma frase. */
  goal: string;
  /** Uma dica que não entrega a solução. */
  hint: string;
  /** A solução por extenso — mostrada só a pedido, depois de errar. */
  solution: string;
  format: DuelFormat;
  /** [quem joga, oponente]. */
  lifePoints: [number, number];
  scenario: ScenarioCard[];
  deck: number[];
  opponentDeck: number[];
}

const CARTA = {
  raigeki: 12580477,
  mst: 5318639,
  mirrorForce: 44095762,
  changeOfHeart: 4031928,
  elf: 69140098, // Gemini Elf — 1900
  horseman: 68516705, // Mystic Horseman — 1300, normal
  celtic: 91152256, // Celtic Guardian — 1400
} as const;

const MAO = 2; // OcgLocation.HAND
const CAMPO_MONSTRO = 4; // OcgLocation.MZONE
const CAMPO_MAGIA = 8; // OcgLocation.SZONE
const VIRADA_PARA_BAIXO = 0xa; // OcgPosition.FACEDOWN

/** Deck de enchimento: monstro normal, sem efeito — não muda o problema. */
const ENCHIMENTO = Array(40).fill(CARTA.horseman) as number[];

export const PUZZLES: DuelPuzzle[] = [
  {
    id: "raio-final",
    title: "Raio final",
    goal: "O oponente tem 1900 LP e dois monstros. Vença neste turno.",
    hint: "Seu monstro tem exatamente o ataque que falta — o problema é quem está no caminho.",
    solution: "Ative Raigeki (destrói todos os monstros do oponente) e ataque diretamente com os Elfos Gêmeos: 1900 de dano.",
    format: "tcg",
    lifePoints: [8000, 1900],
    scenario: [
      { player: 0, location: MAO, code: CARTA.raigeki },
      { player: 0, location: CAMPO_MONSTRO, sequence: 2, code: CARTA.elf },
      { player: 1, location: CAMPO_MONSTRO, sequence: 1, code: CARTA.elf },
      { player: 1, location: CAMPO_MONSTRO, sequence: 3, code: CARTA.horseman },
    ],
    deck: ENCHIMENTO,
    opponentDeck: ENCHIMENTO,
  },
  {
    id: "abra-caminho",
    title: "Abra caminho",
    goal: "O oponente tem 2000 LP, um monstro e uma carta baixada. Vença neste turno.",
    hint: "Atacar de peito aberto contra uma carta baixada costuma sair caro.",
    solution:
      "Ative o Tufão Espacial Místico na carta baixada (é uma Força do Espelho). Depois ataque o Centauro Místico com os Elfos Gêmeos (600 de dano) e ataque diretamente com o Guardião Celta (1400): 2000.",
    format: "tcg",
    lifePoints: [8000, 2000],
    scenario: [
      { player: 0, location: MAO, code: CARTA.mst },
      { player: 0, location: CAMPO_MONSTRO, sequence: 1, code: CARTA.elf },
      { player: 0, location: CAMPO_MONSTRO, sequence: 3, code: CARTA.celtic },
      { player: 1, location: CAMPO_MONSTRO, sequence: 2, code: CARTA.horseman },
      { player: 1, location: CAMPO_MAGIA, sequence: 2, code: CARTA.mirrorForce, position: VIRADA_PARA_BAIXO },
    ],
    deck: ENCHIMENTO,
    opponentDeck: ENCHIMENTO,
  },
  {
    id: "mudanca-de-opiniao",
    title: "Mudança de opinião",
    goal: "O oponente tem 3200 LP e um monstro mais forte que o seu. Vença neste turno.",
    hint: "O monstro mais forte da mesa não precisa ser o seu adversário.",
    solution:
      "Ative Mudança de Opinião e tome os Elfos Gêmeos do oponente. Ataque diretamente com eles (1900) e com o Centauro Místico (1300): 3200.",
    format: "tcg",
    lifePoints: [8000, 3200],
    scenario: [
      { player: 0, location: MAO, code: CARTA.changeOfHeart },
      { player: 0, location: CAMPO_MONSTRO, sequence: 2, code: CARTA.horseman },
      { player: 1, location: CAMPO_MONSTRO, sequence: 2, code: CARTA.elf },
    ],
    deck: ENCHIMENTO,
    opponentDeck: ENCHIMENTO,
  },
];

export function puzzleById(id: string | undefined | null): DuelPuzzle | undefined {
  return PUZZLES.find((puzzle) => puzzle.id === id);
}
