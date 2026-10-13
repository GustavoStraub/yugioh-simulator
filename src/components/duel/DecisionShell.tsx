"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { playSfx } from "@/lib/audio/sfx";

/**
 * A caixa de toda decisão do duelo: o escurecimento sobre a coluna do campo e
 * o diálogo no meio.
 *
 * Existe para que TODA decisão se comporte igual — e a regra que mais importa
 * é a de não prender a mesa: com `hidden` o diálogo continua MONTADO (o nome
 * digitado no "declarar carta", os contadores distribuídos, a ordem montada
 * sobrevivem) e só some da tela, para o jogador conferir o campo, o Cemitério
 * ou o Extra Deck e voltar pela barra "Voltar à decisão". Antes só o modal de
 * sim/não tinha esse caminho; escolher uma carta do Deck ou declarar um nome
 * tapava o campo sem saída.
 *
 * Também é onde mora o básico de acessibilidade que os modais não tinham:
 * papel de diálogo, rótulo e o foco indo para dentro ao abrir.
 */
export function DecisionShell({
  label,
  hidden = false,
  className,
  children,
  onScrimClick,
}: {
  /** Nome do diálogo para leitores de tela — a instrução da decisão. */
  label: string;
  /** Escondido para ver a mesa (continua montado). */
  hidden?: boolean;
  /** Classes da caixa (largura, layout interno). */
  className: string;
  children: ReactNode;
  /** Clique fora da caixa — só para o que pode ser fechado sem decidir. */
  onScrimClick?: () => void;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);

  // O foco vai para a caixa quando ela aparece (ao abrir e ao voltar da
  // espiada): o teclado — Enter, Tab, Esc — passa a falar com a decisão, e não
  // com o botão da mesa que estava focado antes.
  useEffect(() => {
    if (hidden) return;
    const box = boxRef.current;
    if (!box || box.contains(document.activeElement)) return;
    box.focus({ preventScroll: true });
  }, [hidden]);

  return (
    <div
      hidden={hidden}
      className="tf-modal-scrim tf-modal-area z-50 flex items-center justify-center p-6"
      onClick={onScrimClick}
    >
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        data-decision-dialog
        className={`tf-modal tf-anim-modal-in outline-none ${className}`}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * "Ver a mesa": esconde a decisão sem responder.
 *
 * Igual em todo diálogo, no mesmo lugar (o rodapé), com o atalho escrito — o
 * Esc faz o mesmo.
 */
export function PeekButton({ onPeek }: { onPeek: () => void }) {
  return (
    // `data-table-control`: ver a mesa não é jogada — os testes que clicam
    // "qualquer botão útil" o ignoram (alternando com "Voltar à decisão" eles
    // ficavam presos num laço sem jogar nada).
    <button
      type="button"
      data-peek
      data-table-control
      onClick={() => {
        playSfx("click");
        onPeek();
      }}
      title="Esconde esta decisão para você conferir o campo, o Cemitério e o Extra Deck. Ela continua esperando. (Esc)"
      className="shrink-0 rounded border border-[color:var(--tf-slot-border)] px-3 py-1.5 text-[12px] text-[color:var(--tf-gold-dim)] transition hover:bg-black/50 hover:text-[color:var(--tf-gold-bright)]"
    >
      👁 Ver a mesa <span className="opacity-60">(Esc)</span>
    </button>
  );
}
