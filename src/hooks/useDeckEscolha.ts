"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useClientSnapshot } from "@/hooks/useClientSnapshot";
import { usePlayer } from "@/context/PlayerProvider";
import { PRESET_DECKS } from "@/lib/data/preset-decks-catalog";
import { fetchDecks, SELECTED_DECK_KEY } from "@/lib/domain/deck-library";
import { createEmptyDeck } from "@/lib/domain/deck-operations";
import { deckToDuelPayload } from "@/lib/domain/deck-serializer";
import { isDeckDuelReady } from "@/lib/domain/deck-rules";
import { DECK_STORAGE_KEY, loadDeck } from "@/lib/domain/deck-storage";
import { presetToDuelPayload } from "@/lib/domain/preset-decks";
import type { DeckList, DuelDeckPayload } from "@/lib/types";

/** Deck renderizado no servidor, onde não existe localStorage. */
const SEM_DECK: DeckList = createEmptyDeck("Meu Deck Goat");

/**
 * O deck escolhido para o duelo.
 *
 * Pode ser o id de um deck da BIBLIOTECA do jogador (a coleção que vive no
 * servidor, por perfil) ou o id de um deck pronto. `null` significa "o deck
 * aberto no construtor", que é o espelho gravado em `localStorage` — o valor de
 * reserva para quando a biblioteca ainda não chegou, falhou ou está vazia.
 *
 * Os dois espaços de id não colidem: os prontos são apelidos fixos
 * (`starter-yugi`), os da biblioteca são aleatórios. É o que permite guardar a
 * escolha num campo só, e o que faz uma escolha antiga (só de preset) continuar
 * valendo depois desta mudança.
 */
export type EscolhaDeDeck = string | null;

export interface DeckEscolha {
  escolha: EscolhaDeDeck;
  setEscolha: (escolha: EscolhaDeDeck) => void;
  /** Decks do jogador; `null` enquanto a biblioteca não chegou. */
  biblioteca: DeckList[] | null;
  /** Nome do deck aberto no construtor, para rotular a opção de reserva. */
  meuDeckNome: string;
  meuDeckPronto: boolean;
  /** O deck escolhido tem cartas suficientes para duelar. */
  pronto: boolean;
  deckName: string;
  deck: DuelDeckPayload;
  /**
   * Resolve uma escolha QUALQUER, sem passar pelo state.
   *
   * Necessário porque quem troca o deck precisa mandá-lo pela rede no mesmo
   * gesto: ler `deck` logo depois de `setEscolha` devolveria o deck anterior,
   * e recalcular à mão no chamador duplicaria a regra que mora aqui.
   */
  resolve: (escolha: EscolhaDeDeck) => {
    deck: DuelDeckPayload;
    deckName: string;
    pronto: boolean;
  };
}

/**
 * A escolha de deck do duelo, compartilhada pelos lobbies e pela sala online.
 *
 * Antes daqui só saía UM deck do jogador — o espelho em `localStorage` do deck
 * aberto no construtor. Quem tinha cinco decks montados só conseguia levar para
 * a mesa o último que abriu, e a lista de decks prontos aparecia no lugar dos
 * seus. A biblioteca de verdade mora no servidor (`/api/decks`, por perfil), e é
 * ela que este hook oferece.
 */
export function useDeckEscolha(inicial: EscolhaDeDeck = null): DeckEscolha {
  const { profile } = usePlayer();
  const meuDeck = useClientSnapshot<DeckList>(
    DECK_STORAGE_KEY,
    useCallback(() => localStorage.getItem(DECK_STORAGE_KEY), []),
    useCallback(() => loadDeck(), []),
    SEM_DECK,
  );
  const lembrado = useClientSnapshot<string | null>(
    SELECTED_DECK_KEY,
    useCallback(() => localStorage.getItem(SELECTED_DECK_KEY), []),
    useCallback((raw: string | null) => raw, []),
    null,
  );

  const [biblioteca, setBiblioteca] = useState<DeckList[] | null>(null);
  /** `null` = ninguém escolheu ainda; aí vale o padrão derivado abaixo. */
  const [escolhido, setEscolhido] = useState<EscolhaDeDeck>(inicial);

  useEffect(() => {
    if (!profile) return;
    let vivo = true;
    fetchDecks(profile)
      .then((decks) => {
        if (vivo) setBiblioteca(decks);
      })
      // Sem biblioteca o hook continua servindo o deck do navegador — é o
      // mesmo comportamento de antes, e não vale derrubar o lobby por isso.
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [profile]);

  return useMemo(() => {
    const meuDeckPronto = isDeckDuelReady(meuDeck);

    // Padrão: o deck que está aberto no construtor. Derivado em vez de escrito
    // no state por um efeito — assim a chegada da biblioteca não custa um
    // render a mais nem depende de ordem (ver `useClientSnapshot`).
    const padrao =
      biblioteca?.find((deck) => deck.id === lembrado)?.id ??
      biblioteca?.find((deck) => deck.id === meuDeck.id)?.id ??
      biblioteca?.[0]?.id ??
      null;
    const escolha = escolhido ?? padrao;

    const resolve = (alvo: EscolhaDeDeck) => {
      const preset = PRESET_DECKS.find((item) => item.id === alvo);
      if (preset) {
        return {
          deck: presetToDuelPayload(preset),
          deckName: preset.namePt,
          pronto: true,
        };
      }
      const daBiblioteca = biblioteca?.find((deck) => deck.id === alvo);
      const deck = daBiblioteca ?? meuDeck;
      return {
        deck: deckToDuelPayload(deck),
        deckName: deck.name,
        pronto: isDeckDuelReady(deck),
      };
    };

    return {
      escolha,
      setEscolha: setEscolhido,
      biblioteca,
      meuDeckNome: meuDeck.name,
      meuDeckPronto,
      ...resolve(escolha),
      resolve,
    };
  }, [escolhido, meuDeck, biblioteca, lembrado]);
}

/** Uma opção do `<select>` de decks. */
export interface OpcaoDeDeck {
  value: string;
  label: string;
}

/** Um `<optgroup>`: os decks do jogador de um lado, os prontos do outro. */
export interface GrupoDeDecks {
  label: string;
  opcoes: OpcaoDeDeck[];
}

/** Quantas cartas o main deck tem — é o número que diz se dá para duelar. */
function totalDoMain(deck: DeckList): number {
  return deck.main.reduce((total, ref) => total + ref.quantity, 0);
}

/**
 * As opções do seletor, separadas em "meus decks" e "decks prontos".
 *
 * A separação não é decoração: com dez decks prontos na mesma lista, os decks
 * do jogador ficavam perdidos no meio de baralhos que ele nunca montou.
 */
export function gruposDeDecks(escolha: DeckEscolha): GrupoDeDecks[] {
  const meus = escolha.biblioteca?.length
    ? escolha.biblioteca.map((deck) => ({
        value: deck.id,
        label: `${deck.name}${deck.format === "tcg" ? " · TCG" : ""} (${totalDoMain(deck)} cartas)${
          isDeckDuelReady(deck) ? "" : " — incompleto"
        }`,
      }))
    : // Biblioteca vazia ou indisponível: sobra o deck aberto no construtor,
      // sob o valor de reserva (`""` = `null`).
      [
        {
          value: "",
          label: `${escolha.meuDeckNome}${
            escolha.meuDeckPronto ? "" : " — incompleto"
          }`,
        },
      ];
  // (o rótulo de reserva não traz contagem: o deck do navegador é o que está
  // aberto no construtor, e a contagem dele já está na tela de lá)

  return [
    { label: "Meus decks", opcoes: meus },
    {
      label: "Decks prontos",
      opcoes: PRESET_DECKS.map((item) => ({
        value: item.id,
        label: `${item.namePt}${item.format === "tcg" ? " · TCG" : ""} (${item.main.length} cartas)`,
      })),
    },
  ];
}
