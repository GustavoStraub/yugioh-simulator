import type { DeckCardRef, DeckList } from "@/lib/types";

/**
 * Deck de fora para dentro e de dentro para fora: o arquivo `.ydk` (YGOPro,
 * EDOPro, ygoprodeck.com) e o link `ydke://` (o que o EDOPro e o Discord dos
 * jogadores trocam). Sem isto, levar um deck daqui para outro simulador — ou
 * trazer uma lista pronta de lá — era digitar carta por carta.
 *
 * Os dois formatos só carregam passcodes por zona; quem decide se a carta
 * existe é o catálogo (`importDeckLists` recebe a pergunta pronta).
 */
export interface DeckZones {
  main: number[];
  extra: number[];
  side: number[];
}

/** O que veio de um arquivo/link, antes de virar deck. */
export interface ParsedDeck extends DeckZones {
  /** Linhas ou trechos que não se leram — a tela mostra, não engole. */
  errors: string[];
}

function expandir(refs: DeckCardRef[]): number[] {
  return refs.flatMap((ref) => Array.from({ length: ref.quantity }, () => ref.passcode));
}

/** As zonas do deck como listas de passcodes, uma entrada por cópia. */
export function deckZones(deck: DeckList): DeckZones {
  return { main: expandir(deck.main), extra: expandir(deck.extra), side: expandir(deck.side) };
}

/**
 * `.ydk`: texto com `#main`, `#extra` e `!side`, um passcode por linha.
 * Linhas que começam com `#` sem ser seção são comentário (o "created by").
 */
export function exportYdk(deck: DeckList): string {
  const zonas = deckZones(deck);
  return [
    "#created by Yu-Gi-Oh! Goat",
    "#main",
    ...zonas.main.map(String),
    "#extra",
    ...zonas.extra.map(String),
    "!side",
    ...zonas.side.map(String),
    "",
  ].join("\n");
}

export function parseYdk(text: string): ParsedDeck {
  const out: ParsedDeck = { main: [], extra: [], side: [], errors: [] };
  let zona: keyof DeckZones | null = null;
  text.split(/\r?\n/).forEach((bruta, indice) => {
    const linha = bruta.trim();
    if (!linha) return;
    const secao = linha.toLowerCase();
    if (secao === "#main") return void (zona = "main");
    if (secao === "#extra") return void (zona = "extra");
    if (secao === "!side") return void (zona = "side");
    if (linha.startsWith("#")) return;
    // Alguns exportadores anotam o nome depois do passcode ("46986414 Dark Magician").
    const codigo = /^(\d{1,9})\b/.exec(linha)?.[1];
    if (!codigo || zona === null) {
      out.errors.push(`linha ${indice + 1}: "${linha.slice(0, 40)}"`);
      return;
    }
    out[zona].push(Number(codigo));
  });
  return out;
}

/** Passcodes em uint32 little-endian, base64 — o miolo do `ydke://`. */
function codificar(codes: number[]): string {
  const bytes = new Uint8Array(codes.length * 4);
  const view = new DataView(bytes.buffer);
  codes.forEach((code, i) => view.setUint32(i * 4, code >>> 0, true));
  let binario = "";
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario);
}

function decodificar(trecho: string): number[] {
  const binario = atob(trecho);
  if (binario.length % 4 !== 0) throw new Error("tamanho não é múltiplo de 4");
  const bytes = Uint8Array.from(binario, (char) => char.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i += 4) out.push(view.getUint32(i, true));
  return out;
}

export function exportYdke(deck: DeckList): string {
  const zonas = deckZones(deck);
  return `ydke://${codificar(zonas.main)}!${codificar(zonas.extra)}!${codificar(zonas.side)}!`;
}

export function parseYdke(link: string): ParsedDeck {
  const out: ParsedDeck = { main: [], extra: [], side: [], errors: [] };
  const corpo = link.trim().replace(/^ydke:\/\//i, "");
  const partes = corpo.split("!");
  if (!/^ydke:\/\//i.test(link.trim()) || partes.length < 3) {
    out.errors.push("não é um link ydke:// (esperado ydke://principal!extra!side!)");
    return out;
  }
  (["main", "extra", "side"] as const).forEach((zona, i) => {
    if (!partes[i]) return;
    try {
      out[zona] = decodificar(partes[i]);
    } catch (falha) {
      out.errors.push(`${zona}: ${falha instanceof Error ? falha.message : "base64 inválido"}`);
    }
  });
  return out;
}

/** `.ydk` ou `ydke://`, pelo conteúdo. */
export function parseDeckText(texto: string): ParsedDeck {
  return /^\s*ydke:\/\//i.test(texto) ? parseYdke(texto) : parseYdk(texto);
}

/**
 * Agrupa as cópias de volta em referências, descartando o que o catálogo não
 * conhece (contado em `unknown`, para a tela dizer quantas ficaram de fora).
 */
export function importDeckLists(
  parsed: DeckZones,
  existe: (code: number) => boolean,
): { main: DeckCardRef[]; extra: DeckCardRef[]; side: DeckCardRef[]; unknown: number[] } {
  const unknown: number[] = [];
  const agrupar = (codes: number[]): DeckCardRef[] => {
    const contagem = new Map<number, number>();
    for (const code of codes) {
      if (!existe(code)) {
        unknown.push(code);
        continue;
      }
      contagem.set(code, (contagem.get(code) ?? 0) + 1);
    }
    return [...contagem].map(([passcode, quantity]) => ({ passcode, quantity }));
  };
  return {
    main: agrupar(parsed.main),
    extra: agrupar(parsed.extra),
    side: agrupar(parsed.side),
    unknown,
  };
}
