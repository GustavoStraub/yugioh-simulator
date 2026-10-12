"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useClientSnapshot } from "@/hooks/useClientSnapshot";
import {
  LANGUAGE_STORAGE_KEY,
  loadLanguage,
  saveLanguage,
  type Language,
} from "@/lib/i18n/language";
import {
  ensureProfile,
  hasName,
  loadProfile,
  profileIdFromName,
  PROFILE_STORAGE_KEY,
  saveProfile,
  type Profile,
} from "@/lib/domain/profile";

interface PlayerContextValue {
  profile: Profile | null;
  setName: (name: string) => void;
  language: Language;
  setLanguage: (language: Language) => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

/**
 * Quem está jogando e em que idioma lê as cartas.
 *
 * O nome vem antes de tudo porque a biblioteca de decks é dele: sem nome, o
 * jogador montaria decks numa coleção anônima e não teria como se reconhecer
 * na sala online. Por isso a portaria abaixo bloqueia a aplicação até que ele
 * se apresente — uma vez só, e depois nunca mais.
 */
export function PlayerProvider({ children }: { children: ReactNode }) {
  const profile = useClientSnapshot<Profile | null>(
    PROFILE_STORAGE_KEY,
    useCallback(() => localStorage.getItem(PROFILE_STORAGE_KEY), []),
    useCallback(() => loadProfile(), []),
    null,
  );

  const language = useClientSnapshot<Language>(
    LANGUAGE_STORAGE_KEY,
    useCallback(() => localStorage.getItem(LANGUAGE_STORAGE_KEY), []),
    useCallback(() => loadLanguage(), []),
    "pt",
  );

  const setName = useCallback((name: string) => {
    const atual = ensureProfile();
    const limpo = name.trim().slice(0, 40);
    // O id passa a vir do nome (ver `profileIdFromName`): é o que faz a
    // biblioteca ser da PESSOA e não do navegador. `previousId` vai junto para
    // o servidor mover a coleção de quem trocou de nome, em vez de deixá-la
    // órfã num id que ninguém mais pede.
    const id = profileIdFromName(limpo);
    saveProfile({
      id,
      name: limpo,
      previousId: atual.id === id ? atual.previousId : atual.id,
    });
  }, []);

  const value = useMemo<PlayerContextValue>(
    () => ({ profile, setName, language, setLanguage: saveLanguage }),
    [profile, setName, language],
  );

  return (
    <PlayerContext.Provider value={value}>
      {hasName(profile) ? children : <Portaria onName={setName} />}
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerContextValue {
  const context = useContext(PlayerContext);
  if (!context) {
    throw new Error("usePlayer deve ser usado dentro de PlayerProvider.");
  }
  return context;
}

/**
 * Primeira tela de quem chega.
 *
 * Renderizada no lugar da aplicação, não por cima dela: um modal deixaria o
 * construtor montar por trás e escrever num perfil que ainda não existe.
 */
function Portaria({ onName }: { onName: (name: string) => void }) {
  const [nome, setNome] = useState("");
  const valido = nome.trim().length >= 2;

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (valido) onName(nome);
        }}
        className="w-full max-w-sm rounded-2xl border border-amber-900/40 bg-zinc-950/80 p-6"
      >
        <h1 className="text-xl font-bold text-amber-400">Yu-Gi-Oh! Goat</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Como você quer ser chamado? É o nome que vai identificar seus decks e
          aparecer para o adversário na mesa.
        </p>

        <input
          value={nome}
          onChange={(event) => setNome(event.target.value)}
          // O foco automático poupa um clique numa tela de campo único.
          autoFocus
          maxLength={40}
          placeholder="Seu nome"
          aria-label="Seu nome"
          className="mt-4 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-amber-600"
        />

        <button
          type="submit"
          disabled={!valido}
          className="mt-4 w-full rounded-xl bg-amber-600 px-6 py-3 text-sm font-semibold text-black transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Começar
        </button>

        <p className="mt-3 text-center text-xs text-zinc-600">
          Dá para trocar depois, no construtor de decks.
        </p>
      </form>
    </div>
  );
}
