"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { DuelBoard } from "@/components/duel/DuelBoard";
import { TrainingHighlightProvider } from "@/components/duel/TrainingHighlight";
import { useCardRegistry } from "@/context/CardRegistryProvider";
import { usePlayer } from "@/context/PlayerProvider";
import { useDuelEngine } from "@/hooks/useDuelEngine";
import { useGuideProgress } from "@/hooks/useGuideProgress";
import { hasLessonPractice, matchesGuideDeck, type DeckGuide, type PracticeGuideLesson } from "@/lib/domain/deck-guide";
import { presetToDuelPayload, type PresetDeckDefinition } from "@/lib/domain/preset-decks";
import { DEFAULT_DUEL_PREFS } from "@/lib/duel/duel-prefs";
import type { DuelSessionConfig, DuelSnapshot } from "@/lib/duel/duel-session";
import { advancePractice, EMPTY_PRACTICE, practiceCardTargets } from "@/lib/duel/lesson-practice";
import styles from "./practice.module.css";

type Props = { guide: DeckGuide; lesson: PracticeGuideLesson; preset: PresetDeckDefinition };

export function PracticeDuelApp(props: Props) {
  const [attempt, setAttempt] = useState(0);
  return <PracticeAttempt {...props} key={attempt} onRestart={() => setAttempt((value) => value + 1)} />;
}

function PracticeAttempt({ guide, lesson, preset, onRestart }: Props & { onRestart: () => void }) {
  const { registry, error, reload } = useCardRegistry();
  const { profile } = usePlayer();
  const { complete, saveError } = useGuideProgress(guide);
  const [practice, setPractice] = useState(EMPTY_PRACTICE);
  const [showHints, setShowHints] = useState(true);
  const reported = useRef(false);
  const compatible = matchesGuideDeck(guide, preset);
  const backHref = `/aprender/${guide.id}?licao=${lesson.id}`;
  const next = guide.lessons[guide.lessons.findIndex((item) => item.id === lesson.id) + 1];
  const observe = useCallback((snapshot: DuelSnapshot) => {
    setPractice((previous) => advancePractice(lesson, snapshot, previous));
    if (!reported.current && advancePractice(lesson, snapshot, EMPTY_PRACTICE).completed) {
      reported.current = true;
      complete(lesson.id);
    }
  }, [lesson, complete]);
  const config = useMemo<DuelSessionConfig | null>(() => registry && compatible ? {
    playerName: profile?.name ?? "Aprendiz",
    opponentName: "Parceiro de treino",
    playerDeck: presetToDuelPayload(preset),
    opponentDeck: presetToDuelPayload(preset),
    registry,
    format: preset.format,
    openingHands: [lesson.startingHand, preset.main.slice(0, 5)],
    // O parceiro espera: o exercício acontece no primeiro turno do aluno.
    seats: [{ kind: "local", name: "Você" }, { kind: "local", name: "Parceiro de treino" }],
    pace: 0.4,
    cutIns: false,
  } : null, [registry, compatible, profile?.name, preset, lesson]);
  const engine = useDuelEngine(config, observe);
  const stage = lesson.practice.stages[Math.min(practice.reached, lesson.practice.stages.length - 1)];
  const blocked = practice.completed || practice.ended;
  const loading = !registry || engine.snapshot.turnCount === 0;
  const targets = practiceCardTargets(lesson, engine.snapshot, practice);

  if (!compatible || error || engine.snapshot.error) return <div className={styles.error} role="alert"><h1>Não foi possível preparar o exercício</h1><p>{!compatible ? "A lista do deck mudou e esta lição precisa ser revisada." : error ?? engine.snapshot.error}</p><button type="button" onClick={() => error ? void reload() : onRestart()}>Tentar novamente</button><Link href={backHref}>Voltar à lição</Link></div>;

  const panel = <section className={styles.coach} data-practice-lesson={lesson.id} data-practice-stage={practice.reached} data-practice-completed={practice.completed ? "true" : "false"} aria-label="Orientação do exercício">
    <div className={styles.topLine}><div><span className={styles.kicker}>{guide.title} · exercício prático</span><span className={styles.guideLegend}>✦ GUIA · carta desta etapa</span><h1>{lesson.title}</h1></div><div className={styles.actions}><button type="button" onClick={() => setShowHints((value) => !value)} aria-expanded={showHints}>{showHints ? "Recolher dica" : "Mostrar dica"}</button><button type="button" onClick={onRestart}>Recomeçar</button><Link href={backHref}>Voltar ao guia</Link></div></div>
    {!practice.completed && !practice.ended && <div className={styles.step} aria-live="polite"><span className={styles.number}>{loading ? "…" : `${Math.min(practice.reached + 1, lesson.practice.stages.length)}/${lesson.practice.stages.length}`}</span><div><strong>{loading ? "Preparando sua mão…" : stage.title}</strong>{showHints && <p>{loading ? "As cartas desta lição já vão entrar na sua mão. Aguarde a mesa carregar." : stage.instruction}</p>}</div></div>}
    {practice.ended && <p className={styles.notice} role="status">Seu turno terminou antes do objetivo. Recomece para tentar novamente com a mesma mão.</p>}
    {!practice.completed && practice.reached === lesson.practice.stages.length && !engine.snapshot.isProcessing && <p className={styles.notice} role="status">Os recursos finais ainda diferem do objetivo: {lesson.outcome} Recomece para praticar essa parte também.</p>}
    {saveError && <p className={styles.notice} role="alert">A jogada foi concluída, mas o navegador não permitiu salvar seu progresso.</p>}
  </section>;

  return <>
    <TrainingHighlightProvider targets={targets}>
    <DuelBoard snapshot={blocked ? { ...engine.snapshot, pendingPrompt: null, promptPlayer: null } : engine.snapshot} me={0} playerName={profile?.name ?? "Aprendiz"} opponentName="Parceiro de treino" subscribeEvents={engine.subscribeEvents} onRespond={(response) => { if (!blocked) void engine.respond(response); }} onForceAsk={(held) => engine.setChainPreference({ forceAsk: held })} onHurry={engine.hurry} trainingPanel={panel} prefs={{ ...DEFAULT_DUEL_PREFS, cutIns: false, speed: "fast" }} ending={{ backHref, backLabel: "Voltar à lição", onRematch: onRestart, rematchLabel: "Recomeçar exercício" }} />
    </TrainingHighlightProvider>
    {practice.completed && <PracticeSuccess><span className={styles.kicker}>Objetivo alcançado</span><h2 id="practice-success">Você executou a sequência!</h2><p>{lesson.outcome}</p><p className={styles.explanation}>O resultado foi conferido na mesa. Esta lição agora conta como concluída.</p><div className={styles.successActions}>{next && <Link className={styles.primary} href={hasLessonPractice(next) ? `/aprender/${guide.id}/treinar/${next.id}` : `/aprender/${guide.id}?licao=${next.id}`}>{hasLessonPractice(next) ? "Próximo exercício →" : "Próxima lição →"}</Link>}<button type="button" onClick={onRestart}>Praticar novamente</button><Link href={backHref}>Voltar ao guia</Link></div></PracticeSuccess>}
  </>;
}

function PracticeSuccess({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog ref={ref} className={styles.success} aria-labelledby="practice-success" onCancel={(event) => event.preventDefault()}>{children}</dialog>;
}
