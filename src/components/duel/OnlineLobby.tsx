"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { useCardRegistry } from "@/context/CardRegistryProvider";
import { usePlayer } from "@/context/PlayerProvider";
import { useClientSnapshot } from "@/hooks/useClientSnapshot";
import { useDeckEscolha } from "@/hooks/useDeckEscolha";
import { DeckSelect } from "@/components/duel/DeckSelect";
import { DeckSelectionLayout } from "@/components/duel/DeckSelectionLayout";
import {
  defaultPlayerName,
  ONLINE_TOKEN_KEY,
  saveOnlineSetup,
} from "@/lib/duel/online-storage";
import {
  isRoomCode,
  normalizeRoomCode,
  randomRoomCode,
  ROOM_CODE_LENGTH,
} from "@/lib/net/duel-protocol";
import { ehOrigemLocal } from "@/lib/net/origem";

export function OnlineLobby({ initialRoom = "" }: { initialRoom?: string }) {
  const router = useRouter();
  const { isLoading, error, registry } = useCardRegistry();
  const { profile } = usePlayer();
  const deckEscolhido = useDeckEscolha();
  const [hoveredCode, setHoveredCode] = useState<number | null>(null);

  // O nome do perfil é o sugerido; o token da aba é só a rede de segurança
  // para quem abrir uma segunda aba e quiser dois duelistas distintos.
  const nomeDaAba = useClientSnapshot<string>(
    ONLINE_TOKEN_KEY,
    useCallback(() => sessionStorage.getItem(ONLINE_TOKEN_KEY), []),
    useCallback(() => defaultPlayerName(), []),
    "",
  );
  const nomeSugerido = profile?.name || nomeDaAba;
  const [nomeDigitado, setNomeDigitado] = useState("");
  const nome = nomeDigitado || nomeSugerido;

  const [codigo, setCodigo] = useState(normalizeRoomCode(initialRoom));
  const [convites, setConvites] = useState<string[]>([]);

  /**
   * Endereços da máquina na rede.
   *
   * Só fazem sentido quando o jogo está sendo servido DENTRO da rede: pelo
   * túnel ou por um domínio público, um `192.168.x.y` não leva o amigo a lugar
   * nenhum — quem chegou pela URL pública já tem o endereço certo na barra.
   */
  useEffect(() => {
    if (!ehOrigemLocal(window.location.hostname)) return;

    let vivo = true;
    fetch("/api/duel/net-info")
      .then((response) => response.json())
      .then((payload: { urls?: string[] }) => {
        if (vivo) setConvites(payload.urls ?? []);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  const deckPronto = deckEscolhido.pronto;

  function entrar(codigoAlvo: string) {
    saveOnlineSetup({
      name: nome.trim() || defaultPlayerName(),
      deckName: deckEscolhido.deckName,
      deck: deckEscolhido.deck,
      presetId: deckEscolhido.escolha,
    });
    router.push(`/duel/online/${codigoAlvo}`);
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-zinc-400">Carregando catálogo de cartas...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-red-300">{error}</p>
      </div>
    );
  }

  const actions = (
    <>
      <section className="rounded-2xl border border-amber-900/40 bg-zinc-950/80 p-6">
        <h2 className="text-lg font-semibold text-amber-300">Sala</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Crie uma sala e mande o link para o amigo, ou entre com o código dele.
        </p>

        <div className="room-code-entry mt-4 flex flex-wrap gap-2">
          <input
            value={codigo}
            onChange={(event) => setCodigo(normalizeRoomCode(event.target.value))}
            placeholder="CÓDIGO"
            aria-label="Código da sala"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={ROOM_CODE_LENGTH}
            className="w-32 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-center font-mono text-lg tracking-[0.3em] text-zinc-100 outline-none focus:border-amber-600"
          />
          <button
            type="button"
            disabled={!deckPronto || !isRoomCode(codigo)}
            onClick={() => entrar(normalizeRoomCode(codigo))}
            className="flex-1 rounded-xl border border-amber-700/60 px-4 py-3 text-sm font-semibold text-amber-300 transition hover:bg-amber-900/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Entrar na sala
          </button>
        </div>

        <button
          type="button"
          disabled={!deckPronto}
          onClick={() => entrar(randomRoomCode())}
          className="mt-3 w-full rounded-xl bg-amber-600 px-6 py-3 text-sm font-semibold text-black transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Criar sala nova
        </button>
      </section>

      {convites.length > 0 && (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-6">
          <h2 className="text-sm font-semibold text-zinc-300">
            Endereço desta máquina na rede
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            É por aqui que um amigo do mesmo Wi-Fi abre o jogo —{" "}
            <code className="text-zinc-400">localhost</code> só funciona para você.
          </p>
          <ul className="mt-3 space-y-1">
            {convites.map((url) => (
              <li key={url} className="break-all font-mono text-sm text-amber-300">
                {url}/duel/online
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );

  return (
    <DeckSelectionLayout registry={registry} hoveredCode={hoveredCode} actions={actions}>
      <section className="rounded-2xl border border-amber-900/40 bg-zinc-950/80 p-6">
        <h2 className="text-lg font-semibold text-amber-300">Seu nome</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Cada aba é um jogador — abra esta página numa segunda aba para duelar
          contra você mesmo.
        </p>
        <input
          value={nome}
          onChange={(event) => setNomeDigitado(event.target.value)}
          maxLength={24}
          className="mt-4 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-amber-600"
        />
      </section>

      <section className="rounded-2xl border border-amber-900/40 bg-zinc-950/80 p-6">
        <h2 className="text-lg font-semibold text-amber-300">Seu deck</h2>
        <DeckSelect
          escolha={deckEscolhido}
          onChange={(valor) => deckEscolhido.setEscolha(valor)}
          onCardHover={setHoveredCode}
        />
        {!deckPronto && (
          <p className="mt-3 text-sm text-amber-200">
            Seu deck tem menos de 40 cartas.{" "}
            <Link href="/" className="underline underline-offset-2">
              Voltar ao deck builder
            </Link>{" "}
            ou escolha um deck pronto acima.
          </p>
        )}
      </section>

    </DeckSelectionLayout>
  );
}
