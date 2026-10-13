/**
 * Quais duelos-problema o jogador já resolveu — o ✓ na lista. No navegador:
 * é conveniência de quem joga, não dado do duelo.
 */
export const PUZZLES_SOLVED_KEY = "yugioh-goat-puzzles-v1";

export function parseSolved(raw: string | null): string[] {
  try {
    const lista = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(lista) ? lista.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function readSolvedRaw(): string | null {
  try {
    return localStorage.getItem(PUZZLES_SOLVED_KEY);
  } catch {
    return null;
  }
}

export function markPuzzleSolved(id: string): void {
  try {
    const atual = parseSolved(localStorage.getItem(PUZZLES_SOLVED_KEY));
    if (atual.includes(id)) return;
    localStorage.setItem(PUZZLES_SOLVED_KEY, JSON.stringify([...atual, id]));
  } catch {
    // Sem armazenamento, o ✓ só não fica guardado.
  }
}
