"use client";

/**
 * Uma faixa do Master Duel atravessando a tela: "TURN CHANGE", "DRAW PHASE",
 * "BATTLE PHASE"… Em inglês estilizado, como no jogo em qualquer idioma
 * (decisão do Gustavo); azul no seu turno, vermelha no do oponente.
 */
export interface DuelBanner {
  id: number;
  text: string;
  /** De quem é a vez — a cor da faixa. */
  side: "me" | "foe";
  /** Linha de baixo (só quem assiste bot × bot: "VEZ DE FULANO"). */
  sub?: string;
  /** Quanto a faixa fica no ar, em ms (já na velocidade escolhida). */
  duration: number;
  /** A virada de turno é maior que a troca de fase. */
  big?: boolean;
}

/**
 * A faixa: abre do centro para as pontas, o texto entra deslizando com um
 * brilho correndo por ele e sai pelo outro lado. Não captura o mouse.
 */
export function PhaseBanner({ banner }: { banner: DuelBanner | null }) {
  if (!banner) return null;
  return (
    <div
      key={banner.id}
      aria-live="polite"
      data-turn-band={banner.side}
      data-phase-banner={banner.text}
      className={`md-phase-banner md-phase-banner-${banner.side} ${banner.big ? "md-phase-banner-big" : ""}`}
      style={{ ["--md-banner-ms" as string]: `${banner.duration}ms` }}
    >
      <div className="md-phase-banner-band" />
      <div className="md-phase-banner-shine" />
      <p className="md-phase-banner-text" data-text={banner.text}>
        {banner.text}
      </p>
      {banner.sub && <p className="md-phase-banner-sub">{banner.sub}</p>}
    </div>
  );
}

/**
 * "Final Blow!": as duas faixas verde-limão que descem pelas laterais da tela
 * do Master Duel quando o ataque declarado tira todos os LP de quem o recebe.
 * Só decoração — quem decide o fim é o core; se um efeito salvar, o duelo
 * segue (como no MD, que também anuncia pelo que está na mesa).
 */
export function FinalBlow({ token, duration }: { token: number | null; duration: number }) {
  if (token === null) return null;
  const frase = Array.from({ length: 8 }, () => "Final Blow !").join("  ");
  return (
    <div
      key={token}
      aria-hidden
      data-final-blow
      className="md-final-blow"
      style={{ ["--md-final-ms" as string]: `${duration}ms` }}
    >
      <div className="md-final-blow-flash" />
      <div className="md-final-blow-side md-final-blow-left">
        <span>{frase}</span>
      </div>
      <div className="md-final-blow-side md-final-blow-right">
        <span>{frase}</span>
      </div>
    </div>
  );
}
