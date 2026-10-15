"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DuelBoard } from "@/components/duel/DuelBoard";
import { CardRegistryProvider, useCardRegistry } from "@/context/CardRegistryProvider";
import { useClientSnapshot } from "@/hooks/useClientSnapshot";
import { useDeckEscolha } from "@/hooks/useDeckEscolha";
import { useDuelPrefs } from "@/hooks/useDuelPrefs";
import { DeckSelect } from "@/components/duel/DeckSelect";
import { DeckSelectionLayout } from "@/components/duel/DeckSelectionLayout";
import { JokenpoDisputa } from "@/components/duel/JokenpoDisputa";
import { useOnlineDuel } from "@/hooks/useOnlineDuel";
import type { CardRegistry } from "@/lib/domain/card-registry";
import { ehLocalhost } from "@/lib/net/origem";
import {
  loadOnlineSetup,
  ONLINE_SETUP_KEY,
  saveOnlineSetup,
  type StoredOnlineSetup,
} from "@/lib/duel/online-storage";

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      {children}
    </div>
  );
}

function OnlineDuelInner({ code }: { code: string }) {
  const { registry, isLoading, error: registryError } = useCardRegistry();

  // `undefined` = ainda renderizando no servidor, onde não há sessionStorage;
  // `null` = já no navegador e esta aba não escolheu deck. A distinção importa:
  // sem ela a tela de "escolha um deck" apareceria durante a renderização do
  // servidor, para quem já escolheu.
  const setup = useClientSnapshot<StoredOnlineSetup | null | undefined>(
    ONLINE_SETUP_KEY,
    useCallback(() => sessionStorage.getItem(ONLINE_SETUP_KEY), []),
    useCallback(() => loadOnlineSetup(), []),
    undefined,
  );

  // A escolha do lobby entra como valor inicial; daqui em diante quem manda é
  // a sala, para dar como trocar de deck entre uma partida e outra.
  const escolha = useDeckEscolha(setup?.presetId ?? null);
  const duel = useOnlineDuel({
    code,
    name: setup?.name ?? "",
    deck: setup?.deck ?? null,
    deckName: setup?.deckName ?? "Deck",
  });

  const { me, seats, started, finished, snapshot, status, error } = duel;

  // Preferências da mesa. O modo de resposta vai para o servidor (é ele quem
  // roda o engine e decide pular a janela); a velocidade não — online o ritmo
  // é da sala.
  const [prefs, setPrefs] = useDuelPrefs();
  const { setChainPreference } = duel;
  useEffect(() => {
    setChainPreference({ mode: prefs.chainMode });
  }, [prefs.chainMode, setChainPreference]);
  const forceAsk = useCallback(
    (held: boolean) => setChainPreference({ forceAsk: held }),
    [setChainPreference],
  );

  /**
   * A tela de sala aberta por cima de um duelo terminado.
   *
   * É o único caminho depois do resultado: dali se troca de deck, se fica
   * pronto e a próxima partida começa — sem sair da sala nem refazer link.
   */
  const [voltouParaSala, setVoltouParaSala] = useState(false);
  // Ajuste durante o render (mesmo padrão do `DuelBoard` com o prompt): a
  // partida nova fecha a tela de sala sem passar por um efeito, e portanto sem
  // exibir a sala por um frame depois de o duelo já ter começado.
  const [ultimoFinished, setUltimoFinished] = useState(finished);
  if (ultimoFinished !== finished) {
    setUltimoFinished(finished);
    if (!finished) setVoltouParaSala(false);
  }

  const nomes = useMemo(() => {
    const meu = seats.find((seat) => seat.seat === me);
    const outro = seats.find((seat) => seat.seat !== me);
    return {
      eu: meu?.name ?? setup?.name ?? "Você",
      oponente: outro?.name ?? "Oponente",
    };
  }, [seats, me, setup?.name]);

  if (setup === undefined || isLoading) {
    return <Aviso><p className="text-sm text-zinc-400">Conectando à sala {code}…</p></Aviso>;
  }

  if (setup === null) {
    return (
      <Aviso>
        <p className="text-sm text-zinc-400">
          Escolha um nome e um deck antes de entrar na sala {code}.
        </p>
        <Link
          href={`/duel/online?room=${code}`}
          className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-500"
        >
          Escolher deck
        </Link>
      </Aviso>
    );
  }

  if (registryError || !registry) {
    return (
      <Aviso>
        <p className="text-sm text-red-300">{registryError ?? "Erro ao carregar cartas."}</p>
      </Aviso>
    );
  }

  if (status === "recusado") {
    return (
      <Aviso>
        <p className="text-sm text-red-300">{error ?? "A sala recusou a conexão."}</p>
        <Link href="/duel/online" className="text-sm text-amber-400 hover:underline">
          Voltar ao lobby
        </Link>
      </Aviso>
    );
  }

  if (started && snapshot && me !== null && !voltouParaSala) {
    return (
      <>
        {status !== "conectado" && <QuedaDeConexao />}
        {duel.opponentAway && (
          <AdversarioCaiu
            nome={nomes.oponente}
            claimable={duel.claimable}
            onClaim={duel.claimWin}
          />
        )}
        <DuelBoard
          snapshot={snapshot}
          me={me}
          playerName={nomes.eu}
          opponentName={nomes.oponente}
          onRespond={duel.respond}
          onSurrender={duel.surrender}
          subscribeEvents={duel.subscribeEvents}
          prefs={prefs}
          onPrefsChange={setPrefs}
          onForceAsk={forceAsk}
          pacing="room"
          ending={{
            backHref: "/duel/online",
            backLabel: "Sair da sala",
            onBackToRoom: () => setVoltouParaSala(true),
          }}
        />
      </>
    );
  }

  return <SalaDeEspera code={code} duel={duel} escolha={escolha} me={me} registry={registry} />;
}

function QuedaDeConexao() {
  return (
    <p className="shrink-0 bg-red-950/80 px-4 py-1 text-center text-xs text-red-200">
      Conexão perdida — tentando voltar…
    </p>
  );
}

/**
 * O adversário sumiu no meio do duelo.
 *
 * Sem este aviso a tela fica idêntica à de um duelo normal esperando o outro
 * jogar: "Aguardando Fulano…" para sempre, sem nada indicando que Fulano
 * fechou a aba. O assento continua guardado (ele volta no mesmo lugar se
 * reconectar), mas quem ficou precisa de uma saída — daí o botão, que só
 * aparece depois da tolerância decidida pelo servidor.
 */
function AdversarioCaiu({
  nome,
  claimable,
  onClaim,
}: {
  nome: string;
  claimable: boolean;
  onClaim: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center justify-center gap-3 bg-amber-950/80 px-4 py-1 text-xs text-amber-200">
      <span>
        {nome} caiu.{" "}
        {claimable
          ? "Não voltou a tempo."
          : "O lugar fica guardado — dá para esperar a reconexão."}
      </span>
      {claimable && (
        <button
          type="button"
          onClick={onClaim}
          className="rounded bg-amber-600 px-2 py-0.5 text-[11px] font-bold text-black hover:bg-amber-500"
        >
          Encerrar duelo
        </button>
      )}
    </div>
  );
}

function SalaDeEspera({
  code,
  duel,
  escolha,
  me,
  registry,
}: {
  code: string;
  duel: ReturnType<typeof useOnlineDuel>;
  escolha: ReturnType<typeof useDeckEscolha>;
  me: 0 | 1 | null;
  registry: CardRegistry;
}) {
  const { seats, ready, setReady, setDeck, finished, status, error } = duel;
  const { jokenpo } = duel;
  const [copiado, setCopiado] = useState(false);
  const [convite, setConvite] = useState("");
  const [hoveredCode, setHoveredCode] = useState<number | null>(null);

  // O link tem que apontar para o endereço da REDE, não para `localhost`: o
  // amigo não alcança o localhost desta máquina. Quando a página já foi aberta
  // por um IP de rede, a própria origem serve.
  useEffect(() => {
    let vivo = true;
    const origem = window.location.origin;
    // Só `localhost` precisa de tradução: qualquer outro endereço que o
    // anfitrião esteja usando (IP da LAN, túnel, domínio) já serve ao amigo.
    const ehLocal = ehLocalhost(window.location.hostname);

    const base = ehLocal
      ? fetch("/api/duel/net-info")
          .then((response) => response.json())
          .then((payload: { urls?: string[] }) => payload.urls?.[0] ?? origem)
          .catch(() => origem)
      : Promise.resolve(origem);

    void base.then((url) => {
      if (vivo) setConvite(`${url}/duel/online?room=${code}`);
    });

    return () => {
      vivo = false;
    };
  }, [code]);

  const cheia = seats.length === 2;
  const meuAssento = seats.find((seat) => seat.seat === me);
  const nomeDoOponente =
    seats.find((seat) => seat.seat !== me)?.name ?? "o adversário";

  /**
   * Troca o deck e avisa a sala.
   *
   * Grava também no `sessionStorage`: recarregar a aba no meio de uma sala não
   * pode devolver o jogador ao deck anterior sem ele perceber.
   */
  function trocarDeck(novo: string | null) {
    // Resolvido na hora pelo próprio hook: ler `escolha.deck` logo depois do
    // `setEscolha` devolveria o deck ANTERIOR, e o oponente veria uma troca
    // atrasada em uma escolha.
    const { deck, deckName } = escolha.resolve(novo);

    escolha.setEscolha(novo);
    setDeck(deck, deckName);
    saveOnlineSetup({
      name: meuAssento?.name ?? "Duelista",
      deckName,
      deck,
      presetId: novo,
    });
  }

  const actions = (
    <>
      <section className="rounded-2xl border border-amber-900/40 bg-zinc-950/80 p-6 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">Sala</p>
        <p className="mt-1 font-mono text-4xl tracking-[0.4em] text-amber-300">{code}</p>

        {convite && (
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(convite);
              setCopiado(true);
              setTimeout(() => setCopiado(false), 1800);
            }}
            className="mt-4 w-full break-all rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-300 transition hover:border-amber-700 hover:text-amber-200"
          >
            {copiado ? "Link copiado!" : convite}
          </button>
        )}
      </section>

      {jokenpo ? (
        <JokenpoDisputa
          estado={jokenpo}
          nomeDoOponente={nomeDoOponente}
          onJogar={duel.jogarJokenpo}
          onEscolherOrdem={duel.escolherOrdem}
        />
      ) : (
        <>
          {error && (
            <p className="rounded-xl border border-red-900/50 bg-red-950/40 px-4 py-3 text-center text-sm text-red-200">
              {error}
            </p>
          )}
          {status !== "conectado" && !error && (
            <p className="text-center text-sm text-amber-200">Conectando…</p>
          )}
          <section className="rounded-2xl border border-amber-900/40 bg-zinc-950/80 p-6">
            <h2 className="text-lg font-semibold text-amber-300">Pronto para duelo</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {ready ? "Você está pronto. Aguarde o outro duelista." : "Confirme quando estiver pronto para jogar."}
            </p>
            <button
              type="button"
              disabled={status !== "conectado" || !escolha.pronto || !meuAssento}
              onClick={() => setReady(!ready)}
              className={`mt-4 w-full rounded-xl px-6 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                ready
                  ? "border border-emerald-700/60 text-emerald-300 hover:bg-emerald-900/30"
                  : "bg-amber-600 text-black hover:bg-amber-500"
              }`}
            >
              {ready ? "Cancelar" : "Estou pronto"}
            </button>
          </section>
        </>
      )}

      <Link href="/duel/online" className="text-center text-sm text-zinc-500 hover:text-zinc-300">
        Sair da sala
      </Link>
    </>
  );

  return (
    <DeckSelectionLayout registry={registry} hoveredCode={hoveredCode} actions={actions}>
      {!jokenpo && (
        <section className="rounded-2xl border border-amber-900/40 bg-zinc-950/80 p-6">
          <h2 className="text-lg font-semibold text-amber-300">Seu deck</h2>
          <p className="mt-1 text-sm text-zinc-500">
            {finished
              ? "Pode trocar antes da próxima partida."
              : "Dá para trocar até os dois estarem prontos."}
          </p>
          <DeckSelect
            escolha={escolha}
            onChange={(valor) => trocarDeck(valor)}
            onCardHover={setHoveredCode}
          />
          {!escolha.pronto && (
            <p className="mt-3 text-sm text-amber-200">
              Este deck tem menos de 40 cartas — escolha outro para poder duelar.
            </p>
          )}
        </section>
      )}

        <section className="rounded-2xl border border-amber-900/40 bg-zinc-950/80 p-6">
          <h2 className="text-lg font-semibold text-amber-300">
            Duelistas ({seats.length}/2)
          </h2>
          <ul className="mt-4 space-y-2">
            {seats.map((seat) => (
              <li
                key={seat.seat}
                className="flex items-center justify-between rounded-lg border border-zinc-800 px-3 py-2 text-sm"
              >
                <span
                  className={`min-w-0 truncate ${
                    seat.connected ? "text-zinc-100" : "text-zinc-500 line-through"
                  }`}
                >
                  {seat.name}
                  {/* Só aparece no seu próprio assento: o servidor não manda o
                      deck do adversário (ver `seatInfos`). */}
                  <span className="ml-2 text-xs text-zinc-500">
                    {seat.deckName ?? (seat.hasDeck ? "deck escolhido" : "")}
                  </span>
                  {seat.format && (
                    <span
                      className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                        seat.format === "tcg"
                          ? "bg-sky-900/60 text-sky-200"
                          : "bg-amber-900/50 text-amber-200"
                      }`}
                    >
                      {seat.format === "tcg" ? "TCG" : "Goat"}
                    </span>
                  )}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    seat.ready
                      ? "bg-emerald-900/60 text-emerald-300"
                      : "bg-zinc-800 text-zinc-400"
                  }`}
                >
                  {seat.ready ? "Pronto" : "Escolhendo"}
                </span>
              </li>
            ))}
            {!cheia && (
              <li className="rounded-lg border border-dashed border-zinc-800 px-3 py-2 text-sm text-zinc-500">
                Aguardando o segundo duelista…
              </li>
            )}
          </ul>

          {cheia &&
            seats.every((seat) => seat.format) &&
            new Set(seats.map((seat) => seat.format)).size > 1 && (
              <p
                data-format-mismatch
                className="mt-4 rounded-lg border border-amber-800/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-200"
              >
                Os decks são de formatos diferentes (Goat × TCG). O duelo só
                começa com os dois no mesmo formato — troque o deck acima.
              </p>
            )}
        </section>
    </DeckSelectionLayout>
  );
}

export function OnlineDuelApp({ code }: { code: string }) {
  return (
    <CardRegistryProvider>
      <OnlineDuelInner code={code} />
    </CardRegistryProvider>
  );
}
