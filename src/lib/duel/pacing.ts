import { OcgMessageType } from "@n1xx1/ocgcore-wasm";

/**
 * O ritmo do duelo — quanto tempo cada acontecimento fica no ar antes de o
 * engine seguir para o próximo.
 *
 * Isto existe num módulo só porque duas partes precisam concordar sobre os
 * mesmos números: a animação (que desenha) e o laço de mensagens (que decide
 * quando avançar). Enquanto cada lado tinha a sua constante, o tabuleiro se
 * atualizava no meio da animação — o monstro destruído sumia com o atacante
 * ainda no ar, e o combate parecia picotado.
 */

/** Recuo + investida + pausa + volta do monstro que ataca. */
export const ATTACK_FLIGHT = {
  windUp: 170,
  lunge: 240,
  hold: 220,
  back: 220,
} as const;

export const ATTACK_FLIGHT_MS =
  ATTACK_FLIGHT.windUp + ATTACK_FLIGHT.lunge + ATTACK_FLIGHT.hold + ATTACK_FLIGHT.back;

/** Carta chegando na zona (`tf-anim-card-in` no globals.css). */
export const CARD_IN_MS = 260;

/**
 * Virada de turno: a faixa "TURN CHANGE" é a maior do duelo — e é quando o
 * jogador troca de "assisto" para "jogo" (ou o contrário).
 */
export const TURN_BEAT = 760;

/**
 * O corte de invocação do Master Duel: a arte do monstro em tela cheia, com o
 * nome e o ATK/DEF (`SummonCutIn`). A sessão espera ele inteiro — o clique
 * pula, como qualquer pausa (`hurry`).
 */
export const CUT_IN_MS = 1700;

/** Tremor da mesa e clarão de dano (`tf-shake` / `tf-hit-flash`). */
export const HIT_MS = 420;

/**
 * Giro da moeda e rolagem do dado (`useDuelFeedback`).
 *
 * O resultado muda o jogo — é ele que decide o efeito do Barrel Dragon, por
 * exemplo. O engine precisa esperar a animação inteira, senão o tabuleiro já
 * mostra a consequência antes de o jogador ver o sorteio.
 */
export const TOSS_MS = 1900;

/**
 * Quanto cada mensagem merece de tempo no turno do **oponente**.
 *
 * O turno do oponente é assistido: o jogador precisa entender o que aconteceu
 * sem ter causado. Os valores seguem a duração das animações correspondentes,
 * porque cortar antes do fim é exatamente o que fazia o combate parecer
 * atropelado.
 */
const BEAT: Partial<Record<OcgMessageType, number>> = {
  // O ataque é o momento mais longo do duelo por ser o mais coreografado.
  [OcgMessageType.ATTACK]: ATTACK_FLIGHT_MS,
  // O resultado da batalha precisa de um instante próprio: é quando o jogador
  // lê quem sobreviveu.
  [OcgMessageType.BATTLE]: 420,
  [OcgMessageType.DAMAGE]: HIT_MS,
  [OcgMessageType.RECOVER]: HIT_MS,
  // Ativação: o destaque da carta no centro (`ChainSpotlight`) precisa de
  // tempo para ser lido — "quem ativou o quê, de onde". Com 480 ms a Ash do
  // oponente ia da mão para o Cemitério antes de o olho chegar nela.
  [OcgMessageType.CHAINING]: 950,
  // Cada elo resolvendo acende na pilha; um instante basta para seguir a ordem.
  [OcgMessageType.CHAIN_SOLVING]: 380,
  // Negação é o desfecho da corrente: o carimbo "NEGADO" fica à vista.
  [OcgMessageType.CHAIN_NEGATED]: 900,
  [OcgMessageType.CHAIN_DISABLED]: 900,
  [OcgMessageType.NEW_TURN]: TURN_BEAT,
  [OcgMessageType.SUMMONING]: 420,
  [OcgMessageType.SPSUMMONING]: 420,
  [OcgMessageType.FLIPSUMMONING]: 420,
  [OcgMessageType.POS_CHANGE]: 260,
  // O voo da carta comprada dura ~380 ms por carta, escalonado; o suficiente
  // aqui é o jogador ver de onde ela veio antes do próximo acontecimento.
  [OcgMessageType.DRAW]: 320,
  [OcgMessageType.SET]: 260,
  // MOVE dispara para toda troca de zona, inclusive as internas que o jogador
  // não precisa acompanhar — e por volume é a mensagem mais frequente do
  // duelo. O que importa de uma movimentação relevante (invocar, baixar,
  // destruir) já tem batida própria acima, então aqui basta o suficiente para
  // a carta não teletransportar.
  [OcgMessageType.MOVE]: 90,
  // A revelação tem overlay próprio, que continua na tela depois desta pausa;
  // o suficiente aqui é o jogador perceber que algo foi revelado.
  [OcgMessageType.CONFIRM_CARDS]: 900,
  [OcgMessageType.CONFIRM_DECKTOP]: 900,
  [OcgMessageType.TOSS_COIN]: TOSS_MS,
  [OcgMessageType.TOSS_DICE]: TOSS_MS,
};

/**
 * Carta saindo do campo (`LeaveFlight`): o fantasma dela se desfaz na zona de
 * onde saiu. Destruição é o momento que mais se quer ver; ir para a mão ou o
 * Deck é só um deslize.
 */
export const LEAVE_MS = {
  battle: 640,
  destroy: 640,
  tribute: 360,
  material: 300,
  grave: 360,
  banish: 440,
  hand: 320,
  deck: 320,
} as const;

/** Pausa de uma saída do campo — ver `LEAVE_MS`. */
export function leaveBeat(why: keyof typeof LEAVE_MS, ownTurn: boolean): number {
  return Math.round(LEAVE_MS[why] * (ownTurn ? OWN_TURN_SCALE : 1));
}

/**
 * Troca de fase — o tempo de a faixa do Master Duel ("DRAW PHASE", "BATTLE
 * PHASE") atravessar a tela antes de o campo seguir. Era 200 ms, quando a fase
 * só acendia um botão da trilha; com a faixa, menos que isso a próxima a
 * atropelava antes de ser lida.
 */
const PHASE_BEAT = 340;


/**
 * Fração do tempo aplicada às jogadas do **próprio** jogador.
 *
 * Quem acabou de clicar já sabe o que fez; esperar o tempo cheio parece
 * travamento. Mas zerar também não serve — o ataque some antes de acontecer.
 */
const OWN_TURN_SCALE = 0.55;

/**
 * Mensagens cuja animação não pode ser encurtada nem no próprio turno.
 *
 * O voo do atacante tem duração fixa: se o engine seguir antes, o alvo é
 * removido do tabuleiro com a carta ainda no meio do caminho.
 */
const UNSKIPPABLE = new Set<OcgMessageType>([
  OcgMessageType.ATTACK,
  // O sorteio decide o efeito; encurtar mostraria o resultado antes da moeda.
  OcgMessageType.TOSS_COIN,
  OcgMessageType.TOSS_DICE,
]);

/**
 * Quanto pausar depois de uma mensagem, em milissegundos.
 *
 * @param ownTurn a jogada é do próprio jogador.
 */
export function beatFor(type: OcgMessageType, ownTurn: boolean): number {
  const base = BEAT[type];
  if (base === undefined) return 0;
  if (UNSKIPPABLE.has(type)) return base;
  return Math.round(base * (ownTurn ? OWN_TURN_SCALE : 1));
}

/** Pausa de troca de fase. */
export function phaseBeat(ownTurn: boolean): number {
  return Math.round(PHASE_BEAT * (ownTurn ? OWN_TURN_SCALE : 1));
}

/**
 * Teto por lote de mensagens.
 *
 * Uma jogada muito encadeada pode somar vários segundos de espera. O limite
 * corta o excesso — mas alto o bastante para uma sequência de combate inteira
 * (ataque + batalha + dano) caber sem ser atropelada, que era o defeito do
 * teto anterior, de 1400 ms.
 */
export const MAX_BEAT_PER_BATCH_MS = Math.max(ATTACK_FLIGHT_MS, TOSS_MS) + 900;
