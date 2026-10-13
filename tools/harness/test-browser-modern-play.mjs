/**
 * Mecânicas modernas no navegador, só com cliques — o "pronto quando" da Fase 4
 * de `docs/tcg-completo.md`.
 *
 * Um duelo TCG com uma mesa de teste (`scenario`) em que o jogador, clicando
 * como clicaria uma pessoa, faz:
 *
 *  1. Invocação-Sincro (Junk Synchron + Mystical Elf → Black Rose Dragon),
 *     abrindo o Extra Deck que brilha;
 *  2. Invocação-Xyz (2 Touros Guerreiros → Utopia);
 *  3. Invocação-Link (Mystical Elf → Link Spider, que só cabe na Zona Extra);
 *  4. efeito de Cemitério (Glow-Up Bulb volta do Cemitério que brilha);
 *  5. escalas de Pêndulo e Invocação-Pêndulo (Summoned Skull);
 *  6. declaração de nome de arquétipo (Ancient Gear Gadget declara um
 *     "Gadget" — a busca já mostra só os nomes que o filtro do core aceita).
 *
 * Cada passo confere o resultado na mesa e no log. Nenhuma resposta vai ao
 * engine por fora da tela.
 *
 * Uso: APP_URL=http://127.0.0.1:3100 node tools/harness/test-browser-modern-play.mjs [--headed]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { OcgLocation } from "@n1xx1/ocgcore-wasm";

import { launchChrome, openPage } from "./browser.mjs";
import { REPO } from "./env.mjs";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const OUT = join(REPO, ".cache/shots");

const C = {
  ox: 5053103,
  elf: 15025844,
  junk: 63977008,
  blackRose: 73580471,
  utopia: 84013237,
  linkSpider: 98978921,
  bulb: 67441435,
  oddEyes: 16178681,
  // Escala 8 sem condição de ativação. (O Timegazer Magician não serve aqui:
  // "você não pode controlar monstros para ativar este card" — o engine estava
  // certo em não oferecer.)
  dragonpit: 51531505,
  skull: 70781052,
  gadget: 18486927,
};

const M = OcgLocation.MZONE;
const SCENARIO = [
  { player: 0, location: M, sequence: 0, code: C.junk },
  { player: 0, location: M, sequence: 1, code: C.elf },
  { player: 0, location: M, sequence: 2, code: C.ox },
  { player: 0, location: M, sequence: 3, code: C.ox },
  { player: 0, location: M, sequence: 4, code: C.elf },
  { player: 0, location: OcgLocation.EXTRA, code: C.blackRose },
  { player: 0, location: OcgLocation.EXTRA, code: C.utopia },
  { player: 0, location: OcgLocation.EXTRA, code: C.linkSpider },
  { player: 0, location: OcgLocation.GRAVE, code: C.bulb },
  { player: 0, location: OcgLocation.HAND, code: C.oddEyes },
  { player: 0, location: OcgLocation.HAND, code: C.dragonpit },
  { player: 0, location: OcgLocation.HAND, code: C.skull },
  { player: 0, location: OcgLocation.HAND, code: C.gadget },
];

const setup = {
  playerName: "Testador",
  playerDeck: { main: Array(40).fill(C.ox), extra: [], side: [] },
  opponentId: "teste",
  opponentName: "Oponente",
  opponentDeck: { main: Array(40).fill(C.ox), extra: [], side: [] },
  format: "tcg",
  scenario: SCENARIO,
};

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

/** Tudo o que a tela oferece agora, para decidir o próximo clique. */
const LER = `
  const visivel = (el) => el && el.offsetParent !== null;
  const botoes = [...document.querySelectorAll("button")].filter((b) => visivel(b) && !b.disabled).map((b) => b.innerText.trim()).filter(Boolean);
  const zona = (k) => document.querySelector('[data-zone="' + k + '"]');
  const nomeEm = (k) => zona(k)?.querySelector("img")?.alt ?? null;
  const campo = {};
  for (const k of ["0:4:0","0:4:1","0:4:2","0:4:3","0:4:4","0:4:5","0:4:6","0:8:0","0:8:4"]) campo[k] = nomeEm(k);
  return {
    botoes,
    campo,
    processando: Boolean(document.querySelector(".tf-playmat")?.innerText.includes("Aguardando")),
    pilhasAcesas: [...document.querySelectorAll("[data-pile][data-actionable], [title*='há jogadas aqui']")].map((el) => el.getAttribute("title")),
    log: [...document.querySelectorAll("aside p")].map((p) => p.innerText).slice(-12),
  };
`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  const { child, port } = await launchChrome({ headless: !process.argv.includes("--headed") });
  const page = await openPage(port);

  const ler = () => page.evaluate(LER);
  let foto = 0;
  const fotografar = async (nome) => {
    foto += 1;
    writeFileSync(join(OUT, `jogo-${String(foto).padStart(2, "0")}-${nome}.png`), Buffer.from((await page.screenshot()).data, "base64"));
  };

  /** Clica no primeiro botão visível cujo texto contém `texto`. */
  const botao = (texto) => page.clickText(texto);
  /**
   * Clica numa zona da mesa — esperando ela virar escolhível (`tf-slot-place`)
   * quando a pergunta é "onde colocar". Um tempo fixo não serve: a ativação
   * fica em destaque no centro (~1 s, `ChainSpotlight`) antes de o efeito
   * resolver e perguntar a zona, e o clique adiantado caía no vazio. Se a
   * zona nunca acende (o clique é para abrir o menu da carta, não para
   * escolher lugar), clica do mesmo jeito depois de esperar.
   */
  const zona = async (key) => {
    for (let i = 0; i < 25; i += 1) {
      const pronta = await page.evaluate(`return Boolean(document.querySelector('[data-zone="${key}"] .tf-slot-place'));`);
      if (pronta) break;
      await sleep(200);
    }
    return page.evaluate(`const el = document.querySelector('[data-zone="${key}"] [role="button"]'); if (!el) return false; el.click(); return true;`);
  };
  /** Clica numa carta da mão pelo nome (alt da imagem). */
  const naMao = (regex) =>
    page.evaluate(`
      const slot = [...document.querySelectorAll('[data-zone^="0:2:"]')].find((el) => ${regex}.test(el.querySelector("img")?.alt ?? ""));
      const alvo = slot?.querySelector('[role="button"]');
      if (!alvo) return false;
      alvo.click();
      return true;
    `);
  /** Abre uma pilha minha pelo rótulo e clica na carta jogável pelo nome. */
  const daPilha = async (rotulo, regex) => {
    const abriu = await page.evaluate(`
      const pilha = [...document.querySelectorAll("[data-pile], [role=button]")].find((el) => (el.getAttribute("title") ?? "").startsWith(${JSON.stringify(rotulo)}) && (el.getAttribute("title") ?? "").includes("há jogadas"));
      if (!pilha) return false;
      pilha.click();
      return true;
    `);
    if (!abriu) return false;
    await sleep(300);
    return page.evaluate(`
      const carta = [...document.querySelectorAll("[data-pile-card][data-actionable]")].find((el) => ${regex}.test(el.querySelector("img")?.alt ?? ""));
      if (!carta) return false;
      carta.click();
      return true;
    `);
  };
  /**
   * Marca uma carta (seleção na mesa) pelo nome, em qualquer zona minha —
   * pulando as já escolhidas (anel verde), como uma pessoa faria.
   */
  const marcar = (regex) =>
    page.evaluate(`
      const slot = [...document.querySelectorAll('[data-zone^="0:4:"], [data-zone^="0:2:"]')].find((el) => ${regex}.test(el.querySelector("img")?.alt ?? "") && el.querySelector(".tf-slot-active") && !el.querySelector(".ring-emerald-400"));
      const alvo = slot?.querySelector('[role="button"]');
      if (!alvo) return false;
      alvo.click();
      return true;
    `);

  /**
   * Responde, pela tela, tudo o que aparecer até `pronto()` dar verdadeiro:
   * posição (ataque), "deseja responder?" (não), "ativar o efeito?" (conforme
   * `efeitos`), e confirmações de seleção.
   */
  async function resolver(pronto, { efeitos = "Não", limite = 60 } = {}) {
    for (let i = 0; i < limite; i += 1) {
      await sleep(350);
      const tela = await ler();
      // Pronto E de volta à Main Phase (o "EP" só acende no comando livre):
      // o gatilho do monstro que acabou de descer ainda pergunta algo.
      if (tela.botoes.includes("EP") && (await pronto())) return true;
      if (tela.botoes.includes("Ataque (face p/ cima)")) await botao("Ataque (face p/ cima)");
      else if (tela.botoes.some((b) => b === "Não responder")) await botao("Não responder");
      else if (tela.botoes.includes("Sim") && tela.botoes.includes("Não")) await botao(efeitos);
      else if (tela.botoes.includes("Concluir")) await botao("Concluir");
    }
    return pronto();
  }

  /** Seleção de materiais, uma carta por vez (SELECT_UNSELECT_CARD), na mesa. */
  async function materiais(nomes) {
    for (const nome of nomes) {
      for (let i = 0; i < 20; i += 1) {
        await sleep(300);
        if (await marcar(nome)) break;
      }
      await sleep(250);
      await botao("Confirmar");
    }
  }

  try {
    await page.setViewport(1440, 900);
    await page.goto(`${BASE}/duel`);
    // Cartas em inglês (preferência do jogador): os nomes viram âncoras
    // estáveis para os cliques — "Gadget" é "Gadget", e não a tradução.
    await page.evaluate(
      `localStorage.setItem("yugioh-goat-language-v1", "en");
       localStorage.setItem("yugioh-goat-profile-v1", ${JSON.stringify(
        JSON.stringify({ id: "harnessmodernplay", name: "Testador" }),
      )});
       sessionStorage.setItem("yugioh-goat-duel-setup-v1", ${JSON.stringify(JSON.stringify(setup))});
       return true;`,
    );
    await page.goto(`${BASE}/duel/play`);
    for (let i = 0; i < 80; i += 1) {
      await sleep(500);
      const tela = await ler().catch(() => null);
      if (tela?.pilhasAcesas?.length) break;
    }
    await sleep(800);
    await fotografar("inicio");

    // ---- 1. Sincro -------------------------------------------------------
    console.log("1. Invocação-Sincro pelo Extra Deck");
    let tela = await ler();
    conferir(tela.pilhasAcesas.some((t) => t?.startsWith("Extra")), "o Extra Deck brilha (há Invocação-Especial ali)", JSON.stringify(tela.pilhasAcesas));
    conferir(await daPilha("Extra", /Black Rose/), "abre o Extra Deck e escolhe o Black Rose Dragon");
    await sleep(300);
    await botao("Invocação-Especial");
    await materiais([/Junk Synchron/, /Mystical Elf/]);
    await sleep(500);
    await zona("0:4:0");
    const sincro = await resolver(async () => /Black Rose/.test((await ler()).campo["0:4:0"] ?? ""));
    conferir(sincro, "o Black Rose Dragon está na zona 1");
    await fotografar("sincro");

    // ---- 2. Xyz ----------------------------------------------------------
    console.log("2. Invocação-Xyz");
    await sleep(400);
    conferir(await daPilha("Extra", /Utopia/), "escolhe o Utopia no Extra Deck");
    await sleep(300);
    await botao("Invocação-Especial");
    await materiais([/Battle Ox/, /Battle Ox/]);
    await sleep(500);
    await zona("0:4:2");
    const xyz = await resolver(async () => /Utopia/.test((await ler()).campo["0:4:2"] ?? ""));
    conferir(xyz, "o Utopia está na zona 3");
    const materiaisXyz = await page.evaluate(`return document.querySelector('[data-zone="0:4:2"] button[title*="material"]')?.innerText ?? "";`);
    conferir(/◈2/.test(materiaisXyz), "e mostra 2 materiais", materiaisXyz);
    await fotografar("xyz");

    // ---- 3. Link ---------------------------------------------------------
    console.log("3. Invocação-Link (Zona Extra)");
    await sleep(400);
    conferir(await daPilha("Extra", /Link Spider/), "escolhe o Link Spider");
    await sleep(300);
    await botao("Invocação-Especial");
    await materiais([/Mystical Elf/]);
    await sleep(500);
    // A Zona Extra é a única opção: a tela responde sozinha ou a destaca.
    await zona("0:4:5");
    const link = await resolver(async () => /Link Spider/.test((await ler()).campo["0:4:5"] ?? ""));
    conferir(link, "o Link Spider está na Zona Extra");
    await fotografar("link");

    // ---- 4. Cemitério ----------------------------------------------------
    console.log("4. Efeito de Cemitério");
    await sleep(400);
    tela = await ler();
    conferir(tela.pilhasAcesas.some((t) => t?.startsWith("Cemit")), "o Cemitério brilha (Glow-Up Bulb pode voltar)", JSON.stringify(tela.pilhasAcesas));
    conferir(await daPilha("Cemit", /Glow-Up Bulb/), "escolhe o Glow-Up Bulb no Cemitério");
    await sleep(300);
    await botao("Ativar");
    await sleep(600);
    await zona("0:4:1");
    const bulbo = await resolver(async () => {
      const campo = (await ler()).campo;
      return Object.values(campo).some((nome) => /Glow-Up Bulb/.test(nome ?? ""));
    });
    conferir(bulbo, "o Glow-Up Bulb voltou do Cemitério para o campo");
    await fotografar("cemiterio");

    // ---- 5. Pêndulo ------------------------------------------------------
    console.log("5. Escalas e Invocação-Pêndulo");
    await sleep(400);
    const clicouOdd = await naMao(/Odd-Eyes/);
    await sleep(250);
    if (process.env.DEBUG_PLAY) {
      console.log("  [debug] odd-eyes:", clicouOdd, await page.evaluate(`return [...document.querySelectorAll(".tf-anim-menu-in button")].map((b) => b.innerText)`));
    }
    await botao("Ativar");
    await sleep(500);
    await zona("0:8:0");
    await resolver(async () => /Odd-Eyes/.test((await ler()).campo["0:8:0"] ?? ""));
    const clicouTime = await naMao(/Dragonpit/);
    await sleep(250);
    if (process.env.DEBUG_PLAY) {
      console.log("  [debug] dragonpit:", clicouTime, await page.evaluate(`return [...document.querySelectorAll(".tf-anim-menu-in button")].map((b) => b.innerText)`), (await ler()).botoes);
    }
    await botao("Ativar");
    const escalas = await resolver(async () => {
      const campo = (await ler()).campo;
      return Boolean(campo["0:8:0"]) && Boolean(campo["0:8:4"]);
    });
    conferir(escalas, "as duas escalas estão armadas (zonas 1 e 5)");
    // A Invocação-Pêndulo é oferecida pela escala.
    await zona("0:8:0");
    await sleep(300);
    await botao("Invocação-Especial");
    await materiais([/Summoned Skull/]);
    await sleep(300);
    await botao("Concluir");
    await sleep(500);
    await zona("0:4:3");
    const pendulo = await resolver(async () => {
      const campo = (await ler()).campo;
      return Object.values(campo).some((nome) => /Summoned Skull/.test(nome ?? ""));
    });
    conferir(pendulo, "o Summoned Skull desceu por Invocação-Pêndulo");
    await fotografar("pendulo");

    // ---- 6. Declaração de arquétipo -------------------------------------
    console.log("6. Declarar um nome de arquétipo");
    await sleep(400);
    await naMao(/Gadget/);
    await sleep(250);
    await botao("Invocar");
    await sleep(500);
    await zona("0:4:4");
    // O gatilho de Invocação declara um TIPO de carta (Monstro/Magia/
    // Armadilha) — uma escolha de efeito; o NOME de um "Gadget" é o efeito de
    // Ignição, ativado depois clicando no monstro.
    const tipo = await resolver(
      async () => /Gadget/.test((await ler()).campo["0:4:4"] ?? ""),
      { efeitos: "Sim" },
    );
    for (let i = 0; i < 10; i += 1) {
      if (await botao("Cartas de Monstro")) break;
      await sleep(300);
    }
    await resolver(async () => true);
    conferir(tipo, "o Ancient Gear Gadget desceu e declarou o tipo");
    await zona("0:4:4");
    await sleep(300);
    await botao("Ativar");
    let modal = false;
    for (let i = 0; i < 30 && !modal; i += 1) {
      await sleep(350);
      const t = await ler();
      if (t.botoes.includes("Não responder")) await botao("Não responder");
      modal = await page.evaluate(`return document.body.innerText.includes("Declare o nome de uma carta");`);
    }
    conferir(modal, "o modal de declarar nome abriu");
    await sleep(600);
    const ofertas = await page.evaluate(`
      return [...document.querySelectorAll(".tf-modal button[title]")].map((b) => b.getAttribute("title"));
    `);
    conferir(
      ofertas.length > 0 && ofertas.every((nome) => /Gadget/i.test(nome)),
      "a busca já mostra só nomes 'Gadget' (o filtro do core)",
      JSON.stringify(ofertas.slice(0, 8)),
    );
    await fotografar("declarar");
    await page.evaluate(`document.querySelector(".tf-modal button[title]")?.click(); return true;`);
    await sleep(200);
    await botao("Declarar");
    const declarou = await resolver(async () =>
      page.evaluate(`return !document.body.innerText.includes("Declare o nome de uma carta");`),
    );
    conferir(declarou, "a declaração foi aceita pelo engine (sem 'tente novamente')");
    tela = await ler();
    conferir(!tela.log.some((linha) => linha.includes("Resposta inválida")), "nenhuma resposta inválida no log", tela.log.join(" | "));
    await fotografar("fim");

    conferir(page.errors.length === 0, "sem exceções na página", page.errors.join(" | "));
  } finally {
    child.kill();
  }

  if (falhas.length) {
    console.log(`\n${falhas.length} falha(s).`);
    process.exitCode = 1;
  } else {
    console.log(`\nMecânicas modernas só com cliques: tudo certo. Fotos em ${OUT}`);
  }
}

await main();
