/**
 * Efeitos de gatilho pela tela: nenhum se perde sozinho, e nenhum se recusa
 * sem o botão.
 *
 * O caso que motivou: Invocação-Link da Crystron Halqifibrax usando o Swap
 * Cleric de matéria. Os dois efeitos são acionados juntos; o core pergunta
 * qual entra primeiro na corrente e, com esse já como Elo 1, pergunta pelo
 * outro. Essa segunda pergunta era respondida "não" sozinha pelo modo
 * Automático (o elo de cima era meu — a regra de não encadear no próprio
 * efeito) e o efeito sumia sem a tela mostrar nada. Ver `isTriggerWindow` em
 * `chain-mode.ts`.
 *
 * Confere, no modo Automático (o padrão):
 *
 * 1. a primeira janela lista os dois gatilhos e fala de gatilho, não de
 *    "responder", com "Não ativar";
 * 2. clicar fora do painel (mesa vazia dos dois lados, mão, leitura da carta,
 *    margem da direita) não dispensa nem recusa nada — a decisão continua;
 * 3. ativado um, o outro é perguntado com o primeiro anunciado, e os dois
 *    entram na corrente (a pilha mostra 2 elos) e o Swap Cleric compra;
 * 4. com um gatilho só (Guardião Celta no lugar do Swap Cleric), o "Ativar o
 *    efeito desta carta?" também sobrevive aos cliques fora e só some no "Não".
 *
 * Fotos em `.cache/shots/gatilho-*.png`.
 *
 * Uso: APP_URL=http://127.0.0.1:3000 npm run test:browser-triggers [-- --headed]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { OcgLocation } from "@n1xx1/ocgcore-wasm";

import { launchChrome, openPage } from "./browser.mjs";
import { REPO } from "./env.mjs";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const OUT = join(REPO, ".cache/shots");

const C = {
  celtic: 91152256,
  halqi: 50588353, // Link-2: gatilho ao ser Invocada por Link
  cleric: 30968774, // gatilho ao ir para o Cemitério como matéria de Link
  ash: 14558127, // a Regulador que a Halqifibrax pede, e o alvo do efeito dela
};

/** A mesa: as duas matérias em campo e a Halqifibrax no Extra Deck. */
function setupCom(materia) {
  return {
    playerName: "Testador",
    playerDeck: { main: [...Array(37).fill(C.celtic), C.ash, C.ash, C.ash], extra: [], side: [] },
    opponentId: "teste",
    opponentName: "Oponente",
    opponentDeck: { main: Array(40).fill(C.celtic), extra: [], side: [] },
    format: "tcg",
    scenario: [
      { player: 0, location: OcgLocation.MZONE, sequence: 0, code: materia },
      { player: 0, location: OcgLocation.MZONE, sequence: 1, code: C.ash },
      { player: 0, location: OcgLocation.EXTRA, code: C.halqi },
    ],
  };
}

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

/** O que está pendurado agora: o painel da corrente e/ou um diálogo. */
const LER = `
  const visivel = (el) => el && el.offsetParent !== null;
  const painel = document.querySelector("[data-chain-response]");
  const dialogo = [...document.querySelectorAll("[role=dialog]")].find((d) => visivel(d) && d.innerText.includes("Ativar o efeito desta carta?"));
  return {
    painel: visivel(painel) ? painel.innerText : null,
    cartasNoPainel: [...document.querySelectorAll("[data-chain-card] img")].map((img) => img.alt),
    dialogo: dialogo ? dialogo.innerText : null,
    botoes: [...document.querySelectorAll("button")].filter((b) => visivel(b) && !b.disabled).map((b) => b.innerText.trim()).filter(Boolean),
    elos: Number(document.querySelector("[data-chain-stack]")?.dataset.chainStack ?? 0),
    mao: document.querySelectorAll('[data-zone^="0:2:"]').length,
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
    writeFileSync(
      join(OUT, `gatilho-${String(foto).padStart(2, "0")}-${nome}.png`),
      Buffer.from((await page.screenshot()).data, "base64"),
    );
  };

  /** Um clique de mouse de verdade (o mesmo caminho de um dedo ou do mouse). */
  const clicarEm = async ([x, y]) => {
    for (const type of ["mousePressed", "mouseReleased"]) {
      await page.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
    }
  };
  const centroDe = (seletor) =>
    page.evaluate(`
      const r = document.querySelector(${JSON.stringify(seletor)})?.getBoundingClientRect();
      return r ? [r.x + r.width / 2, r.y + r.height / 2] : null;
    `);
  /**
   * O que está sob o ponto, quando é parte da decisão ou um controle: um
   * clique ali não é "fora" (a seta do painel, por exemplo, fica sobre a zona
   * 4 do campo, e esconder o painel é o "ver a mesa", de propósito).
   */
  const naoEhFora = ([x, y]) =>
    page.evaluate(`
      const el = document.elementFromPoint(${x}, ${y});
      const dentro = el?.closest("[data-chain-response], [data-decision-dialog], [role=dialog], button, a, [data-table-control], [data-peek]");
      return dentro ? (dentro.getAttribute("aria-label") || dentro.tagName + "." + (dentro.className || "").toString().slice(0, 40)) : null;
    `);

  /**
   * Ativa pela faixa do painel: um clique escolhe, o segundo na escolhida
   * ativa (o duplo clique do MD) — com uma pausa, porque o segundo só vale
   * depois de a escolha ter sido desenhada.
   */
  const ativarDaFaixa = async (regex) => {
    const clicar = () =>
      page.evaluate(`
        const tile = [...document.querySelectorAll("[data-chain-card]")].find((el) => ${regex}.test(el.querySelector("img")?.alt ?? ""));
        tile?.click();
        return Boolean(tile);`);
    await clicar();
    await sleep(250);
    await clicar();
  };

  /** Espera `cond(tela)`; devolve a última tela lida. */
  const esperar = async (cond, limite = 40) => {
    let tela = null;
    for (let i = 0; i < limite; i += 1) {
      tela = await ler();
      if (cond(tela)) return tela;
      await sleep(250);
    }
    return tela;
  };

  /** Abre a mesa, invoca a Halqifibrax pelo Extra Deck e marca as matérias. */
  async function invocarHalqi(materia, nomeMateria) {
    await page.goto(`${BASE}/duel`);
    // Cartas em inglês: os nomes viram âncoras estáveis para os cliques.
    await page.evaluate(
      `localStorage.setItem("yugioh-goat-language-v1", "en");
       localStorage.setItem("yugioh-goat-profile-v1", ${JSON.stringify(
        JSON.stringify({ id: "harnessgatilhos", name: "Testador" }),
      )});
       sessionStorage.setItem("yugioh-goat-duel-setup-v1", ${JSON.stringify(JSON.stringify(setupCom(materia)))});
       return true;`,
    );
    await page.goto(`${BASE}/duel/play`);
    for (let i = 0; i < 80; i += 1) {
      await sleep(500);
      const pronto = await page
        .evaluate(`return Boolean(document.querySelector("[data-pile][data-actionable], [title*='há jogadas aqui']"));`)
        .catch(() => false);
      if (pronto) break;
    }
    await sleep(800);
    await page.evaluate(`
      const pilha = [...document.querySelectorAll("[data-pile], [role=button]")].find((el) => (el.getAttribute("title") ?? "").startsWith("Extra") && (el.getAttribute("title") ?? "").includes("há jogadas"));
      pilha?.click();
      return true;`);
    await sleep(400);
    await page.evaluate(
      `[...document.querySelectorAll("[data-pile-card][data-actionable]")].find((el) => /Halqifibrax/.test(el.querySelector("img")?.alt ?? ""))?.click(); return true;`,
    );
    await sleep(300);
    await page.clickText("Invocação-Especial");
    for (const nome of [nomeMateria, /Ash Blossom/]) {
      for (let i = 0; i < 20; i += 1) {
        await sleep(300);
        const marcou = await page.evaluate(`
          const slot = [...document.querySelectorAll('[data-zone^="0:4:"]')].find((el) => ${nome}.test(el.querySelector("img")?.alt ?? "") && el.querySelector(".tf-slot-active") && !el.querySelector(".tf-slot-picked"));
          const alvo = slot?.querySelector('[role="button"]');
          if (!alvo) return false;
          alvo.click();
          return true;`);
        if (marcou) break;
      }
      await sleep(250);
    }
    // A Zona Extra: a tela responde sozinha ou a destaca.
    await sleep(600);
    await page.evaluate(`document.querySelector('[data-zone="0:4:5"] [role="button"]')?.click(); return true;`);
  }

  /**
   * Clica em vários pontos fora da decisão e confere, depois de cada um, que
   * ela continua pendurada (`pendente(tela)`).
   */
  async function clicarFora(rotulo, pendente) {
    const pontos = {
      "mesa vazia do oponente": await centroDe('[data-zone="1:4:2"]'),
      "zona vazia minha": await centroDe('[data-zone="0:4:0"]'),
      "carta da mão": await centroDe('[data-zone="0:2:0"]'),
      "leitura da carta (esquerda)": [150, 480],
      "margem da direita": [1330, 620],
    };
    const sumiu = [];
    const clicados = [];
    for (const [nome, ponto] of Object.entries(pontos)) {
      // Ponto coberto pela própria decisão (a mão, sob o painel de um gatilho
      // só) não é "fora": fica de fora da conta.
      if (!ponto || (await naoEhFora(ponto))) continue;
      clicados.push(nome);
      await clicarEm(ponto);
      await sleep(450);
      if (!pendente(await ler())) sumiu.push(nome);
    }
    conferir(
      clicados.length >= 3 && sumiu.length === 0,
      `${rotulo}: clicar fora não dispensa a decisão (${clicados.join(", ")})`,
      sumiu.length ? `sumiu em: ${sumiu.join(", ")}` : `só ${clicados.length} ponto(s) fora do painel`,
    );
  }

  try {
    await page.setViewport(1440, 900);

    // ---- 1–3. Dois gatilhos juntos -------------------------------------
    console.log("1. Halqifibrax com o Swap Cleric: os dois gatilhos");
    await invocarHalqi(C.cleric, /Swap Cleric/);
    let tela = await esperar((t) => t.cartasNoPainel.length >= 2);
    await fotografar("dois-gatilhos");
    conferir(
      tela.cartasNoPainel.some((n) => /Halqifibrax/.test(n)) && tela.cartasNoPainel.some((n) => /Swap Cleric/.test(n)),
      "a primeira janela lista os dois gatilhos",
      JSON.stringify(tela.cartasNoPainel),
    );
    conferir(/gatilho/i.test(tela.painel ?? "") && !/responder com algum efeito/.test(tela.painel ?? ""), "o painel fala de gatilho, não de responder", tela.painel ?? "");
    conferir(tela.botoes.includes("Não ativar"), "e oferece \"Não ativar\"", JSON.stringify(tela.botoes));

    await clicarFora("1ª janela", (t) => t.cartasNoPainel.length >= 2);
    // O clique na mão pode ter deixado o menu daquela carta aberto; o Esc
    // fecha o menu primeiro (a janela da corrente não é escondida por ele).
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await sleep(300);

    // Ativa a Halqifibrax pela faixa (clicar duas vezes = ativar, como no MD).
    const maoAntes = (await ler()).mao;
    await ativarDaFaixa(/Halqifibrax/);
    tela = await esperar((t) => t.cartasNoPainel.length === 1 && /Swap Cleric/.test(t.cartasNoPainel[0]));
    await fotografar("segundo-gatilho");
    conferir(
      tela.cartasNoPainel.length === 1 && /Swap Cleric/.test(tela.cartasNoPainel[0]),
      "com a Halqifibrax na corrente, o Swap Cleric é perguntado (antes: sumia)",
      JSON.stringify(tela),
    );
    conferir(/Halqifibrax/.test(tela.painel ?? "") && /nesta corrente/.test(tela.painel ?? ""), "o painel anuncia o Elo 1 e oferece a mesma corrente", tela.painel ?? "");
    await clicarFora("2ª janela", (t) => t.cartasNoPainel.length === 1);

    let maxElos = 0;
    await ativarDaFaixa(/Swap Cleric/);
    tela = await esperar((t) => {
      maxElos = Math.max(maxElos, t.elos);
      return t.mao > maoAntes;
    }, 60);
    await fotografar("dois-elos");
    conferir(maxElos >= 2, `os dois efeitos entram na corrente (pilha com ${maxElos} elos)`);
    conferir(tela.mao > maoAntes, `o Swap Cleric resolve e compra (mão ${maoAntes} → ${tela.mao})`);

    // ---- 4. Um gatilho só: "Ativar o efeito desta carta?" ------------------
    console.log("2. Um gatilho só: o \"Ativar o efeito desta carta?\"");
    await invocarHalqi(C.celtic, /Celtic Guardian/);
    tela = await esperar((t) => t.dialogo !== null);
    await fotografar("um-gatilho");
    conferir(tela.dialogo !== null && /Halqifibrax/.test(tela.dialogo), "a pergunta do gatilho aparece com a carta", JSON.stringify(tela.dialogo));
    await clicarFora("Ativar o efeito?", (t) => t.dialogo !== null);
    await page.evaluate(`
      const dialogo = [...document.querySelectorAll("[role=dialog]")].find((d) => d.innerText.includes("Ativar o efeito desta carta?"));
      [...(dialogo?.querySelectorAll("button") ?? [])].find((b) => b.innerText.trim() === "Não")?.click();
      return true;`);
    tela = await esperar((t) => t.dialogo === null, 20);
    conferir(tela.dialogo === null, "só o \"Não\" dispensa a pergunta");
  } finally {
    page.close();
    child.kill();
  }

  console.log(falhas.length === 0 ? "\nOK — gatilhos pela tela" : `\nFALHOU (${falhas.length}): ${falhas.join("; ")}`);
  process.exit(falhas.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
