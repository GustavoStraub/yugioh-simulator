import {
  OcgLocation,
  OcgMessageType,
  OcgPosition,
  type OcgCardLoc,
  type OcgCardLocPos,
  type OcgMessage,
} from "@n1xx1/ocgcore-wasm";

/**
 * Esconde, num prompt, o passcode das cartas que o assento perguntado não tem
 * direito de ver.
 *
 * O core manda o `code` verdadeiro de TODO candidato de um SELECT_CARD, sem se
 * importar se o jogador podia olhar aquela carta. Para quase todo efeito isso é
 * inócuo (os candidatos são cartas suas, ou já viradas para cima), mas há uma
 * família em que é justamente o segredo do efeito:
 *
 * - **O Espião Inexperiente** — "escolha e veja 1 card na mão do seu
 *   adversário". O core pede a escolha ANTES de revelar (`SELECT_CARD` →
 *   `CONFIRM_CARDS`); com os códigos na mensagem, a tela mostrava a mão inteira
 *   aberta e a escolha não escolhia nada.
 * - **Confisco / Armadilha Poeira / Sentinela Poderosa** — aqui é o contrário:
 *   o efeito revela a mão PRIMEIRO (`CONFIRM_CARDS` → `SELECT_CARD`), e aí a
 *   face tem que aparecer, senão o jogador escolhe no escuro uma carta que a
 *   regra manda ele ver.
 *
 * A diferença entre as duas está só na ORDEM das mensagens, e é por isso que a
 * máscara depende do que já foi revelado (`revealed`, alimentado pelos
 * `CONFIRM_CARDS` da resolução corrente) em vez de olhar a carta em si.
 *
 * Mascarar aqui, e não na tela, é o que faz o código nem atravessar o socket:
 * num duelo online o prompt vai inteiro para o cliente, e um `console.log` no
 * navegador leria a mão do adversário.
 */

/** Chave de identidade de uma carta numa zona — igual à do `cardKey` da UI. */
export function maskKey(
  controller: number,
  location: number,
  sequence: number,
): string {
  return `${controller}:${location}:${sequence}`;
}

/** Zonas cujo conteúdo é secreto para quem não é o dono. */
const ZONAS_SECRETAS =
  OcgLocation.HAND | OcgLocation.DECK | OcgLocation.EXTRA;

/**
 * O assento `viewer` pode ver a face desta carta?
 *
 * Vale para candidato de prompt, não para o tabuleiro (que é lido do core com
 * a máscara dele, em `readBoardState`).
 */
function podeVer(
  card: { controller: number; location: number; position?: number },
  viewer: 0 | 1,
): boolean {
  if (card.controller === viewer) return true;
  const secreta =
    (card.location & ZONAS_SECRETAS) !== 0 ||
    ((card.position ?? 0) & OcgPosition.FACEDOWN) !== 0;
  return !secreta;
}

/** Devolve o candidato com o passcode zerado quando ele é segredo. */
function mascarar<T extends OcgCardLoc | OcgCardLocPos>(
  card: T,
  viewer: 0 | 1,
  revealed: ReadonlySet<string>,
): T {
  if (podeVer(card, viewer)) return card;
  if (revealed.has(maskKey(card.controller, card.location, card.sequence))) {
    return card;
  }
  // 0 é o "não sei que carta é" que o resto do app já entende: o registry não
  // acha nada e a tela desenha o verso.
  return { ...card, code: 0 };
}

/**
 * Prompt pronto para ser publicado no snapshot.
 *
 * Só os dois prompts que listam cartas de qualquer lugar do campo passam pela
 * máscara — os outros (tributo, soma, corrente, comandos de fase) só oferecem
 * cartas do próprio jogador, e mexer neles seria arriscar esconder o que ele
 * precisa ver para jogar.
 *
 * @param viewer assento a quem o prompt será mostrado.
 * @param revealed identidades (`maskKey`) já reveladas a esse assento na
 *   resolução corrente.
 */
export function maskHiddenCards(
  message: OcgMessage,
  viewer: 0 | 1,
  revealed: ReadonlySet<string>,
): OcgMessage {
  switch (message.type) {
    case OcgMessageType.SELECT_CARD:
      return {
        ...message,
        selects: message.selects.map((card) => mascarar(card, viewer, revealed)),
      };
    case OcgMessageType.SELECT_UNSELECT_CARD:
      return {
        ...message,
        select_cards: message.select_cards.map((card) =>
          mascarar(card, viewer, revealed),
        ),
        unselect_cards: message.unselect_cards.map((card) =>
          mascarar(card, viewer, revealed),
        ),
      };
    default:
      return message;
  }
}
