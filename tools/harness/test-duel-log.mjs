/**
 * O histórico conta o jogo — e a mesa vê a carta sair.
 *
 * Antes, destruir, mandar ao Cemitério, banir e devolver à mão não deixavam
 * rastro: a carta sumia, o topo do Cemitério trocava, e o histórico só dizia
 * "⚔ O oponente declarou ataque" — sem quem, sem em quem. E o histórico
 * misturava ao jogo as linhas de carga ("Carregando engine…") e as dicas do
 * core sobre a escolha em curso. Este teste roda a `DuelSession` real e exige:
 *
 *   1. Ataque com nomes; destruição em batalha narrada, com o código da carta
 *      (passar o mouse na linha mostra a carta) e o evento `leave` que anima a
 *      saída na zona certa.
 *   2. Destruição por efeito (Raigeki) separada da de batalha; compra por
 *      efeito (Pote da Ganância) registrada.
 *   3. **Informação oculta:** a Armadilha baixada que o Giant Trunade devolve
 *      à mão sai como "uma carta baixada" — sem nome, sem código, nem na linha
 *      nem no evento (os dois atravessam a rede no online).
 *   4. As linhas que não são jogo vêm marcadas (`system`, `hint`), e turno e
 *      fase também (`turn`, `phase`) — é o que a tela usa para separá-las.
 *
 * Uso: npm run test:duel-log
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  OcgCardHintType,
  OcgLocation,
  OcgMessageType,
  OcgPosition,
  OcgResponseType,
  SelectBattleCMDAction,
  SelectIdleCMDAction,
} from "@n1xx1/ocgcore-wasm";

import { botAutoResponse } from "@/lib/duel/bot-responder";
import { createDuelSession } from "@/lib/duel/duel-session";
import { localizeLogText } from "@/lib/duel/log-names";
import { CardRegistry } from "@/lib/domain/card-registry";
import { nodeAssets } from "@/server/duel/node-assets";

import { REPO } from "./env.mjs";

const C = {
  celtic: 91152256,
  horseman: 68516705, // Mystic Horseman, 1300 — normal, perde para o Elf
  elf: 69140098, // Gemini Elf, 1900
  raigeki: 12580477,
  potOfGreed: 55144522,
  trunade: 42703248,
  trapHole: 4206964,
  ox: 5053103, // Battle Ox, Nível 4 — matéria do Utopia
  utopia: 84013237,
};

const catalog = JSON.parse(readFileSync(join(REPO, ".cache/catalog/catalog.json"), "utf8"));
const registry = CardRegistry.fromCatalog(catalog);
const nomeDe = (code) => registry.get(code)?.name ?? String(code);

const falhas = [];
function conferir(condicao, descricao, detalhe = "") {
  console.log(condicao ? `  ✓ ${descricao}` : `  ✗ ${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  if (!condicao) falhas.push(descricao);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const idle = (action, index = null) => ({ type: OcgResponseType.SELECT_IDLECMD, action, index });

/**
 * Joga com os dois assentos roteirizados. `roteiro[assento]` recebe o prompt
 * de SELECT_IDLECMD e devolve a jogada (ou `null` para encerrar o turno);
 * ataques: o assento 1 ataca com o que puder na Battle Phase.
 */
async function rodar({ scenario, roteiro, turnos = 2 }) {
  const session = createDuelSession();
  let snap = null;
  const eventos = [];
  session.subscribe((s) => {
    snap = s;
  });
  session.subscribeEvents((evento) => eventos.push(evento));
  void session.start({
    playerName: "Ana",
    playerDeck: { main: Array(40).fill(C.celtic), extra: [], side: [] },
    opponentName: "Bruno",
    opponentDeck: { main: Array(40).fill(C.celtic), extra: [], side: [] },
    registry,
    assets: nodeAssets,
    format: "tcg",
    scenario,
    pace: 0,
    seats: [
      { kind: "local", name: "Ana", chainMode: "never" },
      { kind: "local", name: "Bruno", chainMode: "never" },
    ],
  });

  let ultimoId = -1;
  const limite = Date.now() + 90_000;
  while (Date.now() < limite) {
    await sleep(2);
    if (!snap) continue;
    if (snap.error) throw new Error(`sessão falhou: ${snap.error}`);
    if (snap.winner !== null || snap.turnCount > turnos) break;
    const prompt = snap.pendingPrompt;
    if (!prompt || snap.isProcessing || snap.promptId === ultimoId) continue;
    ultimoId = snap.promptId;
    const assento = snap.promptPlayer;

    let resposta;
    if (prompt.type === OcgMessageType.SELECT_IDLECMD) {
      resposta =
        roteiro[assento]?.(prompt, snap) ??
        (assento === 1 && prompt.to_bp ? idle(SelectIdleCMDAction.TO_BP) : idle(SelectIdleCMDAction.TO_EP));
    } else if (prompt.type === OcgMessageType.SELECT_BATTLECMD) {
      resposta =
        assento === 1 && prompt.attacks.length > 0
          ? { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index: 0 }
          : { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.TO_EP, index: null };
    } else {
      resposta = botAutoResponse(prompt);
    }
    await session.respond(resposta, snap.promptId);
  }
  return { snap, eventos };
}

/** Ativa `code` da mão uma vez (e só uma), no turno do assento. */
function ativando(...codes) {
  const feitas = new Set();
  return (prompt) => {
    for (const code of codes) {
      if (feitas.has(code)) continue;
      const i = prompt.activates.findIndex((c) => c.code === code);
      if (i >= 0) {
        feitas.add(code);
        return idle(SelectIdleCMDAction.SELECT_ACTIVATE, i);
      }
    }
    return null;
  };
}

const linhas = (snap) => snap.log.filter((linha) => !linha.kind);

// ---------------------------------------------------------------------------
console.log("\n1. Batalha: o Gemini Elf do oponente ataca o Mystic Horseman");
{
  const { snap, eventos } = await rodar({
    scenario: [
      { player: 0, location: OcgLocation.MZONE, sequence: 2, code: C.horseman },
      { player: 1, location: OcgLocation.MZONE, sequence: 1, code: C.elf },
    ],
    roteiro: {},
  });
  const ataque = linhas(snap).find((linha) => linha.text.startsWith("⚔"));
  conferir(
    ataque?.text === `⚔ Bruno atacou ${nomeDe(C.horseman)} com ${nomeDe(C.elf)}`,
    "o ataque diz quem atacou quem",
    ataque?.text,
  );
  conferir(
    ataque?.codes?.includes(C.elf) && ataque?.codes?.includes(C.horseman) && ataque?.actor === 1,
    "a linha do ataque guarda as duas cartas e quem agiu",
    JSON.stringify(ataque),
  );
  const morte = linhas(snap).find((linha) => linha.text.includes("destruída em batalha"));
  conferir(
    morte?.text === `💥 ${nomeDe(C.horseman)} foi destruída em batalha` && morte.codes?.[0] === C.horseman,
    "a destruição em batalha é narrada, com a carta",
    morte?.text,
  );
  const saida = eventos.find((evento) => evento.kind === "leave");
  conferir(
    saida?.why === "battle" &&
      saida.code === C.horseman &&
      saida.from.controller === 0 &&
      saida.from.location === OcgLocation.MZONE &&
      saida.from.sequence === 2,
    "o evento de saída aponta a zona de onde a carta saiu (para a mesa animar)",
    JSON.stringify(saida),
  );
}

// ---------------------------------------------------------------------------
console.log("\n2. Efeito: Pote da Ganância e Raigeki no meu turno");
{
  const { snap, eventos } = await rodar({
    scenario: [
      { player: 0, location: OcgLocation.HAND, code: C.potOfGreed },
      { player: 0, location: OcgLocation.HAND, code: C.raigeki },
      { player: 1, location: OcgLocation.MZONE, code: C.elf },
    ],
    roteiro: { 0: ativando(C.potOfGreed, C.raigeki) },
    turnos: 1,
  });
  conferir(
    linhas(snap).some((linha) => linha.text === "Ana comprou 2 carta(s)"),
    "a compra por efeito aparece",
    linhas(snap).map((l) => l.text).join(" | "),
  );
  conferir(
    !linhas(snap).some((linha) => /comprou 1 carta/.test(linha.text)),
    "a compra normal da Draw Phase não enche o histórico",
  );
  const destruida = eventos.find((evento) => evento.kind === "leave" && evento.code === C.elf);
  conferir(destruida?.why === "destroy", "Raigeki: destruição por efeito, não de batalha", JSON.stringify(destruida));
  conferir(
    linhas(snap).some((linha) => linha.text === `💥 ${nomeDe(C.elf)} foi destruída` && linha.actor === 1),
    "a linha diz de quem era a carta (pela cor) e que foi destruída",
  );
  conferir(
    linhas(snap).some((linha) => linha.text === `⚰ ${nomeDe(C.raigeki)} foi enviada ao Cemitério`),
    "a Magia que resolveu vai ao Cemitério com nome",
  );
}

// ---------------------------------------------------------------------------
console.log("\n2b. Invocação-Xyz: as matérias não 'vão para o Extra Deck'");
{
  // O binding não marca a matéria com o bit OVERLAY: manda a zona do Xyz e um
  // `overlay_sequence` — e na Invocação-Xyz o Xyz ainda está no Extra Deck.
  // Lido pela localização, o histórico dizia "Battle Ox foi para o Extra Deck".
  const { snap, eventos } = await rodar({
    scenario: [
      { player: 0, location: OcgLocation.MZONE, sequence: 0, code: C.ox },
      { player: 0, location: OcgLocation.MZONE, sequence: 1, code: C.ox },
      { player: 0, location: OcgLocation.EXTRA, code: C.utopia },
    ],
    roteiro: {
      0: (() => {
        let feito = false;
        return (prompt) => {
          if (feito) return null;
          const i = prompt.special_summons.findIndex((c) => c.code === C.utopia);
          if (i < 0) return null;
          feito = true;
          return idle(SelectIdleCMDAction.SELECT_SPECIAL_SUMMON, i);
        };
      })(),
    },
    turnos: 1,
  });
  const materias = linhas(snap).filter((linha) => linha.text === `${nomeDe(C.ox)} foi usada como matéria Xyz`);
  conferir(materias.length === 2, "as duas matérias narradas como matéria Xyz", linhas(snap).map((l) => l.text).join(" | "));
  conferir(
    !linhas(snap).some((linha) => linha.text.includes("Extra Deck")),
    "nenhuma linha diz que a matéria foi para o Extra Deck",
  );
  const saidas = eventos.filter((evento) => evento.kind === "leave" && evento.code === C.ox);
  conferir(
    saidas.length === 2 && saidas.every((evento) => evento.why === "material"),
    "as duas saídas do campo são de matéria",
    JSON.stringify(saidas),
  );
  conferir(
    (snap.boards[0]?.players[0].monsters ?? []).some((card) => card?.code === C.utopia && card.overlays.length === 2),
    "o Utopia está em campo com 2 matérias",
  );
}

// ---------------------------------------------------------------------------
console.log("\n2c. Desanexar matéria não apaga as marcas do monstro Xyz");
{
  // Direto nas mensagens, sem engine: uma marca de turnos no monstro da zona 0
  // e uma matéria saindo de baixo dele. Antes, a matéria "saía" da zona 0 e
  // levava a marca do Xyz junto.
  const marca = {
    type: OcgMessageType.CARD_HINT,
    controller: 0,
    location: OcgLocation.MZONE,
    sequence: 0,
    card_hint: OcgCardHintType.TURN,
    description: 3n,
  };
  const saida = (overlay) => ({
    type: OcgMessageType.MOVE,
    card: C.ox,
    from: {
      controller: 0, location: OcgLocation.MZONE, sequence: 0, position: 1,
      ...(overlay ? { overlay_sequence: 0 } : {}),
    },
    to: { controller: 0, location: OcgLocation.GRAVE, sequence: 0, position: 1 },
  });
  const comMarca = (session) => (session["hintsByZone"]().get(`0:${OcgLocation.MZONE}:0`) ?? []).some((h) => h.kind === "turn");

  const desanexou = createDuelSession();
  desanexou["consumeMessages"]([marca, saida(true)]);
  conferir(comMarca(desanexou), "a marca do Xyz fica depois de desanexar uma matéria");

  const saiu = createDuelSession();
  saiu["consumeMessages"]([marca, saida(false)]);
  conferir(!comMarca(saiu), "e sai quando é o próprio monstro que deixa a zona (controle)");
}

// ---------------------------------------------------------------------------
console.log("\n3. Informação oculta: Giant Trunade devolve a Armadilha baixada do oponente");
{
  const { snap, eventos } = await rodar({
    scenario: [
      { player: 0, location: OcgLocation.HAND, code: C.trunade },
      { player: 1, location: OcgLocation.SZONE, code: C.trapHole, position: OcgPosition.FACEDOWN },
    ],
    roteiro: { 0: ativando(C.trunade) },
    turnos: 1,
  });
  const volta = linhas(snap).find((linha) => linha.text.includes("voltou para a mão"));
  conferir(volta?.text === "↩ Uma carta baixada voltou para a mão", "a carta baixada volta sem nome", volta?.text);
  conferir(!volta?.codes, "e sem código na linha");
  const evento = eventos.find((e) => e.kind === "leave" && e.from.controller === 1);
  conferir(evento?.code === null && evento?.why === "hand", "nem no evento de saída", JSON.stringify(evento));
  const vazou = snap.log.some(
    (linha) =>
      linha.visibleTo === null &&
      (linha.text.includes(nomeDe(C.trapHole)) || linha.codes?.includes(C.trapHole)),
  );
  conferir(!vazou, "o nome da Armadilha não aparece em nenhuma linha pública");

  // 4. As linhas que não são jogo vêm marcadas.
  console.log("\n4. Tipos de linha");
  conferir(
    snap.log.filter((linha) => linha.text.startsWith("Carregando")).every((linha) => linha.kind === "system"),
    "as linhas de carga são 'system'",
  );
  conferir(snap.log.some((linha) => linha.kind === "turn" && linha.text.startsWith("Turno 1")), "turno marcado");
  conferir(snap.log.some((linha) => linha.kind === "phase"), "fase marcada");
  conferir(
    snap.log.filter((linha) => linha.text.startsWith("💬")).every((linha) => linha.kind === "hint"),
    "as dicas de seleção do core são 'hint'",
  );
}

// ---------------------------------------------------------------------------
console.log("\n4b. Nomes no idioma escolhido (PT/EN)");
{
  // O texto sai da sessão em português; a tela troca pelo idioma de quem lê
  // usando os códigos da linha. Para isso funcionar, toda carta citada pelo
  // nome precisa estar nos códigos — e nada além dela.
  const { snap } = await rodar({
    scenario: [
      { player: 0, location: OcgLocation.HAND, code: C.potOfGreed },
      { player: 0, location: OcgLocation.HAND, code: C.raigeki },
      { player: 1, location: OcgLocation.MZONE, code: C.elf },
      { player: 1, location: OcgLocation.MZONE, sequence: 2, code: C.horseman },
    ],
    roteiro: { 0: ativando(C.potOfGreed, C.raigeki) },
    turnos: 1,
  });
  const comCodigo = snap.log.filter((linha) => linha.codes?.length);
  const semNome = comCodigo.filter((linha) => linha.codes.some((code) => !linha.text.includes(nomeDe(code))));
  conferir(comCodigo.length >= 5, `linhas com cartas citadas (${comCodigo.length})`);
  conferir(semNome.length === 0, "todo código da linha está nomeado no texto", JSON.stringify(semNome.slice(0, 2)));
  const conhecidos = [C.potOfGreed, C.raigeki, C.elf, C.horseman];
  const citadoSemCodigo = snap.log.filter((linha) =>
    conhecidos.some((code) => linha.text.includes(nomeDe(code)) && !linha.codes?.includes(code)),
  );
  conferir(citadoSemCodigo.length === 0, "toda carta pública citada pelo nome vem com o código", JSON.stringify(citadoSemCodigo.slice(0, 2)));

  const emIngles = (code) => registry.get(code)?.nameEn ?? registry.get(code)?.name;
  const raigekiPt = nomeDe(C.raigeki);
  const raigekiEn = emIngles(C.raigeki);
  const linha = comCodigo.find((l) => l.codes.includes(C.elf) && l.text.startsWith("💥"));
  const traduzida = linha ? localizeLogText(linha.text, linha.codes, nomeDe, emIngles) : "";
  conferir(
    Boolean(linha) && traduzida.includes(emIngles(C.elf)) && (nomeDe(C.elf) === emIngles(C.elf) || !traduzida.includes(nomeDe(C.elf))),
    `a linha troca o nome para o inglês ("${traduzida}")`,
  );
  conferir(
    localizeLogText("Dark Magician Girl e Dark Magician", [1, 2], (c) => (c === 1 ? "Dark Magician" : "Dark Magician Girl"), (c) => (c === 1 ? "DM" : "DMG")) === "DMG e DM",
    "nome contido em outro (Dark Magician × Dark Magician Girl) não se corrompe",
  );
  conferir(raigekiPt.length > 0 && raigekiEn.length > 0, `nomes do catálogo presentes (${raigekiPt} / ${raigekiEn})`);
}

// ---------------------------------------------------------------------------
console.log("\n5. O bot começa: quem joga senta no assento 1");
{
  // O core sempre dá o primeiro turno ao assento 0. "O bot começa" é o
  // jogador no assento 1 — o deck dele, o cenário escrito como "player 0 =
  // você" e as perguntas, todos no 1. Assentos padrão (sem `seats`): o bot
  // de verdade joga o turno dele.
  const session = createDuelSession();
  let snap = null;
  session.subscribe((s) => {
    snap = s;
  });
  void session.start({
    playerName: "Ana",
    playerDeck: { main: Array(40).fill(C.horseman), extra: [], side: [] },
    opponentName: "Bot",
    opponentDeck: { main: Array(40).fill(C.celtic), extra: [], side: [] },
    registry,
    assets: nodeAssets,
    format: "tcg",
    pace: 0,
    humanSeat: 1,
    openingNote: "🪙 Moeda: o oponente começa",
    scenario: [{ player: 0, location: OcgLocation.HAND, code: C.potOfGreed }],
  });
  const limite = Date.now() + 60_000;
  while (Date.now() < limite && !(snap?.pendingPrompt && snap.promptPlayer === 1 && !snap.isProcessing)) {
    await sleep(5);
    if (snap?.error) throw new Error(snap.error);
  }
  const textos = snap.log.map((linha) => linha.text);
  conferir(textos.some((t) => t === "🪙 Moeda: o oponente começa"), "a linha da moeda entra no histórico");
  conferir(textos.some((t) => t === "Turno 1 — O oponente"), "o turno 1 é do bot", textos.filter((t) => t.startsWith("Turno")).join(" | "));
  conferir(snap.promptPlayer === 1, "a pergunta chega ao assento 1 (quem joga)");
  const minhaMao = snap.boards[1]?.players[1].hand.map((carta) => carta.code) ?? [];
  conferir(
    minhaMao.includes(C.potOfGreed) && minhaMao.every((code) => code === C.potOfGreed || code === C.horseman),
    "a mão do assento 1 é a do deck de quem joga, com a carta do cenário",
    JSON.stringify(minhaMao),
  );
  conferir(snap.boards[0] === null, "o assento do bot não tem tabuleiro lido (ninguém olha)");
  session.surrender(1);
  conferir(snap.winner === 0, "render-se no assento 1 dá a vitória ao bot (assento 0)");
}

console.log(falhas.length === 0 ? "\nOK — histórico e saídas do campo" : `\nFALHOU (${falhas.length}): ${falhas.join("; ")}`);
process.exit(falhas.length === 0 ? 0 : 1);
