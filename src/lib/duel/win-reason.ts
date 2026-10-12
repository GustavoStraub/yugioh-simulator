/**
 * Por que o duelo acabou, em uma frase.
 *
 * O core manda um número em `WIN.reason` e a tela mostrava só quem ganhou. Nos
 * finais que **não** passam por dano — deck vazio, Exodia, rendição — o
 * resultado aparecia sem explicação nenhuma, e a barra de LP não conta essa
 * história (ela fica em 8000 nos três casos).
 *
 * Fica num módulo à parte para o harness poder verificar as duas metades: que
 * os códigos do core são estes (`test-endgame`) e que cada um vira a frase
 * certa. Um código que mude de significado numa versão nova do ocgcore
 * passaria a produzir uma frase confiante e errada — o pior resultado possível
 * para um texto que explica uma derrota.
 */

/**
 * Códigos de `WIN.reason`, conferidos rodando cada final no ocgcore que este
 * app usa (ver `tools/harness/test-endgame.mjs`).
 */
export const WIN_REASON = {
  /** Rendição pelo core. O app não usa: a nossa não passa pelo engine. */
  SURRENDER: 0,
  LP_ZERO: 1,
  DECK_EMPTY: 2,
  /** Vitória por efeito de carta — no Goat, quase sempre Exodia. */
  EFFECT: 16,
} as const;

export interface WinNames {
  winner: string;
  loser: string;
}

/**
 * @param exodiaReunido as cinco partes estavam na mão do vencedor? Só faz
 *   diferença numa vitória por efeito, e é o que separa "venceu pelo efeito de
 *   uma carta" da frase que o jogador esperava ler.
 * @returns a frase, ou `null` quando o motivo é desconhecido — nesse caso a
 *   tela mostra só o vencedor, que é melhor do que uma explicação inventada.
 */
export function describeWinReason(
  reason: number,
  names: WinNames,
  exodiaReunido = false,
): string | null {
  switch (reason) {
    case WIN_REASON.SURRENDER:
      return `${names.loser} se rendeu.`;
    case WIN_REASON.LP_ZERO:
      return `Os pontos de vida de ${names.loser} chegaram a 0.`;
    case WIN_REASON.DECK_EMPTY:
      return `${names.loser} ficou sem cartas para comprar.`;
    case WIN_REASON.EFFECT:
      return exodiaReunido
        ? "Exodia, o Proibido, foi reunido — obliterado!"
        : `${names.winner} venceu pelo efeito de uma carta.`;
    default:
      return null;
  }
}

/** As cinco partes de Exodia, em passcode canônico (sem arte alternativa). */
export const EXODIA_PECAS = [33396948, 7902349, 70903634, 44519536, 8124921];
