"use client";

import { useEffect, useState } from "react";

import { playSfx } from "@/lib/audio/sfx";
import { CHAIN_RESPONSE_MODES, type ChainResponseMode } from "@/lib/duel/chain-mode";
import {
  CHAIN_MODE_HINT,
  CHAIN_MODE_LABEL,
  SPEED_LABEL,
  type DuelPrefs,
  type DuelSpeed,
} from "@/lib/duel/duel-prefs";

const SPEEDS: DuelSpeed[] = ["normal", "fast", "faster"];

/**
 * A engrenagem da mesa: como a partida pergunta e em que ritmo anda.
 *
 * É o que o Master Duel e o Tag Force põem num menu de duelo — confirmação de
 * ativação, velocidade das animações — e que aqui não existia: a única
 * configuração era o volume. As escolhas ficam no navegador (`duel-prefs.ts`).
 *
 * @param pacing `room` no duelo online: as pausas são da sala (o servidor roda
 *   o laço para os dois), então a velocidade não se escolhe daqui.
 */
export function DuelSettings({
  prefs,
  onChange,
  pacing,
}: {
  prefs: DuelPrefs;
  onChange: (next: Partial<DuelPrefs>) => void;
  pacing: "local" | "room";
}) {
  const [open, setOpen] = useState(false);

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

  return (
    // `data-table-control`: controle da mesa, não jogada — os testes de
    // navegador que clicam "qualquer botão útil" o ignoram.
    <div className="relative" data-table-control>
      <button
        type="button"
        data-duel-settings
        onClick={() => setOpen((value) => !value)}
        aria-label="Configurações do duelo"
        aria-expanded={open}
        title="Configurações do duelo"
        className="tf-panel rounded-md px-2.5 py-1.5 text-base leading-none transition hover:brightness-125"
      >
        ⚙
      </button>

      {open && (
        <>
          {/* Acima da trilha de fases (z-50, que fica sobre os avisos da
              mesa): o painel desce exatamente por cima dela. */}
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label="Configurações do duelo"
            data-duel-settings-panel
            className="tf-panel absolute right-0 top-full z-[70] mt-1 w-[300px] rounded-md p-3 shadow-xl shadow-black/70"
          >
            <Section title="Perguntar se quero responder">
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
                      className={`flex-1 rounded px-2 py-1.5 text-[12px] font-semibold transition ${
                        prefs.speed === speed
                          ? "bg-[color:var(--tf-gold)] text-black"
                          : "border border-[color:var(--tf-slot-border)] text-zinc-200 hover:bg-black/50"
                      }`}
                    >
                      {SPEED_LABEL[speed]}
                    </button>
                  ))}
                </div>
              )}
            </Section>

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
                <li>Clicar no destaque de uma ativação pula a animação.</li>
              </ul>
            </Section>
          </div>
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-3 last:mb-0">
      <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-[color:var(--tf-gold)]">
        {title}
      </h4>
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
    <label
      className={`flex cursor-pointer gap-2 rounded border px-2 py-1.5 transition ${
        checked
          ? "border-[color:var(--tf-gold)] bg-[color:var(--tf-gold)]/10"
          : "border-transparent hover:bg-black/40"
      }`}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={() => {
          playSfx("click");
          onSelect();
        }}
        className="mt-0.5 accent-[color:var(--tf-gold)]"
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

const SHORT: Record<ChainResponseMode, string> = {
  auto: "Auto",
  always: "Sempre",
  never: "Nunca",
};

/**
 * O modo de resposta, sempre à vista na mesa — e trocável com um clique.
 *
 * O botão de corrente do Master Duel, no canto. Fica visível de propósito:
 * quem esqueceu o "Nunca" ligado precisa ver isso antes de perder a janela da
 * armadilha. Com o Ctrl segurado ele acende ("Parando") — é o retorno de que
 * o gesto pegou.
 */
export function ChainModeButton({
  mode,
  forcing,
  onChange,
}: {
  mode: ChainResponseMode;
  /** Ctrl segurado agora. */
  forcing: boolean;
  onChange: (mode: ChainResponseMode) => void;
}) {
  return (
    <button
      type="button"
      data-table-control
      data-chain-mode={mode}
      data-chain-forcing={forcing || undefined}
      onClick={() => {
        playSfx("click");
        onChange(nextChainMode(mode));
      }}
      title={`Perguntar se quero responder: ${CHAIN_MODE_LABEL[mode]}. ${CHAIN_MODE_HINT[mode]} Clique para trocar; segure Ctrl para parar em toda janela.`}
      className={`flex w-full flex-col items-center rounded-md border py-1 text-[10px] font-bold uppercase leading-tight tracking-wide transition ${
        forcing
          ? "border-amber-300 bg-amber-400 text-black"
          : mode === "never"
            ? "border-red-500/70 bg-red-950/60 text-red-200 hover:brightness-125"
            : "tf-phase-pip text-[color:var(--tf-gold-bright)] hover:brightness-125"
      }`}
    >
      <span aria-hidden>⛓</span>
      {forcing ? "Parando" : SHORT[mode]}
    </button>
  );
}
