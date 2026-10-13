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
  OcgLocation,
  OcgMessageType,
  OcgPosition,
  OcgResponseType,
  SelectBattleCMDAction,
  SelectIdleCMDAction,
} from "@n1xx1/ocgcore-wasm";

import { botAutoResponse } from "@/lib/duel/bot-responder";
import { createDuelSession } from "@/lib/duel/duel-session";
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

console.log(falhas.length === 0 ? "\nOK — histórico e saídas do campo" : `\nFALHOU (${falhas.length}): ${falhas.join("; ")}`);
process.exit(falhas.length === 0 ? 0 : 1);
