/**
 * Informação oculta: o que o jogador VÊ e o que ele NÃO pode ver.
 *
 * Os outros testes perguntam "o efeito funciona no engine?" e "o jogador
 * consegue responder ao prompt?". Este pergunta a terceira coisa, que é onde
 * uma falha não quebra nada e passa batido:
 *
 *   1. **Aparece?** Goblin Larápio acerta e o adversário descarta — mas o
 *      descarte não tinha rastro nenhum na tela. A mão encolhia em silêncio e,
 *      da cadeira do jogador, o efeito parecia não ter funcionado. Aqui o teste
 *      exige a linha no log.
 *   2. **Fica escondido o que tem que ficar?** O core manda o passcode de TODO
 *      candidato de um SELECT_CARD, inclusive das cartas na mão do adversário.
 *      No Espião Inexperiente ("escolha e veja 1 card na mão do adversário") o
 *      prompt vem ANTES da revelação, então mostrar os códigos abre a mão
 *      inteira e a escolha deixa de ser escolha.
 *   3. **Aparece o que tem que aparecer?** O contrário do item 2: Confisco
 *      revela a mão PRIMEIRO e pede a escolha depois. Mascarar ali obrigaria o
 *      jogador a escolher no escuro uma carta que a regra manda ele ver.
 *   4. **O dono vê a própria carta revelada?** Boneca Chamariz vira uma carta
 *      baixada do adversário; a revelação é dirigida a quem ativou, mas a carta
 *      é do OUTRO — e ele tem todo o direito de saber o que foi mostrado.
 *   5. **A mão que o core mandou abrir, abre?** O Olho Mágico da Verdade deixa
 *      o adversário jogando com a mão revelada — um estado CONTÍNUO, sem
 *      MSG_CONFIRM_CARDS nenhum para o histórico de revelações pegar. A tela
 *      escondia a mão do oponente por decreto e o efeito não existia para o
 *      jogador: o duelo respeitava a carta, a mesa não.
 *
 * Roda a `DuelSession` de verdade (a mesma classe que a tela usa), não o duelo
 * roteirizado do `duel.mjs`: o que se testa aqui é justamente a camada que
 * decide o que entra no snapshot, e ela não existe no duelo cru.
 *
 * Uso: npm run test:hidden
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  OcgLocation,
  OcgMessageType,
  OcgPosition,
  OcgResponseType,
  SelectBattleCMDAction,
  SelectIdleCMDAction,
  ocgPositionParse,
} from "@n1xx1/ocgcore-wasm";

import { botAutoResponse } from "@/lib/duel/bot-responder";
import { createDuelSession } from "@/lib/duel/duel-session";
import { CardRegistry } from "@/lib/domain/card-registry";
import { nodeAssets } from "@/server/duel/node-assets";

import { REPO } from "./env.mjs";

const CARTA = {
  /** Goblin Larápio — dano de batalha faz o adversário descartar 1 ao acaso. */
  goblinLarapio: 88279736,
  /** O Espião Inexperiente — escolhe primeiro, revela depois. */
  espiao: 81820689,
  /** Confisco — revela a mão primeiro, escolhe depois. */
  confisco: 17375316,
  /** Boneca Chamariz — vira uma carta baixada e a devolve. */
  bonecaChamariz: 7165085,
  /** Gemini Elf — nível 4, 1900 de ataque: bate sem precisar de tributo. */
  elf: 69140098,
  /** Remédio Secreto do Goblin — Magia Normal inofensiva que o bot só baixa. */
  magiaInerte: 11868825,
  /** Olho Mágico da Verdade — Armadilha Contínua: mão do adversário revelada. */
  olhoMagico: 34694160,
};

const pool = JSON.parse(
  readFileSync(join(REPO, ".cache/goat-pool.json"), "utf8"),
).data;
const registry = CardRegistry.fromApiResponse(pool);

const falhas = [];
function conferir(condicao, descricao, detalhe = "") {
  if (condicao) {
    console.log(`  ✓ ${descricao}`);
  } else {
    falhas.push(descricao);
    console.log(`  ✗ ${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Joga uma sessão com o assento 0 roteirizado e o 1 no bot.
 *
 * @param decidir `(prompt, snapshot) => resposta | null`. `null` cai no piloto
 *   do bot — que responde qualquer coisa de um jeito legal, é o suficiente para
 *   o duelo andar até o ponto que interessa.
 * @param pronto `(snapshot) => boolean` — para o teste assim que o que se quer
 *   observar já aconteceu, em vez de jogar o duelo inteiro.
 */
async function jogar({ main0, main1, decidir, pronto, limiteMs = 90_000 }) {
  const session = createDuelSession();
  let snap = null;
  session.subscribe((s) => {
    snap = s;
  });

  void session.start({
    playerName: "Eu",
    playerDeck: { main: main0, extra: [] },
    opponentName: "Bot",
    opponentDeck: { main: main1, extra: [] },
    registry,
    assets: nodeAssets,
    seats: [
      { kind: "local", name: "Você" },
      { kind: "bot", name: "O oponente" },
    ],
  });

  const limite = Date.now() + limiteMs;
  while (Date.now() < limite) {
    await sleep(10);
    if (!snap) continue;
    if (snap.error) throw new Error(`sessão falhou: ${snap.error}`);
    if (snap.winner !== null) break;
    if (pronto(snap)) break;
    if (snap.pendingPrompt && !snap.isProcessing && snap.promptPlayer === 0) {
      const resposta =
        decidir(snap.pendingPrompt, snap) ?? botAutoResponse(snap.pendingPrompt);
      await session.respond(resposta, snap.promptId);
    }
  }
  return snap;
}

/** Atalhos para as respostas mais usadas pelos roteiros abaixo. */
const responder = {
  idle: (action, index = null) => ({
    type: OcgResponseType.SELECT_IDLECMD,
    action,
    index,
  }),
  atacar: () => ({
    type: OcgResponseType.SELECT_BATTLECMD,
    action: SelectBattleCMDAction.SELECT_BATTLE,
    index: 0,
  }),
  posicao: (prompt) => {
    const permitidas = ocgPositionParse(prompt.positions);
    return {
      type: OcgResponseType.SELECT_POSITION,
      position: permitidas.includes(OcgPosition.FACEUP_ATTACK)
        ? OcgPosition.FACEUP_ATTACK
        : permitidas[0],
    };
  },
};

/**
 * Roteiro comum de "ativo a carta X": invoca um monstro se puder, ativa X na
 * primeira oportunidade e não faz mais nada.
 */
function decidirAtivando(passcode, { atacar = false, estado } = {}) {
  return (prompt, snap) => {
    switch (prompt.type) {
      case OcgMessageType.SELECT_IDLECMD: {
        const alvo = prompt.activates.findIndex((c) => c.code === passcode);
        if (alvo >= 0 && !estado.ativou) {
          estado.ativou = true;
          return responder.idle(SelectIdleCMDAction.SELECT_ACTIVATE, alvo);
        }
        const temMonstro = (snap.boards[0]?.players[0].monsters ?? []).some(
          (c) => c,
        );
        const invocavel = prompt.summons.findIndex((c) => c.code === CARTA.elf);
        if (invocavel >= 0 && !temMonstro) {
          return responder.idle(SelectIdleCMDAction.SELECT_SUMMON, invocavel);
        }
        if (atacar && prompt.to_bp) {
          return responder.idle(SelectIdleCMDAction.TO_BP);
        }
        return responder.idle(SelectIdleCMDAction.TO_EP);
      }
      case OcgMessageType.SELECT_BATTLECMD:
        if (atacar && prompt.attacks.length > 0) return responder.atacar();
        return {
          type: OcgResponseType.SELECT_BATTLECMD,
          action: SelectBattleCMDAction.TO_EP,
          index: null,
        };
      case OcgMessageType.SELECT_POSITION:
        return responder.posicao(prompt);
      default:
        return null;
    }
  };
}

/** Candidatos de um prompt que estão na mão do adversário. */
function naMaoDoOponente(prompt) {
  const lista =
    prompt.type === OcgMessageType.SELECT_CARD
      ? prompt.selects
      : (prompt.select_cards ?? []);
  return lista.filter(
    (card) => card.controller === 1 && (card.location & OcgLocation.HAND) !== 0,
  );
}

// ---------------------------------------------------------------------------
// 1. O descarte do Goblin Larápio aparece no log.
// ---------------------------------------------------------------------------
console.log("\nGoblin Larápio — o descarte tem que aparecer");
{
  const estado = { ativou: false, baixou: false };
  // Armadilha: precisa ser BAIXADA num turno e ativada no seguinte — por isso
  // este roteiro é próprio, e não o `decidirAtivando` das magias.
  const roteiro = (prompt, snap) => {
    switch (prompt.type) {
      case OcgMessageType.SELECT_IDLECMD: {
        const ativar = prompt.activates.findIndex(
          (c) => c.code === CARTA.goblinLarapio,
        );
        if (ativar >= 0) {
          estado.ativou = true;
          return responder.idle(SelectIdleCMDAction.SELECT_ACTIVATE, ativar);
        }
        const temMonstro = (snap.boards[0]?.players[0].monsters ?? []).some(
          (c) => c,
        );
        const invocar = prompt.summons.findIndex((c) => c.code === CARTA.elf);
        if (invocar >= 0 && !temMonstro) {
          return responder.idle(SelectIdleCMDAction.SELECT_SUMMON, invocar);
        }
        const baixar = prompt.spell_sets.findIndex(
          (c) => c.code === CARTA.goblinLarapio,
        );
        if (baixar >= 0 && !estado.baixou) {
          estado.baixou = true;
          return responder.idle(SelectIdleCMDAction.SELECT_SPELL_SET, baixar);
        }
        if (prompt.to_bp) return responder.idle(SelectIdleCMDAction.TO_BP);
        return responder.idle(SelectIdleCMDAction.TO_EP);
      }
      // Só ataca com a armadilha já ativa: senão o duelo acaba por dano antes
      // de o efeito ter chance de disparar.
      case OcgMessageType.SELECT_BATTLECMD:
        if (estado.ativou && prompt.attacks.length > 0) return responder.atacar();
        return {
          type: OcgResponseType.SELECT_BATTLECMD,
          action: SelectBattleCMDAction.TO_EP,
          index: null,
        };
      case OcgMessageType.SELECT_POSITION:
        return responder.posicao(prompt);
      default:
        return null;
    }
  };

  const snap = await jogar({
    main0: [
      ...Array(8).fill(CARTA.goblinLarapio),
      ...Array(32).fill(CARTA.elf),
    ],
    // Só magia: o bot baixa e nunca invoca, então o ataque é sempre direto.
    main1: Array(40).fill(CARTA.magiaInerte),
    decidir: roteiro,
    // "O oponente descartou" e não só "descartou": o limite de mão do End
    // Phase também produz descarte, e ele apareceria aqui como falso positivo.
    pronto: (s) =>
      s.log.some((linha) => linha.text.includes("O oponente descartou")),
  });

  const descartes = snap.log.filter((linha) =>
    linha.text.includes("O oponente descartou"),
  );
  conferir(estado.ativou, "a armadilha foi ativada");
  conferir(
    descartes.length > 0,
    "o log narra o descarte do adversário",
    snap.log
      .slice(-6)
      .map((l) => l.text)
      .join(" | "),
  );
  conferir(
    descartes.every((linha) => linha.visibleTo === null),
    "a linha do descarte é pública (o cemitério é público)",
  );
}

// ---------------------------------------------------------------------------
// 2. O Espião Inexperiente escolhe pelo verso.
// ---------------------------------------------------------------------------
console.log("\nO Espião Inexperiente — escolher pelo verso, revelar depois");
{
  const estado = { ativou: false };
  let candidatos = null;
  const base = decidirAtivando(CARTA.espiao, { estado });
  const snap = await jogar({
    main0: [...Array(10).fill(CARTA.espiao), ...Array(30).fill(CARTA.elf)],
    main1: Array(40).fill(CARTA.magiaInerte),
    decidir: (prompt, snap) => {
      if (prompt.type === OcgMessageType.SELECT_CARD && estado.ativou) {
        const mao = naMaoDoOponente(prompt);
        if (mao.length > 0 && !candidatos) candidatos = mao;
      }
      return base(prompt, snap);
    },
    pronto: (s) => Boolean(candidatos) && s.reveals.length > 0,
  });

  conferir(Boolean(candidatos), "o prompt ofereceu a mão do adversário");
  conferir(
    (candidatos ?? []).every((card) => card.code === 0),
    "os candidatos chegam SEM passcode (verso)",
    JSON.stringify((candidatos ?? []).map((c) => c.code)),
  );
  const minhas = snap.reveals.filter((r) => r.visibleTo === 0);
  conferir(
    minhas.some((r) => r.codes.every((code) => code !== 0)),
    "depois da escolha a carta é revelada a quem escolheu",
    JSON.stringify(snap.reveals),
  );
}

// ---------------------------------------------------------------------------
// 3. Confisco revela antes — as faces têm que aparecer.
// ---------------------------------------------------------------------------
console.log("\nConfisco — revela primeiro, então a face aparece na escolha");
{
  const estado = { ativou: false };
  let candidatos = null;
  const base = decidirAtivando(CARTA.confisco, { estado });
  await jogar({
    main0: [...Array(10).fill(CARTA.confisco), ...Array(30).fill(CARTA.elf)],
    main1: Array(40).fill(CARTA.magiaInerte),
    decidir: (prompt, snap) => {
      if (prompt.type === OcgMessageType.SELECT_CARD && estado.ativou) {
        const mao = naMaoDoOponente(prompt);
        if (mao.length > 0 && !candidatos) candidatos = mao;
      }
      return base(prompt, snap);
    },
    pronto: () => Boolean(candidatos),
  });

  conferir(Boolean(candidatos), "o prompt ofereceu a mão do adversário");
  conferir(
    (candidatos ?? []).every((card) => card.code !== 0),
    "os candidatos vêm COM passcode (a mão já foi revelada)",
    JSON.stringify((candidatos ?? []).map((c) => c.code)),
  );
}

// ---------------------------------------------------------------------------
// 4. Boneca Chamariz: o dono da carta virada também fica sabendo qual era.
// ---------------------------------------------------------------------------
console.log("\nBoneca Chamariz — o dono vê qual carta dele foi revelada");
{
  const estado = { ativou: false };
  /** O elo de corrente publicado no snapshot no momento da escolha. */
  let correnteNaEscolha = null;
  const base = decidirAtivando(CARTA.bonecaChamariz, { estado });
  const snap = await jogar({
    main0: [
      ...Array(12).fill(CARTA.bonecaChamariz),
      ...Array(28).fill(CARTA.elf),
    ],
    main1: Array(40).fill(CARTA.magiaInerte),
    decidir: (prompt, snap) => {
      // O alvo é a carta baixada DELE: sem isto o piloto escolheria a primeira
      // da lista, que pode ser uma minha.
      if (prompt.type === OcgMessageType.SELECT_CARD && estado.ativou) {
        correnteNaEscolha ??= snap.chain;
        const dele = prompt.selects.findIndex((c) => c.controller === 1);
        if (dele >= 0) {
          return { type: OcgResponseType.SELECT_CARD, indicies: [dele] };
        }
      }
      return base(prompt, snap);
    },
    pronto: (s) => s.reveals.some((r) => r.visibleTo === 1),
  });

  const minhas = snap.reveals.filter((r) => r.visibleTo === 0);
  const doDono = snap.reveals.filter((r) => r.visibleTo === 1);
  conferir(estado.ativou, "a Boneca foi ativada");
  conferir(minhas.length > 0, "quem ativou vê a carta revelada");
  conferir(
    doDono.length > 0,
    "o DONO da carta virada também recebe a revelação",
    JSON.stringify(snap.reveals),
  );

  // O modal de decisão mostra a que se está respondendo — o elo tem que estar
  // no snapshot ENQUANTO a corrente existe, não só no log.
  conferir(
    correnteNaEscolha?.code === CARTA.bonecaChamariz,
    "o snapshot diz qual carta está na corrente",
    JSON.stringify(correnteNaEscolha),
  );
  conferir(
    Boolean(correnteNaEscolha?.playerName),
    "e diz quem a ativou",
    JSON.stringify(correnteNaEscolha),
  );
  conferir(snap.turnCount >= 1, `a contagem de turno anda (${snap.turnCount})`);
}

// ---------------------------------------------------------------------------
// 5. Olho Mágico da Verdade: a mão do adversário abre — e só depois de ativado.
// ---------------------------------------------------------------------------
console.log("\nOlho Mágico da Verdade — a mão do adversário fica aberta");
{
  const estado = { baixou: false, ativou: false };
  /** A mão do bot como a tela a via ANTES de a armadilha entrar em jogo. */
  let antes = null;

  const roteiro = (prompt, snap) => {
    switch (prompt.type) {
      case OcgMessageType.SELECT_IDLECMD: {
        if (!estado.ativou) {
          const mao = snap.boards[0]?.players[1].hand ?? [];
          if (mao.length > 0) antes ??= mao.map((card) => card.code);
        }
        const ativar = prompt.activates.findIndex(
          (c) => c.code === CARTA.olhoMagico,
        );
        if (ativar >= 0) {
          estado.ativou = true;
          return responder.idle(SelectIdleCMDAction.SELECT_ACTIVATE, ativar);
        }
        const baixar = prompt.spell_sets.findIndex(
          (c) => c.code === CARTA.olhoMagico,
        );
        if (baixar >= 0 && !estado.baixou) {
          estado.baixou = true;
          return responder.idle(SelectIdleCMDAction.SELECT_SPELL_SET, baixar);
        }
        return responder.idle(SelectIdleCMDAction.TO_EP);
      }
      case OcgMessageType.SELECT_BATTLECMD:
        return {
          type: OcgResponseType.SELECT_BATTLECMD,
          action: SelectBattleCMDAction.TO_EP,
          index: null,
        };
      case OcgMessageType.SELECT_POSITION:
        return responder.posicao(prompt);
      default:
        return null;
    }
  };

  const snap = await jogar({
    // Deck de uma carta só: a armadilha precisa estar na mão de saída, e três
    // cópias em quarenta deixariam o teste dependendo do embaralhamento.
    main0: Array(40).fill(CARTA.olhoMagico),
    main1: Array(40).fill(CARTA.magiaInerte),
    decidir: roteiro,
    pronto: (s) => {
      if (!estado.ativou) return false;
      const mao = s.boards[0]?.players[1].hand ?? [];
      return mao.length > 0 && mao.every((card) => card.code !== null);
    },
  });

  const depois = (snap.boards[0]?.players[1].hand ?? []).map((c) => c.code);
  conferir(estado.ativou, "o Olho Mágico foi baixado e ativado");
  conferir(
    (antes ?? []).length > 0 && (antes ?? []).every((code) => code === null),
    "antes da ativação a mão do adversário está fechada",
    JSON.stringify(antes),
  );
  conferir(
    depois.length > 0 && depois.every((code) => code !== null),
    "com o Olho Mágico em campo a mão do adversário vem aberta",
    JSON.stringify(depois),
  );
}

console.log("");
if (falhas.length > 0) {
  console.log(`${falhas.length} falha(s):`);
  for (const falha of falhas) console.log(`  - ${falha}`);
  process.exit(1);
}
console.log("Informação oculta: tudo certo.");
process.exit(0);
