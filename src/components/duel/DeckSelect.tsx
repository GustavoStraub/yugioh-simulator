"use client";

import { DeckCombobox } from "@/components/duel/DeckCombobox";
import { gruposDeDecks, type DeckEscolha } from "@/hooks/useDeckEscolha";

/**
 * O seletor do SEU deck, igual nos três lugares onde se escolhe deck: lobby
 * do bot, lobby online e sala de espera — uma lista suspensa com busca
 * (`DeckCombobox`).
 *
 * Vive num componente porque a lista é a mesma e o agrupamento também — e
 * porque a conversão "valor da opção ↔ escolha" tem uma sutileza: a opção não
 * guarda `null`, então a de reserva (o deck aberto no construtor) usa `""`.
 * Traduzir isso em cada tela era o tipo de detalhe que fica certo em duas e
 * errado na terceira.
 */
export function DeckSelect({
  escolha,
  onChange,
  disabled = false,
}: {
  escolha: DeckEscolha;
  onChange: (valor: string | null) => void;
  disabled?: boolean;
}) {
  return (
    <DeckCombobox
      nome="meu-deck"
      rotulo="Seu deck"
      grupos={gruposDeDecks(escolha)}
      value={escolha.escolha ?? ""}
      disabled={disabled}
      onChange={(valor) => onChange(valor || null)}
      className="mt-4"
    />
  );
}
