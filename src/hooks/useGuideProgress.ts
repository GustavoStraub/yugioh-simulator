"use client";

import { useCallback, useState } from "react";

import { usePlayer } from "@/context/PlayerProvider";
import { invalidateClientSnapshot, useClientSnapshot } from "@/hooks/useClientSnapshot";
import {
  EMPTY_GUIDE_PROGRESS,
  guideProgressKey,
  parseGuideProgress,
  type GuideProgressReference,
  type GuideProgress,
} from "@/lib/domain/deck-guide";

const unsavedProgress = new Map<string, string>();

function readProgress(key: string): string | null {
  const unsaved = unsavedProgress.get(key);
  if (unsaved !== undefined) return unsaved;
  try { return localStorage.getItem(key); } catch { return null; }
}

export function useGuideProgress(guide: GuideProgressReference) {
  const { profile } = usePlayer();
  const key = guideProgressKey(profile?.id ?? "", guide);
  const [saveError, setSaveError] = useState(false);
  const progress = useClientSnapshot(
    key,
    useCallback(() => {
      return readProgress(key);
    }, [key]),
    useCallback((raw) => parseGuideProgress(raw, guide), [guide]),
    EMPTY_GUIDE_PROGRESS,
  );

  const save = useCallback((update: (current: GuideProgress) => GuideProgress) => {
    const current = parseGuideProgress(readProgress(key), guide);
    const raw = JSON.stringify(update(current));
    try {
      localStorage.setItem(key, raw);
      unsavedProgress.delete(key);
      invalidateClientSnapshot(key);
      setSaveError(false);
    } catch {
      unsavedProgress.set(key, raw);
      invalidateClientSnapshot(key);
      setSaveError(true);
    }
  }, [key, guide]);

  const visit = useCallback((id: string) => save((current) => ({ ...current, currentLesson: id })), [save]);
  const complete = useCallback((id: string) => save((current) => ({
    ...current,
    currentLesson: id,
    completed: [...new Set([...current.completed, id])],
  })), [save]);

  const advance = useCallback((id: string, step: number) => save((current) => ({ ...current, currentLesson: id, steps: { ...current.steps, [id]: step } })), [save]);

  return {
    progress,
    advance,
    saveError,
    visit,
    complete,
  };
}
