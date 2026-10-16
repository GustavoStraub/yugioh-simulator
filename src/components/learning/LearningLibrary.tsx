"use client";

import Link from "next/link";
import { useState } from "react";

import { useGuideProgress } from "@/hooks/useGuideProgress";
import { DECK_GUIDES } from "@/lib/data/deck-guides";
import { getPresetDeck } from "@/lib/data/preset-decks-catalog";
import type { DeckGuide } from "@/lib/domain/deck-guide";
import { normalizeSearch } from "@/lib/domain/preset-decks";
import styles from "./learning.module.css";

export function LearningLibrary() {
  const [query, setQuery] = useState("");
  const guides = DECK_GUIDES.filter((guide) => normalizeSearch(
    [guide.title, guide.description, ...guide.tags].join(" "),
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
        <div><p className={styles.eyebrow}>Guias para decks oficiais</p><h2>Escolha por onde começar</h2><p>Explore os três decks de Heróis Lendários e Albaz Strike. Aprenda as sequências jogando com uma mão preparada e cartas indicadas na mesa.</p></div>
        <label className={styles.search}>Buscar um guia<input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="Nome, estilo ou mecânica…" /></label>
      </div>

      <div className={styles.libraryGrid}>
        {guides.map((guide) => <GuideCard key={guide.id} guide={guide} />)}
      </div>
      {guides.length === 0 && <p className={styles.empty} role="status">Nenhum guia encontrado. Busque pelo nome do deck ou por Fusão, Sincro, Xyz ou Link.</p>}
      <p className={styles.footnote}>Guias produzidos pelo app para as listas oficiais disponíveis. Cada trilha inclui suas fontes e a data da revisão.</p>
    </div>
  );
}

function GuideCard({ guide }: { guide: DeckGuide }) {
  const preset = getPresetDeck(guide.presetId);
  const { progress } = useGuideProgress(guide);
  const started = progress.currentLesson !== null || progress.completed.length > 0;
  const next = guide.lessons.find((lesson) => !progress.completed.includes(lesson.id));
  const resume = progress.currentLesson && !progress.completed.includes(progress.currentLesson)
    ? progress.currentLesson : next?.id ?? guide.lessons[0].id;

  return (
    <article className={styles.guideCard}>
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
