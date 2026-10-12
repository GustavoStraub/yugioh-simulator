"use client";

import { useState } from "react";

import { OcgLocation } from "@n1xx1/ocgcore-wasm";

import type { BoardCard } from "@/lib/duel/board-state";
import type { CardMark } from "@/lib/duel/card-marks";
import { useCardText } from "@/hooks/useCardText";
import type { CardAction } from "@/lib/duel/duel-actions";
import type { CardRegistry } from "@/lib/domain/card-registry";

/**
 * Todas as peças da mesa dimensionam pela ALTURA (`h-full` + `aspect`), nunca
 * pela largura. É isso que faz o campo inteiro caber na viewport sem scroll,
 * encolhendo as cartas conforme a janela diminui.
 */
export const CARD_SHAPE = "h-full w-auto aspect-[59/86] shrink-0";

/** Classe de realce por intenção — ver `intent` em DuelCardSlotProps. */
const INTENT_CLASS = {
  activate: "tf-slot-activate",
  select: "tf-slot-select",
  place: "tf-slot-place",
} as const;

interface DuelCardSlotProps {
  card: BoardCard | null;
  registry: CardRegistry | null;
  /** Rótulo da zona vazia (ex.: "M1"). */
  placeholder?: string;
  /** Gira a carta 90° — monstro em defesa. */
  rotated?: boolean;
  /** Vira a carta 180° — lado do oponente, como numa mesa física. */
  upsideDown?: boolean;
  /** Cartas na mão sobem um pouco no hover. */
  inHand?: boolean;
  /** A zona/carta participa do prompt atual. */
  highlighted?: boolean;
  /**
   * Que tipo de destaque a carta merece.
   *
   * No Tag Force o realce diz o que vai acontecer se você clicar, e não só
   * "dá para clicar": o dourado forte é uma jogada sua (ativar, invocar), o
   * ciano é "escolha um alvo". Uma cor única para tudo obriga o jogador a
   * abrir o menu de cada carta para descobrir o que ela oferece.
   */
  intent?: "activate" | "select" | "place";
  /** Marcada numa seleção múltipla. */
  selected?: boolean;
  /** Ações abertas para esta carta — renderiza o menu de contexto. */
  menu?: CardAction[] | null;
  /**
   * Chave da zona (`cardKey`). Vira um `data-zone` no DOM para que as
   * animações consigam localizar a carta na tela pelo evento do engine.
   */
  zoneKey?: string;
  onHover?: (card: BoardCard | null) => void;
  onClick?: () => void;
  onChoose?: (action: CardAction) => void;
  onCloseMenu?: () => void;
  /**
   * Mostra Nível/Rank/Link de um monstro em campo.
   *
   * No Goat o nível quase não pesa depois que o monstro desceu, e a selo
   * competiria com o ATK/DEF; no TCG ele decide Sincro e Xyz, e o Rank e o
   * Link são o que diferencia o monstro à primeira vista.
   */
  showLevel?: boolean;
  /**
   * Esta carta está numa Zona de Pêndulo e vale como escala — qual delas. A
   * zona da esquerda usa a escala esquerda da carta, a da direita a direita.
   */
  scaleSide?: "left" | "right" | null;
  /** Nomes dos Links que apontam para esta zona (realce tracejado). */
  linkedBy?: string[];
  /** Abre a lista de materiais Xyz — só existe quando há material. */
  onOpenMaterials?: () => void;
  /**
   * Marcas da carta (contadores, turnos, declarações, avisos, equipamento,
   * alvo, negação) já prontas para selo — ver `card-marks.ts`.
   */
  marks?: CardMark[];
  /** Zona inutilizada por um efeito (`FIELD_DISABLED`): hachurada. */
  disabledZone?: boolean;
}

/** Cor do selo por tipo de marca. */
const MARK_TONE: Record<CardMark["tone"], string> = {
  counter: "bg-amber-950/95 text-amber-200 ring-amber-400/60",
  turn: "bg-sky-950/95 text-sky-200 ring-sky-400/60",
  declared: "bg-fuchsia-950/95 text-fuchsia-200 ring-fuchsia-400/60",
  notice: "bg-zinc-900/95 text-zinc-100 ring-zinc-300/50",
  link: "bg-emerald-950/95 text-emerald-200 ring-emerald-400/60",
  negated: "bg-red-950/95 text-red-200 ring-red-400/70",
};

/**
 * Uma zona do campo ou carta na mão. Mostra a arte quando a carta é conhecida,
 * o verso quando está virada para baixo, e a moldura vazia quando não há carta.
 *
 * Quando o prompt atual permite alguma jogada com esta carta, ela ganha
 * destaque dourado e um clique abre o menu com as opções legais — é assim que
 * se joga, em vez de escolher numa lista solta de botões.
 */
export function DuelCardSlot({
  card,
  registry,
  placeholder,
  rotated = false,
  upsideDown = false,
  inHand = false,
  highlighted = false,
  intent = "select",
  selected = false,
  menu = null,
  zoneKey,
  onHover,
  onClick,
  onChoose,
  onCloseMenu,
  showLevel = false,
  scaleSide = null,
  linkedBy = [],
  onOpenMaterials,
  marks = [],
  disabledZone = false,
}: DuelCardSlotProps) {
  const texto = useCardText();
  const definition = card?.code ? registry?.get(card.code) : undefined;
  const image = definition?.images[0]?.image_url_small;
  const interactive = Boolean(onClick);

  // Cartas viradas para baixo aparecem como verso, mesmo sendo nossas — como
  // no Tag Force. O conteúdo continua acessível no painel de detalhes.
  const showBack = !card?.code || (card.faceDown && !inHand);

  // ATK/DEF vêm do engine quando a carta está em campo (já com equipamentos e
  // buffs aplicados) e do catálogo quando está na mão.
  const atk = card?.attack ?? definition?.atk ?? null;
  const def = card?.defenseValue ?? definition?.def ?? null;
  const baseAtk = card?.baseAttack ?? definition?.atk ?? null;
  const baseDef = card?.baseDefense ?? definition?.def ?? null;

  const showStats = !showBack && atk !== null;

  // Estrelas de nível na mão; em campo, só quando a mesa pede (`showLevel`).
  const level = inHand && !showBack ? (definition?.level ?? 0) : 0;
  const isXyzInHand = definition?.frameType?.includes("xyz") ?? false;
  const fieldBadge = showLevel && !showBack && !inHand && card ? levelBadge(card) : null;
  const scale =
    scaleSide && !showBack && card?.scales
      ? scaleSide === "left"
        ? card.scales.left
        : card.scales.right
      : null;
  const materials = !showBack ? (card?.overlays.length ?? 0) : 0;

  // O giro de defesa (90°) e o do lado do oponente (180°) se somam.
  const spin = (upsideDown ? 180 : 0) + (rotated ? 90 : 0);

  // Anima quando a zona passa de vazia para ocupada — é a carta "chegando".
  // Comparar durante o render evita um frame com a carta já parada no lugar.
  const [wasEmpty, setWasEmpty] = useState(!card);
  const [entering, setEntering] = useState(false);
  const isEmpty = !card;
  if (wasEmpty !== isEmpty) {
    setWasEmpty(isEmpty);
    if (!isEmpty && !inHand) {
      setEntering(true);
      setTimeout(() => setEntering(false), 300);
    }
  }

  return (
    <div
      data-zone={zoneKey}
      className={`relative ${CARD_SHAPE} ${
        inHand ? "transition-transform duration-150 hover:z-20 hover:-translate-y-1.5" : ""
      }`}
    >
      <div
        title={linkedBy.length ? `Apontada por: ${linkedBy.join(", ")}` : undefined}
        className={`tf-slot h-full w-full rounded-[4px] ${entering ? "tf-anim-card-in" : ""} ${
          linkedBy.length ? "tf-slot-linked" : ""
        } ${disabledZone ? "tf-zone-disabled" : ""} ${
          // Uma classe só: a de intenção. Aplicar `tf-slot-active` junto fazia
          // duas regras disputarem a mesma `box-shadow`, e qual vencia dependia
          // da ordem no arquivo CSS — frágil e difícil de enxergar.
          highlighted ? `tf-slot-active ${INTENT_CLASS[intent]}` : ""
        } ${
          selected ? "ring-2 ring-emerald-400" : ""
        } ${
          interactive ? "cursor-pointer hover:brightness-125" : ""
        }`}
        onMouseEnter={() => onHover?.(card)}
        onMouseLeave={() => onHover?.(null)}
        onClick={onClick}
        role={interactive ? "button" : undefined}
        tabIndex={interactive ? 0 : undefined}
        aria-label={definition ? texto.name(definition) : placeholder}
        onKeyDown={
          interactive
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onClick?.();
                }
              }
            : undefined
        }
      >
        <div
          className="h-full w-full overflow-hidden rounded-[3px] transition-transform duration-200"
          style={
            // O giro vale para a CARTA — é o que reproduz a mesa física, com o
            // lado do oponente de cabeça para baixo e o monstro em defesa
            // deitado. O rótulo da zona vazia é interface, não objeto de jogo:
            // girado ele virava um "Mon1" de ponta-cabeça, que parece defeito
            // de renderização e não dá para ler.
            spin && card
              ? {
                  transform: `rotate(${spin}deg)${rotated ? " scale(0.72)" : ""}`,
                }
              : undefined
          }
        >
          {card ? (
            showBack ? (
              <div className="tf-card-back h-full w-full rounded-[3px]" />
            ) : (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image}
                  alt={definition ? texto.name(definition) : "Carta"}
                  loading="lazy"
                  // Carta negada fica sem cor — como no EDOPro: o olho acha
                  // de relance qual monstro está sem efeito.
                  className={`h-full w-full object-cover ${card.negated ? "grayscale" : ""}`}
                />
                {/* Setas DENTRO do giro: elas são da carta, e um Link do
                    oponente (de cabeça para baixo) aponta para o seu lado. */}
                {card.link && <LinkArrows markers={card.link.markers} />}
              </>
            )
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="text-[10px] font-medium tracking-wider text-[color:var(--tf-gold-dim)]/60">
                {placeholder}
              </span>
            </div>
          )}
        </div>

        {/* Nível em estrelas, no topo da carta — só na mão. Acima de 6 vira
            "★ ×N" porque 8 estrelas não cabem numa miniatura. Xyz tem Rank, de
            estrela vazada. */}
        {level > 0 && (
          <span className="pointer-events-none absolute inset-x-0 top-0 flex justify-center">
            <span className="rounded-b bg-black/85 px-1.5 text-[10px] font-bold leading-tight text-amber-300">
              {isXyzInHand
                ? `☆${level}`
                : level <= 6
                  ? "★".repeat(level)
                  : `★×${level}`}
            </span>
          </span>
        )}

        {/* Nível, Rank ou Link do monstro em campo (TCG). */}
        {fieldBadge && (
          <span className="pointer-events-none absolute inset-x-0 top-0 flex justify-center">
            <span
              className={`whitespace-nowrap rounded-b px-1 font-mono text-[10px] font-bold leading-tight ${fieldBadge.className}`}
              title={fieldBadge.title}
            >
              {fieldBadge.text}
            </span>
          </span>
        )}

        {/* Escala de Pêndulo, na zona que a usa. Azul à esquerda, vermelho à
            direita — as cores das duas escalas impressas na carta. */}
        {scale !== null && (
          <span className="pointer-events-none absolute inset-x-0 top-0 flex justify-center">
            <span
              title={`Escala ${scaleSide === "left" ? "esquerda" : "direita"}: ${scale}`}
              className={`rounded-b px-1.5 font-mono text-[11px] font-black leading-tight text-white ${
                scaleSide === "left" ? "bg-sky-700/95" : "bg-rose-700/95"
              }`}
            >
              {scaleSide === "left" ? `◂${scale}` : `${scale}▸`}
            </span>
          </span>
        )}

        {/* Marcas, empilhadas no canto direito. A frase inteira vai na dica
            e na leitura da carta; o selo só precisa dizer "tem algo aqui". */}
        {marks.length > 0 && !showBack && (
          <span
            data-marks={marks.length}
            className="pointer-events-none absolute right-0.5 top-[14%] z-10 flex flex-col items-end gap-0.5"
          >
            {marks.slice(0, 4).map((mark, index) => (
              <span
                key={index}
                title={mark.text}
                className={`pointer-events-auto rounded px-1 font-mono text-[10px] font-bold leading-tight ring-1 ${MARK_TONE[mark.tone]}`}
              >
                {mark.chip}
              </span>
            ))}
            {marks.length > 4 && (
              <span
                title={marks.slice(4).map((mark) => mark.text).join("\n")}
                className="pointer-events-auto rounded bg-black/85 px-1 text-[10px] font-bold text-zinc-200"
              >
                +{marks.length - 4}
              </span>
            )}
          </span>
        )}

        {/* Materiais Xyz — contagem pública, e um clique abre a lista. */}
        {materials > 0 && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenMaterials?.();
            }}
            title={`${materials} material(is) Xyz — clique para ver`}
            className="absolute left-0.5 top-1/2 z-10 -translate-y-1/2 rounded bg-black/85 px-1 font-mono text-[10px] font-bold leading-tight text-violet-200 ring-1 ring-violet-400/70 hover:bg-violet-900"
          >
            ◈{materials}
          </button>
        )}

        {/* Placa de ATK/DEF: fica sempre legível na horizontal, mesmo com a
            carta girada, para o jogador não precisar virar a cabeça. */}
        {showStats && (
          <span className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center">
            <span className="rounded-t bg-black/85 px-1.5 font-mono text-[10px] font-bold leading-tight">
              <StatValue value={atk} base={baseAtk} />
              <span className="text-[color:var(--tf-gold-dim)]">/</span>
              {/* Link não tem DEF: no lugar vai o rating, como na carta. */}
              {card?.link || definition?.linkval ? (
                <span className="text-sky-300">
                  L{card?.link?.rating ?? definition?.linkval}
                </span>
              ) : (
                <StatValue value={def} base={baseDef} />
              )}
            </span>
          </span>
        )}
      </div>

      {menu && menu.length > 0 && (
        <CardActionMenu
          actions={menu}
          upward={inHand}
          onChoose={(action) => onChoose?.(action)}
          onClose={() => onCloseMenu?.()}
        />
      )}
    </div>
  );
}

/**
 * Selo de Nível/Rank/Link de um monstro em campo, com os valores ATUAIS que o
 * core informa (um efeito que muda o nível aparece aqui).
 */
function levelBadge(
  card: BoardCard,
): { text: string; title: string; className: string } | null {
  if (card.location !== OcgLocation.MZONE) return null;
  if (card.link) {
    return {
      text: `LINK-${card.link.rating}`,
      title: `Link ${card.link.rating}`,
      className: "bg-sky-950/95 text-sky-200",
    };
  }
  if (card.rank) {
    return {
      text: `☆${card.rank}`,
      title: `Rank ${card.rank}`,
      className: "bg-zinc-950/95 text-zinc-100 ring-1 ring-zinc-400/40",
    };
  }
  if (card.level) {
    return {
      text: `★${card.level}`,
      title: `Nível ${card.level}`,
      className: "bg-black/85 text-amber-300",
    };
  }
  return null;
}

/**
 * As oito setas de um monstro Link, por cima da arte.
 *
 * Todas aparecem — as apagadas também —, como na carta impressa: é a posição
 * das acesas em relação às apagadas que se lê de relance.
 */
const ARROW_LAYOUT: { bit: number; className: string; rotate: number }[] = [
  { bit: 0x040, className: "left-0 top-0", rotate: -45 },
  { bit: 0x080, className: "left-1/2 top-0 -translate-x-1/2", rotate: 0 },
  { bit: 0x100, className: "right-0 top-0", rotate: 45 },
  { bit: 0x008, className: "left-0 top-1/2 -translate-y-1/2", rotate: -90 },
  { bit: 0x020, className: "right-0 top-1/2 -translate-y-1/2", rotate: 90 },
  { bit: 0x001, className: "bottom-0 left-0", rotate: -135 },
  { bit: 0x002, className: "bottom-0 left-1/2 -translate-x-1/2", rotate: 180 },
  { bit: 0x004, className: "bottom-0 right-0", rotate: 135 },
];

function LinkArrows({ markers }: { markers: number }) {
  return (
    <span className="pointer-events-none absolute inset-0" data-link-markers={markers}>
      {ARROW_LAYOUT.map(({ bit, className, rotate }) => {
        const on = (markers & bit) !== 0;
        return (
          <span
            key={bit}
            data-arrow-on={on || undefined}
            className={`absolute ${className} flex h-[18%] w-[18%] items-center justify-center`}
          >
            <span
              className={`tf-link-arrow ${on ? "tf-link-arrow-on" : ""}`}
              style={{ transform: `rotate(${rotate}deg)` }}
            />
          </span>
        );
      })}
    </span>
  );
}

/**
 * Um valor de ATK ou DEF, colorido conforme o desvio do valor impresso:
 * azul quando um efeito aumentou, vermelho quando reduziu.
 */
export function StatValue({
  value,
  base,
}: {
  value: number | null;
  base: number | null;
}) {
  if (value === null) return <span>?</span>;

  const boosted = base !== null && value > base;
  const weakened = base !== null && value < base;

  return (
    <span
      className={
        boosted
          ? "text-sky-400"
          : weakened
            ? "text-red-400"
            : "text-[color:var(--tf-gold-bright)]"
      }
      title={
        base !== null && base !== value
          ? `Original: ${base}`
          : undefined
      }
    >
      {value}
    </span>
  );
}

/** Menu flutuante com as jogadas legais da carta clicada. */
function CardActionMenu({
  actions,
  upward,
  onChoose,
  onClose,
}: {
  actions: CardAction[];
  upward: boolean;
  onChoose: (action: CardAction) => void;
  onClose: () => void;
}) {
  return (
    <>
      {/* Clique fora fecha o menu. */}
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div
        className={`tf-anim-menu-in absolute left-1/2 z-40 w-max min-w-[160px] -translate-x-1/2 overflow-hidden rounded-md border border-[color:var(--tf-gold)] bg-[color:var(--tf-panel)] shadow-xl shadow-black/70 ${
          upward ? "bottom-full mb-1" : "top-full mt-1"
        }`}
      >
        {actions.map((action, index) => (
          <button
            key={index}
            type="button"
            onClick={() => onChoose(action)}
            className="block w-full px-4 py-2.5 text-left text-[13px] font-semibold text-[color:var(--tf-gold-bright)] transition-colors duration-100 hover:bg-[color:var(--tf-gold)] hover:text-black"
          >
            {action.label}
          </button>
        ))}
      </div>
    </>
  );
}

/**
 * Pilha (deck, cemitério, banidas, extra) com contador — cantos da mesa.
 * Recebe `onOpen` quando o conteúdo pode ser consultado; nesse caso vira botão.
 */
export function DuelPile({
  label,
  count,
  onOpen,
  openTitle,
  topCard,
  registry,
  upsideDown = false,
  dataPile,
  badge,
  actionable = false,
}: {
  label: string;
  count: number;
  /**
   * O prompt atual oferece jogada com alguma carta desta pilha (Invocar do
   * Extra Deck, efeito de Cemitério) — a pilha brilha como uma carta jogável.
   */
  actionable?: boolean;
  /**
   * Selo extra no canto de cima — no Extra Deck, quantas cartas estão viradas
   * para cima (Pêndulos que voltaram para lá, e que são públicos).
   */
  badge?: { text: string; title: string } | null;
  onOpen?: () => void;
  /** Rótulo do clique, quando abrir a pilha não é "ver o conteúdo". */
  openTitle?: string;
  /** Marca a pilha no DOM para as animações a localizarem (ex.: "deck-0"). */
  dataPile?: string;
  /** Carta do topo, quando a pilha é aberta (cemitério e banidas). */
  topCard?: BoardCard | null;
  registry?: CardRegistry | null;
  upsideDown?: boolean;
}) {
  const texto = useCardText();
  const openable = Boolean(onOpen) && (count > 0 || actionable);

  // O cemitério fica com as cartas para cima numa mesa real, então mostramos
  // a do topo em vez de um verso genérico.
  const topDefinition =
    topCard?.code != null ? registry?.get(topCard.code) : undefined;
  const topImage = topDefinition?.images[0]?.image_url_small;

  return (
    <div
      data-pile={dataPile}
      data-actionable={actionable || undefined}
      role={openable ? "button" : undefined}
      tabIndex={openable ? 0 : undefined}
      title={
        actionable
          ? `${label}: há jogadas aqui agora`
          : openable
            ? (openTitle ?? `Ver ${label} (${count})`)
            : label
      }
      onClick={openable ? onOpen : undefined}
      onKeyDown={
        openable
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen?.();
              }
            }
          : undefined
      }
      className={`relative overflow-hidden rounded-[4px] ${CARD_SHAPE} ${
        topImage ? "tf-slot" : count > 0 ? "tf-card-back" : "tf-slot"
      } ${openable ? "cursor-pointer hover:brightness-125 hover:ring-1 hover:ring-[color:var(--tf-gold)]" : ""} ${
        actionable ? "tf-slot-active tf-slot-activate" : ""
      }`}
    >
      {topImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={topImage}
          alt={topDefinition ? texto.name(topDefinition) : label}
          loading="lazy"
          className="h-full w-full object-cover"
          style={upsideDown ? { transform: "rotate(180deg)" } : undefined}
        />
      ) : (
        <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[9px] uppercase leading-tight tracking-wider text-[color:var(--tf-gold-dim)]">
          {label}
        </span>
      )}
      {count > 0 && (
        <span className="absolute bottom-0.5 right-0.5 rounded bg-black/85 px-1.5 text-[11px] font-bold text-[color:var(--tf-gold-bright)]">
          {count}
        </span>
      )}
      {badge && (
        <span
          title={badge.title}
          className="absolute left-0.5 top-0.5 rounded bg-emerald-900/90 px-1 text-[10px] font-bold text-emerald-200"
        >
          {badge.text}
        </span>
      )}
    </div>
  );
}
