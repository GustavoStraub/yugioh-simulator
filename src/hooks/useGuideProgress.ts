"use client";

import { useCallback, useState } from "react";

import { usePlayer } from "@/context/PlayerProvider";
import { invalidateClientSnapshot, useClientSnapshot } from "@/hooks/useClientSnapshot";
import {
  EMPTY_GUIDE_PROGRESS,
  guideProgressKey,
  parseGuideProgress,
  type DeckGuide,
  type GuideProgress,
} from "@/lib/domain/deck-guide";

export function useGuideProgress(guide: DeckGuide) {
  const { profile } = usePlayer();
  const key = guideProgressKey(profile?.id ?? "", guide);
  const [saveError, setSaveError] = useState(false);
  const progress = useClientSnapshot(
    key,
    useCallback(() => {
      try { return localStorage.getItem(key); } catch { return null; }
    }, [key]),
    useCallback((raw) => parseGuideProgress(raw, guide), [guide]),
    EMPTY_GUIDE_PROGRESS,
  );

  const save = useCallback((update: (current: GuideProgress) => GuideProgress) => {
    try {
      const current = parseGuideProgress(localStorage.getItem(key), guide);
      localStorage.setItem(key, JSON.stringify(update(current)));
      invalidateClientSnapshot(key);
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  }, [key, guide]);

  const visit = useCallback((id: string) => save((current) => ({ ...current, currentLesson: id })), [save]);
  const complete = useCallback((id: string) => save((current) => ({
    currentLesson: id,
    completed: [...new Set([...current.completed, id])],
  })), [save]);

  return {
    progress,
    saveError,
    visit,
    complete,
  };
}
