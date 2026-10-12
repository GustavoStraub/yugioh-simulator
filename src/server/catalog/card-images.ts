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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

async function download(size: CardImageSize, passcode: number): Promise<Buffer | null> {
  await upstreamTurn();
  const response = await fetch(
    `https://images.ygoprodeck.com/images/${UPSTREAM_DIRS[size]}/${passcode}.jpg`,
    { cache: "no-store" },
  );
  if (response.status === 404) return null;
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

  const key = `${size}/${passcode}`;
  let pending = inFlight.get(key);
  if (!pending) {
    pending = download(size, passcode).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending;
}

/** A imagem já está no disco? (o script de pré-carga pula as que estão). */
export function hasCardImage(size: CardImageSize, passcode: number): boolean {
  return existsSync(pathFor(size, passcode));
}
