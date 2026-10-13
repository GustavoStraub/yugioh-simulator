import type { OcgResponse } from "@n1xx1/ocgcore-wasm";

import type { CardRegistry } from "@/lib/domain/card-registry";
import { deckLimits } from "@/lib/domain/deck-rules";
import { formatOf } from "@/lib/types";
import type { DuelEvent } from "@/lib/duel/duel-events";
import { loadCatalogRegistry } from "@/server/catalog/catalog-store";
import {
  createDuelSession,
  type DuelSession,
  type DuelSnapshot,
} from "@/lib/duel/duel-session";
import {
  isJokenpoJogada,
  jokenpoResultado,
  type JokenpoJogada,
} from "@/lib/duel/jokenpo";
import type {
  JokenpoState,
  ServerMessage,
  SeatInfo,
} from "@/lib/net/duel-protocol";
import type { DuelDeckPayload } from "@/lib/types";
import { nodeAssets } from "@/server/duel/node-assets";

export type Sender = (message: ServerMessage) => void;

/** Um jogador da sala. `seat` só existe depois do sorteio (ver `iniciar`). */
interface RoomPlayer {
  token: string;
  name: string;
  deck: DuelDeckPayload | null;
  deckName: string;
  ready: boolean;
  /** `null` enquanto desconectado — o assento continua reservado pelo token. */
  send: Sender | null;
  /** Quando o socket caiu, para contar a tolerância. `null` = está aqui. */
  disconnectedAt: number | null;
  seat: 0 | 1 | null;
}

/**
 * Quanto tempo o adversário pode sumir antes de o outro poder encerrar.
 *
 * Existe por causa dos dois lados do problema: uma queda de Wi-Fi de dez
 * segundos não pode custar o duelo (o assento fica guardado pelo token e a
 * pessoa volta no mesmo lugar), mas quem ficou não pode ficar preso a um
 * tabuleiro que nunca mais anda — que é exatamente o que acontecia antes.
 */
function toleranciaDeQuedaMs(): number {
  // Lido a cada chamada, e não uma vez na carga do módulo: é o que deixa o
  // harness encurtar a tolerância sem precisar subir outro processo.
  return Number(process.env.DUEL_DISCONNECT_GRACE_MS ?? 45_000);
}

/**
 * Catálogo de cartas do processo.
 *
 * O engine precisa dele para criar cada carta (`cardReader`), e ele é o mesmo
 * para todas as salas — o arquivo do catálogo é lido uma vez por processo
 * (`catalog-store.ts`), e uma falha não fica em cache.
 */
function duelRegistry(): Promise<CardRegistry> {
  return loadCatalogRegistry();
}

/** O deck vem de um cliente, e cliente não é confiável. */
export function deckProblem(deck: DuelDeckPayload | undefined): string | null {
  if (!deck || !Array.isArray(deck.main) || !Array.isArray(deck.extra)) {
    return "Deck inválido.";
  }
  if (deck.format !== undefined && deck.format !== "goat" && deck.format !== "tcg") {
    return "Formato desconhecido.";
  }
  const passcodes = [...deck.main, ...deck.extra];
  if (passcodes.some((code) => !Number.isSafeInteger(code) || code <= 0)) {
    return "Deck contém cartas inválidas.";
  }
  // Os limites do formato do deck: o Extra Deck do TCG é de 15, o do Goat 60.
  const limites = deckLimits(formatOf(deck.format));
  if (deck.main.length < limites.main.min) {
    return `Deck principal precisa de ao menos ${limites.main.min} cartas.`;
  }
  if (deck.main.length > limites.main.max) {
    return `Deck principal passa de ${limites.main.max} cartas.`;
  }
  if (deck.extra.length > limites.extra.max) {
    return `Extra Deck passa de ${limites.extra.max} cartas.`;
  }
  return null;
}

export class DuelRoom {
  readonly code: string;
  /** Na ordem de entrada — vira a ordem exibida no lobby. */
  private players: RoomPlayer[] = [];
  private session: DuelSession | null = null;
  /**
   * Desliga a sessão anterior.
   *
   * Sem isto a revanche tinha uma corrida feia: `runLoop` da partida velha
   * podia estar dentro de uma pausa de animação quando a nova começava, e ao
   * acordar publicava o snapshot ANTIGO — com vencedor — por cima do novo. A
   * sala nascia "terminada", mostrando o resultado da partida passada.
   */
  private descartarSessao: (() => void) | null = null;
  /** Último snapshot completo; cada assento recebe uma projeção dele. */
  private master: DuelSnapshot | null = null;
  private started = false;
  /**
   * O jokenpô que decide o primeiro turno, entre "os dois prontos" e o duelo.
   *
   * Guardado por TOKEN, e não por assento: assento só existe depois que a
   * ordem é decidida — é justamente o que está sendo disputado aqui.
   */
  private jokenpo: {
    round: number;
    /** Jogadas da rodada corrente, por token. */
    jogadas: Map<string, JokenpoJogada>;
    /** A rodada resolvida por último, para as duas telas narrarem o que saiu. */
    ultima: { jogadas: Map<string, JokenpoJogada>; vencedor: string | null } | null;
    /** Token de quem ganhou e vai escolher a ordem; `null` = ainda jogando. */
    vencedor: string | null;
  } | null = null;
  /**
   * O duelo acabou e a sala espera revanche.
   *
   * A sala **não** é destruída no fim: recriar sala e reenviar link a cada
   * partida é o atrito que separa "jogamos uma" de "jogamos a tarde toda".
   */
  private finished = false;
  /** Instante do último socket a se desligar — usado pela faxina de salas. */
  private emptySince: number | null = Date.now();

  /**
   * Envios represados até o fim do lote de mensagens do engine.
   *
   * O `DuelSession` chama `update()` a cada linha de log e a cada mudança de
   * LP, o que num lote é dezenas de notificações para o mesmo estado final.
   * Juntar tudo num `queueMicrotask` transforma isso em um envio por lote — e,
   * de quebra, garante que o snapshot chegue ANTES dos eventos daquele lote,
   * que é o que a animação de compra precisa (ela mede a mão já redesenhada).
   */
  private flushAgendado = false;
  private snapshotSujo = false;
  private eventosPendentes: DuelEvent[] = [];

  constructor(code: string) {
    this.code = code;
  }

  get isEmpty(): boolean {
    return this.players.every((player) => player.send === null);
  }

  get vacantSince(): number | null {
    return this.emptySince;
  }

  /**
   * Entra na sala, ou reassume o lugar guardado pelo token.
   *
   * @returns o índice do jogador no lobby, ou uma mensagem de recusa.
   */
  join(params: {
    token: string;
    name: string;
    deck: DuelDeckPayload;
    deckName?: string;
    send: Sender;
  }): { ok: true; player: RoomPlayer } | { ok: false; error: string } {
    const problema = deckProblem(params.deck);
    if (problema) return { ok: false, error: problema };

    this.emptySince = null;

    const existente = this.players.find((player) => player.token === params.token);
    if (existente) {
      existente.send = params.send;
      existente.disconnectedAt = null;
      if (this.podeTrocarDeck) {
        existente.deck = params.deck;
        existente.deckName = params.deckName ?? existente.deckName;
      }
      this.enviarEstadoInicial(existente);
      this.broadcastLobby();
      return { ok: true, player: existente };
    }

    if (this.players.length >= 2) {
      return { ok: false, error: "Esta sala já está cheia." };
    }
    if (this.started) {
      return { ok: false, error: "O duelo desta sala já começou." };
    }

    const player: RoomPlayer = {
      token: params.token,
      name: this.nomeLivre(params.name),
      deck: params.deck,
      deckName: params.deckName ?? "Deck",
      ready: false,
      send: params.send,
      disconnectedAt: null,
      seat: null,
    };
    this.players.push(player);
    this.enviarEstadoInicial(player);
    this.broadcastLobby();
    return { ok: true, player };
  }

  /**
   * Evita dois duelistas com o mesmo nome na mesma sala.
   *
   * Acontece o tempo todo desde que o nome passou a vir do perfil: duas abas
   * do mesmo navegador entram como a mesma pessoa, e a lista da sala fica com
   * duas linhas idênticas — sem como saber qual é você.
   */
  private nomeLivre(desejado: string): string {
    // Comparação sem caixa: "Straub" e "straub" são a mesma pessoa em qualquer
    // outro lugar do app (o id do perfil sai do apelido normalizado), e duas
    // linhas iguais a menos de uma maiúscula na lista da sala não dizem nada a
    // quem está tentando se achar nela.
    const usados = new Set(this.players.map((player) => player.name.toLowerCase()));
    const livre = (nome: string) => !usados.has(nome.toLowerCase());
    if (livre(desejado)) return desejado;
    for (let n = 2; n < 10; n += 1) {
      const tentativa = `${desejado} (${n})`;
      if (livre(tentativa)) return tentativa;
    }
    return desejado;
  }

  /**
   * Dá para trocar de deck agora?
   *
   * Antes da primeira partida, e **entre** partidas. No meio de um duelo a
   * troca não teria efeito nenhum no engine — e uma opção que não faz nada é
   * pior do que uma opção ausente.
   */
  private get podeTrocarDeck(): boolean {
    return !this.started || this.finished;
  }

  /** Troca o deck de um jogador para a próxima partida. */
  setDeck(token: string, deck: DuelDeckPayload, deckName: string): void {
    const player = this.players.find((candidate) => candidate.token === token);
    if (!player || !this.podeTrocarDeck) return;

    const problema = deckProblem(deck);
    if (problema) {
      player.send?.({ t: "error", message: problema, fatal: false });
      return;
    }

    player.deck = deck;
    player.deckName = deckName.slice(0, 40) || "Deck";
    // Trocar de deck desfaz o "pronto": quem já tinha confirmado precisa ver
    // com o que o outro vai jogar antes de confirmar de novo. E se um jokenpô
    // estava em curso, ele cai junto — a disputa vale para o duelo que ia
    // começar, não para outro.
    player.ready = false;
    this.jokenpo = null;
    this.broadcastLobby();
  }

  /**
   * "Quero jogar" — antes da primeira partida e **entre** partidas.
   *
   * A condição é a mesma da troca de deck (`podeTrocarDeck`), e isso é o
   * conserto de um travamento real: a checagem antiga era `this.started`, que
   * continua verdadeira depois de o duelo acabar (só o `reiniciar` a desfaz).
   * Resultado: com o duelo terminado o servidor DESCARTAVA o "estou pronto" em
   * silêncio — nada era transmitido — e os dois lados ficavam se olhando, cada
   * um convencido de ter confirmado e vendo o outro como não pronto. Quem
   * tivesse trocado de deck no meio ficava preso de vez, porque a troca também
   * derruba o `ready`.
   */
  setReady(token: string, ready: boolean): void {
    const player = this.players.find((candidate) => candidate.token === token);
    if (!player || !this.podeTrocarDeck) return;
    player.ready = ready;
    // Desmarcar no meio do jokenpô cancela a disputa: quem voltou atrás pode
    // querer trocar de deck, e a rodada seguinte tem que ser jogada de novo com
    // os dois de acordo.
    if (!ready) this.jokenpo = null;
    this.broadcastLobby();
    this.tentarComecar();
  }

  /**
   * Revanche: é o mesmo "estou pronto".
   *
   * Existe como mensagem própria porque o cliente antigo a manda; para a sala
   * não há diferença nenhuma entre querer jogar a primeira partida e querer
   * jogar a próxima, e dois caminhos separados foram exatamente o que
   * dessincronizou o estado.
   */
  rematch(token: string): void {
    this.setReady(token, true);
  }

  /**
   * Começa a partida quando os dois quiserem — a primeira ou a seguinte.
   *
   * Com o duelo anterior terminado é preciso zerar a sala antes; `tentarIniciar`
   * sozinho não faria nada, porque ele desiste enquanto `started` for verdade.
   */
  private tentarComecar(): void {
    if (this.finished) {
      const prontos =
        this.players.length === 2 &&
        this.players.every((candidate) => candidate.ready && candidate.send);
      if (prontos) this.reiniciar();
      return;
    }
    this.tentarIniciar();
  }

  /** Zera a sala para uma partida nova, mantendo quem já está sentado. */
  private reiniciar(): void {
    this.descartarSessao?.();
    this.descartarSessao = null;
    this.session = null;
    this.master = null;
    this.started = false;
    this.finished = false;
    this.jokenpo = null;
    this.snapshotSujo = false;
    this.eventosPendentes = [];
    // O assento é sorteado de novo: quem começou a primeira não começa a
    // segunda por herança.
    for (const player of this.players) player.seat = null;
    this.tentarIniciar();
  }

  respond(token: string, promptId: number, response: OcgResponse): void {
    const player = this.players.find((candidate) => candidate.token === token);
    if (!player || player.seat === null || !this.session) return;
    // A pergunta é de um assento só. Sem esta checagem o adversário poderia
    // responder no lugar do outro simplesmente mandando a mensagem.
    if (this.master?.promptPlayer !== player.seat) return;
    void this.session.respond(response, promptId);
  }

  disconnect(token: string): void {
    const player = this.players.find((candidate) => candidate.token === token);
    if (!player) return;

    player.send = null;
    player.disconnectedAt = Date.now();

    // Antes de começar, sair é sair: o lugar volta a ficar livre para outro
    // amigo entrar. Depois de começar o lugar fica guardado pelo token, senão
    // uma queda de Wi-Fi custaria o duelo.
    if (!this.started) {
      this.players = this.players.filter((candidate) => candidate !== player);
      // Sem os dois não há disputa: a fase cai, e recomeça quando alguém
      // entrar e os dois ficarem prontos de novo.
      this.jokenpo = null;
    }
    if (this.isEmpty) this.emptySince = Date.now();
    this.broadcastLobby();

    // Um aviso agendado para o fim da tolerância: sem ele, quem ficou só
    // descobriria que já pode encerrar na próxima mensagem qualquer da sala —
    // e num duelo parado não existe próxima mensagem.
    if (this.started && !this.finished) {
      const aviso = setTimeout(() => this.broadcastLobby(), toleranciaDeQuedaMs() + 250);
      aviso.unref?.();
    }
  }

  /** Há quanto tempo este jogador sumiu, ou `null` se está conectado. */
  private tempoForaDe(player: RoomPlayer): number | null {
    if (player.send !== null || player.disconnectedAt === null) return null;
    return Date.now() - player.disconnectedAt;
  }

  /** O adversário de `player` sumiu tempo bastante para o duelo ser encerrado? */
  private podeReivindicar(player: RoomPlayer): boolean {
    if (!this.started || this.finished) return false;
    const outro = this.players.find((candidate) => candidate !== player);
    if (!outro) return false;
    const fora = this.tempoForaDe(outro);
    return fora !== null && fora >= toleranciaDeQuedaMs();
  }

  /**
   * Encerra o duelo a favor de quem pediu, porque o outro sumiu.
   *
   * Passa pelo mesmo caminho da rendição: quem não voltou é tratado como quem
   * desistiu. Assim o log, o som e a tela de resultado saem iguais nos dois
   * casos, em vez de existir um segundo jeito de terminar um duelo.
   */
  claimWin(token: string): void {
    const player = this.players.find((candidate) => candidate.token === token);
    if (!player || player.seat === null) return;
    if (!this.podeReivindicar(player)) return;

    const ausente = (1 - player.seat) as 0 | 1;
    const nomeAusente =
      this.players.find((c) => c.seat === ausente)?.name ?? "O adversário";
    this.encerrarPorDesistencia(
      ausente,
      `🏳 ${nomeAusente} não voltou — duelo encerrado.`,
      `${nomeAusente} caiu e não voltou a tempo.`,
    );
  }

  /** Desistência pedida pelo próprio jogador. */
  surrender(token: string): void {
    const player = this.players.find((candidate) => candidate.token === token);
    if (!player || player.seat === null) return;
    if (!this.started || this.finished) return;

    this.encerrarPorDesistencia(player.seat);
  }

  /** Fecha o duelo com `seat` como perdedor e deixa a sala pronta para revanche. */
  private encerrarPorDesistencia(
    seat: 0 | 1,
    motivo?: string,
    razao?: string,
  ): void {
    if (!this.session || this.finished) return;

    // Só isto: marcar a sala como terminada, zerar o "pronto" dos dois e
    // avisar todo mundo já é trabalho do observador do snapshot (ver
    // `iniciarSessao`), que roda no mesmo instante porque `surrender` publica
    // de forma síncrona. Repetir aqui só produziria um aviso duplicado.
    this.session.surrender(seat, motivo, razao);
  }

  private enviarEstadoInicial(player: RoomPlayer): void {
    // O assento só existe depois do sorteio; antes disso a posição no lobby
    // serve de identidade provisória.
    const me = (player.seat ?? this.players.indexOf(player)) as 0 | 1;
    player.send?.({ t: "joined", me, room: this.code });
    if (this.master && player.seat !== null) {
      player.send?.({
        t: "snapshot",
        snapshot: projectSnapshot(this.master, player.seat),
      });
    }
  }

  /**
   * O lobby na ótica de um destinatário.
   *
   * O nome do deck só vai para o próprio dono: com ele em mãos, o adversário
   * escolheria justamente o deck que ganha do seu antes de a partida começar.
   * Recortar aqui, e não na tela, é o que garante que ele nem atravesse a rede.
   */
  private seatInfos(para: RoomPlayer): SeatInfo[] {
    return this.players.map((player, index) => ({
      seat: (player.seat ?? index) as 0 | 1,
      name: player.name,
      connected: player.send !== null,
      ready: player.ready,
      hasDeck: player.deck !== null,
      deckName: player === para ? player.deckName : null,
      format: player.deck ? formatOf(player.deck.format) : null,
    }));
  }

  private broadcastLobby(): void {
    for (const player of this.players) {
      player.send?.({
        t: "lobby",
        seats: this.seatInfos(player),
        started: this.started,
        finished: this.finished,
        claimable: this.podeReivindicar(player),
        jokenpo: this.jokenpoState(player),
      });
    }
  }

  /**
   * Os dois querem jogar: abre o jokenpô que decide o primeiro turno.
   *
   * Antes daqui saía um sorteio silencioso (`crypto.getRandomValues`) e o duelo
   * começava. No Goat o primeiro turno vale demais para ser decidido assim, e
   * "ganhou o sorteio" não é jogada de ninguém: agora os dois jogam pedra,
   * papel e tesoura, e quem ganha escolhe **começar ou não** — que é a decisão
   * de verdade, porque com certos decks o segundo turno é melhor.
   */
  private tentarIniciar(): void {
    if (this.started) return;
    if (this.players.length !== 2) return;
    if (!this.players.every((player) => player.ready && player.deck && player.send)) {
      return;
    }
    // Goat contra TCG não tem regra comum: o duelo só começa com os dois decks
    // no mesmo formato. A sala mostra o formato de cada assento (`SeatInfo`),
    // e é por lá que os dois veem por que o jogo não começa.
    if (this.formatosDiferentes()) return;
    if (this.jokenpo) return;

    this.jokenpo = {
      round: 1,
      jogadas: new Map(),
      ultima: null,
      vencedor: null,
    };
    this.broadcastLobby();
  }

  /** Os dois decks sentados são de formatos diferentes? */
  private formatosDiferentes(): boolean {
    const formatos = new Set(
      this.players.filter((player) => player.deck).map((player) => formatOf(player.deck?.format)),
    );
    return formatos.size > 1;
  }

  /** O jokenpô na ótica de um jogador — ver `JokenpoState`. */
  private jokenpoState(player: RoomPlayer): JokenpoState | null {
    const jokenpo = this.jokenpo;
    if (!jokenpo) return null;

    const outro = this.players.find((candidate) => candidate !== player);
    const ultima = jokenpo.ultima;
    const minhaUltima = ultima?.jogadas.get(player.token);
    const dele = outro ? ultima?.jogadas.get(outro.token) : undefined;

    return {
      round: jokenpo.round,
      mine: jokenpo.jogadas.get(player.token) ?? null,
      // Só QUE jogou, nunca O QUE jogou: com a jogada do outro em mãos bastava
      // esperar para ganhar sempre.
      opponentChose: outro ? jokenpo.jogadas.has(outro.token) : false,
      last:
        minhaUltima && dele
          ? {
              mine: minhaUltima,
              theirs: dele,
              outcome:
                ultima?.vencedor === null
                  ? "empate"
                  : ultima?.vencedor === player.token
                    ? "ganhei"
                    : "perdi",
            }
          : null,
      chooseFirst: jokenpo.vencedor === player.token,
      waitingChoice:
        jokenpo.vencedor !== null && jokenpo.vencedor !== player.token,
    };
  }

  /** Uma jogada do jokenpô. A rodada só é resolvida quando os dois jogam. */
  jogarJokenpo(token: string, jogada: unknown): void {
    const player = this.players.find((candidate) => candidate.token === token);
    const jokenpo = this.jokenpo;
    if (!player || this.started || !jokenpo) return;
    // Com a ordem já decidida, o que falta é a escolha do vencedor.
    if (jokenpo.vencedor !== null) return;
    if (!isJokenpoJogada(jogada)) return;

    jokenpo.jogadas.set(token, jogada);
    if (jokenpo.jogadas.size < 2) {
      this.broadcastLobby();
      return;
    }

    const [a, b] = this.players;
    const jogadaA = jokenpo.jogadas.get(a.token);
    const jogadaB = jokenpo.jogadas.get(b.token);
    if (!jogadaA || !jogadaB) return;

    const resultado = jokenpoResultado(jogadaA, jogadaB);
    const vencedor =
      resultado === 0 ? null : resultado > 0 ? a.token : b.token;

    jokenpo.ultima = { jogadas: new Map(jokenpo.jogadas), vencedor };
    jokenpo.jogadas = new Map();
    jokenpo.vencedor = vencedor;
    // Empate não decide nada: joga de novo, e a rodada muda para a tela poder
    // dizer que é outra.
    if (vencedor === null) jokenpo.round += 1;

    this.broadcastLobby();
  }

  /**
   * Quem ganhou o jokenpô escolhe a ordem — e é isso que começa o duelo.
   *
   * @param primeiro `true` = quem escolheu joga o primeiro turno.
   */
  escolherOrdem(token: string, primeiro: boolean): void {
    const jokenpo = this.jokenpo;
    if (this.started || !jokenpo || jokenpo.vencedor !== token) return;

    const vencedor = this.players.find((candidate) => candidate.token === token);
    const perdedor = this.players.find((candidate) => candidate !== vencedor);
    if (!vencedor || !perdedor) return;

    this.comecar(primeiro ? [vencedor, perdedor] : [perdedor, vencedor]);
  }

  /**
   * Começa a partida com a ordem já decidida.
   *
   * O ocgcore sempre dá o primeiro turno ao jogador 0, então "quem começa" é
   * "quem senta no assento 0" — a lista chega aqui nessa ordem.
   */
  private comecar(porAssento: RoomPlayer[]): void {
    this.started = true;
    this.jokenpo = null;
    porAssento[0].seat = 0;
    porAssento[1].seat = 1;

    for (const player of porAssento) {
      player.send?.({ t: "joined", me: player.seat as 0 | 1, room: this.code });
    }
    this.broadcastLobby();

    void this.iniciarSessao(porAssento);
  }

  private async iniciarSessao(porAssento: RoomPlayer[]): Promise<void> {
    const [primeiro, segundo] = porAssento;

    let registry: CardRegistry;
    try {
      registry = await duelRegistry();
    } catch (error) {
      const detalhe = error instanceof Error ? error.message : String(error);
      this.falhar(`Não foi possível carregar o catálogo de cartas: ${detalhe}`);
      return;
    }

    const session = createDuelSession();
    this.session = session;

    const pararSnapshots = session.subscribe((snapshot) => {
      // Guarda dupla: mesmo que alguém esqueça de desligar, um snapshot de
      // sessão antiga não pode mexer no estado da sala.
      if (this.session !== session) return;
      this.master = snapshot;
      this.snapshotSujo = true;
      this.agendarFlush();

      if (snapshot.winner !== null && !this.finished) {
        this.finished = true;
        // Volta os dois para "não pronto": a revanche precisa de um clique de
        // cada lado, senão o duelo seguinte começaria sozinho por cima da tela
        // de resultado.
        for (const player of this.players) player.ready = false;
        this.broadcastLobby();
      }
    });
    const pararEventos = session.subscribeEvents((event) => {
      if (this.session !== session) return;
      this.eventosPendentes.push(event);
      this.agendarFlush();
    });

    this.descartarSessao = () => {
      pararSnapshots();
      pararEventos();
    };

    await session.start({
      playerName: primeiro.name,
      playerDeck: primeiro.deck as DuelDeckPayload,
      opponentName: segundo.name,
      opponentDeck: segundo.deck as DuelDeckPayload,
      registry,
      seats: [
        { kind: "remote", name: primeiro.name },
        { kind: "remote", name: segundo.name },
      ],
      assets: nodeAssets,
      // Os dois decks têm o mesmo formato (`tentarIniciar` não começa sem isso).
      format: formatOf(primeiro.deck?.format),
    });
  }

  private falhar(message: string): void {
    for (const player of this.players) {
      player.send?.({ t: "error", message, fatal: true });
    }
  }

  private agendarFlush(): void {
    if (this.flushAgendado) return;
    this.flushAgendado = true;
    queueMicrotask(() => {
      this.flushAgendado = false;
      this.flush();
    });
  }

  private flush(): void {
    const master = this.master;
    const eventos = this.eventosPendentes;
    this.eventosPendentes = [];

    if (this.snapshotSujo && master) {
      this.snapshotSujo = false;
      for (const player of this.players) {
        if (player.seat === null) continue;
        player.send?.({
          t: "snapshot",
          snapshot: projectSnapshot(master, player.seat),
        });
      }
    }

    for (const event of eventos) {
      for (const player of this.players) {
        if (player.seat === null) continue;
        // A revelação é dirigida a um assento; entregá-la aos dois mostraria a
        // carta que só um deles tinha direito de olhar.
        if (event.kind === "reveal" && event.visibleTo !== player.seat) continue;
        player.send?.({ t: "event", event });
      }
    }
  }
}

/**
 * Recorta o estado na ótica de um assento.
 *
 * É aqui que a informação oculta é de fato protegida: o `master` tem os dois
 * tabuleiros, o prompt do adversário e o log inteiro, e nada disso pode
 * atravessar o socket para o lado errado.
 *
 * `promptPlayer` **fica** na projeção de propósito: saber que o adversário está
 * decidindo algo é informação pública numa mesa de verdade, e é o que alimenta
 * o aviso de "aguardando".
 */
export function projectSnapshot(master: DuelSnapshot, seat: 0 | 1): DuelSnapshot {
  const meuPrompt = master.promptPlayer === seat;
  return {
    ...master,
    boards: seat === 0 ? [master.boards[0], null] : [null, master.boards[1]],
    pendingPrompt: meuPrompt ? master.pendingPrompt : null,
    promptCard: meuPrompt ? master.promptCard : null,
    promptHint: meuPrompt ? master.promptHint : null,
    log: master.log.filter(
      (entry) => entry.visibleTo === null || entry.visibleTo === seat,
    ),
    // O histórico de revelações segue o mesmo recorte do log: cada entrada
    // pertence a um assento, e mandar a do outro é entregar a carta que o
    // efeito mostrou só para ele.
    reveals: master.reveals.filter((reveal) => reveal.visibleTo === seat),
  };
}
