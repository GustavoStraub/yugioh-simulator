"use client";

import Link from "next/link";
import { useState } from "react";

import { useGuideProgress } from "@/hooks/useGuideProgress";
import { getPresetDeck } from "@/lib/data/preset-decks-catalog";
import type { DeckGuide } from "@/lib/domain/deck-guide";
import { normalizeSearch } from "@/lib/domain/preset-decks";
import styles from "./learning.module.css";

type LibraryGuide = Pick<DeckGuide, "id" | "revision" | "title" | "description" | "difficulty" | "minutes" | "tags" | "coverCodes" | "presetId"> & { lessons: { id: string; steps: null[] }[]; searchText: string };

export function LearningLibrary({ guides: allGuides }: { guides: LibraryGuide[] }) {
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(12);
  const guides = allGuides.filter((guide) => normalizeSearch(
    [guide.title, guide.description, guide.searchText, ...guide.tags].join(" "),
  ).includes(normalizeSearch(query.trim())));

  return (
    <div className={styles.page} data-learning-library>
      <header className={styles.libraryHero}>
        <div>
          <p className={styles.eyebrow}>Academia de duelos</p>
          <h1>Conheça o deck.<br /><span>Encontre sua jogada.</span></h1>
          <p className={styles.lead}>Entenda o plano, descubra o papel das cartas e acompanhe as sequências antes de levar o deck para a mesa.</p>
        </div>
        <ol className={styles.learningPath} aria-label="Como aprender">
          {["Entenda o plano", "Aprenda as sequências", "Pratique na mesa", "Jogue contra o bot"].map((item, i) => (
            <li key={item}><span>{String(i + 1).padStart(2, "0")}</span>{item}</li>
          ))}
        </ol>
      </header>

      <div className={styles.libraryHeading}>
        <div><p className={styles.eyebrow}>Guias para decks oficiais</p><h2>Escolha por onde começar</h2><p>Explore {allGuides.length} decks com estratégias em etapas.<span className={styles.libraryDescription}> Alguns guias também oferecem exercícios na mesa com mão preparada.</span></p></div>
        <label className={styles.search}>Buscar um guia<input value={query} onChange={(event) => { setQuery(event.target.value); setVisible(12); }} type="search" placeholder="Nome, estilo ou mecânica…" /></label>
      </div>

      <p className={styles.libraryCount} role="status">{guides.length} de {allGuides.length} guias · {Math.min(visible, guides.length)} exibidos</p>
      <div className={styles.libraryGrid}>
        {guides.slice(0, visible).map((guide) => <GuideCard key={guide.id} guide={guide} />)}
      </div>
      {visible < guides.length && <button type="button" className={`${styles.secondaryButton} ${styles.libraryMore}`} onClick={() => setVisible((count) => count + 12)}>Mostrar mais guias</button>}
      {guides.length === 0 && <p className={styles.empty} role="status">Nenhum guia encontrado. Busque pelo nome do deck ou por Fusão, Sincro, Xyz ou Link.</p>}
      <p className={styles.footnote}>Guias produzidos pelo app para as listas oficiais disponíveis. Cada trilha inclui suas fontes e a data da revisão.</p>
    </div>
  );
}

function GuideCard({ guide }: { guide: LibraryGuide }) {
  const preset = getPresetDeck(guide.presetId);
  const { progress } = useGuideProgress(guide);
  const started = progress.currentLesson !== null || progress.completed.length > 0;
  const next = guide.lessons.find((lesson) => !progress.completed.includes(lesson.id));
  const resume = progress.currentLesson && !progress.completed.includes(progress.currentLesson)
    ? progress.currentLesson : next?.id ?? guide.lessons[0].id;

  return (
    <article className={styles.guideCard} data-guide-card={guide.id}>
      <div className={styles.cardArtwork} aria-hidden="true">
        {guide.coverCodes.map((code) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={code} src={`/card-images/small/${code}.jpg`} alt="" loading="lazy" />
        ))}
        <span className={styles.artworkLabel}>{preset?.setCode} · {preset?.year}</span>
      </div>
      <div className={styles.guideCardBody}>
        <div className={styles.tags}>{guide.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
        <h3>{guide.title}</h3>
        <p>{guide.description}</p>
        <p className={styles.meta}>{guide.difficulty} · {guide.lessons.length} lições · cerca de {guide.minutes} min</p>
        {started && <div className={styles.cardProgress}><progress aria-label={`Progresso em ${guide.title}`} max={guide.lessons.length} value={progress.completed.length} /><span>{progress.completed.length}/{guide.lessons.length} lições concluídas</span></div>}
        <Link className={styles.primaryButton} href={`/aprender/${guide.id}${started ? `?licao=${resume}` : ""}`}>
          {progress.completed.length === guide.lessons.length ? "Revisar trilha" : started ? "Continuar aprendendo" : "Conhecer o deck"}<span aria-hidden="true">↗</span>
        </Link>
      </div>
    </article>
  );
}
