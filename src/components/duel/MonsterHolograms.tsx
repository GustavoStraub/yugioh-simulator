"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

import type { AttackFlight } from "@/hooks/useDuelFeedback";
import { cardKey } from "@/lib/duel/duel-actions";
import type { HologramMode } from "@/lib/duel/duel-prefs";
import { ATTACK_FLIGHT_MS } from "@/lib/duel/pacing";
import type { HologramKind, HologramList } from "@/server/catalog/holograms";

/** Um monstro de face para cima no campo — candidato a holograma. */
export interface HoloMonster {
  /** `cardKey` da zona — é por ela que o holograma acha a carta na tela. */
  zoneKey: string;
  code: number;
  foeSide: boolean;
  defense: boolean;
  /** Atributo em minúsculas ("dark", "light"…) — a cor do brilho. */
  attribute: string;
}

interface Placed extends HoloMonster {
  /** Ponto de onde o holograma sobe (o meio da carta), em coordenadas do campo. */
  x: number;
  y: number;
  /** Lado do quadro do holograma, em pixels. */
  side: number;
}

/**
 * Quanto tempo o holograma fica de pé quando o monstro chega ao campo (já
 * contando a subida e a descida), na velocidade normal.
 */
const ARRIVE_MS = 2600;
/**
 * A investida inteira e um pouco depois do golpe: a investida sozinha (~0,85 s)
 * mal dá tempo de o holograma terminar de subir.
 */
const ATTACK_MS = ATTACK_FLIGHT_MS + 900;

/**
 * O holograma do monstro saindo da carta, como na Visão Sólida do anime.
 *
 * Desenhado FORA da mesa inclinada, numa camada plana por cima dela — pelo
 * mesmo motivo do ATK/DEF (`FieldStatsLayer`): dentro do plano 3D da mesa a
 * profundidade decide quem tapa quem, e o holograma, de pé saindo do meio da
 * carta, cruzaria o plano da própria carta (que também está de pé) e sairia
 * cortado por ela. Aqui ele lê a caixa da carta na tela e sobe dali.
 *
 * O volume vem das fatias (`npm run build:holograms`): cada uma numa camada
 * com profundidade própria, dentro de uma perspectiva só dele, e o conjunto
 * balançando devagar — a frente anda mais que o fundo.
 *
 * Só aparece para quem tem holograma gerado (o índice diz quem); os outros
 * monstros ficam como sempre ficaram.
 */
export function MonsterHologramsLayer({
  monsters,
  fieldRef,
  index,
  mode,
  flight,
  animationScale,
}: {
  monsters: HoloMonster[];
  fieldRef: RefObject<HTMLDivElement | null>;
  /** Quem tem holograma (`useHologramIndex`, lido uma vez pela mesa). */
  index: HologramIndexView | null;
  mode: HologramMode;
  flight: AttackFlight | null;
  animationScale: number;
}) {
  const comHolograma = index ? monsters.filter((m) => index.kinds.has(m.code)) : [];
  const placed = usePlacement(comHolograma, fieldRef);
  const hovered = useHoveredZone(fieldRef);
  // Quem já estava na mesa quando ela abriu (recarga, reconexão) não "chegou":
  // o holograma dele não sobe sozinho na entrada.
  const [jaEstavam] = useState(() => new Set(monsters.map((m) => `${m.zoneKey}:${m.code}`)));

  if (mode === "off" || !index || placed.length === 0) return null;
  const atacando = (zoneKey: string) =>
    flight &&
    (zoneKey === cardKey(flight.from.controller, flight.from.location, flight.from.sequence) ||
      (flight.to && zoneKey === cardKey(flight.to.controller, flight.to.location, flight.to.sequence)))
      ? flight.token
      : null;
  return (
    <div aria-hidden className="md-holo-layer pointer-events-none absolute inset-0 z-[11]">
      {placed.map((m) => {
        const key = `${m.zoneKey}:${m.code}`;
        return (
          <Hologram
            key={key}
            monster={m}
            fieldRef={fieldRef}
            always={mode === "always"}
            hovered={hovered === m.zoneKey}
            arrived={!jaEstavam.has(key)}
            attack={atacando(m.zoneKey)}
            arriveMs={ARRIVE_MS * animationScale}
            attackMs={ATTACK_MS * (flight?.scale ?? animationScale)}
            kind={index.kinds.get(m.code) ?? "cutout"}
            url={hologramUrl(index, m.code)}
            layers={index.layers}
          />
        );
      })}
    </div>
  );
}

/**
 * Um holograma. Monta quando o monstro chega à zona (a chave é zona + carta),
 * e a subida vem do `@starting-style` do CSS — por isso "chegou" é só o
 * estado inicial, sem efeito nenhum.
 */
function Hologram({
  monster,
  fieldRef,
  always,
  hovered,
  arrived,
  attack,
  arriveMs,
  attackMs,
  kind,
  url,
  layers,
}: {
  monster: Placed;
  fieldRef: RefObject<HTMLDivElement | null>;
  always: boolean;
  hovered: boolean;
  /** Montou porque o monstro acabou de chegar (e não porque a mesa abriu). */
  arrived: boolean;
  /** `token` do ataque em que este monstro ataca ou é atacado, se houver. */
  attack: number | null;
  arriveMs: number;
  attackMs: number;
  kind: HologramKind;
  url: string;
  layers: number;
}) {
  // O momento em que ele fica de pé sozinho: a chegada, depois cada ataque.
  const [momento, setMomento] = useState<{ ms: number } | null>(() =>
    arrived ? { ms: arriveMs } : null,
  );
  // O ataque que já estava no ar quando ele montou não é dele (é o do
  // monstro que ocupava a zona antes).
  const [ataqueVisto, setAtaqueVisto] = useState(attack);
  if (attack !== null && attack !== ataqueVisto) {
    setAtaqueVisto(attack);
    setMomento({ ms: attackMs });
  }
  useEffect(() => {
    if (!momento) return;
    const timer = setTimeout(() => setMomento(null), momento.ms);
    return () => clearTimeout(timer);
  }, [momento]);
  const on = always || hovered || momento !== null;

  // Holograma aceso, carta embaixo um pouco mais escura: o monstro se
  // destaca dela e do fundo. Marca no DOM (`data-holo-on` no plano da carta),
  // como a investida esconde a carta que voa: a carta é de outro componente,
  // e uma classe posta por fora o React apagaria no próximo render — um
  // atributo `data-` que ele não controla fica.
  const { zoneKey } = monster;
  // Sai aceso? Anota (ver `saiuAceso`) — o `on` mais recente, num ref, porque
  // a limpeza do efeito só roda na saída.
  const acesoAgora = useRef(on);
  useEffect(() => {
    acesoAgora.current = on;
  }, [on]);
  useEffect(
    () => () => {
      if (acesoAgora.current) saiuAceso.set(zoneKey, Date.now());
    },
    [zoneKey],
  );
  useEffect(() => {
    const plano = fieldRef.current?.querySelector<HTMLElement>(`[data-zone="${zoneKey}"] .md-card-plane`);
    if (!plano) return;
    if (on) plano.dataset.holoOn = "1";
    else delete plano.dataset.holoOn;
    return () => {
      delete plano.dataset.holoOn;
    };
  }, [on, zoneKey, fieldRef]);

  const { side } = monster;
  return (
    <div
      data-holo-for={monster.zoneKey}
      data-holo-code={monster.code}
      data-holo-kind={kind}
      data-holo-on={on ? "1" : undefined}
      className={`md-holo md-holo-${monster.attribute || "neutral"} ${on ? "md-holo-on" : ""} ${
        monster.defense ? "md-holo-def" : ""
      }`}
      style={{ left: monster.x, top: monster.y, width: side, height: side }}
    >
      <HologramArtwork side={side} layers={layers} url={url} />
    </div>
  );
}

/** O volume e os efeitos do monstro, compartilhados pela mesa e pela ampliação. */
export function HologramArtwork({ side, layers, url }: { side: number; layers: number; url: string }) {
  // A perspectiva e a profundidade em proporção ao tamanho: o mesmo volume em
  // qualquer tela. Cada fatia mais perto cresce com a perspectiva (P / (P − z));
  // a escala de volta a deixa do tamanho da de trás, senão as bordas não
  // casam e o monstro fica com contorno duplo.
  const perspectiva = side * 3;
  // Rasa de propósito. As fatias são cumulativas (a de trás é o monstro
  // inteiro; cada uma à frente repete o que está mais perto), então no fim do
  // balanço cada uma desenha o mesmo contorno um pouco deslocado. Com 0,3 ×
  // o lado e ±14° eram ~1,7 px entre fatias vizinhas — o contorno aparecia
  // repetido em degraus (a asa do Curse of Dragon em "pente"). Com 0,14 e
  // ±10° são ~0,6 px: as cópias se fundem numa borda macia, e a frente ainda
  // anda ~3 px em relação ao fundo.
  const profundidade = side * 0.14;
  const fatias = Array.from({ length: layers }, (_, k) => {
    const z = layers > 1 ? (k / (layers - 1)) * profundidade : 0;
    return {
      k,
      transform: `translateZ(${z.toFixed(1)}px) scale(${((perspectiva - z) / perspectiva).toFixed(4)})`,
      position: layers > 1 ? `0 ${((k / (layers - 1)) * 100).toFixed(3)}%` : "0 0",
    };
  });
  const sprite = `url("${url}")`;
  const tamanho = `100% ${layers * 100}%`;

  return (
    <>
      <span className="md-holo-beam" />
      <div className="md-holo-view">
        <div className="md-holo-rise" style={{ perspective: `${perspectiva}px` }}>
          <div className="md-holo-rig">
            {fatias.map((f) => (
              <i
                key={f.k}
                className="md-holo-slice"
                style={{
                  backgroundImage: sprite,
                  backgroundSize: tamanho,
                  backgroundPosition: f.position,
                  transform: f.transform,
                }}
              />
            ))}
            {/* O brilho que varre o monstro, recortado pela forma dele (a
                fatia de trás é o monstro inteiro, e é ela que vira a máscara). */}
            <i
              className="md-holo-sheen"
              style={{
                // Na frente de todas: atrás, as fatias da frente o tapariam.
                transform: fatias[fatias.length - 1]?.transform,
                maskImage: sprite,
                maskSize: tamanho,
                maskPosition: "0 0",
                WebkitMaskImage: sprite,
                WebkitMaskSize: tamanho,
                WebkitMaskPosition: "0 0",
              }}
            />
          </div>
        </div>
      </div>
    </>
  );
}

/** A lista do servidor, com o tipo de cada passcode à mão. */
export interface HologramIndexView {
  layers: number;
  generatedAt: string;
  kinds: Map<number, HologramKind>;
}

/**
 * Quem tem holograma. Lido uma vez por mesa — gerar mais hologramas aparece
 * na partida seguinte, sem recarregar o servidor.
 */
export function useHologramIndex(enabled: boolean): HologramIndexView | null {
  const [index, setIndex] = useState<HologramIndexView | null>(null);
  useEffect(() => {
    if (!enabled || index) return;
    let vivo = true;
    fetch("/card-images/holo/index.json")
      .then((r) => (r.ok ? (r.json() as Promise<HologramList>) : null))
      .then((lista) => {
        if (!vivo || !lista || lista.layers <= 0) return;
        const kinds = new Map<number, HologramKind>();
        for (const code of lista.cutout) kinds.set(code, "cutout");
        for (const code of lista.projection) kinds.set(code, "projection");
        setIndex({ layers: lista.layers, generatedAt: lista.generatedAt, kinds });
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [enabled, index]);
  return index;
}

/**
 * Holograma que estava aceso quando o monstro saiu da zona, e quando.
 *
 * A mesa tira o monstro (e o holograma) no mesmo instante em que a destruição
 * começa a ser animada: quando o estilhaço (`LeaveFlight`) vai conferir se o
 * holograma estava de pé, o elemento já não existe. Cada holograma anota aqui
 * se saiu aceso; o estilhaço consulta logo depois.
 */
const saiuAceso = new Map<string, number>();

/** O holograma desta zona estava de pé agora há pouco (ou ainda está)? */
export function hologramWasLit(field: HTMLElement, zoneKey: string): boolean {
  if (field.querySelector(`[data-holo-for="${zoneKey}"][data-holo-on]`)) return true;
  const quando = saiuAceso.get(zoneKey);
  return quando !== undefined && Date.now() - quando < 1500;
}

/**
 * Onde o holograma de uma carta fica, a partir da caixa dela na tela (`rect`)
 * e da do campo (`base`): o ponto de onde ele sobe e o lado do quadro. A
 * camada dos hologramas e o estilhaço da destruição (`LeaveFlight`) usam a
 * mesma conta — o holograma estoura exatamente onde estava.
 */
export function hologramAnchor(
  rect: { left: number; top: number; width: number; height: number },
  base: { left: number; top: number },
  foeSide: boolean,
  compact = false,
): { x: number; y: number; side: number } {
  return {
    x: rect.left - base.left + rect.width / 2,
    // A base no meio da arte da carta: as pernas somem dentro dela (o degradê
    // de baixo) e o corpo sai por cima. A carta do oponente está de cabeça
    // para baixo — a arte dela fica na metade de baixo.
    y: rect.top - base.top + rect.height * (compact ? 0.65 : foeSide ? 0.55 : 0.45),
    // Pela LARGURA da carta: em defesa quem deita é a face dentro do plano, e
    // a caixa do plano fica igual. Pouco mais larga que a carta — com 1,45 ×
    // a altura os hologramas de zonas vizinhas se atropelavam, e 1,35 × a
    // largura ainda pedia "um pouquinho" menor.
    // No mobile, nasce um pouco mais baixo e fica próximo da largura da carta:
    // o corpo continua visível sem invadir a zona da fileira de trás.
    side: Math.round(rect.width * (compact ? 1.08 : 1.2)),
  };
}

/** A imagem das fatias de um holograma (a versão vai na URL; ver a rota). */
export function hologramUrl(index: HologramIndexView, code: number): string {
  return `/card-images/holo/${code}.webp?v=${encodeURIComponent(index.generatedAt)}`;
}

/** Onde cada holograma fica: mede a carta de pé na tela, como o ATK/DEF. */
function usePlacement(monsters: HoloMonster[], fieldRef: RefObject<HTMLDivElement | null>): Placed[] {
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [tick, setTick] = useState(0);
  // A lista é recriada a cada render da mesa; a chave diz se mudou de verdade.
  const chave = monsters.map((m) => `${m.zoneKey}=${m.code}${m.defense ? "d" : ""}`).join("|");

  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    const base = field.getBoundingClientRect();
    const proximos: Placed[] = [];
    for (const monster of monsters) {
      const slot = field.querySelector<HTMLElement>(`[data-zone="${monster.zoneKey}"]`);
      const plano = slot?.querySelector<HTMLElement>(".md-card-plane") ?? slot;
      if (!plano) continue;
      const r = plano.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      proximos.push({ ...monster, ...hologramAnchor(r, base, monster.foeSide, Boolean(field.closest(".md-narrow"))) });
    }
    setPlaced((atual) => (mesmasPosicoes(atual, proximos) ? atual : proximos));
    // `monsters` muda de identidade a cada render; `chave` é o que importa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, fieldRef, tick]);

  // A carta que acabou de chegar ainda está pousando: mede de novo depois.
  useEffect(() => {
    const timer = setTimeout(() => setTick((t) => t + 1), 480);
    return () => clearTimeout(timer);
  }, [chave]);

  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    const observador = new ResizeObserver(() => setTick((t) => t + 1));
    observador.observe(field);
    return () => observador.disconnect();
  }, [fieldRef]);

  return placed;
}

/**
 * A zona com o mouse em cima. Só mouse: no toque não existe "tirar o dedo de
 * cima", e o holograma ficaria de pé até o próximo toque em outro lugar.
 */
function useHoveredZone(fieldRef: RefObject<HTMLDivElement | null>): string | null {
  const [hovered, setHovered] = useState<string | null>(null);
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    const sobre = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const alvo = event.target instanceof Element ? event.target.closest("[data-zone]") : null;
      setHovered(alvo?.getAttribute("data-zone") ?? null);
    };
    const saiu = () => setHovered(null);
    field.addEventListener("pointerover", sobre);
    field.addEventListener("pointerleave", saiu);
    return () => {
      field.removeEventListener("pointerover", sobre);
      field.removeEventListener("pointerleave", saiu);
    };
  }, [fieldRef]);
  return hovered;
}

function mesmasPosicoes(a: Placed[], b: Placed[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    return (
      x.zoneKey === y.zoneKey &&
      x.code === y.code &&
      x.defense === y.defense &&
      x.attribute === y.attribute &&
      Math.abs(x.x - y.x) < 0.5 &&
      Math.abs(x.y - y.y) < 0.5 &&
      Math.abs(x.side - y.side) < 0.5
    );
  });
}
