/**
 * Imagens das cartas, servidas do nosso disco.
 *
 * A YGOPRODeck é clara: "Do not continually hotlink images directly from this
 * site… Failure to do so will result in an IP blacklist." O app fazia hotlink
 * de `image_url_small` em toda tela; com o pool TCG (8× mais cartas) o risco de
 * bloqueio crescia junto. Agora cada imagem é baixada **uma vez**, na primeira
 * vez que alguém a pede, e servida do disco para sempre depois.
 *
 * Três cuidados:
 *
 * - **Ritmo.** 20 requisições por segundo é o teto da YGOPRODeck, e uma grade
 *   do construtor pede dezenas de imagens de uma vez. As idas à origem passam
 *   por uma fila de ~14 por segundo.
 * - **Uma ida por imagem.** Duas abas pedindo a mesma carta ao mesmo tempo
 *   esperam o mesmo download.
 * - **Nada de caminho vindo do cliente.** O nome do arquivo é validado como
 *   número antes de virar caminho.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../..");

export const CARD_IMAGES_DIR =
  process.env.CARD_IMAGES_DIR ?? join(REPO, ".cache/card-images");

/** Tamanho pedido → pasta da YGOPRODeck. */
const UPSTREAM_DIRS = {
  small: "cards_small",
  full: "cards",
  cropped: "cards_cropped",
} as const;

export type CardImageSize = keyof typeof UPSTREAM_DIRS;

export function isCardImageSize(value: string): value is CardImageSize {
  return value in UPSTREAM_DIRS;
}

/** `"12345.jpg"` → `12345`; qualquer outra coisa → `null`. */
export function passcodeFromFile(file: string): number | null {
  const match = /^(\d{1,10})\.jpg$/.exec(file);
  return match ? Number(match[1]) : null;
}

/**
 * Intervalo mínimo entre duas idas à YGOPRODeck (~14 por segundo).
 *
 * Abaixo do teto de 20/s com folga: um bloqueio custa uma hora sem imagem
 * nenhuma, e a grade do construtor pede dezenas de uma vez na primeira visita.
 */
const UPSTREAM_INTERVAL_MS = 70;
let nextSlot = 0;

/** Espera a vez na fila de idas à origem. */
async function upstreamTurn(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + UPSTREAM_INTERVAL_MS;
  if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
}

const inFlight = new Map<string, Promise<Buffer | null>>();

function pathFor(size: CardImageSize, passcode: number): string {
  return join(CARD_IMAGES_DIR, size, `${passcode}.jpg`);
}

/**
 * "A YGOPRODeck não tem arte para este passcode" — lembrado em disco.
 *
 * Sem isto, cada ficha sem arte (~30 das modernas) custava uma ida à origem a
 * cada vez que aparecia na mesa. A marca vence em 7 dias: a YGOPRODeck vai
 * ganhando arte com o tempo, e a carta passa a mostrá-la sozinha.
 */
const MISSING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function missingMarker(size: CardImageSize, passcode: number): string {
  return join(CARD_IMAGES_DIR, size, `${passcode}.missing`);
}

function knownMissing(size: CardImageSize, passcode: number): boolean {
  const marker = missingMarker(size, passcode);
  return existsSync(marker) && Date.now() - statSync(marker).mtimeMs < MISSING_TTL_MS;
}

async function download(size: CardImageSize, passcode: number): Promise<Buffer | null> {
  await upstreamTurn();
  const response = await fetch(
    `https://images.ygoprodeck.com/images/${UPSTREAM_DIRS[size]}/${passcode}.jpg`,
    { cache: "no-store" },
  );
  if (response.status === 404) {
    mkdirSync(join(CARD_IMAGES_DIR, size), { recursive: true });
    writeFileSync(missingMarker(size, passcode), new Date().toISOString());
    return null;
  }
  if (!response.ok) throw new Error(`YGOPRODeck respondeu ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const path = pathFor(size, passcode);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return bytes;
}

/**
 * Bytes da imagem — do disco, ou baixados agora (e guardados).
 *
 * @returns `null` quando a YGOPRODeck não tem a imagem.
 */
export async function cardImage(
  size: CardImageSize,
  passcode: number,
): Promise<Buffer | null> {
  const path = pathFor(size, passcode);
  if (existsSync(path)) return readFileSync(path);
  if (knownMissing(size, passcode)) return null;

  const key = `${size}/${passcode}`;
  let pending = inFlight.get(key);
  if (!pending) {
    pending = download(size, passcode).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending;
}

/**
 * A imagem já está no disco — ou já se sabe que a YGOPRODeck não a tem? O
 * script de pré-carga pula as duas.
 */
export function hasCardImage(size: CardImageSize, passcode: number): boolean {
  return existsSync(pathFor(size, passcode)) || knownMissing(size, passcode);
}

/** O mínimo da carta que a face genérica precisa. */
export interface FallbackCard {
  name: string;
  frameType: string;
  type: string;
  level?: number | null;
  atk?: number | null;
  def?: number | null;
  race?: string | null;
  attribute?: string | null;
}

/** Cor da moldura por tipo de carta — a que o jogador reconhece de relance. */
const FRAME_COLORS: Record<string, [string, string]> = {
  token: ["#8d8f94", "#5b5d62"],
  normal: ["#d9b56a", "#a8823a"],
  effect: ["#d98a4c", "#a65a26"],
  ritual: ["#5d8fd6", "#2f5ea8"],
  fusion: ["#9a6bc4", "#6a3f94"],
  synchro: ["#e8e8e8", "#b0b0b0"],
  xyz: ["#3a3a3f", "#18181b"],
  link: ["#3f7fc4", "#1f4f8c"],
  spell: ["#3d9a7c", "#1f6b52"],
  trap: ["#c45a8f", "#8c2f61"],
};

const escapeXml = (text: string) =>
  text.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

/** Quebra o nome em até duas linhas de ~20 caracteres, por palavra. */
function nameLines(name: string): string[] {
  if (name.length <= 20) return [name];
  const words = name.split(" ");
  const lines = [""];
  for (const word of words) {
    const current = lines.at(-1)!;
    if (current && (current + " " + word).length > 20 && lines.length < 2) lines.push(word);
    else lines[lines.length - 1] = current ? `${current} ${word}` : word;
  }
  return lines.map((line) => (line.length > 24 ? `${line.slice(0, 23)}…` : line));
}

/**
 * Face de carta desenhada, para quando a YGOPRODeck não tem a arte.
 *
 * Existe por causa das fichas: ~30 das que o engine cria (Fiendsmith,
 * Centur-Ion, Shinsen…) nunca ganharam imagem lá, e a mesa mostrava a imagem
 * quebrada. É uma carta de verdade, no formato 59×86 das outras: moldura na
 * cor do tipo (cinza para ficha), nome, estrelas de Nível e ATK/DEF — o que
 * se lê numa ficha. Serve também para carta recém-anunciada ainda sem arte.
 */
export function fallbackCardSvg(card: FallbackCard | null, passcode: number): string {
  const frame = card?.frameType?.split("_")[0] ?? "token";
  const [light, dark] = FRAME_COLORS[frame] ?? FRAME_COLORS.token;
  const name = card?.name ?? `Carta ${passcode}`;
  const isMonster = frame !== "spell" && frame !== "trap";
  const label = frame === "token" ? "TOKEN" : (card?.type ?? "").toUpperCase();
  const level = Math.min(card?.level ?? 0, 12);
  const stars = Array.from({ length: level }, (_, i) =>
    `<circle cx="${371 - i * 27}" cy="104" r="10" fill="#f2c94c" stroke="#7a5a10" stroke-width="2"/>`,
  ).join("");
  const lines = nameLines(name);
  const nameText = lines
    .map(
      (line, i) =>
        `<text x="44" y="${lines.length === 1 ? 70 : 58 + i * 26}" font-size="${lines.length === 1 ? 30 : 24}" font-weight="700" fill="#111">${escapeXml(line)}</text>`,
    )
    .join("");
  const typeLine = [card?.race, frame === "token" ? "Token" : null].filter(Boolean).join(" / ");
  const stats =
    isMonster && (card?.atk != null || card?.def != null)
      ? `<text x="377" y="572" font-size="24" font-weight="700" fill="#111" text-anchor="end">ATK/${card?.atk ?? "?"}  DEF/${card?.def ?? "?"}</text>`
      : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 421 614" width="421" height="614" font-family="Arial, Helvetica, sans-serif">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs>
<rect width="421" height="614" rx="18" fill="#1b1b1f"/>
<rect x="10" y="10" width="401" height="594" rx="12" fill="url(#g)"/>
<rect x="32" y="28" width="357" height="${lines.length === 1 ? 58 : 66}" rx="4" fill="#f4f1ea" opacity="0.92"/>
${nameText}
${stars}
<rect x="50" y="124" width="321" height="306" fill="#26262b" stroke="#111" stroke-width="4"/>
<text x="210.5" y="290" font-size="${label.length > 8 ? 34 : 54}" font-weight="800" fill="${light}" text-anchor="middle" letter-spacing="4">${escapeXml(label)}</text>
<rect x="32" y="448" width="357" height="138" rx="4" fill="#f4f1ea" opacity="0.92"/>
<text x="44" y="480" font-size="20" font-weight="700" fill="#333">${escapeXml(typeLine ? `[${typeLine}]` : "")}</text>
<text x="44" y="512" font-size="18" fill="#555">${escapeXml(card?.attribute ?? "")}</text>
${stats}
</svg>`;
}
