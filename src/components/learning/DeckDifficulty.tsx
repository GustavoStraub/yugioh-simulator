import styles from "./learning.module.css";

export function DeckDifficulty({ difficulty }: { difficulty: string }) {
  return (
    <span className={styles.difficulty} data-difficulty={difficulty}>
      <span className={styles.difficultyBars} aria-hidden="true">
        {[1, 2, 3].map((level) => (
          <span key={level} data-active={level <= (difficulty === "Iniciante" ? 1 : difficulty === "Intermediário" ? 2 : 3)} />
        ))}
      </span>
      Dificuldade: {difficulty}
    </span>
  );
}
