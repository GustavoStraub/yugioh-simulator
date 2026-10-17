"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

import type { BoardCard } from "@/lib/duel/board-state";
import type { CardMark } from "@/lib/duel/card-marks";
import { useCardText } from "@/hooks/useCardText";
import { playSfx } from "@/lib/audio/sfx";
import type { CardAction } from "@/lib/duel/duel-actions";
import type { CardRegistry } from "@/lib/domain/card-registry";
import { TrainingHighlight, useTrainingTarget } from "@/components/duel/TrainingHighlight";

/**
 * Todas as peças da mesa dimensionam pela ALTURA (`h-full` + `aspect`). É isso
 * que faz o campo inteiro caber na viewport sem scroll, encolhendo as cartas
 * conforme a janela diminui.
 *
 * E também têm um TETO pela largura (`--tf-card-max-h`, que o campo define
 * em unidades do próprio contêiner): só pela altura, numa janela estreita e
 * alta a fileira saía mais larga que a coluna do campo. Fora do campo a
 * variável não existe e o teto é 100% (nenhum).
 */
export const CARD_SHAPE =
  "h-full w-auto aspect-[59/86] shrink-0 max-h-[var(--tf-card-max-h,100%)]";

/** A casa quadrada comporta a mesma carta de pé ou deitada, sem encolhê-la. */
export const ZONE_SHAPE =
  "h-full w-auto aspect-square shrink-0 max-h-[var(--tf-card-max-h,100%)]";

/**
 * O realce da carta, nas cores do Master Duel.
 *
 * - `activate` — amarelo: a carta ativa um efeito agora (ou é o alvo de uma
 *   escolha — o MD usa o mesmo amarelo para "escolha esta");
 * - `action` — azul: uma jogada comum (Invocar, Baixar, Atacar, mudar de
 *   posição);
 * - `both` — as duas cores juntas, como o MD faz quando a carta pode atacar E
 *   ativar;
 * - `select` — alvo de uma seleção;
 * - `place` — zona vazia escolhível (destino).
 */
export type SlotIntent = "activate" | "action" | "both" | "select" | "place";

const INTENT_CLASS: Record<SlotIntent, string> = {
  activate: "tf-slot-activate",
  action: "tf-slot-activate md-glow-action",
  both: "tf-slot-activate md-glow-both",
  select: "tf-slot-select",
  place: "tf-slot-place",
};

/**
 * Tipo de zona — decide o desenho da zona vazia no tapete do MD (anel do
 * monstro, placa da magia, hexágono do campo) e se a carta fica "de pé".
 */
export type ZoneKind = "monster" | "spell" | "field" | "emz";

interface DuelCardSlotProps {
  card: BoardCard | null;
  registry: CardRegistry | null;
  /** Rótulo da zona vazia (só a Zona de Pêndulo ganha um "P"). */
  placeholder?: string;
  /** Desenho da zona vazia (ver `ZoneKind`); ausente = sem zona (mão). */
  zoneKind?: ZoneKind;
  /** Gira a carta 90° — monstro em defesa. */
  rotated?: boolean;
  /**
   * A carta está do lado do oponente: de cabeça para baixo, como numa mesa de
   * verdade (o Master Duel as deixa de pé; o Gustavo preferiu a mesa real
   * depois dos hologramas, que ficam de pé de qualquer jeito). As setas Link
   * giram meia volta junto: elas apontam para casas da mesa, e a "de cima"
   * dele aponta para o seu lado.
   */
  foeSide?: boolean;
  /** Cartas na mão sobem um pouco no hover. */
  inHand?: boolean;
  /** O dono vê a arte da carta baixada através do verso. */
  ownedFaceDown?: boolean;
  /** A zona/carta participa do prompt atual. */
  highlighted?: boolean;
  /** Que tipo de destaque a carta merece — ver `SlotIntent`. */
  intent?: SlotIntent;
  /** Marcada numa seleção múltipla. */
  selected?: boolean;
  /** Ações abertas para esta carta — renderiza os comandos do MD. */
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
  /** A carta é um elo da corrente em aberto: o número aparece no canto. */
  chainBadge?: ChainBadge;
  /**
   * Toque longo (dedo/caneta): abre a leitura da carta. Tela de toque não tem
   * "passar o mouse"; sem isto, na mesa estreita (onde a leitura não cabe ao
   * lado) não havia como ler uma carta.
   */
  onLongPress?: (card: BoardCard) => void;
}

/** Quanto o dedo precisa ficar parado para ser "toque longo". */
const LONG_PRESS_MS = 450;

/** Elo da corrente de uma carta do campo (ver `chainAt` no `DuelBoard`). */
export interface ChainBadge {
  link: number;
  /** Quem ativou é quem olha a mesa? */
  mine: boolean;
  state: "pending" | "resolving" | "resolved" | "negated" | "disabled";
}

/**
 * Cor do selo por tipo de marca — fundo SÓLIDO e claro: o selo fica por cima
 * da arte, e o fundo escuro translúcido de antes sumia sobre carta escura (o
 * Marcador de Magia do Breaker era um borrão no canto).
 */
const MARK_TONE: Record<CardMark["tone"], string> = {
  counter: "bg-amber-400 text-black ring-amber-950/70",
  turn: "bg-sky-400 text-black ring-sky-950/70",
  declared: "bg-fuchsia-400 text-black ring-fuchsia-950/70",
  notice: "bg-zinc-100 text-black ring-zinc-900/70",
  link: "bg-emerald-400 text-black ring-emerald-950/70",
  target: "bg-amber-300 text-black ring-amber-950/70",
  negated: "bg-red-500 text-white ring-red-950/70",
};

/**
 * Uma zona do campo ou carta na mão, no desenho do Master Duel.
 *
 * No campo são duas camadas: a ZONA, deitada no tapete (anel, placa ou
 * hexágono que brilha), e a CARTA, que fica levemente de pé sobre ela —
 * menos achatada pela câmera, como as cartas do MD. O ATK/DEF grande mora
 * fora da carta: embaixo dela do seu lado, em cima do lado do oponente.
 *
 * Quando o prompt atual permite alguma jogada com esta carta, ela ganha o
 * contorno do MD (azul jogada comum, amarelo efeito) e um clique abre os
 * comandos redondos em cima dela.
 */
export function DuelCardSlot({
  card,
  registry,
  placeholder,
  zoneKind,
  rotated = false,
  foeSide = false,
  inHand = false,
  ownedFaceDown = false,
  highlighted = false,
  intent = "select",
  selected = false,
  menu = null,
  zoneKey,
  onHover,
  onClick,
  onChoose,
  onCloseMenu,
  scaleSide = null,
  linkedBy = [],
  onOpenMaterials,
  marks = [],
  disabledZone = false,
  chainBadge,
  onLongPress,
}: DuelCardSlotProps) {
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** A caixa da carta na tela — de onde os comandos se ancoram. */
  const slotRef = useRef<HTMLDivElement | null>(null);
  /** O toque longo já abriu a leitura — o clique que vem junto não age. */
  const longPressed = useRef(false);
  const cancelarToque = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  const texto = useCardText();
  const guided = useTrainingTarget(card?.code, card?.location, card?.controller) && !selected;
  const definition = card?.code ? registry?.get(card.code) : undefined;
  const image = definition?.images[0]?.image_url_small;
  const interactive = Boolean(onClick);
  // Ler também é uma ação. No toque, todas as cartas conhecidas precisam
  // disputar o alvo igualmente, mesmo quando só a vizinha oferece uma jogada.
  const pressable = interactive || Boolean(card?.code);

  // O dono reconhece a própria carta baixada pela arte sob transparência; do
  // outro lado, `code` já vem mascarado e só resta mostrar o verso.
  const showBack = !card?.code || (card.faceDown && !inHand && !ownedFaceDown);
  const showFaceThroughBack = Boolean(card?.faceDown && !inHand && ownedFaceDown);


  const scale =
    scaleSide && !showBack && !card?.faceDown && card?.scales
      ? scaleSide === "left"
        ? card.scales.left
        : card.scales.right
      : null;
  const materials = !showBack ? (card?.overlays.length ?? 0) : 0;

  // O MONSTRO fica "de pé" no campo (menos achatado pela câmera, como no
  // MD); Magias e Armadilhas ficam deitadas na mesa — nas capturas do jogo a
  // fileira de trás aparece mais achatada que a de monstros, mesmo estando
  // mais perto da câmera. Em defesa o monstro também deita.
  const deitada = rotated;
  const dePe =
    Boolean(card) && !inHand && !deitada && (zoneKind === "monster" || zoneKind === "emz");

  // Anima quando a zona passa de vazia para ocupada — é a carta "chegando".
  // Comparar durante o render evita um frame com a carta já parada no lugar.
  const [wasEmpty, setWasEmpty] = useState(!card);
  const [entering, setEntering] = useState(false);
  const isEmpty = !card;
  if (wasEmpty !== isEmpty) {
    setWasEmpty(isEmpty);
    if (!isEmpty && !inHand) {
      setEntering(true);
      setTimeout(() => setEntering(false), 520);
    }
  }

  return (
    <div
      ref={slotRef}
      data-zone={zoneKey}
      data-zone-kind={zoneKind}
      data-card-position={card && (zoneKind === "monster" || zoneKind === "emz") ? (rotated ? "defense" : "attack") : undefined}
      className={`md-slot relative ${zoneKind ? ZONE_SHAPE : CARD_SHAPE} ${zoneKind ? `md-slot-${zoneKind}` : ""} ${
        inHand ? "md-hand-card" : ""
      } ${inHand && menu && menu.length > 0 ? "md-hand-card-up" : ""} ${foeSide ? "md-slot-foe" : ""}`}
    >
      {/* A zona gravada no tapete — fica embaixo da carta, deitada. */}
      {zoneKind && (
        <span
          aria-hidden
          className={`md-zone md-zone-${zoneKind} ${card ? "md-zone-busy" : ""} ${
            highlighted && !card ? "md-zone-lit" : ""
          }`}
        />
      )}
      {/* A carta chegando na zona: o anel de luz que se abre no tapete e a
          coluna de luz subindo — a invocação do MD. */}
      {entering && zoneKind && (
        <span aria-hidden className={`md-arrive md-arrive-${zoneKind === "monster" || zoneKind === "emz" ? "monster" : "spell"}`}>
          <span className="md-arrive-ring" />
          <span className="md-arrive-pillar" />
        </span>
      )}

      <div
        data-training-target={guided || undefined}
        title={linkedBy.length ? `Apontada por: ${linkedBy.join(", ")}` : undefined}
        data-previewable={card?.code ? "" : undefined}
        className={`tf-slot tf-touch-card md-card-plane relative h-full w-full ${card ? "md-card-on" : "md-card-empty"} ${
          dePe ? "md-standing" : ""
        } ${deitada && card ? "md-card-def" : ""} ${entering ? "md-anim-land" : ""} ${linkedBy.length ? "tf-slot-linked" : ""} ${
          disabledZone ? "tf-zone-disabled" : ""
        } ${
          // Uma classe só: a de intenção. Aplicar `tf-slot-active` junto fazia
          // duas regras disputarem a mesma `box-shadow`, e qual vencia dependia
          // da ordem no arquivo CSS — frágil e difícil de enxergar.
          highlighted ? `tf-slot-active ${INTENT_CLASS[intent]}` : ""
        } ${selected ? "tf-slot-picked" : ""} ${interactive ? "cursor-pointer md-interactive" : ""}`}
        onPointerDown={(event) => {
          if (event.pointerType === "mouse" || !card) return;
          longPressed.current = false;
          if (!onLongPress) return;
          cancelarToque();
          pressTimer.current = setTimeout(() => {
            longPressed.current = true;
            onLongPress(card);
          }, LONG_PRESS_MS);
        }}
        onPointerUp={cancelarToque}
        onPointerCancel={cancelarToque}
        onPointerLeave={cancelarToque}
        onContextMenu={(event) => {
          // O toque longo abre a leitura, não o menu do navegador.
          if (onLongPress) event.preventDefault();
        }}
        onClickCapture={(event) => {
          if (longPressed.current) {
            longPressed.current = false;
            event.stopPropagation();
            event.preventDefault();
            return;
          }
        }}
        onClick={pressable ? () => {
          // O clique fixa a leitura mesmo sem uma jogada disponível.
          if (card?.code) onHover?.(card);
          onClick?.();
        } : undefined}
        role={pressable ? "button" : undefined}
        tabIndex={pressable ? 0 : undefined}
        aria-label={definition ? `${texto.name(definition)}${zoneKind === "monster" || zoneKind === "emz" ? ` — posição de ${rotated ? "defesa" : "ataque"}` : ""}${guided ? " — carta indicada pela lição" : ""}` : placeholder || undefined}
        onKeyDown={
          pressable
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  if (card?.code) onHover?.(card);
                  onClick?.();
                }
              }
            : undefined
        }
      >
        {guided && <TrainingHighlight />}
        {card ? (
          <div
            className="md-card-face h-full w-full overflow-hidden"
            style={
              // O giro vale para a CARTA (deitada de lado na defesa, de cabeça
              // para baixo do lado do oponente); o rótulo e as marcas ficam
              // fora dele, sempre legíveis. A investida copia este giro para a
              // carta que voa (`AttackFlight`) — tem de estar AQUI, no estilo.
              rotated
                ? { transform: `rotate(${foeSide ? 270 : 90}deg)` }
                : foeSide
                  ? { transform: "rotate(180deg)" }
                  : undefined
            }
          >
            {showBack ? (
              <div className="tf-card-back h-full w-full" />
            ) : showFaceThroughBack ? (
              <div className="relative h-full w-full">
                <div className="tf-card-back absolute inset-0 h-full w-full" />
                {/* A pulsação lenta mantém o verso mais visível que a face. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image}
                  alt={definition ? texto.name(definition) : "Carta"}
                  loading="lazy"
                  draggable={false}
                  className={`absolute inset-0 h-full w-full animate-[card-face-pulse_4s_ease-in-out_infinite] object-cover ${card.negated ? "grayscale" : ""}`}
                />
              </div>
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={image}
                alt={definition ? texto.name(definition) : "Carta"}
                loading="lazy"
                draggable={false}
                // Carta negada fica sem cor — o olho acha de relance qual
                // monstro está sem efeito.
                className={`h-full w-full object-cover ${card.negated ? "grayscale" : ""}`}
              />
            )}
          </div>
        ) : (
          placeholder && (
            <span className="md-zone-label flex h-full w-full items-center justify-center">{placeholder}</span>
          )
        )}

        {/* Setas Link, na orientação da MESA: do lado do oponente giram meia
            volta junto com a carta (a seta "de cima" dele aponta para o seu
            lado). */}
        {card?.link && !showBack && !card.faceDown && (
          <span
            className="pointer-events-none absolute inset-0"
            style={foeSide ? { transform: "rotate(180deg)" } : undefined}
          >
            <LinkArrows markers={card.link.markers} />
          </span>
        )}

        {/* Proibido: a carta com o efeito negado ganha o símbolo do MD. */}
        {card?.negated && !showBack && !card.faceDown && <span aria-hidden className="md-negated-icon" />}


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

        {/* Número do elo da corrente — fora do giro, como as marcas: tem que
            se ler na carta deitada. */}
        {chainBadge && (
          <span
            data-chain-badge={chainBadge.link}
            data-chain-badge-state={chainBadge.state}
            title={`Elo ${chainBadge.link} da corrente`}
            className={`md-chain-badge ${
              chainBadge.state === "negated" || chainBadge.state === "disabled"
                ? "md-chain-badge-off"
                : chainBadge.mine
                  ? "md-chain-mine"
                  : "md-chain-foe"
            } ${chainBadge.state === "resolving" ? "tf-chain-resolving" : ""}`}
          >
            {chainBadge.link}
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
                className={`pointer-events-auto rounded px-1.5 py-px font-mono text-[12px] font-extrabold leading-tight shadow-md shadow-black/60 ring-1 ${MARK_TONE[mark.tone]}`}
              >
                {mark.chip}
              </span>
            ))}
            {marks.length > 4 && (
              <span
                title={marks.slice(4).map((mark) => mark.text).join("\n")}
                className="pointer-events-auto rounded bg-zinc-100 px-1.5 py-px text-[12px] font-extrabold text-black shadow-md shadow-black/60"
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
            className="md-materials"
          >
            <span aria-hidden className="md-materials-icon" />
            {materials}
          </button>
        )}
      </div>

      {menu && menu.length > 0 && (
        <CardActionMenu
          actions={menu}
          anchorRef={slotRef}
          onChoose={(action) => onChoose?.(action)}
          onClose={() => onCloseMenu?.()}
        />
      )}
    </div>
  );
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
 * azul-claro quando um efeito aumentou, vermelho quando reduziu — as cores
 * do Master Duel.
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
      data-stat={boosted ? "up" : weakened ? "down" : undefined}
      className={boosted ? "md-stat-up" : weakened ? "md-stat-down" : undefined}
      title={base !== null && base !== value ? `Original: ${base}` : undefined}
    >
      {value}
    </span>
  );
}

/**
 * O tipo de cada comando, para a cor e o ícone do botão redondo do MD:
 * amarelo para ativar efeito, azul para as jogadas comuns. Casa pelo rótulo —
 * o mesmo verbo que os testes e o `duel-actions.ts` usam.
 */
export function commandKind(label: string): "attack" | "summon" | "special" | "set" | "position" | "activate" | "other" {
  if (/^atacar/i.test(label)) return "attack";
  if (/^invoca[çc][aã]o-especial/i.test(label)) return "special";
  if (/^invocar/i.test(label)) return "summon";
  if (/^baixar/i.test(label)) return "set";
  if (/^mudar posi/i.test(label)) return "position";
  if (/^ativar/i.test(label)) return "activate";
  return "other";
}

/**
 * Os comandos da carta clicada — os botões redondos do Master Duel, em
 * fileira em cima da carta: o ícone num disco (amarelo para ativar efeito,
 * azul para Invocar, Baixar, Atacar…) e o nome embaixo.
 *
 * Vão para o `body` por portal, ancorados na caixa da carta NA TELA. Morando
 * dentro da carta, eles herdavam a inclinação 3D da mesa e o `fixed` do
 * "clique fora fecha" deixava de cobrir a tela: um ancestral com `transform`
 * vira o contêiner de todo `position: fixed` abaixo dele.
 */
function CardActionMenu({
  actions,
  anchorRef,
  onChoose,
  onClose,
}: {
  actions: CardAction[];
  anchorRef: RefObject<HTMLDivElement | null>;
  onChoose: (action: CardAction) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);

  // O "pop" dos comandos aparecendo, uma vez por abertura.
  useEffect(() => {
    playSfx("open");
  }, []);

  // Mede depois de montar (precisa da largura do próprio menu para não sair
  // pela borda) e de novo quando a janela muda. A carta não anda com o menu
  // aberto — o clique fora o fecha antes de qualquer outra jogada.
  useLayoutEffect(() => {
    const medir = () => {
      const anchor = anchorRef.current;
      const menu = menuRef.current;
      if (!anchor || !menu) return;
      // A carta de pé é o que se vê; a zona deitada é menor na tela.
      const plano = anchor.querySelector<HTMLElement>(".md-card-plane") ?? anchor;
      const r = plano.getBoundingClientRect();
      const w = menu.offsetWidth;
      const h = menu.offsetHeight;
      const margem = 8;
      const leitor = document.querySelector("[data-landscape-reader]")?.getBoundingClientRect();
      const esquerda = leitor ? leitor.right + margem : margem;
      const left = Math.min(
        Math.max(r.left + r.width / 2 - w / 2, esquerda),
        window.innerWidth - w - margem,
      );
      // Sempre para CIMA da carta, como os comandos do Master Duel — também
      // no campo (pedido do Gustavo: ao responder na corrente, o "Ativar"
      // abrindo para baixo caía sobre a fileira de trás e a mão). Só desce
      // quando não cabe em cima (carta no alto da tela).
      let top = r.top - h + Math.min(18, r.height * 0.18);
      // Barras de decisão sobre a mesa ("Não responder", seleção) marcam-se
      // com `data-menu-avoid`: o menu sobe acima delas em vez de tapar o
      // botão que é a outra metade da mesma decisão.
      for (const barra of document.querySelectorAll("[data-menu-avoid]")) {
        const b = barra.getBoundingClientRect();
        const cruza =
          left < b.right && left + w > b.left && top < b.bottom && top + h > b.top;
        if (cruza) top = b.top - h - 6;
      }
      let below = false;
      if (top < margem) {
        top = Math.min(r.bottom + 6, window.innerHeight - h - margem);
        below = true;
      }
      setPos({ left, top, below });
    };
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [anchorRef, actions.length]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      {/* Clique fora fecha o menu. */}
      <div className="fixed inset-0 z-[70]" onClick={onClose} />
      <div
        ref={menuRef}
        data-card-menu
        className="fixed z-[71]"
        style={{
          left: pos?.left ?? -9999,
          top: pos?.top ?? -9999,
          visibility: pos ? "visible" : "hidden",
        }}
      >
        <div
          className={`tf-anim-menu-in md-commands ${pos?.below ? "md-commands-below" : ""} flex w-max max-w-[min(92vw,560px)] flex-wrap items-start justify-center`}
        >
          {actions.map((action, index) => {
            const kind = commandKind(action.label);
            return (
              <button
                key={index}
                type="button"
                data-menu-item
                data-command={kind}
                onClick={() => onChoose(action)}
                className={`tf-menu-item md-command md-command-${kind === "activate" ? "effect" : "normal"}`}
              >
                {/* O ícone vem por CSS (`data-command`): fora do `innerText`,
                    o texto do botão continua começando pelo verbo — é por ele
                    que os testes escolhem a jogada ("Invocar"…). */}
                <span aria-hidden className="md-command-disc">
                  <span className="md-command-glyph" />
                </span>
                <span className="md-command-label">{action.label}</span>
                {/* Qual efeito — duas jogadas "Ativar" na mesma carta deixam de
                    ser iguais (ver `CardAction.detail`). */}
                {action.detail && <span className="md-command-detail">{action.detail}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </>,
    document.body,
  );
}

/** Que pilha é — decide o desenho (deck de pé, poço redondo do Cemitério…). */
export type PileKind = "deck" | "extra" | "grave" | "banished";

/**
 * Pilha (deck, cemitério, banidas, extra) com contador.
 *
 * No Master Duel o Deck e o Extra Deck são a pilha de versos de pé nos cantos
 * da mesa, e o Cemitério e as banidas são poços redondos ao lado da fileira de
 * monstros — com a arte da carta do topo dentro do círculo, aqui.
 *
 * Recebe `onOpen` quando o conteúdo pode ser consultado; nesse caso vira botão.
 */
export function DuelPile({
  label,
  kind = "deck",
  count,
  onOpen,
  openTitle,
  topCard,
  registry,
  dataPile,
  badge,
  actionable = false,
  warnLow = false,
}: {
  label: string;
  kind?: PileKind;
  count: number;
  /**
   * Pilha que acaba o duelo quando zera (o Deck): o contador fica vermelho
   * com 5 ou menos — é quando o número vira informação.
   */
  warnLow?: boolean;
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
}) {
  const texto = useCardText();
  const openable = Boolean(onOpen) && (count > 0 || actionable);
  const poco = kind === "grave" || kind === "banished";

  // O cemitério fica com as cartas para cima numa mesa real: o poço mostra a
  // arte da carta do topo.
  const topDefinition =
    topCard?.code != null ? registry?.get(topCard.code) : undefined;
  const topImage = poco
    ? (topDefinition?.images[0]?.image_url_cropped ?? topDefinition?.images[0]?.image_url_small)
    : undefined;

  return (
    <div
      data-pile={dataPile}
      data-pile-kind={kind}
      data-actionable={actionable || undefined}
      role={openable ? "button" : undefined}
      tabIndex={openable ? 0 : undefined}
      title={
        actionable
          ? `${label}: há jogadas aqui agora`
          : openable
            ? (openTitle ?? `Ver ${label} (${count})`)
            : `${label} (${count})`
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
      className={`md-pile md-pile-${kind} relative ${poco ? "" : ZONE_SHAPE} ${count > 0 ? "md-pile-full" : "md-pile-empty"} ${
        openable ? "cursor-pointer md-interactive" : ""
      } ${actionable ? "tf-slot-active tf-slot-activate" : ""}`}
    >
      {poco ? (
        <span className="md-well">
          {topImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={topImage}
              alt={topDefinition ? texto.name(topDefinition) : label}
              loading="lazy"
              draggable={false}
              className="md-well-art"
            />
          ) : (
            <span aria-hidden className="md-well-core" />
          )}
        </span>
      ) : (
        <span className={`md-pile-stack ${count > 0 ? "tf-card-back" : "md-pile-hole"}`} />
      )}
      {count > 0 && (
        <span
          data-pile-count={count}
          title={warnLow && count <= 5 ? `Só ${count} carta(s) no Deck` : undefined}
          className={`md-pile-count ${warnLow && count <= 5 ? "md-pile-count-low" : ""}`}
        >
          {count}
        </span>
      )}
      {badge && (
        <span title={badge.title} className="md-pile-badge">
          {badge.text}
        </span>
      )}
    </div>
  );
}
