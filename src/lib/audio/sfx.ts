/**
 * Efeitos sonoros sintetizados na hora com a Web Audio API, no caráter do
 * Master Duel.
 *
 * Nada de arquivos: os sons são gerados por osciladores e ruído, o que evita
 * baixar assets, elimina qualquer questão de licenciamento sobre áudio do jogo
 * original e mantém o bundle do mesmo tamanho. Os do MD não podem ser usados
 * (são da Konami) — estes imitam o desenho deles: o "whoosh" com o baque e o
 * brilho na invocação, o cristal na ativação, a corrente de metal, o vidro
 * estilhaçando, o estrondo no dano com o LP escorrendo em tique-tique, a
 * faixa passando, a fanfarra da vitória.
 *
 * O som sai por uma cadeia de mesa de mixagem: cada efeito vai seco para o
 * mestre e, em parte, para uma reverberação gerada (um eco de sala, que é o
 * que dá o "tamanho" dos sons do MD); o mestre passa por um compressor, que
 * segura o pico quando várias camadas tocam juntas (um Raigeki destrói cinco
 * cartas no mesmo instante).
 *
 * O contexto de áudio só é criado no primeiro toque — navegadores bloqueiam
 * áudio antes de uma interação do usuário, e criar antes disso deixaria um
 * contexto suspenso pendurado.
 */

export type SfxName =
  /** Toque de interface: escolher, confirmar. */
  | "click"
  /** Abrir um menu (os comandos da carta, as fases). */
  | "open"
  | "draw"
  /** Carta baixada: o tapa da carta na mesa. */
  | "place"
  | "summon"
  | "specialSummon"
  /** O corte de invocação: o ar sendo puxado, o estrondo e o acorde. */
  | "cutIn"
  | "flip"
  | "activate"
  /** Um elo novo na corrente: os elos de metal batendo. */
  | "chain"
  | "attack"
  | "damage"
  | "destroy"
  | "banish"
  | "recover"
  | "phase"
  /** A faixa de fase atravessando a tela. */
  | "banner"
  | "turn"
  /** "Final Blow!": o golpe que acaba o duelo. */
  | "finalBlow"
  | "coin"
  | "dice"
  | "victory"
  | "defeat";

/**
 * Os sons na ordem do painel de teste da engrenagem, com o nome em português —
 * é por ali que se ouve cada um para dizer o que ajustar.
 */
export const SFX_PREVIEW: { name: SfxName; label: string }[] = [
  { name: "click", label: "Clique" },
  { name: "open", label: "Abrir menu" },
  { name: "draw", label: "Comprar" },
  { name: "place", label: "Baixar" },
  { name: "flip", label: "Virar" },
  { name: "summon", label: "Invocar" },
  { name: "specialSummon", label: "Invocação-Especial" },
  { name: "cutIn", label: "Corte de invocação" },
  { name: "activate", label: "Ativar" },
  { name: "chain", label: "Corrente" },
  { name: "attack", label: "Atacar" },
  { name: "damage", label: "Dano" },
  { name: "destroy", label: "Destruir" },
  { name: "banish", label: "Banir" },
  { name: "recover", label: "Recuperar LP" },
  { name: "banner", label: "Fase" },
  { name: "turn", label: "Virada de turno" },
  { name: "finalBlow", label: "Final Blow" },
  { name: "coin", label: "Moeda" },
  { name: "dice", label: "Dado" },
  { name: "victory", label: "Vitória" },
  { name: "defeat", label: "Derrota" },
];

interface SfxSettings {
  /** 0 a 1. */
  volume: number;
  muted: boolean;
}

const STORAGE_KEY = "yugioh-goat-audio-v1";
const DEFAULT_SETTINGS: SfxSettings = { volume: 0.5, muted: false };

let context: AudioContext | null = null;
/** O volume escolhido — entra no compressor, que entra na saída. */
let master: GainNode | null = null;
/** A entrada da reverberação (cada som manda uma parte para cá). */
let reverbSend: GainNode | null = null;
/** Um segundo de ruído branco, gerado uma vez e reaproveitado. */
let noiseBuffer: AudioBuffer | null = null;
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

/**
 * A resposta de uma sala: ruído estéreo caindo em curva — o jeito clássico de
 * gerar uma reverberação sem arquivo de impulso. 1,7 s de cauda, um pouco
 * escura (o ruído é suavizado), que é o "salão" em volta dos sons do MD.
 */
function salaGerada(ctx: AudioContext): AudioBuffer {
  const segundos = 1.7;
  const frames = Math.floor(ctx.sampleRate * segundos);
  const buffer = ctx.createBuffer(2, frames, ctx.sampleRate);
  for (let canal = 0; canal < 2; canal += 1) {
    const dados = buffer.getChannelData(canal);
    let anterior = 0;
    for (let i = 0; i < frames; i += 1) {
      const t = i / frames;
      // Ruído levemente filtrado (média com o anterior) para a cauda não
      // chiar, caindo como (1 - t)^3.
      const branco = Math.random() * 2 - 1;
      anterior = anterior * 0.55 + branco * 0.45;
      dados[i] = anterior * Math.pow(1 - t, 3);
    }
  }
  return buffer;
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
    const ctx = context;

    // Mestre: volume → compressor → saída.
    master = ctx.createGain();
    const current = getSfxSettings();
    master.gain.value = current.muted ? 0 : current.volume;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 10;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;
    master.connect(compressor).connect(ctx.destination);

    // Reverberação: envio → sala gerada → volume do retorno → mestre.
    reverbSend = ctx.createGain();
    const sala = ctx.createConvolver();
    sala.buffer = salaGerada(ctx);
    const retorno = ctx.createGain();
    retorno.gain.value = 0.55;
    reverbSend.connect(sala).connect(retorno).connect(master);

    // O ruído branco reaproveitado (1 s basta: os ruídos daqui são curtos e
    // começam em pontos diferentes do buffer).
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const dados = noiseBuffer.getChannelData(0);
    for (let i = 0; i < dados.length; i += 1) dados[i] = Math.random() * 2 - 1;
  }

  // O navegador suspende o contexto até haver interação; retomar é barato.
  if (context.state === "suspended") void context.resume();
  return context;
}

/* ---------------------------------------------------------------------------
   Peças de síntese.
--------------------------------------------------------------------------- */

interface Saida {
  ctx: AudioContext;
  /** Para onde o som vai seco. */
  dry: AudioNode;
  /** O envio da reverberação. */
  wet: AudioNode;
}

/** Envelope: sobe em `attack`, cai exponencialmente até `start + duration`. */
function envelope(
  ctx: AudioContext,
  start: number,
  peak: number,
  attack: number,
  duration: number,
): GainNode {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), start + Math.max(attack, 0.002));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + Math.max(duration, attack + 0.01));
  return gain;
}

/** Liga o fim de uma cadeia na saída seca, na reverberação (`rev`) e no pan. */
function ligar(o: Saida, node: AudioNode, { rev = 0, pan = 0 }: { rev?: number; pan?: number }) {
  let fim: AudioNode = node;
  if (pan !== 0 && "createStereoPanner" in o.ctx) {
    const p = o.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    fim.connect(p);
    fim = p;
  }
  fim.connect(o.dry);
  if (rev > 0) {
    const envio = o.ctx.createGain();
    envio.gain.value = rev;
    fim.connect(envio).connect(o.wet);
  }
}

interface ToneOpts {
  type?: OscillatorType;
  from: number;
  /** Frequência final (rampa exponencial ao longo de `glide`, ou da duração). */
  to?: number;
  glide?: number;
  start: number;
  duration: number;
  peak?: number;
  attack?: number;
  /** Filtro passa-baixa opcional (e para onde ele anda). */
  lowpass?: number;
  lowpassTo?: number;
  detune?: number;
  rev?: number;
  pan?: number;
}

function tone(o: Saida, opts: ToneOpts): void {
  const { ctx } = o;
  const {
    type = "sine",
    from,
    to,
    glide,
    start,
    duration,
    peak = 0.2,
    attack = 0.005,
    lowpass,
    lowpassTo,
    detune = 0,
  } = opts;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.detune.value = detune;
  osc.frequency.setValueAtTime(from, start);
  if (to !== undefined && to !== from) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), start + (glide ?? duration));
  }
  let cadeia: AudioNode = osc;
  if (lowpass !== undefined) {
    const filtro = ctx.createBiquadFilter();
    filtro.type = "lowpass";
    filtro.frequency.setValueAtTime(lowpass, start);
    if (lowpassTo !== undefined) {
      filtro.frequency.exponentialRampToValueAtTime(Math.max(lowpassTo, 1), start + duration);
    }
    cadeia.connect(filtro);
    cadeia = filtro;
  }
  const gain = envelope(ctx, start, peak, attack, duration);
  cadeia.connect(gain);
  ligar(o, gain, opts);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

interface NoiseOpts {
  start: number;
  duration: number;
  peak?: number;
  attack?: number;
  type?: BiquadFilterType;
  from?: number;
  to?: number;
  q?: number;
  rev?: number;
  pan?: number;
}

/** Ruído filtrado — impactos, "whoosh", papel, vidro. */
function noise(o: Saida, opts: NoiseOpts): void {
  const { ctx } = o;
  if (!noiseBuffer) return;
  const { start, duration, peak = 0.2, attack = 0.004, type = "lowpass", from = 2000, to, q = 0.8 } = opts;
  const fonte = ctx.createBufferSource();
  fonte.buffer = noiseBuffer;
  fonte.loop = true;
  const filtro = ctx.createBiquadFilter();
  filtro.type = type;
  filtro.Q.value = q;
  filtro.frequency.setValueAtTime(from, start);
  if (to !== undefined && to !== from) {
    filtro.frequency.exponentialRampToValueAtTime(Math.max(to, 1), start + duration);
  }
  const gain = envelope(ctx, start, peak, attack, duration);
  fonte.connect(filtro).connect(gain);
  ligar(o, gain, opts);
  // Começa num ponto diferente do buffer a cada vez: o mesmo ruído repetido
  // vira um timbre reconhecível.
  fonte.start(start, Math.random() * 0.8);
  fonte.stop(start + duration + 0.05);
}

/**
 * Sino/cristal: parciais inarmônicos (os de uma barra de metal), os agudos
 * morrendo antes — o brilho das ativações e dos acordes do MD.
 */
function bell(
  o: Saida,
  f: number,
  start: number,
  duration: number,
  peak: number,
  extra: { rev?: number; pan?: number } = {},
) {
  const parciais: [number, number][] = [
    [1, 1],
    [2.756, 0.5],
    [5.404, 0.26],
    [8.933, 0.12],
  ];
  for (const [mult, amp] of parciais) {
    tone(o, {
      type: "sine",
      from: f * mult,
      start,
      duration: duration / Math.sqrt(mult),
      peak: peak * amp,
      attack: 0.003,
      rev: extra.rev ?? 0.4,
      pan: extra.pan ?? 0,
    });
  }
}

/** Metal (FM): elo de corrente, moeda — um tilintar com corpo. */
function metal(
  o: Saida,
  {
    carrier,
    ratio,
    index,
    start,
    duration,
    peak,
    rev = 0.3,
    pan = 0,
  }: {
    carrier: number;
    ratio: number;
    index: number;
    start: number;
    duration: number;
    peak: number;
    rev?: number;
    pan?: number;
  },
) {
  const { ctx } = o;
  const mod = ctx.createOscillator();
  mod.frequency.value = carrier * ratio;
  const modGain = ctx.createGain();
  modGain.gain.setValueAtTime(carrier * index, start);
  modGain.gain.exponentialRampToValueAtTime(Math.max(carrier * index * 0.05, 1), start + duration);
  const car = ctx.createOscillator();
  car.frequency.value = carrier;
  mod.connect(modGain).connect(car.frequency);
  const gain = envelope(ctx, start, peak, 0.002, duration);
  car.connect(gain);
  ligar(o, gain, { rev, pan });
  mod.start(start);
  car.start(start);
  mod.stop(start + duration + 0.05);
  car.stop(start + duration + 0.05);
}

/** Uma variação pequena de afinação a cada toque — o mesmo som repetido cansa. */
function varia(base: number, spread = 0.03): number {
  return base * (1 + (Math.random() - 0.5) * spread);
}

/** Tique-tique do LP escorrendo (descendo no dano, subindo na cura). */
function lpTicks(o: Saida, start: number, subindo: boolean) {
  const n = 9;
  for (let i = 0; i < n; i += 1) {
    const f = subindo ? 900 + i * 70 : 1500 - i * 60;
    tone(o, { type: "square", from: f, start: start + i * 0.055, duration: 0.03, peak: 0.022, lowpass: 3200 });
  }
}

/* ---------------------------------------------------------------------------
   Os sons.
--------------------------------------------------------------------------- */

/** Toca um efeito. Silencioso e sem erro quando o áudio não está disponível. */
export function playSfx(name: SfxName): void {
  const current = getSfxSettings();
  if (current.muted || current.volume <= 0) return;

  const ctx = ensureContext();
  if (!ctx || !master || !reverbSend) return;

  const o: Saida = { ctx, dry: master, wet: reverbSend };
  // Um respiro de 10 ms: agendar exatamente em `currentTime` corta o ataque
  // do primeiro quadro em alguns navegadores.
  const t = ctx.currentTime + 0.01;

  switch (name) {
    case "click":
      // O "tic" da interface do MD: curto, limpo, sem grave.
      tone(o, { from: varia(2100), to: 1500, start: t, duration: 0.05, peak: 0.14 });
      noise(o, { start: t, duration: 0.02, peak: 0.07, type: "highpass", from: 6000 });
      break;

    case "open":
      // Os comandos aparecendo: um "pop" subindo e um brilho fino.
      tone(o, { from: varia(520), to: 1150, start: t, duration: 0.09, peak: 0.13 });
      bell(o, varia(2637), t + 0.03, 0.2, 0.04, { rev: 0.2 });
      break;

    case "draw":
      // A carta saindo do deck: papel deslizando, e o toque dela na mão.
      noise(o, { start: t, duration: 0.17, peak: 0.24, type: "bandpass", from: 1100, to: 5200, q: 1.1 });
      tone(o, { from: varia(2600), start: t + 0.13, duration: 0.03, peak: 0.07 });
      break;

    case "place":
      // Carta baixada: o tapa seco na mesa.
      tone(o, { from: varia(170), to: 60, start: t, duration: 0.14, peak: 0.3 });
      // O "tap" audível em caixa de notebook (o grave sozinho some ali).
      tone(o, { type: "square", from: 280, to: 95, start: t, duration: 0.09, peak: 0.08, lowpass: 1300 });
      noise(o, { start: t, duration: 0.08, peak: 0.2, type: "lowpass", from: 2600, to: 300, rev: 0.08 });
      break;

    case "flip":
      // A carta virando: um "fwip" de papel e o estalo.
      noise(o, { start: t, duration: 0.09, peak: 0.22, type: "bandpass", from: 1500, to: 7200, q: 2 });
      tone(o, { from: varia(3000), start: t + 0.07, duration: 0.03, peak: 0.08 });
      break;

    case "summon": {
      // Invocação do MD: o ar subindo, o baque da carta na zona e o brilho.
      noise(o, { start: t, duration: 0.28, peak: 0.13, attack: 0.18, type: "bandpass", from: 400, to: 3200, q: 0.9 });
      const pouso = t + 0.22;
      tone(o, { from: varia(150), to: 45, start: pouso, duration: 0.32, peak: 0.34, rev: 0.12 });
      tone(o, { type: "triangle", from: 240, to: 85, start: pouso, duration: 0.2, peak: 0.16, lowpass: 1500 });
      noise(o, { start: pouso, duration: 0.13, peak: 0.16, type: "lowpass", from: 1800, to: 150 });
      bell(o, varia(1568), pouso + 0.02, 0.7, 0.05, { rev: 0.45 });
      bell(o, varia(2093), pouso + 0.05, 0.6, 0.035, { rev: 0.45 });
      break;
    }

    case "specialSummon": {
      // Maior: a subida longa (serra abrindo o filtro), o estrondo e o
      // arpejo de cristal.
      tone(o, { type: "sawtooth", from: 110, to: 440, start: t, duration: 0.45, peak: 0.08, attack: 0.3, lowpass: 400, lowpassTo: 3200 });
      noise(o, { start: t, duration: 0.45, peak: 0.12, attack: 0.38, type: "bandpass", from: 300, to: 6500, q: 0.8 });
      const impacto = t + 0.42;
      tone(o, { from: 90, to: 34, start: impacto, duration: 0.65, peak: 0.42, rev: 0.2 });
      tone(o, { type: "triangle", from: 190, to: 60, start: impacto, duration: 0.35, peak: 0.2, lowpass: 1400 });
      noise(o, { start: impacto, duration: 0.28, peak: 0.24, type: "lowpass", from: 3000, to: 100, rev: 0.2 });
      [1046.5, 1318.5, 1568, 2093].forEach((f, i) => {
        bell(o, varia(f, 0.01), impacto + 0.03 + i * 0.05, 0.8, 0.045, { rev: 0.5, pan: (i - 1.5) * 0.25 });
      });
      break;
    }

    case "cutIn": {
      // O corte: o ar sendo puxado (subida de ruído), o estrondo grave e um
      // acorde aberto de serras abrindo o filtro — o "tchan" do MD.
      noise(o, { start: t, duration: 0.5, peak: 0.16, attack: 0.45, type: "bandpass", from: 200, to: 4500, q: 0.7 });
      const golpe = t + 0.45;
      tone(o, { from: 72, to: 30, start: golpe, duration: 1.3, peak: 0.48, rev: 0.25 });
      tone(o, { type: "square", from: 115, to: 55, start: golpe, duration: 0.5, peak: 0.12, lowpass: 900 });
      noise(o, { start: golpe, duration: 0.55, peak: 0.24, type: "lowpass", from: 2400, to: 80, rev: 0.3 });
      [146.8, 220, 293.7, 440, 587.3].forEach((f, i) => {
        for (const d of [-8, 8]) {
          tone(o, {
            type: "sawtooth",
            from: f,
            start: golpe,
            duration: 1.25,
            peak: 0.022,
            attack: 0.06,
            lowpass: 700,
            lowpassTo: 2600,
            detune: d,
            rev: 0.55,
            pan: (i - 2) * 0.2,
          });
        }
      });
      for (let i = 0; i < 6; i += 1) {
        bell(o, 2000 + Math.random() * 1700, golpe + 0.08 + Math.random() * 0.45, 0.5, 0.022, {
          rev: 0.6,
          pan: Math.random() * 1.2 - 0.6,
        });
      }
      break;
    }

    case "activate": {
      // A ativação do MD: um sopro subindo ao contrário e o cristal.
      noise(o, { start: t, duration: 0.2, peak: 0.08, attack: 0.17, type: "highpass", from: 2800, to: 8000, rev: 0.2 });
      const brilho = t + 0.16;
      bell(o, varia(1760, 0.015), brilho, 1.1, 0.085, { rev: 0.55 });
      bell(o, varia(2637, 0.015), brilho + 0.015, 0.95, 0.055, { rev: 0.55 });
      tone(o, { from: 230, to: 110, start: brilho, duration: 0.25, peak: 0.12 });
      break;
    }

    case "chain": {
      // Os elos de metal batendo, com um "chung" grave por baixo.
      [1900, 2350, 1720].forEach((f, i) => {
        metal(o, { carrier: varia(f), ratio: 2.4, index: 2.2, start: t + i * 0.065, duration: 0.2, peak: 0.08, pan: (i - 1) * 0.3 });
        noise(o, { start: t + i * 0.065, duration: 0.04, peak: 0.04, type: "highpass", from: 5200 });
      });
      tone(o, { from: 190, to: 140, start: t, duration: 0.22, peak: 0.1, rev: 0.25 });
      break;
    }

    case "attack": {
      // A investida: o "fuuuh" rápido e o corte da lâmina.
      noise(o, { start: t, duration: 0.24, peak: 0.26, attack: 0.08, type: "bandpass", from: 500, to: 2600, q: 1 });
      const corte = t + 0.13;
      noise(o, { start: corte, duration: 0.13, peak: 0.18, type: "highpass", from: 4200, rev: 0.15 });
      tone(o, { type: "sawtooth", from: 950, to: 280, start: corte, duration: 0.13, peak: 0.06, lowpass: 3000 });
      break;
    }

    case "damage": {
      // O estrondo do dano e o LP escorrendo em tique-tique.
      tone(o, { from: varia(98), to: 38, start: t, duration: 0.6, peak: 0.5, rev: 0.25 });
      // O soco no meio do espectro: é o que se ouve numa caixa pequena.
      tone(o, { type: "square", from: 170, to: 58, start: t, duration: 0.28, peak: 0.2, lowpass: 1100 });
      noise(o, { start: t, duration: 0.03, peak: 0.16, type: "highpass", from: 3000 });
      noise(o, { start: t, duration: 0.34, peak: 0.36, type: "lowpass", from: 3500, to: 120, rev: 0.3 });
      lpTicks(o, t + 0.26, false);
      break;
    }

    case "destroy": {
      // Vidro estilhaçando: o golpe, dezenas de cacos agudos espalhados no
      // estéreo e o chiado que fica.
      noise(o, { start: t, duration: 0.09, peak: 0.42, type: "highpass", from: 2400 });
      tone(o, { from: 300, to: 80, start: t, duration: 0.18, peak: 0.24 });
      tone(o, { type: "triangle", from: 420, to: 140, start: t, duration: 0.14, peak: 0.14 });
      for (let i = 0; i < 16; i += 1) {
        tone(o, {
          type: i % 2 ? "triangle" : "sine",
          from: 2500 + Math.random() * 5200,
          start: t + Math.random() * 0.2,
          duration: 0.04 + Math.random() * 0.13,
          peak: 0.05 + Math.random() * 0.06,
          rev: 0.35,
          pan: Math.random() * 1.4 - 0.7,
        });
      }
      noise(o, { start: t + 0.03, duration: 0.4, peak: 0.09, type: "highpass", from: 6000, rev: 0.4 });
      break;
    }

    case "banish": {
      // Some no ar: o sopro descendo, dois tons batendo (o "uóóóm") e um
      // brilho que se apaga no eco.
      noise(o, { start: t, duration: 0.55, peak: 0.2, type: "bandpass", from: 4200, to: 500, q: 1.2, rev: 0.4 });
      tone(o, { from: 1600, to: 200, start: t, duration: 0.55, peak: 0.13, rev: 0.45 });
      tone(o, { from: 1612, to: 204, start: t, duration: 0.55, peak: 0.09, rev: 0.45 });
      bell(o, 3136, t + 0.05, 0.9, 0.025, { rev: 0.7 });
      break;
    }

    case "recover": {
      // A cura: arpejo de sinos subindo e o LP subindo em tique-tique.
      [1046.5, 1318.5, 1568, 2093].forEach((f, i) => {
        bell(o, f, t + i * 0.07, 0.7, 0.055, { rev: 0.5 });
      });
      lpTicks(o, t + 0.22, true);
      break;
    }

    case "phase":
    case "banner": {
      // A faixa atravessando a tela: o ar passando (subindo e descendo) e um
      // toque metálico no meio.
      noise(o, { start: t, duration: 0.26, peak: 0.09, attack: 0.2, type: "bandpass", from: 700, to: 4200, q: 1 });
      noise(o, { start: t + 0.24, duration: 0.3, peak: 0.07, type: "bandpass", from: 4200, to: 700, q: 1 });
      metal(o, { carrier: 2637, ratio: 1.4, index: 1.1, start: t + 0.13, duration: 0.35, peak: 0.035, rev: 0.4 });
      break;
    }

    case "turn": {
      // TURN CHANGE: o sopro grande, o timbal e um acorde de metais.
      noise(o, { start: t, duration: 0.4, peak: 0.13, attack: 0.3, type: "bandpass", from: 500, to: 3800, q: 0.8 });
      const golpe = t + 0.32;
      tone(o, { from: 120, to: 62, start: golpe, duration: 0.55, peak: 0.3, rev: 0.25 });
      tone(o, { type: "triangle", from: 210, to: 95, start: golpe, duration: 0.3, peak: 0.14, lowpass: 1400 });
      [220, 277.2, 329.6, 440].forEach((f, i) => {
        tone(o, {
          type: "sawtooth",
          from: f,
          start: golpe,
          duration: 0.6,
          peak: 0.032,
          attack: 0.02,
          lowpass: 1300,
          lowpassTo: 700,
          rev: 0.45,
          pan: (i - 1.5) * 0.2,
        });
      });
      break;
    }

    case "finalBlow": {
      // O golpe final: a subida, o estrondo, o prato e o acorde em ré maior.
      noise(o, { start: t, duration: 0.3, peak: 0.12, attack: 0.25, type: "bandpass", from: 400, to: 5000 });
      const golpe = t + 0.26;
      tone(o, { from: 82, to: 30, start: golpe, duration: 0.9, peak: 0.52, rev: 0.3 });
      tone(o, { type: "square", from: 150, to: 60, start: golpe, duration: 0.4, peak: 0.18, lowpass: 1000 });
      noise(o, { start: golpe, duration: 1.1, peak: 0.13, type: "highpass", from: 3200, rev: 0.45 });
      [293.7, 370, 440, 587.3].forEach((f, i) => {
        for (const d of [-6, 6]) {
          tone(o, {
            type: "sawtooth",
            from: f,
            start: golpe,
            duration: 0.8,
            peak: 0.03,
            attack: 0.015,
            lowpass: 2400,
            lowpassTo: 900,
            detune: d,
            rev: 0.5,
            pan: (i - 1.5) * 0.25,
          });
        }
      });
      break;
    }

    case "coin": {
      // A moeda girando (o metal tremulando cada vez mais devagar) e o "tim"
      // de quando ela cai.
      const tremulo = ctx.createGain();
      tremulo.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.frequency.setValueAtTime(22, t);
      lfo.frequency.exponentialRampToValueAtTime(6, t + 1);
      const profundidade = ctx.createGain();
      profundidade.gain.value = 0.5;
      lfo.connect(profundidade).connect(tremulo.gain);
      tremulo.connect(master);
      metal({ ctx, dry: tremulo, wet: reverbSend }, { carrier: 2600, ratio: 1.41, index: 2.6, start: t, duration: 1, peak: 0.05, rev: 0.25 });
      lfo.start(t);
      lfo.stop(t + 1.05);
      metal(o, { carrier: 3100, ratio: 1.41, index: 2, start: t + 1.05, duration: 0.7, peak: 0.07, rev: 0.4 });
      break;
    }

    case "dice": {
      // O dado chacoalhando e o baque no fim.
      let s = t;
      for (let i = 0; i < 11; i += 1) {
        s += 0.05 + Math.random() * 0.06;
        noise(o, {
          start: s,
          duration: 0.02,
          peak: 0.08,
          type: "bandpass",
          from: 2000 + Math.random() * 2500,
          q: 3,
          pan: Math.random() * 0.8 - 0.4,
        });
      }
      tone(o, { from: 320, to: 120, start: t + 1.02, duration: 0.12, peak: 0.2 });
      noise(o, { start: t + 1.02, duration: 0.06, peak: 0.1, type: "lowpass", from: 3000, to: 400 });
      break;
    }

    case "victory": {
      // A fanfarra: três notas subindo, o acorde aberto sustentado com o
      // timbal, e os sinos no fim.
      [523.3, 659.3, 784].forEach((f, i) => {
        tone(o, { type: "square", from: f, start: t + i * 0.12, duration: 0.2, peak: 0.05, lowpass: 2600, rev: 0.3 });
        tone(o, { type: "sawtooth", from: f / 2, start: t + i * 0.12, duration: 0.2, peak: 0.03, lowpass: 1800, rev: 0.3 });
      });
      const acorde = t + 0.42;
      tone(o, { from: 110, to: 70, start: acorde, duration: 0.6, peak: 0.32, rev: 0.3 });
      [261.6, 329.6, 392, 523.3, 659.3].forEach((f, i) => {
        for (const d of [-7, 7]) {
          tone(o, {
            type: "sawtooth",
            from: f,
            start: acorde,
            duration: 1.8,
            peak: 0.024,
            attack: 0.03,
            lowpass: 2600,
            lowpassTo: 1200,
            detune: d,
            rev: 0.5,
            pan: (i - 2) * 0.2,
          });
        }
      });
      [1568, 2093, 2637].forEach((f, i) => bell(o, f, acorde + 0.5 + i * 0.1, 1.1, 0.04, { rev: 0.6 }));
      break;
    }

    case "defeat": {
      // A derrota: acordes menores descendo devagar, sobre um estrondo grave.
      tone(o, { from: 80, to: 36, start: t, duration: 1.2, peak: 0.34, rev: 0.4 });
      [
        [220, 261.6, 329.6],
        [174.6, 207.7, 261.6],
        [146.8, 174.6, 220],
      ].forEach((acorde, j) => {
        acorde.forEach((f) => {
          tone(o, {
            type: "sawtooth",
            from: f,
            start: t + 0.1 + j * 0.42,
            duration: 0.9,
            peak: 0.028,
            attack: 0.05,
            lowpass: 900,
            lowpassTo: 400,
            rev: 0.6,
          });
        });
      });
      break;
    }
  }
}

/** Libera o contexto — usado ao sair do duelo. */
export function disposeSfx(): void {
  if (context) {
    void context.close();
    context = null;
    master = null;
    reverbSend = null;
    noiseBuffer = null;
  }
}
