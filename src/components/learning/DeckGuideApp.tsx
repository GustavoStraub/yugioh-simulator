"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { DeckPreview } from "@/components/duel/DeckPreview";
import { CardDetailsDialog } from "@/components/layout/CardDetailsDialog";
import { useCardRegistry } from "@/context/CardRegistryProvider";
import { usePlayer } from "@/context/PlayerProvider";
import { useCardText } from "@/hooks/useCardText";
import { useGuideProgress } from "@/hooks/useGuideProgress";
import { matchesGuideDeck, type DeckGuide, type GuideLesson } from "@/lib/domain/deck-guide";
import { presetToDuelPayload, type PresetDeckDefinition } from "@/lib/domain/preset-decks";
import { saveDuelSetup } from "@/lib/duel/duel-storage";
import styles from "./learning.module.css";

type Section = "overview" | "cards" | "lessons" | "sources";
const SECTIONS: { id: Section; label: string }[] = [
  { id: "overview", label: "Visão geral" },
  { id: "cards", label: "Cartas-chave" },
  { id: "lessons", label: "Jogadas e lições" },
  { id: "sources", label: "Fontes" },
];

export function DeckGuideApp({ guide, preset, initialLessonId }: {
  guide: DeckGuide;
  preset: PresetDeckDefinition;
  initialLessonId?: string;
}) {
  const router = useRouter();
  const { registry, error, reload, isLoading } = useCardRegistry();
  const { profile } = usePlayer();
  const { progress, saveError, visit } = useGuideProgress(guide);
  const [section, setSection] = useState<Section>(initialLessonId ? "lessons" : "overview");
  const [selectedLesson, setSelectedLesson] = useState<string | null>(initialLessonId ?? null);
  const [reading, setReading] = useState<number | null>(null);
  const [duelError, setDuelError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const closeReader = useCallback(() => setReading(null), []);
  const compatible = matchesGuideDeck(guide, preset);
  const activeId = selectedLesson ?? progress.currentLesson ?? guide.lessons[0].id;
  const lesson = guide.lessons.find((item) => item.id === activeId) ?? guide.lessons[0];
  const remaining = guide.lessons.find((item) => !progress.completed.includes(item.id));

  function openLesson(id: string) {
    setSelectedLesson(id);
    setSection("lessons");
    visit(id);
  }

  function practice() {
    try {
      setDuelError(null);
      saveDuelSetup({
        playerName: profile?.name ?? "Aprendiz",
        playerDeck: presetToDuelPayload(preset),
        opponentId: preset.id,
        opponentName: `Bot · ${guide.title}`,
        opponentDeck: presetToDuelPayload(preset),
        format: preset.format,
        firstTurn: "me",
        humanSeat: 0,
      });
      setStarting(true);
      router.push("/duel/play");
    } catch {
      setDuelError("Não foi possível preparar o duelo. Confira se o navegador permite o armazenamento desta sessão e tente novamente.");
    }
  }

  return (
    <div className={styles.page} data-deck-guide={guide.id}>
      <Link href="/aprender" className={styles.backLink}>← Todos os guias</Link>
      <header className={styles.deckHero}>
        <div>
          <p className={styles.eyebrow}>Aprenda a pilotar · {preset.setCode} · {preset.year}</p>
          <div className={styles.tags}>{guide.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
          <h1>{guide.title}</h1>
          <p className={styles.subtitle}>{guide.subtitle}</p>
          <p className={styles.meta}>{guide.difficulty} · {guide.lessons.length} lições · cerca de {guide.minutes} min</p>
          <p className={styles.meta}>Lista oficial · {preset.main.length} cartas + {preset.extra.length} no Extra</p>
        </div>
        <div className={styles.heroArtwork} aria-hidden="true">
          {guide.coverCodes.map((code) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/card-images/small/${code}.jpg`} alt="" key={code} />
          ))}
        </div>
      </header>

      {!compatible && <p role="alert" className={styles.notice}>A lista deste deck mudou desde a revisão do guia. As sequências precisam ser conferidas antes da prática.</p>}
      {error && <p role="alert" className={styles.notice}>As cartas não carregaram. O guia continua disponível. <button type="button" onClick={() => void reload()}>Tentar carregar as cartas</button></p>}
      {saveError && <p role="alert" className={styles.notice}>O navegador não permitiu salvar seu progresso. Você pode continuar a leitura nesta página.</p>}
      {duelError && <p role="alert" className={styles.notice}>{duelError}</p>}

      <div className={styles.sectionNav} role="group" aria-label="Partes do guia">
        {SECTIONS.map((item) => <button type="button" key={item.id} aria-pressed={section === item.id} onClick={() => setSection(item.id)}>{item.label}</button>)}
      </div>

      <div className={styles.guideLayout}>
        <div className={styles.mainContent}>
          {section === "overview" && (
            <section aria-labelledby="guide-plan">
              <p className={styles.eyebrow}>O plano de jogo</p>
              <h2 id="guide-plan">O que você quer construir?</h2>
              <p className={styles.goal}>{guide.overview.goal}</p>
              <ol className={styles.planList}>{guide.overview.plan.map((item, i) => <li key={item}><span>{i + 1}</span><p>{item}</p></li>)}</ol>
              <div className={styles.infoGrid}>
                <div className={styles.panel}><h3>O que o deck oferece</h3><ul>{guide.overview.strengths.map((item) => <li key={item}>{item}</li>)}</ul></div>
                <div className={styles.panel}><h3>Antes de começar</h3><ul>{guide.overview.watchOut.map((item) => <li key={item}>{item}</li>)}</ul></div>
              </div>
              <button type="button" className={styles.primaryButton} onClick={() => openLesson(progress.currentLesson ?? remaining?.id ?? guide.lessons[0].id)}>{progress.currentLesson ? "Continuar a trilha" : "Começar a primeira lição"}<span aria-hidden="true">→</span></button>
            </section>
          )}

          {section === "cards" && (
            <section aria-labelledby="guide-cards">
              <p className={styles.eyebrow}>Cada peça tem uma função</p><h2 id="guide-cards">Conheça suas cartas-chave</h2>
              <p className={styles.sectionIntro}>Toque em uma carta para consultar o texto completo no idioma selecionado.</p>
              <div className={styles.keyCards}>
                {guide.keyCards.map((card) => (
                  <article className={styles.keyCard} key={card.code}>
                    <CardButton code={card.code} guide={guide} onRead={setReading} artwork />
                    <div><p className={styles.eyebrow}>{card.role}</p><h3>{card.name}</h3><p>{card.explanation}</p><SourceLinks guide={guide} ids={card.sourceIds} /></div>
                  </article>
                ))}
              </div>
              <details className={styles.fullDeck}><summary>Consultar as {preset.main.length + preset.extra.length} cartas da lista oficial</summary><DeckPreview deck={presetToDuelPayload(preset)} registry={registry} onCardHover={setReading} />
                <p className={styles.footnote}>Lista do produto: <a href={preset.sourceUrl} target="_blank" rel="noreferrer">Yugipedia</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>.</p>
              </details>
            </section>
          )}

          {section === "lessons" && <LessonReader key={lesson.id} guide={guide} lesson={lesson} onRead={setReading} completed={progress.completed.includes(lesson.id)} compatible={compatible} onStart={() => visit(lesson.id)} />}

          {section === "sources" && (
            <section aria-labelledby="guide-sources">
              <p className={styles.eyebrow}>De onde vem o conteúdo</p><h2 id="guide-sources">Fontes e revisão</h2>
              <p className={styles.sectionIntro}>Explicações e roteiros elaborados pelo app a partir dos efeitos oficiais. As sequências são verificadas no motor do simulador por testes automatizados.</p>
              <p className={styles.meta}>Revisado em {guide.reviewedAt.split("-").reverse().join("/")} · versão {guide.revision} · lista {preset.setCode} · regras TCG</p>
              <ul className={styles.sourceList}>{guide.sources.map((source) => <li key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title}<span aria-hidden="true">↗</span></a></li>)}</ul>
              <p className={styles.footnote}>Cada exercício começa com uma mão preparada e acompanha suas jogadas na mesa. O duelo livre contra o bot continua disponível como prática adicional.</p>
            </section>
          )}
        </div>

        <aside className={styles.sidebar} aria-label="Sua trilha de aprendizado">
          <div className={styles.progressHeader}><p className={styles.eyebrow}>Sua trilha</p><span>{progress.completed.length}/{guide.lessons.length}</span></div>
          <progress max={guide.lessons.length} value={progress.completed.length} aria-label="Lições concluídas" />
          <p className={styles.progressHint}>Execute o objetivo de cada exercício na mesa para concluir a lição.</p>
          <ol className={styles.lessonList}>
            {guide.lessons.map((item, i) => <li key={item.id}><button type="button" aria-current={section === "lessons" && lesson.id === item.id ? "step" : undefined} onClick={() => openLesson(item.id)}><span className={styles.lessonNumber}>{progress.completed.includes(item.id) ? "✓" : String(i + 1).padStart(2, "0")}</span><span><strong>{item.title}</strong><small>{item.minutes} min{progress.completed.includes(item.id) ? " · concluída" : ""}</small></span></button></li>)}
          </ol>
          <div className={styles.practiceCard}><h3>Leve o deck para a mesa</h3><p>Duelo livre contra o bot, com a lista oficial dos dois lados e mão aleatória. Você começa.</p><button type="button" onClick={practice} disabled={!compatible || starting} className={styles.secondaryButton}>{starting ? "Preparando duelo…" : "Praticar contra o bot ↗"}</button></div>
          <p className={styles.footnote}>Progresso salvo neste navegador para {profile?.name ?? "você"}.</p>
        </aside>
      </div>
      {reading !== null && registry && <CardDetailsDialog code={reading} registry={registry} onClose={closeReader} />}
      {isLoading && <p className={styles.footnote} role="status">Carregando os textos das cartas…</p>}
    </div>
  );
}

function CardButton({ code, guide, onRead, artwork = false }: { code: number; guide: DeckGuide; onRead: (code: number) => void; artwork?: boolean }) {
  const { registry } = useCardRegistry();
  const text = useCardText();
  const definition = registry?.get(code);
  const name = definition ? text.name(definition) : guide.keyCards.find((card) => card.code === code)?.name ?? `Carta ${code}`;
  return <button type="button" className={artwork ? styles.cardButton : styles.cardChip} onClick={() => onRead(code)} disabled={!definition} aria-label={`Ler ${name}`} title={name}>
    {artwork && (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={definition?.images[0]?.image_url_small ?? `/card-images/small/${code}.jpg`} alt={name} loading="lazy" />
    )}
    {!artwork && name}
  </button>;
}

function SourceLinks({ guide, ids }: { guide: DeckGuide; ids: string[] }) {
  return <div className={styles.sourceLinks} aria-label="Referências">{ids.map((id) => {
    const source = guide.sources.find((item) => item.id === id);
    return source && <a key={id} href={source.url} target="_blank" rel="noreferrer">{source.title.replace("Konami · ", "")} ↗</a>;
  })}</div>;
}

function LessonReader({ guide, lesson, onRead, completed, compatible, onStart }: {
  guide: DeckGuide; lesson: GuideLesson; onRead: (code: number) => void;
  completed: boolean; compatible: boolean; onStart: () => void;
}) {
  const [step, setStep] = useState(0);
  const current = lesson.steps[step];
  return (
    <section aria-labelledby="lesson-title" data-lesson={lesson.id}>
      <p className={styles.eyebrow}>Lição {guide.lessons.indexOf(lesson) + 1} · exercício na mesa{completed ? " · concluído" : ""}</p>
      <h2 id="lesson-title">{lesson.title}</h2><p className={styles.sectionIntro}>{lesson.summary}</p>
      <div className={styles.outcome}><p className={styles.eyebrow}>Seu objetivo na mesa</p><p>{lesson.outcome}</p></div>
      {compatible && <Link className={styles.primaryButton} href={`/aprender/${guide.id}/treinar/${lesson.id}`} onClick={onStart}>{completed ? "Praticar novamente na mesa" : "Começar exercício na mesa"}<span aria-hidden="true">→</span></Link>}
      <p className={styles.sectionIntro}>Você começa com as cinco cartas abaixo. Faça as jogadas na mesa: as dicas acompanham a sequência e o objetivo é conferido automaticamente.</p>
      <details className={styles.preparation} open><summary>Sua mão inicial e a preparação</summary><ul>{lesson.preparation.map((item) => <li key={item}>{item}</li>)}</ul><div className={styles.cardChips}>{lesson.startingHand.map((code, i) => <CardButton key={`${code}-${i}`} code={code} guide={guide} onRead={onRead} />)}</div></details>
      <details className={styles.preparation}><summary>Consultar o roteiro da sequência</summary>
        <div className={styles.stepDots} role="group" aria-label="Etapas da sequência">{lesson.steps.map((item, i) => <button type="button" key={item.title} aria-pressed={step === i} aria-label={`Passo ${i + 1}: ${item.title}`} onClick={() => setStep(i)}>{i + 1}</button>)}</div>
        <div className={styles.stepPanel} aria-live="polite" aria-atomic="true">
          <p className={styles.eyebrow}>Passo {step + 1} de {lesson.steps.length}</p><h3>{current.title}</h3><p>{current.action}</p>
          <div className={styles.cardChips}>{current.cardCodes.map((code) => <CardButton key={code} code={code} guide={guide} onRead={onRead} />)}</div>
          <div className={styles.why}><strong>Por que fazer isso?</strong><p>{current.why}</p></div>
        </div>
        <div className={styles.stepControls}><button type="button" className={styles.secondaryButton} disabled={step === 0} onClick={() => setStep((value) => value - 1)}>← Anterior</button><span>{step + 1}/{lesson.steps.length}</span><button type="button" className={styles.secondaryButton} disabled={step === lesson.steps.length - 1} onClick={() => setStep((value) => value + 1)}>Próximo passo →</button></div>
      </details>
      <div className={styles.cautions}><h3>Preste atenção</h3><ul>{lesson.cautions.map((item) => <li key={item}>{item}</li>)}</ul></div>
      <details className={styles.lessonSources}><summary>Fontes desta lição</summary><SourceLinks guide={guide} ids={lesson.sourceIds} /></details>
    </section>
  );
}
