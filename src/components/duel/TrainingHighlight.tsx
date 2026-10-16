"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { GuideCardTarget } from "@/lib/domain/deck-guide";
import styles from "./TrainingHighlight.module.css";

const Targets = createContext<readonly GuideCardTarget[]>([]);

export function TrainingHighlightProvider({ targets, children }: { targets: readonly GuideCardTarget[]; children: ReactNode }) {
  return <Targets.Provider value={targets}>{children}</Targets.Provider>;
}

export function useTrainingTarget(code: number | null | undefined, location: number | undefined, controller = 0): boolean {
  const targets = useContext(Targets);
  return Boolean(code && targets.some((target) => target.code === code && target.location === location && (target.controller ?? 0) === controller));
}

/** Camada independente dos brilhos azul/amarelo e da seleção verde. */
export function TrainingHighlight() {
  return <span className={styles.frame} aria-hidden="true" data-training-highlight><span className={styles.badge}>✦ GUIA</span></span>;
}
