/**
 * Hologramas dos monstros: o monstro recortado da arte, em fatias de
 * profundidade, que a mesa faz "sair" da carta.
 *
 * Gerados uma vez por carta, fora do servidor (`npm run build:holograms` —
 * dois modelos de IA, ~270 MB, ~0,6 s por carta) e servidos daqui. A rota só
 * serve o que já existe: carta sem holograma não tem holograma, e a mesa
 * simplesmente não o desenha.
 *
 * Cada holograma é **uma** imagem: as fatias empilhadas na vertical (a de trás
 * em cima, a da frente embaixo), todas do mesmo tamanho. A mesa põe cada fatia
 * numa camada com profundidade própria; quando o holograma balança, a frente
 * anda mais que o fundo e o olho lê volume (ver `MonsterHolograms.tsx`).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { CARD_IMAGES_DIR } from "@/server/catalog/card-images";

export const HOLOGRAMS_DIR = join(CARD_IMAGES_DIR, "holo");
export const HOLOGRAM_INDEX_PATH = join(HOLOGRAMS_DIR, "index.json");

/**
 * Como o holograma foi feito.
 *
 * - `cutout`: o recorte deu certo — só o monstro, sem o cenário.
 * - `projection`: o recorte não separou o monstro do fundo (monstro que ocupa
 *   a janela inteira, como o Giant Soldier of Stone, ou fundo que o modelo
 *   confundiu com o corpo). Vai a arte inteira, esfumada em oval — uma
 *   "projeção", em vez de um monstro com cenário colado em volta.
 */
export type HologramKind = "cutout" | "projection";

export interface HologramIndex {
  version: 1;
  /** Fatias por imagem. */
  layers: number;
  /** Lado de cada fatia, em pixels. */
  size: number;
  /** Muda a cada geração — vai na URL da imagem para furar o cache. */
  generatedAt: string;
  cards: Record<string, { kind: HologramKind; cover: number }>;
}

/**
 * O que a mesa recebe: só quem tem holograma, e de que tipo.
 *
 * O índice inteiro (com a cobertura de cada recorte, para diagnóstico) passa
 * de 400 KB com os ~9.800 monstros — e a mesa o pede a cada partida. Duas
 * listas de passcodes ficam em ~90 KB.
 */
export interface HologramList {
  layers: number;
  size: number;
  generatedAt: string;
  cutout: number[];
  projection: number[];
}

export function hologramList(index: HologramIndex | null): HologramList {
  const lista: HologramList = {
    layers: index?.layers ?? 0,
    size: index?.size ?? 0,
    generatedAt: index?.generatedAt ?? "",
    cutout: [],
    projection: [],
  };
  for (const [code, { kind }] of Object.entries(index?.cards ?? {})) lista[kind].push(Number(code));
  return lista;
}

/** O índice, ou `null` se nenhum holograma foi gerado ainda. */
export function readHologramIndex(): HologramIndex | null {
  if (!existsSync(HOLOGRAM_INDEX_PATH)) return null;
  try {
    return JSON.parse(readFileSync(HOLOGRAM_INDEX_PATH, "utf8")) as HologramIndex;
  } catch {
    return null;
  }
}

/** `"12345.webp"` → `12345`; qualquer outra coisa → `null`. */
export function hologramPasscode(file: string): number | null {
  const match = /^(\d{1,10})\.webp$/.exec(file);
  return match ? Number(match[1]) : null;
}

export function hologramPath(passcode: number): string {
  return join(HOLOGRAMS_DIR, `${passcode}.webp`);
}

/**
 * O mapa de profundidade (cinza, claro = perto) ao lado das fatias. A mesa
 * ainda não o usa: é o que um desenho contínuo, sem fatias, precisaria.
 */
export function hologramDepthPath(passcode: number): string {
  return join(HOLOGRAMS_DIR, `${passcode}-depth.webp`);
}
