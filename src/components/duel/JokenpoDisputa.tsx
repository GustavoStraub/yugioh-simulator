"use client";

import { playSfx } from "@/lib/audio/sfx";
import {
  JOKENPO_JOGADAS,
  JOKENPO_ROTULO,
  type JokenpoJogada,
} from "@/lib/duel/jokenpo";
import type { JokenpoState } from "@/lib/net/duel-protocol";

/**
 * Pedra, papel e tesoura pelo primeiro turno.
 *
 * Fica entre "os dois prontos" e o duelo. Antes o servidor sorteava quem
 * começava e ninguém via nada acontecer; aqui a decisão é jogada — e quem ganha
 * escolhe **começar ou não**, que é a escolha que existe na mesa de verdade.
 *
 * A jogada do adversário só aparece depois de os dois terem jogado, e isso é
 * garantido no servidor (`jokenpoState`): se a tela pudesse mostrar antes,
 * bastava esperar para ganhar sempre.
 */
export function JokenpoDisputa({
  estado,
  nomeDoOponente,
  onJogar,
  onEscolherOrdem,
}: {
  estado: JokenpoState;
  nomeDoOponente: string;
  onJogar: (jogada: JokenpoJogada) => void;
  onEscolherOrdem: (primeiro: boolean) => void;
}) {
  const { last: ultima } = estado;

  return (
    <section className="rounded-2xl border border-amber-900/40 bg-zinc-950/80 p-6">
      <h2 className="text-lg font-semibold text-amber-300">
        Quem começa · rodada {estado.round}
      </h2>
      <p className="mt-1 text-sm text-zinc-500">
        Pedra, papel e tesoura. Quem ganhar escolhe jogar o primeiro ou o
        segundo turno — no Goat essa escolha vale mais que uma carta.
      </p>

      {/* O que saiu na rodada anterior. No empate as duas jogadas aparecem
          juntas, que é a única forma de "jogar de novo" não parecer um erro
          da tela. */}
      {ultima && (
        <p className="mt-4 rounded-lg border border-zinc-800 bg-black/40 px-3 py-2 text-sm text-zinc-300">
          <span className="font-semibold text-zinc-100">
            {JOKENPO_ROTULO[ultima.mine].emoji} você
          </span>{" "}
          contra{" "}
          <span className="font-semibold text-zinc-100">
            {JOKENPO_ROTULO[ultima.theirs].emoji} {nomeDoOponente}
          </span>{" "}
          ·{" "}
          {ultima.outcome === "empate"
            ? "empate — joguem de novo"
            : ultima.outcome === "ganhei"
              ? "você ganhou"
              : `${nomeDoOponente} ganhou`}
        </p>
      )}

      {estado.chooseFirst ? (
        <div className="mt-5">
          <p className="text-sm text-emerald-300">
            Você ganhou o jokenpô. Começa jogando?
          </p>
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              onClick={() => {
                playSfx("click");
                onEscolherOrdem(true);
              }}
              className="flex-1 rounded-xl bg-amber-600 px-4 py-3 text-sm font-semibold text-black transition hover:bg-amber-500"
            >
              Jogar primeiro
            </button>
            <button
              type="button"
              onClick={() => {
                playSfx("click");
                onEscolherOrdem(false);
              }}
              className="flex-1 rounded-xl border border-zinc-700 px-4 py-3 text-sm font-semibold text-zinc-100 transition hover:border-amber-700 hover:text-amber-200"
            >
              Jogar por último
            </button>
          </div>
        </div>
      ) : estado.waitingChoice ? (
        <p className="mt-5 text-sm text-amber-200">
          {nomeDoOponente} ganhou e está escolhendo quem começa…
        </p>
      ) : (
        <div className="mt-5">
          <div className="flex gap-3">
            {JOKENPO_JOGADAS.map((jogada) => {
              const rotulo = JOKENPO_ROTULO[jogada];
              const escolhida = estado.mine === jogada;
              return (
                <button
                  key={jogada}
                  type="button"
                  // Trocar de jogada depois de escolher permitiria ficar
                  // mudando até o outro jogar; o servidor recusaria, então o
                  // botão também recusa.
                  disabled={estado.mine !== null}
                  onClick={() => {
                    playSfx("click");
                    onJogar(jogada);
                  }}
                  className={`flex flex-1 flex-col items-center gap-1 rounded-xl border px-4 py-4 transition disabled:cursor-not-allowed ${
                    escolhida
                      ? "border-amber-500 bg-amber-900/30 text-amber-200"
                      : "border-zinc-700 text-zinc-100 hover:border-amber-700 hover:text-amber-200 disabled:opacity-40"
                  }`}
                >
                  <span className="text-3xl leading-none">{rotulo.emoji}</span>
                  <span className="text-sm font-semibold">{rotulo.nome}</span>
                </button>
              );
            })}
          </div>

          <p className="mt-3 text-sm text-zinc-400">
            {estado.mine === null
              ? estado.opponentChose
                ? `${nomeDoOponente} já jogou. Sua vez — ele não vê a sua escolha.`
                : "Escolha a sua jogada."
              : estado.opponentChose
                ? "Resolvendo…"
                : `Jogada feita. Esperando ${nomeDoOponente}…`}
          </p>
        </div>
      )}
    </section>
  );
}
