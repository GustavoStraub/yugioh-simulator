/**
 * Efeitos sonoros sintetizados na hora com a Web Audio API.
 *
 * Nada de arquivos: os sons são gerados por osciladores e ruído, o que evita
 * baixar assets, elimina qualquer questão de licenciamento sobre áudio do jogo
 * original e mantém o bundle do mesmo tamanho.
 *
 * O contexto de áudio só é criado no primeiro toque — navegadores bloqueiam
 * áudio antes de uma interação do usuário, e criar antes disso deixaria um
 * contexto suspenso pendurado.
 */

export type SfxName =
  | "click"
  | "draw"
  | "place"
  | "summon"
  | "specialSummon"
  | "flip"
  | "activate"
  | "attack"
  | "damage"
  | "destroy"
  | "banish"
  | "recover"
  | "phase"
  | "turn"
  | "victory"
  | "defeat"
  /** O corte de invocação: o "vwoosh" grave subindo para um brilho. */
  | "cutIn"
  /** A faixa de fase atravessando a tela. */
  | "banner"
  /** "Final Blow!": o golpe que acaba o duelo. */
  | "finalBlow"
  /** Um elo novo na corrente: o tilintar de corrente. */
  | "chain";

interface SfxSettings {
  /** 0 a 1. */
  volume: number;
  muted: boolean;
}

const STORAGE_KEY = "yugioh-goat-audio-v1";
const DEFAULT_SETTINGS: SfxSettings = { volume: 0.5, muted: false };

let context: AudioContext | null = null;
let master: GainNode | null = null;
let settings: SfxSettings = DEFAULT_SETTINGS;
let loaded = false;

function readSettings(): SfxSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<SfxSettings>;
    return {
      volume: clamp01(parsed.volume ?? DEFAULT_SETTINGS.volume),
      muted: Boolean(parsed.muted),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function getSfxSettings(): SfxSettings {
  if (!loaded) {
    settings = readSettings();
    loaded = true;
  }
  return settings;
}

export function setSfxSettings(next: Partial<SfxSettings>): SfxSettings {
  settings = {
    volume: clamp01(next.volume ?? getSfxSettings().volume),
    muted: next.muted ?? getSfxSettings().muted,
  };
  loaded = true;

  if (master && context) {
    master.gain.setTargetAtTime(
      settings.muted ? 0 : settings.volume,
      context.currentTime,
      0.01,
    );
  }

  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Sem localStorage (aba privada): o ajuste vale só para esta sessão.
    }
  }

  return settings;
}

function ensureContext(): AudioContext | null {
  if (typeof window === "undefined") return null;

  if (!context) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;

    context = new Ctor();
    master = context.createGain();
    const current = getSfxSettings();
    master.gain.value = current.muted ? 0 : current.volume;
    master.connect(context.destination);
  }

  // O navegador suspende o contexto até haver interação; retomar é barato.
  if (context.state === "suspended") void context.resume();
  return context;
}

/** Envelope ADSR simplificado — ataque rápido, decaimento exponencial. */
function envelope(
  ctx: AudioContext,
  start: number,
  peak: number,
  attack: number,
  duration: number,
): GainNode {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  return gain;
}

function tone(
  ctx: AudioContext,
  out: AudioNode,
  {
    type = "sine",
    from,
    to,
    start,
    duration,
    peak = 0.3,
    attack = 0.01,
  }: {
    type?: OscillatorType;
    from: number;
    to?: number;
    start: number;
    duration: number;
    peak?: number;
    attack?: number;
  },
): void {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, start);
  if (to !== undefined && to !== from) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), start + duration);
  }

  const gain = envelope(ctx, start, peak, attack, duration);
  osc.connect(gain).connect(out);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

/** Ruído branco filtrado — usado em impactos e "whoosh". */
function noise(
  ctx: AudioContext,
  out: AudioNode,
  {
    start,
    duration,
    peak = 0.25,
    filterFrom = 2000,
    filterTo = 200,
    type = "lowpass",
  }: {
    start: number;
    duration: number;
    peak?: number;
    filterFrom?: number;
    filterTo?: number;
    type?: BiquadFilterType;
  },
): void {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(filterFrom, start);
  filter.frequency.exponentialRampToValueAtTime(
    Math.max(filterTo, 1),
    start + duration,
  );

  const gain = envelope(ctx, start, peak, 0.005, duration);
  source.connect(filter).connect(gain).connect(out);
  source.start(start);
  source.stop(start + duration + 0.02);
}

/** Toca um efeito. Silencioso e sem erro quando o áudio não está disponível. */
export function playSfx(name: SfxName): void {
  const current = getSfxSettings();
  if (current.muted || current.volume <= 0) return;

  const ctx = ensureContext();
  if (!ctx || !master) return;

  const t = ctx.currentTime;
  const out = master;

  switch (name) {
    case "click":
      tone(ctx, out, { type: "square", from: 880, start: t, duration: 0.05, peak: 0.08 });
      break;

    case "draw":
      // Deslize curto de papel.
      noise(ctx, out, { start: t, duration: 0.18, peak: 0.16, filterFrom: 900, filterTo: 4200, type: "bandpass" });
      break;

    case "place":
      // Baque seco de carta na mesa.
      tone(ctx, out, { type: "sine", from: 180, to: 70, start: t, duration: 0.12, peak: 0.28 });
      noise(ctx, out, { start: t, duration: 0.09, peak: 0.12, filterFrom: 1200, filterTo: 200 });
      break;

    case "summon":
      // Acorde ascendente curto.
      tone(ctx, out, { type: "triangle", from: 262, start: t, duration: 0.32, peak: 0.22 });
      tone(ctx, out, { type: "triangle", from: 392, start: t + 0.06, duration: 0.3, peak: 0.2 });
      tone(ctx, out, { type: "triangle", from: 523, start: t + 0.12, duration: 0.34, peak: 0.22 });
      break;

    case "specialSummon":
      tone(ctx, out, { type: "sawtooth", from: 220, to: 880, start: t, duration: 0.4, peak: 0.18 });
      tone(ctx, out, { type: "triangle", from: 660, start: t + 0.16, duration: 0.34, peak: 0.2 });
      break;

    case "flip":
      tone(ctx, out, { type: "square", from: 500, to: 1200, start: t, duration: 0.14, peak: 0.14 });
      break;

    case "activate":
      // Brilho: subida rápida com harmônico.
      tone(ctx, out, { type: "sine", from: 700, to: 1900, start: t, duration: 0.26, peak: 0.2 });
      tone(ctx, out, { type: "sine", from: 1400, to: 2600, start: t + 0.05, duration: 0.22, peak: 0.1 });
      break;

    case "attack":
      // Whoosh seguido de impacto.
      noise(ctx, out, { start: t, duration: 0.16, peak: 0.22, filterFrom: 4000, filterTo: 600, type: "bandpass" });
      tone(ctx, out, { type: "sawtooth", from: 300, to: 90, start: t + 0.1, duration: 0.18, peak: 0.26 });
      break;

    case "damage":
      // Impacto grave e sujo.
      tone(ctx, out, { type: "square", from: 140, to: 50, start: t, duration: 0.3, peak: 0.32 });
      noise(ctx, out, { start: t, duration: 0.26, peak: 0.24, filterFrom: 1600, filterTo: 120 });
      break;

    case "destroy":
      // Estilhaço: estalo agudo de ruído caindo para um baque curto.
      noise(ctx, out, { start: t, duration: 0.22, peak: 0.24, filterFrom: 6000, filterTo: 900, type: "highpass" });
      tone(ctx, out, { type: "triangle", from: 220, to: 60, start: t + 0.03, duration: 0.2, peak: 0.2 });
      break;

    case "banish":
      // Some no ar: varredura descendente e etérea.
      tone(ctx, out, { type: "sine", from: 1500, to: 300, start: t, duration: 0.34, peak: 0.12 });
      noise(ctx, out, { start: t, duration: 0.3, peak: 0.08, filterFrom: 3000, filterTo: 8000, type: "bandpass" });
      break;

    case "recover":
      tone(ctx, out, { type: "sine", from: 520, to: 780, start: t, duration: 0.3, peak: 0.2 });
      tone(ctx, out, { type: "sine", from: 780, start: t + 0.14, duration: 0.26, peak: 0.16 });
      break;

    case "phase":
      tone(ctx, out, { type: "sine", from: 1046, start: t, duration: 0.09, peak: 0.09 });
      break;

    case "turn":
      tone(ctx, out, { type: "triangle", from: 440, start: t, duration: 0.2, peak: 0.2 });
      tone(ctx, out, { type: "triangle", from: 659, start: t + 0.12, duration: 0.26, peak: 0.2 });
      break;

    case "victory":
      [523, 659, 784, 1046].forEach((freq, index) => {
        tone(ctx, out, {
          type: "triangle",
          from: freq,
          start: t + index * 0.13,
          duration: 0.42,
          peak: 0.24,
        });
      });
      break;

    case "cutIn":
      // Sobe como o MD: o ar sendo puxado, um grave que cresce e o brilho.
      noise(ctx, out, { start: t, duration: 0.5, peak: 0.16, filterFrom: 300, filterTo: 5200, type: "bandpass" });
      tone(ctx, out, { type: "sawtooth", from: 80, to: 220, start: t, duration: 0.45, peak: 0.16 });
      tone(ctx, out, { type: "triangle", from: 523, start: t + 0.38, duration: 0.6, peak: 0.2 });
      tone(ctx, out, { type: "triangle", from: 784, start: t + 0.44, duration: 0.6, peak: 0.16 });
      tone(ctx, out, { type: "sine", from: 1568, start: t + 0.5, duration: 0.5, peak: 0.08 });
      break;

    case "banner":
      // A faixa passando: um "fsss" de ar e um toque metálico.
      noise(ctx, out, { start: t, duration: 0.32, peak: 0.1, filterFrom: 900, filterTo: 6000, type: "bandpass" });
      tone(ctx, out, { type: "sine", from: 1318, start: t + 0.06, duration: 0.16, peak: 0.06 });
      break;

    case "finalBlow":
      // O golpe final: impacto grave e um acorde que sobe.
      tone(ctx, out, { type: "sawtooth", from: 110, to: 55, start: t, duration: 0.5, peak: 0.3 });
      noise(ctx, out, { start: t, duration: 0.4, peak: 0.22, filterFrom: 2400, filterTo: 160 });
      [392, 523, 659].forEach((freq, index) => {
        tone(ctx, out, { type: "square", from: freq, start: t + 0.18 + index * 0.08, duration: 0.42, peak: 0.1 });
      });
      break;

    case "chain":
      // Elos de corrente batendo.
      [1760, 2350, 1980].forEach((freq, index) => {
        tone(ctx, out, { type: "square", from: freq, to: freq * 0.85, start: t + index * 0.045, duration: 0.07, peak: 0.06 });
      });
      noise(ctx, out, { start: t, duration: 0.12, peak: 0.08, filterFrom: 7000, filterTo: 2500, type: "highpass" });
      break;

    case "defeat":
      [440, 370, 294, 220].forEach((freq, index) => {
        tone(ctx, out, {
          type: "sawtooth",
          from: freq,
          start: t + index * 0.16,
          duration: 0.5,
          peak: 0.18,
        });
      });
      break;
  }
}

/** Libera o contexto — usado ao sair do duelo. */
export function disposeSfx(): void {
  if (context) {
    void context.close();
    context = null;
    master = null;
  }
}
