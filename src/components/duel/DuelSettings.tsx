"use client";

import { useEffect, useState } from "react";

import { usePlayer } from "@/context/PlayerProvider";
import { getSfxSettings, playSfx, setSfxSettings, SFX_PREVIEW } from "@/lib/audio/sfx";
import { CHAIN_RESPONSE_MODES, type ChainResponseMode } from "@/lib/duel/chain-mode";
import {
  CHAIN_MODE_HINT,
  CHAIN_MODE_LABEL,
  HOLOGRAM_MODE_LABEL,
  SPEED_LABEL,
  type DuelPrefs,
  type DuelSpeed,
  type HologramMode,
} from "@/lib/duel/duel-prefs";
import { LANGUAGE_OPTIONS } from "@/lib/i18n/language";

const SPEEDS: DuelSpeed[] = ["normal", "fast", "faster"];
const HOLOGRAM_MODES: HologramMode[] = ["always", "moments", "off"];

/**
 * A engrenagem da mesa — o menu do canto de cima à esquerda do Master Duel.
 *
 * Junta tudo o que se ajusta no meio do duelo: a confirmação de ativação, a
 * velocidade das animações, os cortes de invocação, o som, o idioma das cartas
 * e as dicas — e a saída: render-se e sair da mesa. Com a mesa em tela cheia
 * (como no MD) o cabeçalho do site fica por baixo, então é daqui que se sai.
 * As escolhas ficam no navegador (`duel-prefs.ts`).
 *
 * @param pacing `room` no duelo online: as pausas são da sala (o servidor roda
 *   o laço para os dois), então a velocidade não se escolhe daqui.
 */
export function DuelSettings({
  prefs,
  onChange,
  pacing,
  tips,
  onSurrender,
  leave,
}: {
  prefs: DuelPrefs;
  /** Ausente: a mesa não tem quem aplique as preferências (só leitura). */
  onChange?: (next: Partial<DuelPrefs>) => void;
  pacing: "local" | "room";
  /** Dicas de primeira vez (ver `tips.ts`); ausente esconde a seção. */
  tips?: { on: boolean; onToggle: (on: boolean) => void; onReset: () => void };
  /** Render-se — ausente quando não há rendição (duelo acabado, assistindo). */
  onSurrender?: () => void;
  /** Sair da mesa (o lobby, a lista de salas); `confirm` pede um segundo clique. */
  leave?: { href: string; label: string; confirm: boolean };
}) {
  const [open, setOpen] = useState(false);
  const [rendendo, setRendendo] = useState(false);
  const [saindo, setSaindo] = useState(false);
  const { language, setLanguage } = usePlayer();
  // Lido na abertura: o volume mora no `localStorage` (fora do React).
  const [som, setSom] = useState(() => getSfxSettings());

  // Esc fecha o painel. Em captura e parando a propagação: o Esc da mesa
  // (esconder a decisão) não deve disparar junto com o fechamento.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopImmediatePropagation();
      setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  const fechar = () => {
    setOpen(false);
    setRendendo(false);
    setSaindo(false);
  };

  return (
    // `data-table-control`: controle da mesa, não jogada — os testes de
    // navegador que clicam "qualquer botão útil" o ignoram.
    <div className="relative" data-table-control>
      <button
        type="button"
        data-duel-settings
        onClick={() => {
          playSfx("click");
          if (open) fechar();
          else {
            setSom(getSfxSettings());
            setOpen(true);
          }
        }}
        aria-label="Configurações do duelo"
        aria-expanded={open}
        title="Configurações do duelo"
        className={`md-round md-round-gear ${open ? "md-round-on" : ""}`}
      >
        <svg aria-hidden viewBox="0 0 24 24" className="md-round-glyph md-gear-glyph">
          <path d="M12 8.6a3.4 3.4 0 100 6.8 3.4 3.4 0 000-6.8z" />
          <path d="M19.4 13.5a7.6 7.6 0 000-3l2-1.6-2-3.4-2.4 1a7.4 7.4 0 00-2.6-1.5L14 2.4h-4l-.4 2.6A7.4 7.4 0 007 6.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 000 3l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 002.6 1.5l.4 2.6h4l.4-2.6a7.4 7.4 0 002.6-1.5l2.4 1 2-3.4z" />
        </svg>
      </button>

      {open && (
        <>
          {/* Acima do HUD (z-45/46) e dos avisos da mesa: o painel desce por
              cima deles. */}
          <div className="fixed inset-0 z-[60]" onClick={fechar} />
          <div
            role="dialog"
            aria-label="Configurações do duelo"
            data-duel-settings-panel
            className="md-settings absolute left-0 top-full z-[70] mt-2 w-[min(320px,calc(100vw-24px))]"
          >
            <header className="md-settings-head">Configurações do duelo</header>
            <div className="md-settings-body">
              {onChange && (
                <Section title="Confirmação de ativação">
                  {CHAIN_RESPONSE_MODES.map((mode) => (
                    <Choice
                      key={mode}
                      name="chain-mode"
                      checked={prefs.chainMode === mode}
                      label={CHAIN_MODE_LABEL[mode]}
                      hint={CHAIN_MODE_HINT[mode]}
                      onSelect={() => onChange({ chainMode: mode })}
                    />
                  ))}
                </Section>
              )}

              {onChange && (
                <Section title="Velocidade">
                  {pacing === "room" ? (
                    <p className="text-[11px] leading-snug text-zinc-400">
                      No duelo online o ritmo é da sala — os dois veem a mesma jogada
                      no mesmo tempo.
                    </p>
                  ) : (
                    <div className="flex gap-1">
                      {SPEEDS.map((speed) => (
                        <button
                          key={speed}
                          type="button"
                          data-speed={speed}
                          aria-pressed={prefs.speed === speed}
                          onClick={() => {
                            playSfx("click");
                            onChange({ speed });
                          }}
                          className={`md-seg flex-1 ${prefs.speed === speed ? "md-seg-on" : ""}`}
                        >
                          {SPEED_LABEL[speed]}
                        </button>
                      ))}
                    </div>
                  )}
                </Section>
              )}

              {onChange && (
                <Section title="Animações">
                  <label className="flex cursor-pointer items-start gap-2 text-[12px] text-zinc-200">
                    <input
                      type="checkbox"
                      data-cutins-toggle
                      checked={prefs.cutIns}
                      onChange={(event) => onChange({ cutIns: event.target.checked })}
                      className="mt-0.5 accent-[color:var(--md-cyan)]"
                    />
                    <span>
                      Corte de invocação
                      <span className="block text-[11px] leading-snug text-zinc-400">
                        A arte do monstro em tela cheia nas invocações do Extra Deck, de
                        Ritual e por Tributo (clique para pular).
                        {pacing === "room" ? " No online a pausa é da sala." : ""}
                      </span>
                    </span>
                  </label>
                  <div className="mt-3 text-[12px] text-zinc-200">
                    Holograma do monstro
                    <span className="block text-[11px] leading-snug text-zinc-400">
                      O monstro sai da carta. “Em momentos”: só ao chegar ao campo, no
                      ataque e com o mouse na carta.
                    </span>
                    <div className="mt-1.5 flex gap-1">
                      {HOLOGRAM_MODES.map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          data-hologram-mode={mode}
                          aria-pressed={prefs.holograms === mode}
                          onClick={() => {
                            playSfx("click");
                            onChange({ holograms: mode });
                          }}
                          className={`md-seg flex-1 ${prefs.holograms === mode ? "md-seg-on" : ""}`}
                        >
                          {HOLOGRAM_MODE_LABEL[mode]}
                        </button>
                      ))}
                    </div>
                  </div>
                </Section>
              )}

              <Section title="Som">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSom(setSfxSettings({ muted: !som.muted }))}
                    className={`md-seg shrink-0 px-3 ${som.muted ? "" : "md-seg-on"}`}
                  >
                    {som.muted ? "🔇 Mudo" : "🔊 Ligado"}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round(som.volume * 100)}
                    disabled={som.muted}
                    onChange={(event) => setSom(setSfxSettings({ volume: Number(event.target.value) / 100 }))}
                    // Um som de amostra ao soltar dá a referência do nível escolhido.
                    onMouseUp={() => playSfx("click")}
                    onKeyUp={() => playSfx("click")}
                    className="min-w-0 flex-1 accent-[color:var(--md-cyan)] disabled:opacity-40"
                    aria-label="Volume"
                  />
                  <span className="w-9 text-right font-mono text-[11px] text-zinc-400">
                    {som.muted ? "—" : `${Math.round(som.volume * 100)}%`}
                  </span>
                </div>
                {/* Ouvir cada som, um a um — é como se diz o que ajustar. */}
                <details className="md-sfx-preview">
                  <summary>Ouvir os sons</summary>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {SFX_PREVIEW.map(({ name, label }) => (
                      <button
                        key={name}
                        type="button"
                        data-sfx-preview={name}
                        disabled={som.muted}
                        onClick={() => playSfx(name)}
                        className="md-seg px-2 py-1 text-[11px] disabled:opacity-40"
                      >
                        ▶ {label}
                      </button>
                    ))}
                  </div>
                </details>
              </Section>

              <Section title="Idioma das cartas">
                <div className="flex gap-1" role="group" aria-label="Idioma das cartas na mesa">
                  {LANGUAGE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={language === option.value}
                      onClick={() => setLanguage(option.value)}
                      className={`md-seg flex-1 ${language === option.value ? "md-seg-on" : ""}`}
                    >
                      {option.value === "pt" ? "Português" : "English"}
                    </button>
                  ))}
                </div>
              </Section>

              {tips && (
                <Section title="Dicas para iniciantes">
                  <label className="flex cursor-pointer items-center gap-2 text-[12px] text-zinc-200">
                    <input
                      type="checkbox"
                      data-tips-toggle
                      checked={tips.on}
                      onChange={(event) => tips.onToggle(event.target.checked)}
                      className="accent-[color:var(--md-cyan)]"
                    />
                    Mostrar dicas na primeira vez de cada situação
                  </label>
                  <button
                    type="button"
                    onClick={tips.onReset}
                    className="text-[11px] text-sky-300 hover:text-sky-200"
                  >
                    Rever todas as dicas desde o começo
                  </button>
                </Section>
              )}

              <Section title="Atalhos">
                <ul className="space-y-1 text-[11px] leading-snug text-zinc-300">
                  <li>
                    <Kbd>Esc</Kbd> esconde a decisão para ver a mesa (e a traz de volta);
                    fecha o que estiver aberto.
                  </li>
                  <li>
                    <Kbd>Enter</Kbd> confirma a seleção quando ela está completa.
                  </li>
                  <li>
                    <Kbd>Ctrl</Kbd> segurado: pergunta em toda janela, qualquer que seja
                    o modo — para parar onde o automático passaria.
                  </li>
                  <li>Clicar numa animação (ativação, corte de invocação) a pula.</li>
                </ul>
              </Section>
            </div>

            {(onSurrender || leave) && (
              <footer className="md-settings-foot">
                {onSurrender && (
                  <button
                    type="button"
                    data-surrender
                    onClick={() => {
                      if (!rendendo) {
                        setRendendo(true);
                        return;
                      }
                      fechar();
                      onSurrender();
                    }}
                    className={`md-pill flex-1 px-3 py-2 text-[12px] ${rendendo ? "md-pill-danger" : "md-pill-ghost"}`}
                  >
                    🏳️ {rendendo ? "Confirmar rendição?" : "Render-se"}
                  </button>
                )}
                {leave && (
                  <a
                    href={leave.href}
                    onClick={(event) => {
                      if (leave.confirm && !saindo) {
                        event.preventDefault();
                        setSaindo(true);
                      }
                    }}
                    className={`md-pill flex-1 px-3 py-2 text-center text-[12px] ${saindo ? "md-pill-danger" : "md-pill-ghost"}`}
                  >
                    {saindo ? "Sair mesmo? O duelo fica para trás" : `↩ ${leave.label}`}
                  </a>
                )}
              </footer>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="md-settings-section">
      <h4 className="md-settings-title">{title}</h4>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function Choice({
  name,
  checked,
  label,
  hint,
  onSelect,
}: {
  name: string;
  checked: boolean;
  label: string;
  hint: string;
  onSelect: () => void;
}) {
  return (
    <label className={`md-choice ${checked ? "md-choice-on" : ""}`}>
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={() => {
          playSfx("click");
          onSelect();
        }}
        className="mt-0.5 accent-[color:var(--md-cyan)]"
      />
      <span>
        <span className="block text-[12px] font-semibold text-zinc-100">{label}</span>
        <span className="block text-[11px] leading-snug text-zinc-400">{hint}</span>
      </span>
    </label>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-zinc-600 bg-black/60 px-1 font-mono text-[10px] text-zinc-100">
      {children}
    </kbd>
  );
}

/** Próximo modo no botão da mesa: Automático → Sempre → Nunca → Automático. */
export function nextChainMode(mode: ChainResponseMode): ChainResponseMode {
  const index = CHAIN_RESPONSE_MODES.indexOf(mode);
  return CHAIN_RESPONSE_MODES[(index + 1) % CHAIN_RESPONSE_MODES.length];
}
