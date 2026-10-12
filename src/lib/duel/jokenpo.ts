/**
 * Pedra, papel e tesoura — quem decide o primeiro turno.
 *
 * No formato Goat o primeiro turno vale demais para ser sorteado em silêncio
 * pelo servidor: quem ganha escolhe **começar ou não**, que é a decisão de
 * verdade (contra um deck de mão explosiva dá para preferir o segundo turno).
 * Era o que faltava para a sala parecer uma mesa: nas duas pontas se joga, em
 * vez de o resultado aparecer pronto.
 *
 * Módulo separado e sem dependência de nada porque as duas pontas precisam
 * dele: o servidor resolve a rodada, a tela desenha as opções — e o harness
 * confere as duas coisas.
 */

export type JokenpoJogada = "pedra" | "papel" | "tesoura";

/** Na ordem em que a tela mostra os botões. */
export const JOKENPO_JOGADAS: readonly JokenpoJogada[] = [
  "pedra",
  "papel",
  "tesoura",
];

/** O que cada jogada ganha. É daqui que sai o resultado — e só daqui. */
const GANHA_DE: Record<JokenpoJogada, JokenpoJogada> = {
  pedra: "tesoura",
  papel: "pedra",
  tesoura: "papel",
};

export const JOKENPO_ROTULO: Record<
  JokenpoJogada,
  { nome: string; emoji: string }
> = {
  pedra: { nome: "Pedra", emoji: "✊" },
  papel: { nome: "Papel", emoji: "✋" },
  tesoura: { nome: "Tesoura", emoji: "✌️" },
};

/**
 * Resolve uma rodada.
 *
 * @returns `1` se `a` ganha, `-1` se `b` ganha, `0` no empate — e empate aqui
 *   não é resultado, é "joga de novo" (ver `DuelRoom.jogarJokenpo`).
 */
export function jokenpoResultado(
  a: JokenpoJogada,
  b: JokenpoJogada,
): 1 | 0 | -1 {
  if (a === b) return 0;
  return GANHA_DE[a] === b ? 1 : -1;
}

/** A jogada veio de um cliente, então precisa ser conferida. */
export function isJokenpoJogada(value: unknown): value is JokenpoJogada {
  return (
    typeof value === "string" &&
    (JOKENPO_JOGADAS as readonly string[]).includes(value)
  );
}
