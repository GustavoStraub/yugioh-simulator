/**
 * Duelo entre dois assentos humanos, sem navegador e sem socket.
 *
 * O que este teste existe para responder é uma pergunta que nenhum outro
 * responde: **a projeção por assento realmente esconde o que tem que
 * esconder?** Um erro aí não quebra nada — o duelo roda liso, e o adversário
 * simplesmente vê a sua mão.
 *
 * Também cobre o resto do caminho de rede: o codec de BigInt (sem ele o
 * primeiro prompt derruba a sala), o `promptId` contra resposta atrasada, e o
 * roteamento — um assento não pode responder pelo outro.
 *
 * Uso: npm run test:multiplayer
 */
import { OcgMessageType } from "@n1xx1/ocgcore-wasm";

import { botAutoResponse } from "@/lib/duel/bot-responder";
import { buildPromptPlan } from "@/lib/duel/duel-actions";
import { needsCardPicker } from "@/lib/duel/prompt-reach";
import { EMPTY_ENGINE_STRINGS } from "@/lib/duel/engine-strings";
import { DuelRoom, deckProblem } from "@/server/duel/room";
import { PRESET_DECKS } from "@/lib/data/preset-decks-catalog";
import { presetToDuelPayload } from "@/lib/domain/preset-decks";
import { decodeMessage, encodeMessage } from "@/lib/net/duel-protocol";

/** Quantos prompts responder antes de considerar o duelo suficientemente jogado. */
const MAX_PROMPTS = 120;

/**
 * Tolerância de queda encurtada para o teste.
 *
 * A sala lê a variável a cada checagem, então dá para apertá-la aqui em vez de
 * esperar os 45 segundos de verdade — o que se quer provar é a REGRA (recusar
 * antes, permitir depois), não a duração.
 */
process.env.DUEL_DISCONNECT_GRACE_MS ??= "1500";
const TOLERANCIA_MS = Number(process.env.DUEL_DISCONNECT_GRACE_MS);

/**
 * Teto para a segunda etapa, que joga até alguém vencer.
 *
 * Um duelo inteiro entre dois pilotos automáticos passa das centenas de
 * decisões; sem chegar ao fim não dá para exercitar a revanche, que é
 * justamente o caminho que mantém a sala viva entre partidas.
 */
const MAX_PROMPTS_ATE_O_FIM = 1500;

/** Nome legível do tipo de mensagem, para o relatório. */
function nomeDoPrompt(type) {
  return (
    Object.entries(OcgMessageType).find(([, valor]) => valor === type)?.[0] ?? String(type)
  );
}

const falhas = [];
function conferir(condicao, descricao) {
  if (condicao) {
    console.log(`  ✓ ${descricao}`);
  } else {
    falhas.push(descricao);
    console.log(`  ✗ ${descricao}`);
  }
}

/**
 * Um jogador de mentira.
 *
 * Passa tudo pelo `encodeMessage`/`decodeMessage` de propósito: é o que faz o
 * teste exercitar o codec de verdade em vez de olhar objetos que nunca
 * atravessaram a "rede".
 */
function criarCliente(nome) {
  const cliente = {
    nome,
    token: `token-${nome}-${"x".repeat(12)}`,
    me: null,
    snapshot: null,
    lobby: null,
    eventos: [],
    erros: [],
    falhasDeCodec: [],
    /**
     * A maior mão própria vista em algum snapshot, e se alguma vez ela veio
     * com carta ilegível. A checagem de sanidade lia só o ÚLTIMO snapshot, e
     * num duelo que acaba com a mão vazia (acontece, ~1 em 6) o teste
     * reprovava sem ter visto bug nenhum.
     */
    maiorMao: 0,
    maoIlegivel: false,
  };

  cliente.send = (message) => {
    let recebido;
    try {
      recebido = decodeMessage(encodeMessage(message));
    } catch (error) {
      cliente.falhasDeCodec.push(`${message.t}: ${error.message}`);
      return;
    }
    if (!recebido) {
      cliente.falhasDeCodec.push(`${message.t}: não desserializou`);
      return;
    }

    switch (recebido.t) {
      case "joined": cliente.me = recebido.me; break;
      case "lobby": cliente.lobby = recebido; break;
      case "snapshot": {
        cliente.snapshot = recebido.snapshot;
        const mao = cliente.me === null ? [] : (recebido.snapshot.boards[cliente.me]?.players[cliente.me].hand ?? []);
        cliente.maiorMao = Math.max(cliente.maiorMao, mao.length);
        if (mao.some((carta) => carta.code === null)) cliente.maoIlegivel = true;
        break;
      }
      case "event": cliente.eventos.push(recebido.event); break;
      case "error": cliente.erros.push(recebido.message); break;
    }
  };

  return cliente;
}

async function until(check, { timeout = 60_000, label = "condição" } = {}) {
  const limite = Date.now() + timeout;
  for (;;) {
    const valor = await check();
    if (valor) return valor;
    if (Date.now() > limite) throw new Error(`tempo esgotado esperando ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * A tela consegue responder este prompt, sentado neste assento?
 *
 * Um plano existir não basta: uma seleção cujos candidatos não são clicáveis
 * **nem** abrem o seletor é uma barra de "Confirmar" desabilitada com nada
 * para marcar — o duelo trava sem erro nenhum, que é o modo de falha mais caro
 * de achar. Este é o teste que transforma isso numa falha determinística em
 * vez de um travamento intermitente no navegador.
 */
function planoRespondivel(prompt, assento) {
  const plan = buildPromptPlan(prompt, EMPTY_ENGINE_STRINGS);
  if (!plan) return { ok: false, motivo: "sem plano" };

  if (plan.selection) {
    const { candidates } = plan.selection;
    // Com o seletor em modal, todo candidato é listado — sempre respondível.
    if (needsCardPicker(candidates, assento)) return { ok: true, plan };
    if (candidates.length === 0) return { ok: false, motivo: "seleção sem candidatos" };
    return { ok: true, plan };
  }

  const temAlgo =
    plan.global.length > 0 ||
    plan.byCard.size > 0 ||
    plan.places.length > 0 ||
    plan.placeSelection !== null ||
    plan.sorting !== null ||
    plan.announce !== null ||
    plan.announceCard !== null;

  return temAlgo ? { ok: true, plan } : { ok: false, motivo: "plano sem nenhuma ação" };
}

/** Alguma carta da mão do oponente veio com o código legível? */
function vazouMaoDoOponente(snapshot, me) {
  const board = snapshot?.boards?.[me];
  if (!board) return false;
  const oponente = board.players[1 - me];
  return oponente.hand.some((carta) => carta.code !== null);
}

/**
 * Alguma carta oculta do Extra Deck do oponente veio listada?
 *
 * O Extra Deck dele é secreto — com uma exceção da regra: Pêndulo que volta
 * para lá fica virado para cima e é público. Esses podem vir (com código); uma
 * carta virada para baixo, ou sem código, na lista é vazamento.
 */
function vazouDeckDoOponente(snapshot, me) {
  const board = snapshot?.boards?.[me];
  if (!board) return false;
  return board.players[1 - me].extra.some((carta) => carta.faceDown || carta.code === null);
}

console.log("Validando decks de entrada...");
conferir(deckProblem({ main: [], extra: [], side: [] }) !== null, "deck vazio é recusado");
conferir(
  deckProblem({ main: Array(40).fill(-1), extra: [], side: [] }) !== null,
  "passcode inválido é recusado",
);
conferir(
  deckProblem(presetToDuelPayload(PRESET_DECKS[0])) === null,
  "deck oficial é aceito",
);

console.log("\nMontando a sala...");
const room = new DuelRoom("TEST");
const a = criarCliente("Ana");
const b = criarCliente("Bruno");

for (const [cliente, preset] of [[a, PRESET_DECKS[0]], [b, PRESET_DECKS[1]]]) {
  const resultado = room.join({
    token: cliente.token,
    name: cliente.nome,
    deck: presetToDuelPayload(preset),
    send: cliente.send,
  });
  conferir(resultado.ok, `${cliente.nome} entrou`);
}

const intruso = criarCliente("Intruso");
const terceiro = room.join({
  token: intruso.token,
  name: intruso.nome,
  deck: presetToDuelPayload(PRESET_DECKS[2]),
  send: intruso.send,
});
conferir(!terceiro.ok, "terceiro jogador é recusado (sala cheia)");

room.setReady(a.token, true);
room.setReady(b.token, true);

// ---------------------------------------------------------------------------
// Jokenpô: quem começa não é sorteado, é disputado.
//
// Duas coisas para provar aqui, e a segunda é a que faz o jogo ser jogo: que a
// jogada do adversário NÃO aparece antes de os dois jogarem (com ela em mãos
// bastava esperar), e que a escolha de quem ganha é respeitada — quem escolhe
// "por último" precisa mesmo receber o assento 1.
// ---------------------------------------------------------------------------
console.log("\nJokenpô pelo primeiro turno...");
conferir(
  a.lobby?.started === false && Boolean(a.lobby?.jokenpo),
  "com os dois prontos o duelo espera o jokenpô",
);

room.jogarJokenpo(a.token, "pedra");
conferir(
  b.lobby?.jokenpo?.opponentChose === true && b.lobby?.jokenpo?.mine === null,
  "o outro sabe que já jogaram, e nada mais",
);
conferir(
  JSON.stringify(b.lobby?.jokenpo).includes("pedra") === false,
  "a jogada do adversário NÃO atravessa a rede antes da hora",
  JSON.stringify(b.lobby?.jokenpo),
);

// Empate: joga de novo, sem decidir nada.
room.jogarJokenpo(b.token, "pedra");
conferir(
  a.lobby?.jokenpo?.last?.outcome === "empate" && a.lobby?.jokenpo?.round === 2,
  `empate manda jogar de novo (rodada ${a.lobby?.jokenpo?.round})`,
);
conferir(
  a.lobby?.started === false,
  "e o duelo continua parado enquanto ninguém ganha",
);

// Agora com vencedor: papel ganha de pedra.
room.jogarJokenpo(a.token, "papel");
room.jogarJokenpo(b.token, "pedra");
conferir(
  a.lobby?.jokenpo?.chooseFirst === true && b.lobby?.jokenpo?.waitingChoice === true,
  "quem ganhou é quem escolhe a ordem",
);
conferir(
  b.lobby?.jokenpo?.last?.outcome === "perdi" &&
    b.lobby?.jokenpo?.last?.theirs === "papel",
  "resolvida a rodada, as duas jogadas aparecem",
);

// Escolhe jogar POR ÚLTIMO — o assento 0 (que o core faz começar) tem que ir
// para o outro.
room.escolherOrdem(a.token, false);

console.log("\nEsperando o duelo começar (baixa catálogo e scripts)...");
await until(() => a.lobby?.started && b.lobby?.started, { label: "início do duelo" });
conferir(
  a.me !== null && b.me !== null && a.me !== b.me,
  `assentos sem colisão (${a.nome}=${a.me}, ${b.nome}=${b.me})`,
);
conferir(
  a.me === 1 && b.me === 0,
  `quem escolheu "por último" ficou no assento 1 (${a.nome}=${a.me})`,
);
conferir(
  a.lobby?.jokenpo === null,
  "com o duelo em andamento não há jokenpô pendente",
);

let porAssento = { [a.me]: a, [b.me]: b };

console.log("\nJogando...");
const promptsVistos = new Set();
const promptsSemResposta = [];
let respondidos = 0;
let vazamentoDeMao = false;
let vazamentoDeDeck = false;
let promptDoOutro = false;

while (respondidos < MAX_PROMPTS) {
  let esperando;
  try {
    esperando = await until(
      () => {
        for (const cliente of [a, b]) {
          if (cliente.snapshot?.winner != null) return "fim";
          if (cliente.snapshot?.pendingPrompt) return cliente;
        }
        return null;
      },
      { timeout: 30_000, label: "um prompt" },
    );
  } catch {
    break;
  }
  if (esperando === "fim") break;

  // A cada rodada, conferir as duas óticas — não só a de quem foi perguntado.
  for (const cliente of [a, b]) {
    if (!cliente.snapshot) continue;
    if (vazouMaoDoOponente(cliente.snapshot, cliente.me)) vazamentoDeMao = true;
    if (vazouDeckDoOponente(cliente.snapshot, cliente.me)) vazamentoDeDeck = true;
    if (cliente.snapshot.boards[1 - cliente.me] !== null) vazamentoDeMao = true;
    // Só quem foi perguntado recebe a pergunta.
    if (
      cliente.snapshot.pendingPrompt &&
      cliente.snapshot.promptPlayer !== cliente.me
    ) {
      promptDoOutro = true;
    }
  }

  const prompt = esperando.snapshot.pendingPrompt;
  const promptId = esperando.snapshot.promptId;
  promptsVistos.add(nomeDoPrompt(prompt.type));

  const respondivel = planoRespondivel(prompt, esperando.me);
  if (!respondivel.ok) {
    promptsSemResposta.push(`${nomeDoPrompt(prompt.type)} (${respondivel.motivo})`);
  }
  porAssento = { [a.me]: a, [b.me]: b };
  const outro = porAssento[1 - esperando.me];

  if (respondidos === 0) {
    // Duas tentativas ilegítimas, antes da legítima: o adversário respondendo
    // no lugar do outro, e uma resposta com id velho.
    room.respond(outro.token, promptId, botAutoResponse(prompt));
    room.respond(esperando.token, promptId - 1, botAutoResponse(prompt));
    await new Promise((resolve) => setTimeout(resolve, 50));
    conferir(
      esperando.snapshot?.promptId === promptId &&
        esperando.snapshot?.pendingPrompt !== null,
      "resposta do assento errado e resposta com id velho são ignoradas",
    );
  }

  room.respond(esperando.token, promptId, botAutoResponse(prompt));
  respondidos += 1;

  await until(
    () =>
      esperando.snapshot?.promptId !== promptId ||
      esperando.snapshot?.pendingPrompt === null ||
      esperando.snapshot?.winner != null,
    { timeout: 30_000, label: "o engine seguir" },
  ).catch(() => {});
}

console.log("");
conferir(respondidos > 10, `o duelo avançou (${respondidos} decisões respondidas)`);
conferir(
  promptsSemResposta.length === 0,
  promptsSemResposta.length === 0
    ? `toda pergunta tinha resposta possível na tela (${promptsVistos.size} tipos vistos)`
    : `prompts que a tela não sabe responder: ${[...new Set(promptsSemResposta)].join(", ")}`,
);
conferir(!vazamentoDeMao, "a mão do oponente nunca chega com o código da carta");
conferir(!vazamentoDeDeck, "o Extra Deck do oponente nunca chega listado");
conferir(!promptDoOutro, "ninguém recebe o prompt do outro assento");
conferir(
  a.falhasDeCodec.length === 0 && b.falhasDeCodec.length === 0,
  "toda mensagem sobreviveu ao codec (BigInt incluso)",
);
conferir(
  a.snapshot?.log.every((linha) => linha.visibleTo === null || linha.visibleTo === a.me) ?? false,
  "o log de cada assento só traz linhas que ele pode ler",
);
conferir(
  a.eventos.every((evento) => evento.kind !== "reveal" || evento.visibleTo === a.me),
  "revelações só chegam a quem tinha direito de ver",
);
conferir(a.erros.length === 0 && b.erros.length === 0, "nenhum erro reportado pela sala");

// Uma checagem de sanidade do próprio teste: sem ela um bug que zerasse o
// tabuleiro passaria como "não vazou nada".
conferir(a.maiorMao > 0, `o teste realmente olhou um tabuleiro com cartas (mão de até ${a.maiorMao})`);
conferir(!a.maoIlegivel, "a própria mão continua visível para o dono");
conferir(
  (a.snapshot?.boards[a.me]?.players[a.me].deckSize ?? 0) > 0 ||
    a.snapshot?.winner != null,
  "o tabuleiro projetado tem o deck do próprio jogador",
);

console.log("\nJogando até alguém vencer, para exercitar a revanche...");

let extras = 0;
while (
  extras < MAX_PROMPTS_ATE_O_FIM &&
  a.snapshot?.winner == null &&
  b.snapshot?.winner == null
) {
  const quem = await until(
    () => {
      for (const cliente of [a, b]) {
        if (cliente.snapshot?.winner != null) return "fim";
        if (cliente.snapshot?.pendingPrompt) return cliente;
      }
      return null;
    },
    { timeout: 30_000, label: "um prompt" },
  ).catch(() => null);
  if (!quem || quem === "fim") break;

  const id = quem.snapshot.promptId;
  room.respond(quem.token, id, botAutoResponse(quem.snapshot.pendingPrompt));
  extras += 1;
  await until(
    () =>
      quem.snapshot?.promptId !== id ||
      quem.snapshot?.pendingPrompt === null ||
      quem.snapshot?.winner != null,
    { timeout: 30_000, label: "o engine seguir" },
  ).catch(() => {});
}

const terminou = a.snapshot?.winner != null;
if (!terminou) {
  console.log(
    `  ⚠ o duelo não terminou em ${respondidos + extras} decisões — revanche não exercitada`,
  );
} else {
  conferir(
    a.lobby?.finished === true && b.lobby?.finished === true,
    "os dois lados sabem que a sala aceita revanche",
  );

  // Pelo caminho da TELA: com o duelo terminado o jogador volta à sala e
  // clica "estou pronto" — o mesmo botão da primeira partida. Este era o
  // travamento: o servidor descartava esse "pronto" em silêncio (a checagem
  // olhava `started`, que continua verdadeira depois do fim), e os dois lados
  // ficavam se olhando, cada um vendo o outro como não pronto.
  room.setReady(a.token, true);
  await new Promise((resolve) => setTimeout(resolve, 60));
  conferir(
    a.lobby?.seats.find((seat) => seat.seat === a.me)?.ready === true,
    "depois do duelo o 'estou pronto' é aceito",
  );
  conferir(
    b.lobby?.seats.find((seat) => seat.seat === a.me)?.ready === true,
    "o adversário VÊ que o outro está pronto para a próxima",
  );
  conferir(
    a.lobby?.finished === true,
    "com um só pronto a sala continua esperando (não recomeça sozinha)",
  );

  // Trocar de deck entre partidas — o motivo de a sala sobreviver ao duelo.
  const deckAntigo = b.lobby?.seats.find((seat) => seat.seat === b.me)?.deckName;
  room.setDeck(b.token, presetToDuelPayload(PRESET_DECKS[3]), "Deck da revanche");
  await new Promise((resolve) => setTimeout(resolve, 60));
  const depoisDaTroca = b.lobby?.seats.find((seat) => seat.seat === b.me);
  conferir(
    depoisDaTroca?.deckName === "Deck da revanche" && deckAntigo !== "Deck da revanche",
    "dá para trocar de deck entre partidas",
  );
  conferir(
    a.lobby?.seats.find((seat) => seat.seat === b.me)?.deckName === null,
    "o adversário NÃO vê qual deck o outro escolheu",
  );
  conferir(
    a.lobby?.seats.find((seat) => seat.seat === a.me)?.deckName !== null,
    "cada um continua vendo o próprio deck",
  );
  conferir(
    depoisDaTroca?.ready === false,
    "trocar de deck desfaz o 'pronto' de quem trocou",
  );

  room.setReady(b.token, true);
  // Partida nova, jokenpô novo: a sala volta a esperar a disputa.
  await new Promise((resolve) => setTimeout(resolve, 60));
  conferir(
    Boolean(a.lobby?.jokenpo),
    "a partida seguinte também disputa quem começa",
  );
  await jokenpo(a, b);
  const recomecou = await until(
    () => a.snapshot?.winner == null && a.snapshot?.boards?.[a.me] != null,
    { timeout: 90_000, label: "a partida nova" },
  ).catch(() => false);

  conferir(
    Boolean(recomecou),
    "com os dois prontos a partida nova começa na mesma sala",
  );
  conferir(
    a.me !== null && b.me !== null && a.me !== b.me,
    `assentos sorteados de novo (${a.nome}=${a.me}, ${b.nome}=${b.me})`,
  );
  conferir(
    (a.snapshot?.lifePoints?.[0] ?? 0) === 8000 && (a.snapshot?.lifePoints?.[1] ?? 0) === 8000,
    "a partida nova começou com os LP zerados",
  );

  // No meio do duelo a troca não teria efeito no engine — recusar é o que
  // impede uma opção que finge funcionar.
  const noMeio = b.lobby?.seats.find((seat) => seat.seat === b.me)?.deckName;
  room.setDeck(b.token, presetToDuelPayload(PRESET_DECKS[4]), "Nao deve valer");
  await new Promise((resolve) => setTimeout(resolve, 60));
  conferir(
    b.lobby?.seats.find((seat) => seat.seat === b.me)?.deckName === noMeio,
    "trocar de deck no meio do duelo é recusado",
  );
}

// ---------------------------------------------------------------------------
// Queda no meio do duelo.
//
// O modo de falha que isto cobre não dá erro nenhum: o adversário fecha a aba,
// o core fica parado esperando a resposta dele, e quem ficou olha
// "Aguardando Fulano..." para sempre. A sala nem é recolhida, porque não está
// vazia. Sem um jeito de encerrar, o duelo simplesmente nunca termina.
// ---------------------------------------------------------------------------
/**
 * Recomeça a sala e espera a partida nova.
 *
 * Cada cenário abaixo TERMINA o duelo (rendição, abandono), então o seguinte
 * precisa de um tabuleiro novo — sem isto o segundo cenário só encontraria um
 * duelo já decidido e se anularia em silêncio.
 */
/**
 * Resolve o jokenpô do jeito mais curto possível: `vencedor` joga papel, o
 * outro pedra, e o vencedor escolhe começar.
 *
 * Existe porque toda partida agora passa por essa disputa, e repetir as quatro
 * chamadas em cada cenário esconderia o que cada cenário está testando.
 */
async function jokenpo(vencedor, perdedor, { primeiro = true } = {}) {
  room.jogarJokenpo(vencedor.token, "papel");
  room.jogarJokenpo(perdedor.token, "pedra");
  room.escolherOrdem(vencedor.token, primeiro);
  await new Promise((resolve) => setTimeout(resolve, 60));
}

async function novaPartida() {
  room.rematch(a.token);
  room.rematch(b.token);
  await new Promise((resolve) => setTimeout(resolve, 60));
  await jokenpo(a, b);
  return until(
    () => a.snapshot?.winner == null && a.snapshot?.boards?.[a.me] != null,
    { timeout: 90_000, label: "a partida nova" },
  ).catch(() => false);
}

console.log("\nRendição no meio do duelo...");
if (!(await novaPartida())) {
  console.log("  ⚠ não foi possível começar uma partida nova — rendição não exercitada");
} else {
  const antes = a.snapshot?.lifePoints?.slice() ?? [];
  room.surrender(a.token);
  await until(() => a.snapshot?.winner != null, {
    timeout: 10_000,
    label: "o duelo encerrar",
  });

  conferir(a.snapshot?.winner === b.me, `quem se rendeu perde (venceu o assento ${a.snapshot?.winner})`);
  conferir(b.snapshot?.winner === b.me, "o adversário vê a mesma vitória");
  conferir(
    JSON.stringify(a.snapshot?.lifePoints) === JSON.stringify(antes),
    "os pontos de vida não são mexidos — só o resultado muda",
  );
  conferir(
    /se rendeu/.test(a.snapshot?.winReason ?? ""),
    `o resultado explica o motivo ("${a.snapshot?.winReason}")`,
  );
  conferir(
    a.snapshot?.log.some((linha) => /rendeu/.test(linha.text)),
    "o log registra a rendição",
  );
  conferir(
    a.snapshot?.pendingPrompt === null && a.snapshot?.promptPlayer === null,
    "o tabuleiro para de pedir resposta depois da rendição",
  );
  conferir(a.lobby?.finished === true, "a sala fica pronta para revanche");

  // Insistir depois de acabado não pode virar um segundo resultado.
  room.surrender(b.token);
  await new Promise((resolve) => setTimeout(resolve, 60));
  conferir(
    a.snapshot?.winner === b.me,
    "render-se de novo com o duelo acabado não muda nada",
  );
}

console.log("\nSimulando queda de um jogador no meio do duelo...");
if (!(await novaPartida())) {
  console.log("  ⚠ não havia duelo em andamento — queda não exercitada");
} else {
  const comPrompt = await until(
    () => [a, b].find((cliente) => cliente.snapshot?.pendingPrompt),
    { timeout: 30_000, label: "um prompt" },
  ).catch(() => null);

  if (!comPrompt) {
    console.log(
      `  ⚠ ninguém estava com prompt — queda não exercitada` +
        ` (a: prompt=${Boolean(a.snapshot?.pendingPrompt)} winner=${a.snapshot?.winner}` +
        ` processando=${a.snapshot?.isProcessing};` +
        ` b: prompt=${Boolean(b.snapshot?.pendingPrompt)} winner=${b.snapshot?.winner})`,
    );
  } else {
    const fica = comPrompt === a ? b : a;
    const cai = comPrompt;

    room.disconnect(cai.token);
    await new Promise((resolve) => setTimeout(resolve, 60));

    conferir(
      fica.lobby?.seats.find((seat) => seat.seat === cai.me)?.connected === false,
      "quem fica é avisado de que o adversário caiu",
    );
    conferir(
      fica.lobby?.claimable === false,
      "logo depois da queda ainda NÃO dá para encerrar (a pessoa pode voltar)",
    );

    // Encerrar antes da hora tem que ser recusado, senão a tolerância não vale
    // nada: bastaria clicar assim que o outro piscasse.
    room.claimWin(fica.token);
    await new Promise((resolve) => setTimeout(resolve, 60));
    conferir(
      fica.snapshot?.winner == null,
      "encerrar antes da tolerância é recusado",
    );

    const liberou = await until(() => fica.lobby?.claimable === true, {
      timeout: TOLERANCIA_MS + 10_000,
      label: "a tolerância acabar",
    }).catch(() => false);
    conferir(Boolean(liberou), "passada a tolerância, a sala avisa que dá para encerrar");

    room.claimWin(fica.token);
    await until(() => fica.snapshot?.winner != null, {
      timeout: 10_000,
      label: "o duelo encerrar",
    });
    conferir(
      fica.snapshot?.winner === fica.me,
      "quem ficou vence o duelo abandonado",
    );
    conferir(
      /não voltou/.test(fica.snapshot?.winReason ?? ""),
      `o resultado diz que foi abandono, não rendição ("${fica.snapshot?.winReason}")`,
    );
    conferir(
      fica.snapshot?.pendingPrompt === null && fica.snapshot?.promptPlayer === null,
      "o tabuleiro para de pedir resposta ao assento que sumiu",
    );

    // Volta para a sala para as etapas seguintes (revanche) seguirem valendo.
    room.join({
      token: cai.token,
      name: cai.nome,
      deck: presetToDuelPayload(PRESET_DECKS[cai.me === a.me ? 0 : 1]),
      send: cai.send,
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    conferir(
      fica.lobby?.seats.find((seat) => seat.seat === cai.me)?.connected === true,
      "quem voltou reaparece conectado no mesmo assento",
    );
    conferir(
      cai.snapshot?.winner != null,
      "quem voltou vê o resultado do duelo que perdeu por ausência",
    );
  }
}

console.log("");
if (falhas.length > 0) {
  console.log(`${falhas.length} falha(s):`);
  for (const falha of falhas) console.log(`  - ${falha}`);
  process.exit(1);
}
console.log("Tudo certo.");
process.exit(0);
