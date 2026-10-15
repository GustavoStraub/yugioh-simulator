"use client";

import { DeckPreview } from "@/components/duel/DeckPreview";
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
      <select
        value={escolha.escolha ?? ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value || null)}
        className="mt-4 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-amber-600 disabled:opacity-50"
      >
        {gruposDeDecks(escolha).map((grupo) => (
          <optgroup key={grupo.label} label={grupo.label}>
            {grupo.opcoes.map((opcao) => (
              <option key={opcao.value} value={opcao.value}>
                {opcao.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <DeckPreview deck={escolha.deck} registry={registry} onCardHover={onCardHover} />
    </>
  );
}
