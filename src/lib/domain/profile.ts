import { invalidateClientSnapshot } from "@/hooks/useClientSnapshot";
import { randomId } from "@/lib/random-id";

/**
 * Quem é o dono da biblioteca de decks.
 *
 * O nome é pedido logo na entrada e não é decorativo: é ele que identifica a
 * coleção, é ele que aparece na mesa e é ele que o adversário vê na sala.
 *
 * Fica em `localStorage` (não em `sessionStorage`, como a identidade do duelo
 * online): a biblioteca é da PESSOA, e abrir uma segunda aba para montar um
 * deck não pode dar uma coleção vazia. O id é o que nomeia o arquivo no
 * servidor; o nome é só rótulo, e dá para trocar sem perder nada.
 */
export const PROFILE_STORAGE_KEY = "yugioh-goat-profile-v1";

export interface Profile {
  id: string;
  name: string;
  /**
   * Id anterior deste jogador, quando ele acabou de ganhar um id novo.
   *
   * Serve para a biblioteca ACOMPANHAR o dono: o servidor renomeia o arquivo do
   * id velho para o novo em vez de deixar os decks presos num id que ninguém
   * mais usa (ver `resolveDecks` no store).
   */
  previousId?: string;
}

/**
 * O id do perfil sai do APELIDO, insensível a caixa e a acento.
 *
 * Antes era um número aleatório por navegador, e isso amarrava a biblioteca à
 * origem: `localhost:3000` e `localhost:3100` são origens diferentes, cada uma
 * com o seu `localStorage` — trocar a porta (ou o navegador) dava um perfil
 * novo e uma coleção vazia, com os decks antigos vivos num arquivo de nome
 * ilegível. Com o id vindo do nome, "Straub", "straub" e "STRAUB" são a mesma
 * pessoa em qualquer porta, e o arquivo em `.data/decks/` passa a se chamar
 * `straub.json` — dá para achar, copiar e versionar à mão.
 *
 * Duas pessoas com o mesmo apelido na mesma máquina compartilhariam a coleção;
 * num app de rede doméstica isso é preço justo pelo resto.
 */
export function profileIdFromName(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  // O servidor exige 4 caracteres (é nome de arquivo, ver `isProfileId`).
  return slug.length >= 4 ? slug : `${slug || "duelista"}-goat`;
}

/** Id sem caracteres que virariam travessia de diretório no servidor. */
function novoId(): string {
  return randomId().replace(/-/g, "").slice(0, 24);
}

export function loadProfile(): Profile | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Profile>;
    if (typeof parsed.id !== "string" || parsed.id.length < 4) return null;
    // Nome vazio é estado legítimo: o perfil existe, mas ainda não foi batizado.
    const name = (parsed.name ?? "").trim();
    const previousId =
      typeof parsed.previousId === "string" ? parsed.previousId : undefined;

    // Perfil antigo (id aleatório) com nome já escolhido: passa a valer o id
    // derivado do nome, guardando o velho para o servidor mover a biblioteca.
    const esperado = name ? profileIdFromName(name) : parsed.id;
    if (name && parsed.id !== esperado) {
      return { id: esperado, name, previousId: parsed.id };
    }
    return { id: parsed.id, name, previousId };
  } catch {
    return null;
  }
}

export function saveProfile(profile: Profile): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  // Sem isto quem lê o perfil por `useClientSnapshot` (o cabeçalho, a portaria)
  // continuaria com o valor antigo até a próxima navegação.
  invalidateClientSnapshot(PROFILE_STORAGE_KEY);
}

/** Perfil desta máquina, criado na primeira vez (ainda sem nome). */
export function ensureProfile(): Profile {
  const existente = loadProfile();
  if (existente) return existente;

  const novo: Profile = { id: novoId(), name: "" };
  saveProfile(novo);
  return novo;
}

/** O jogador já se apresentou? */
export function hasName(profile: Profile | null): boolean {
  return Boolean(profile && profile.name.trim().length > 0);
}
