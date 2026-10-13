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
 * ou o Extra Deck e voltar pela barra "Voltar à decisão".
 *
 * Também é onde mora o básico de acessibilidade: papel de diálogo, rótulo e o
 * foco indo para dentro ao abrir.
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
  const boxRef = useFocoAoAbrir(hidden);

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
 * O foco vai para a caixa quando ela aparece (ao abrir e ao voltar da
 * espiada): o teclado — Enter, Tab, Esc — passa a falar com a decisão, e não
 * com o botão da mesa que estava focado antes.
 */
function useFocoAoAbrir(hidden: boolean) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (hidden) return;
    const box = boxRef.current;
    if (!box || box.contains(document.activeElement)) return;
    box.focus({ preventScroll: true });
  }, [hidden]);
  return boxRef;
}

/**
 * O painel de baixo do Master Duel — a "lista de cartas" das escolhas: a
 * instrução no topo, as cartas numa faixa e os botões no pé. Fica sobre a
 * parte de baixo do campo, sem escurecer a mesa inteira; as abas do canto
 * (a grade e a seta para baixo) são as do MD — a seta esconde o painel para
 * ver a mesa (o "Ver a mesa" de antes), e Esc faz o mesmo.
 *
 * Mesmas garantias da `DecisionShell`: diálogo com rótulo, foco ao abrir, e
 * montado mesmo escondido.
 */
export function DecisionSheet({
  label,
  hidden = false,
  onPeek,
  head,
  foot,
  children,
  tone = "neutral",
  modal = true,
  tabs,
  className = "",
  sheetProps,
}: {
  label: string;
  hidden?: boolean;
  /** A seta para baixo: esconde sem responder. Ausente, não há seta. */
  onPeek?: () => void;
  head: ReactNode;
  foot?: ReactNode;
  children?: ReactNode;
  /** A cor do fio do painel: azul (sua decisão), vermelho (resposta ao oponente). */
  tone?: "neutral" | "foe";
  /**
   * Bloqueia a mesa por trás (as decisões do core que não se jogam na mesa).
   * A janela de resposta na corrente não bloqueia: a carta que responde também
   * se ativa clicando nela na mesa.
   */
  modal?: boolean;
  /** Abas extras à esquerda da seta (ex.: alternar faixa/grade). */
  tabs?: ReactNode;
  className?: string;
  /** Atributos `data-*` do painel (os testes acham a decisão por eles). */
  sheetProps?: Record<string, string | number | boolean | undefined>;
}) {
  const boxRef = useFocoAoAbrir(hidden);

  const painel = (
    <div
      ref={boxRef}
      role="dialog"
      aria-modal={modal ? "true" : undefined}
      aria-label={label}
      tabIndex={-1}
      data-decision-dialog={modal ? true : undefined}
      className={`md-sheet md-sheet-${tone} pointer-events-auto outline-none ${className}`}
      onClick={(event) => event.stopPropagation()}
      {...sheetProps}
    >
      <div className="md-sheet-tabs">
        {tabs}
        {onPeek && (
          // `data-table-control`: ver a mesa não é jogada — os testes que
          // clicam "qualquer botão útil" o ignoram.
          <button
            type="button"
            data-peek
            data-table-control
            onClick={() => {
              playSfx("click");
              onPeek();
            }}
            title="Esconde esta escolha para você conferir o campo, o Cemitério e o Extra Deck. Ela continua esperando. (Esc)"
            aria-label="Ver a mesa"
            className="md-sheet-tab"
          >
            <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5">
              <path d="M5 8l7 7 7-7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
      <header className="md-sheet-head">{head}</header>
      {children !== undefined && <div className="md-sheet-body">{children}</div>}
      {foot && <footer className="md-sheet-foot">{foot}</footer>}
    </div>
  );

  return (
    <div
      hidden={hidden}
      className={`md-sheet-area tf-modal-area z-50 flex items-end justify-center ${
        modal ? "md-sheet-scrim" : "pointer-events-none"
      }`}
    >
      {painel}
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
      className="md-pill md-pill-ghost shrink-0 px-3 py-1.5 text-[12px]"
    >
      👁 Ver a mesa <span className="opacity-60">(Esc)</span>
    </button>
  );
}
