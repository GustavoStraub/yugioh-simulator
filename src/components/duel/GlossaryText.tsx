"use client";

import { useMemo, useState } from "react";

import { glossarySegments, type GlossaryTerm } from "@/lib/domain/glossary";

/**
 * O texto de uma carta com os termos de regra sublinhados — passar o mouse
 * mostra a definição; clicar (ou tocar) a fixa embaixo do texto.
 *
 * É a "Duel Academy" do Tag Force no lugar onde a dúvida aparece: ninguém
 * precisa sair da partida para saber o que é "Regulador" ou "banir".
 */
export function GlossaryText({ text, className }: { text: string; className?: string }) {
  const segmentos = useMemo(() => glossarySegments(text), [text]);
  const [aberto, setAberto] = useState<GlossaryTerm | null>(null);

  return (
    <div className={className}>
      <p data-glossary-text>
        {segmentos.map((segmento, index) =>
          segmento.term ? (
            <button
              key={index}
              type="button"
              data-glossary-term={segmento.term.id}
              title={`${segmento.term.label}: ${segmento.term.definition}`}
              onClick={() =>
                setAberto((atual) => (atual?.id === segmento.term?.id ? null : (segmento.term ?? null)))
              }
              className="inline cursor-help border-b border-dotted border-sky-300/70 p-0 text-left text-inherit hover:text-sky-200"
            >
              {segmento.text}
            </button>
          ) : (
            <span key={index}>{segmento.text}</span>
          ),
        )}
      </p>
      {aberto && (
        <p
          data-glossary-definition={aberto.id}
          className="mt-2 rounded border border-sky-400/30 bg-sky-950/40 px-2 py-1.5 text-[12px] leading-snug text-sky-100"
        >
          <span className="font-semibold">📖 {aberto.label}:</span> {aberto.definition}
        </p>
      )}
    </div>
  );
}
