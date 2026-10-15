"use client";

import type { ReactNode } from "react";

import { GlossaryText } from "@/components/duel/GlossaryText";
import { StatValue } from "@/components/duel/DuelCardSlot";
import { useCardText } from "@/hooks/useCardText";
import { attributeLabel, monsterTypeParts, translateRace, translateType } from "@/lib/card-labels";
import { ATTRIBUTE_KANJI } from "@/lib/duel/attributes";
import type { CardMark } from "@/lib/duel/card-marks";
import type { BoardCard } from "@/lib/duel/board-state";
import type { CardRegistry } from "@/lib/domain/card-registry";

type PreviewCard = Pick<BoardCard, "code"> & Partial<Omit<BoardCard, "code">>;

function spellTrapSubtype(type: string, race: string | undefined): string {
  const magia = /spell/i.test(type);
  const sub: Record<string, string> = magia
    ? {
        Normal: "Magia Normal",
        Continuous: "Magia Contínua",
        Equip: "Magia de Equipamento",
        Field: "Magia de Campo",
        "Quick-Play": "Magia Rápida",
        Ritual: "Magia de Ritual",
      }
    : {
        Normal: "Armadilha Normal",
        Continuous: "Armadilha Contínua",
        Counter: "Armadilha de Resposta",
      };
  return (race && sub[race]) ?? (magia ? "Magia" : "Armadilha");
}

/**
 * A leitura da carta — o painel do canto esquerdo do Master Duel: o nome numa
 * faixa com o círculo do atributo, a carta à esquerda e, ao lado, Nível, ATK
 * e DEF com os ícones do jogo (os valores ATUAIS, em azul se subiram e em
 * vermelho se caíram); embaixo, a faixa do tipo na cor da moldura da carta e
 * o texto rolável. O fundo diz de quem é a carta (azul sua, vermelho do
 * oponente).
 */
export function DuelCardPreview({
  card,
  registry,
  marksOf = () => [],
  activation = null,
  viewer = 0,
  hideEmpty = false,
}: {
  card: PreviewCard | null;
  registry: CardRegistry | null;
  marksOf?: (card: BoardCard | null | undefined) => CardMark[];
  /** Quando a carta está aqui porque acabou de ser ativada (ver `ativacaoLida`). */
  activation?: ReactNode;
  /** Quem olha a mesa — decide o fundo azul (sua) ou vermelho (do oponente). */
  viewer?: 0 | 1;
  /** Sem carta para ler, não desenha nada (o painel do MD só aparece com carta). */
  hideEmpty?: boolean;
}) {
  const texto = useCardText();
  const definition = card?.code ? registry?.get(card.code) : undefined;
  // O fundo da leitura diz de quem é a carta, como no Master Duel: azul a
  // sua, vermelho a do oponente. Carta sem dono conhecido (lista de busca,
  // seletor) fica neutra.
  const dono =
    card?.controller === undefined || card.controller === null
      ? "neutral"
      : card.controller === viewer
        ? "me"
        : "foe";

  if (!definition) {
    if (hideEmpty) return null;
    return (
      <div className="md-detail md-detail-neutral flex min-h-0 flex-1 items-center justify-center p-3 text-center text-[13px] text-zinc-500">
        Passe o mouse sobre uma carta
        <br />
        para ver os detalhes
      </div>
    );
  }

  const image = definition.images[0]?.image_url ?? definition.images[0]?.image_url_small;
  const isMonster = definition.type.includes("Monster");
  const isLink = Boolean(definition.linkval) || Boolean(card?.link);
  const isXyz = definition.frameType.includes("xyz");
  const isPendulum = definition.frameType.includes("pendulum");
  const moldura = isPendulum ? "pendulum" : definition.frameType.replace(/_pendulum$/, "");
  const isSpell = /spell/i.test(definition.type);
  const isTrap = /trap/i.test(definition.type);

  // Linha de tipo no formato da carta: [Dragão/Sincro/Regulador/Efeito]
  const typeLine = isMonster
    ? `[${[translateRace(definition.race) ?? "?", ...monsterTypeParts(definition.humanReadableCardType, definition.type)].join("/")}]`
    : `[${translateType(definition.type)}${
        definition.race ? ` / ${translateRace(definition.race)}` : ""
      }]`;

  // Valores ATUAIS quando a carta está em campo (o core informa); os impressos
  // quando ela está na mão, numa pilha ou num modal.
  const rating = card?.link?.rating ?? definition.linkval ?? 0;
  const markers = card?.link?.markers ?? definition.linkMarkers ?? 0;
  const rank = card?.rank || (isXyz ? (definition.level ?? 0) : 0);
  const level = card?.level || (!isXyz && !isLink ? (definition.level ?? 0) : 0);
  /** O Nível impresso — para mostrar quando um efeito o mudou. */
  const levelBase = !isXyz && !isLink ? (definition.level ?? 0) : 0;
  const leftScale = card?.scales?.left ?? definition.scale;
  const rightScale = card?.scales?.right ?? definition.scale;
  const materials = card?.overlays ?? [];
  // Só carta EM CAMPO tem marca (a da mão ou de um modal não tem zona).
  const marks =
    card && "counters" in card && card.counters !== undefined
      ? marksOf(card as BoardCard)
      : [];
  // Em campo, o atributo ATUAL (um efeito pode tê-lo trocado); fora dele, o
  // impresso.
  const atributoAtual =
    (card && "attribute" in card && card.attribute ? card.attribute : null) ?? definition.attribute;
  const kanji = isSpell ? "魔" : isTrap ? "罠" : ATTRIBUTE_KANJI[atributoAtual ?? ""];
  const atributo = isSpell ? "spell" : isTrap ? "trap" : (atributoAtual ?? "").toLowerCase();

  return (
    <div
      data-preview-owner={dono}
      data-preview-frame={moldura}
      className={`md-detail md-detail-${dono} md-frame-${moldura} flex min-h-0 flex-col overflow-hidden`}
    >
      {activation}

      <header className="md-detail-name">
        <h4>{texto.name(definition)}</h4>
        {kanji && (
          <span
            className={`md-attr md-attr-${atributo}`}
            title={
              isMonster
                ? atributoAtual !== definition.attribute && definition.attribute
                  ? `${attributeLabel(atributoAtual ?? undefined)} (original: ${attributeLabel(definition.attribute)})`
                  : (attributeLabel(atributoAtual ?? undefined) ?? undefined)
                : isSpell
                  ? "Magia"
                  : "Armadilha"
            }
          >
            {kanji}
          </span>
        )}
      </header>

      <div className="md-detail-top">
        {image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt={texto.name(definition)} className="md-detail-art" />
        )}
        <div className="md-detail-stats">
          {isMonster ? (
            <>
              {isLink ? (
                <p data-preview-link={rating} className="md-detail-stat" title={`Link ${rating}`}>
                  <span aria-hidden className="md-detail-icon md-icon-link" />
                  <span className="md-detail-value">LINK-{rating}</span>
                  <LinkArrowsGlyph markers={markers} />
                </p>
              ) : rank ? (
                <p data-preview-rank={rank} className="md-detail-stat" title={`Rank ${rank}`}>
                  <span aria-hidden className="md-detail-icon md-icon-rank" />
                  <span className="md-detail-value">{rank}</span>
                </p>
              ) : level ? (
                <p
                  data-preview-level={level}
                  className="md-detail-stat"
                  title={levelBase && levelBase !== level ? `Nível ${level} (original ${levelBase})` : `Nível ${level}`}
                >
                  <span aria-hidden className="md-detail-icon md-icon-level" />
                  {/* Nível mudado por efeito (Ruído Mental, Fusão do Nível…): a
                      mesma cor do ATK/DEF alterado — azul subiu, vermelho desceu. */}
                  <span
                    className={`md-detail-value ${
                      levelBase && level > levelBase
                        ? "md-stat-up"
                        : levelBase && level < levelBase
                          ? "md-stat-down"
                          : ""
                    }`}
                  >
                    {level}
                  </span>
                </p>
              ) : null}
              <p className="md-detail-stat" title="ATK">
                <span aria-hidden className="md-detail-icon md-icon-atk" />
                <span className="md-detail-value">
                  <StatValue
                    value={card?.attack ?? definition.atk ?? null}
                    base={card?.baseAttack ?? definition.atk ?? null}
                  />
                </span>
              </p>
              {!isLink && (
                <p className="md-detail-stat" title="DEF">
                  <span aria-hidden className="md-detail-icon md-icon-def" />
                  <span className="md-detail-value">
                    <StatValue
                      value={card?.defenseValue ?? definition.def ?? null}
                      base={card?.baseDefense ?? definition.def ?? null}
                    />
                  </span>
                </p>
              )}
              {isPendulum && leftScale !== undefined && (
                <p className="md-detail-stat md-detail-scales" title="Escalas de Pêndulo">
                  <span className="text-sky-300">◂{leftScale}</span>
                  <span className="text-zinc-500">·</span>
                  <span className="text-rose-300">{rightScale}▸</span>
                </p>
              )}
            </>
          ) : (
            <p className="md-detail-subtype">
              <span aria-hidden className={`md-detail-icon ${isSpell ? "md-icon-spell" : "md-icon-trap"}`} />
              {spellTrapSubtype(definition.type, definition.race)}
            </p>
          )}
        </div>
      </div>

      <p className="md-detail-band">{typeLine}</p>

      {(marks.length > 0 || materials.length > 0) && (
        <div className="md-detail-extra">
          {marks.length > 0 && (
            <ul data-preview-marks className="space-y-0.5">
              {marks.map((mark, index) => (
                <li
                  key={index}
                  className={`text-[12px] leading-snug ${
                    mark.tone === "negated"
                      ? "font-semibold text-red-300"
                      : mark.tone === "counter"
                        ? "text-amber-200"
                        : mark.tone === "declared"
                          ? "text-fuchsia-200"
                          : mark.tone === "link"
                            ? "text-emerald-200"
                            : mark.tone === "turn"
                              ? "text-sky-200"
                              : "text-zinc-200"
                  }`}
                >
                  {mark.chip.replace(/\d+$/, "")} {mark.text}
                </li>
              ))}
            </ul>
          )}
          {materials.length > 0 && (
            <div className={marks.length > 0 ? "mt-1.5" : undefined}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-300">
                ◈ Materiais Xyz ({materials.length})
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {materials.map((code, index) => {
                  const material = registry?.get(code);
                  return (
                    <span
                      key={`${code}-${index}`}
                      className="rounded bg-violet-950/70 px-1.5 py-0.5 text-[11px] text-violet-100"
                    >
                      {material ? texto.name(material) : `Carta ${code}`}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Termos de regra sublinhados, com a definição a um toque (glossário);
          as quebras de linha da carta (as listas "●") ficam como estão. */}
      <GlossaryText text={texto.desc(definition)} className="md-detail-text" />
    </div>
  );
}

/**
 * As setas de um Link em miniatura (3×3), para a leitura da carta — a mesma
 * disposição da carta impressa, com o centro vazio.
 */
function LinkArrowsGlyph({ markers }: { markers: number }) {
  const cells = [0x040, 0x080, 0x100, 0x008, 0, 0x020, 0x001, 0x002, 0x004];
  return (
    <span className="inline-grid grid-cols-3 gap-px" aria-hidden>
      {cells.map((bit, index) => (
        <span
          key={index}
          className={`h-1.5 w-1.5 rounded-[1px] ${
            bit === 0 ? "bg-transparent" : markers & bit ? "bg-red-500" : "bg-zinc-700"
          }`}
        />
      ))}
    </span>
  );
}
