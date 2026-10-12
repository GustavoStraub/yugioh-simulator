"use client";

import { useMemo } from "react";

import { usePlayer } from "@/context/PlayerProvider";
import { cardDesc, cardName } from "@/lib/i18n/language";
import type { CardDefinition } from "@/lib/types";

/**
 * Nome e texto da carta no idioma escolhido pelo jogador.
 *
 * Um hook em vez de passar `language` de componente em componente: quem mostra
 * carta são folhas espalhadas (a lista do catálogo, o slot da mesa, os modais),
 * e enfiar a preferência por todos os níveis intermediários sujaria assinaturas
 * que não têm nada a ver com idioma.
 */
export function useCardText() {
  const { language } = usePlayer();

  return useMemo(
    () => ({
      name: (card: CardDefinition) => cardName(card, language),
      desc: (card: CardDefinition) => cardDesc(card, language),
      language,
    }),
    [language],
  );
}
