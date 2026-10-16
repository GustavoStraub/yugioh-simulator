"use client";

import { DeckPreview } from "@/components/duel/DeckPreview";
import { DeckSearchSelect } from "@/components/deck-builder/DeckSearchSelect";
import { useCardRegistry } from "@/context/CardRegistryProvider";
import { gruposDeDecks, type DeckEscolha } from "@/hooks/useDeckEscolha";
import type { Passcode } from "@/lib/types";

/**
 * Seletor e prévia do deck, compartilhados pelo lobby do bot, lobby online e
 * sala de espera.
 *
 * Vive num componente porque a lista é a mesma e o agrupamento também — e
 * porque a conversão "valor do `<option>` ↔ escolha" tem uma sutileza: o
 * `<option>` não guarda `null`, então a opção de reserva (o deck aberto no
 * construtor) usa `""`. Traduzir isso em cada tela era o tipo de detalhe que
 * fica certo em duas e errado na terceira.
 */
export function DeckSelect({
  escolha,
  onChange,
  onCardHover,
  disabled = false,
}: {
  escolha: DeckEscolha;
  onChange: (valor: string | null) => void;
  onCardHover?: (code: Passcode) => void;
  disabled?: boolean;
}) {
  const { registry } = useCardRegistry();

  return (
    <>
      <DeckSearchSelect
        value={escolha.escolha ?? ""}
        disabled={disabled}
        onChange={(value) => onChange(value || null)}
        grupos={gruposDeDecks(escolha)}
        label="Seu deck"
        className="mt-4"
      />
      <DeckPreview deck={escolha.deck} registry={registry} onCardHover={onCardHover} />
    </>
  );
}
