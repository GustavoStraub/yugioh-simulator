"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  addCardToDeck,
  clearDeck,
  createEmptyDeck,
  removeCardFromDeck,
  replaceDeck,
  setDeckFormat,
} from "@/lib/domain/deck-operations";
import {
  duplicarDeck,
  fetchDecks,
  nomeUnico,
  persistDeck,
  removeDeck,
  SELECTED_DECK_KEY,
} from "@/lib/domain/deck-library";
import { presetToDeckList } from "@/lib/domain/preset-decks";
import type { PresetDeckDefinition } from "@/lib/domain/preset-decks";
import { buildDeckCountMap, canAddCard } from "@/lib/domain/deck-rules";
import { loadDeck, saveDeck } from "@/lib/domain/deck-storage";
import { usePlayer } from "@/context/PlayerProvider";
import type { Profile } from "@/lib/domain/profile";
import type { CardDefinition, DeckList, DeckZone, DuelFormat } from "@/lib/types";

/**
 * Deck renderizado no servidor, onde não existe navegador.
 *
 * Constante de verdade — `id` e `updatedAt` fixos. Gerar um UUID ou um
 * timestamp aqui produziria valores diferentes no servidor e no cliente, que é
 * justamente a divergência de hidratação que isto existe para evitar.
 */
const SEM_DECK: DeckList = {
  id: "ssr-placeholder",
  name: "Meu Deck Goat",
  format: "goat",
  main: [],
  extra: [],
  side: [],
  updatedAt: "1970-01-01T00:00:00.000Z",
};

/**
 * Espera antes de gravar no servidor.
 *
 * Montar um deck é uma rajada de cliques; gravar a cada carta seria uma
 * requisição por clique. O espelho em `localStorage` é imediato, então nada se
 * perde nesse intervalo — o que atrasa é só a ida ao disco.
 */
const SALVAR_APOS_MS = 600;

export interface DeckLibrary {
  /** `null` enquanto carrega — a tela mostra o estado de carregamento. */
  decks: DeckList[] | null;
  selectedId: string | null;
  select: (id: string) => void;
  create: () => void;
  duplicate: () => void;
  remove: (id: string) => void;
  /** Erro da última gravação; `null` quando tudo foi para o disco. */
  saveError: string | null;
  profile: Profile | null;
}

export function useDeck() {
  // O perfil vem da portaria (ver `PlayerProvider`): quando esta tela renderiza,
  // o jogador já tem nome. Ler dali em vez de criar aqui evita duas fontes de
  // verdade para a mesma pessoa.
  const { profile } = usePlayer();
  const [decks, setDecks] = useState<DeckList[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastActionError, setLastActionError] = useState<string | null>(null);

  /** Decks aguardando gravação, por id — o debounce grava o último estado. */
  const pendentes = useRef(new Map<string, DeckList>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Gravações e remoções vão ao servidor UMA de cada vez, na ordem em que
   * aconteceram. Sem a fila, apagar um deck logo depois de mexer nele (renomear
   * e apagar, carregar um deck pronto e apagar) mandava o "apagar" enquanto o
   * "salvar" ainda estava a caminho — o salvar chegava depois e o deck
   * apagado voltava à biblioteca.
   */
  const fila = useRef<Promise<void>>(Promise.resolve());
  const enfileirar = useCallback((tarefa: () => Promise<void>) => {
    // Cada tarefa trata o próprio erro; o `catch` só impede que uma falha
    // inesperada trave a fila para as próximas.
    fila.current = fila.current.then(tarefa).catch(() => undefined);
  }, []);

  // Carrega a biblioteca. Tudo depois de um `await`, então não há cascata de
  // render (ver a regra `react-hooks/set-state-in-effect`).
  useEffect(() => {
    if (!profile) return;
    const perfil = profile;
    let vivo = true;

    (async () => {
      let biblioteca: DeckList[] = [];
      let erro: string | null = null;

      try {
        biblioteca = await fetchDecks(perfil);
      } catch (falha) {
        erro = falha instanceof Error ? falha.message : "Falha ao carregar decks.";
      }

      // Primeira visita: traz o deck que já existia no navegador em vez de
      // começar do zero — quem já montou um deck não pode perdê-lo na troca.
      if (!erro && biblioteca.length === 0) {
        const antigo = loadDeck();
        const temCartas = antigo.main.length + antigo.extra.length > 0;
        const inicial = temCartas ? antigo : createEmptyDeck("Meu Deck Goat");
        biblioteca = [inicial];
        try {
          biblioteca = await persistDeck(perfil, inicial);
        } catch {
          // Sem servidor a biblioteca ainda funciona em memória; o aviso de
          // gravação abaixo é que conta a verdade.
          erro = "Os decks não estão sendo salvos no servidor.";
        }
      }

      if (!vivo) return;

      const lembrado = localStorage.getItem(SELECTED_DECK_KEY);
      const escolhido =
        biblioteca.find((deck) => deck.id === lembrado)?.id ?? biblioteca[0]?.id ?? null;

      setDecks(biblioteca);
      setSelectedId(escolhido);
      setSaveError(erro);
    })();

    return () => {
      vivo = false;
    };
    // Só o ID importa: renomear o perfil não pode recarregar a biblioteca.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  const deck = useMemo(
    () => decks?.find((candidate) => candidate.id === selectedId) ?? SEM_DECK,
    [decks, selectedId],
  );

  /** Agenda a gravação no servidor e espelha na hora no navegador. */
  const agendarGravacao = useCallback(
    (alvo: DeckList, perfil: Profile | null) => {
      // O espelho é o que faz o lobby do duelo continuar lendo o deck atual
      // sem saber que existe biblioteca — e o que segura o estado se o
      // servidor estiver fora do ar.
      saveDeck(alvo);
      if (!perfil) return;

      pendentes.current.set(alvo.id, alvo);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const lote = [...pendentes.current.values()];
        pendentes.current.clear();
        enfileirar(async () => {
          for (const item of lote) {
            try {
              await persistDeck(perfil, item);
              setSaveError(null);
            } catch (falha) {
              setSaveError(
                falha instanceof Error ? falha.message : "Falha ao salvar o deck.",
              );
            }
          }
        });
      }, SALVAR_APOS_MS);
    },
    [enfileirar],
  );

  // Uma edição pendente não pode ir embora com a tela: sem isto, sair do
  // construtor logo depois do último clique perderia essa última carta.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  /**
   * Aplica uma alteração ao deck aberto e persiste.
   *
   * O cálculo fica FORA do atualizador de estado de propósito: gravar em disco
   * de dentro dele faria a gravação acontecer duas vezes no modo estrito do
   * React, que chama o atualizador duas vezes para detectar efeitos colaterais.
   */
  const setDeck = useCallback(
    (next: DeckList | ((current: DeckList) => DeckList)) => {
      if (!decks || !selectedId) return;
      const indice = decks.findIndex((candidate) => candidate.id === selectedId);
      if (indice < 0) return;

      const bruto = typeof next === "function" ? next(decks[indice]) : next;
      const atualizado = { ...bruto, updatedAt: new Date().toISOString() };

      const copia = [...decks];
      copia[indice] = atualizado;
      setDecks(copia);
      agendarGravacao(atualizado, profile);
    },
    [decks, selectedId, profile, agendarGravacao],
  );

  const countByPasscode = useMemo(() => buildDeckCountMap(deck), [deck]);

  const tryAddCard = useCallback(
    (card: CardDefinition, zone: DeckZone) => {
      const check = canAddCard(deck, card, zone);
      if (!check.ok) {
        setLastActionError(check.reason);
        return false;
      }
      setDeck((current) => addCardToDeck(current, card, zone));
      setLastActionError(null);
      return true;
    },
    [deck, setDeck],
  );

  const tryRemoveCard = useCallback(
    (passcode: number, zone: DeckZone) => {
      setDeck((current) => removeCardFromDeck(current, passcode, zone));
      setLastActionError(null);
    },
    [setDeck],
  );

  const tryClearDeck = useCallback(() => {
    setDeck((current) => clearDeck(current));
    setLastActionError(null);
  }, [setDeck]);

  const renameDeck = useCallback(
    (name: string) => setDeck((current) => ({ ...current, name })),
    [setDeck],
  );

  /**
   * Muda o formato do deck aberto. As cartas ficam: o que não for do pool do
   * formato novo aparece marcado no construtor (e o deck não duela até sair),
   * em vez de sumir sem aviso.
   */
  const changeFormat = useCallback(
    (format: DuelFormat) => {
      setDeck((current) => setDeckFormat(current, format));
      setLastActionError(null);
    },
    [setDeck],
  );

  const loadPreset = useCallback(
    (preset: PresetDeckDefinition) => {
      setDeck((current) => replaceDeck(current, presetToDeckList(preset, current.id)));
      setLastActionError(null);
    },
    [setDeck],
  );

  const select = useCallback((id: string) => {
    setSelectedId(id);
    localStorage.setItem(SELECTED_DECK_KEY, id);
    setLastActionError(null);
  }, []);

  /** Abre um deck recém-criado e o manda para o disco. */
  const adotar = useCallback(
    (novo: DeckList) => {
      setDecks((atual) => [...(atual ?? []), novo]);
      setSelectedId(novo.id);
      localStorage.setItem(SELECTED_DECK_KEY, novo.id);
      agendarGravacao(novo, profile);
    },
    [profile, agendarGravacao],
  );

  // Deck novo nasce no formato do deck aberto: quem está montando TCG quer o
  // próximo TCG também.
  const create = useCallback(() => {
    adotar(createEmptyDeck(nomeUnico("Novo deck", decks ?? []), deck.format));
  }, [adotar, decks, deck.format]);

  const duplicate = useCallback(() => {
    if (deck.id === SEM_DECK.id) return;
    adotar(duplicarDeck(deck, decks ?? []));
  }, [adotar, deck, decks]);

  const remove = useCallback(
    (id: string) => {
      if (!decks) return;

      // A edição ainda não gravada do deck apagado não pode ir ao servidor
      // depois — ela o recriaria.
      pendentes.current.delete(id);
      const restante = decks.filter((candidate) => candidate.id !== id);
      // Nunca deixar a biblioteca vazia: sem deck aberto o construtor não teria
      // onde pôr a próxima carta.
      const biblioteca =
        restante.length > 0 ? restante : [createEmptyDeck("Meu Deck Goat")];
      setDecks(biblioteca);

      if (id === selectedId) {
        const proximo = biblioteca[0];
        setSelectedId(proximo.id);
        localStorage.setItem(SELECTED_DECK_KEY, proximo.id);
        agendarGravacao(proximo, profile);
      }

      if (profile) {
        const perfil = profile;
        enfileirar(async () => {
          try {
            await removeDeck(perfil, id);
          } catch (falha) {
            setSaveError(
              falha instanceof Error ? falha.message : "Falha ao apagar o deck.",
            );
          }
        });
      }
    },
    [decks, profile, selectedId, agendarGravacao, enfileirar],
  );

  const library: DeckLibrary = {
    decks,
    selectedId,
    select,
    create,
    duplicate,
    remove,
    saveError,
    profile,
  };

  return {
    deck,
    library,
    countByPasscode,
    lastActionError,
    clearLastActionError: () => setLastActionError(null),
    tryAddCard,
    tryRemoveCard,
    tryClearDeck,
    renameDeck,
    changeFormat,
    loadPreset,
  };
}
