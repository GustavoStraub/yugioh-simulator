/**
 * Confere, no navegador, que dá para desistir de uma Invocação-Tributo.
 *
 * O `test-cancel.mjs` prova que o CORE aceita a desistência; este prova que o
 * jogador consegue chegar nela — que o botão aparece na barra de seleção, que
 * clicar nele devolve o turno e que os tributos continuam em campo. São duas
 * afirmações diferentes: o engine pode aceitar um cancelamento que a tela
 * nunca oferece.
 *
 * O deck é montado só com monstros de nível 5–6 e alguns de nível 4, para a
 * Invocação-Tributo acontecer nos primeiros turnos em vez de depender de sorte.
 *
 * Uso: APP_URL=http://127.0.0.1:3100 node tools/harness/test-browser-cancel.mjs
 */
import { launchChrome, openPage } from "./browser.mjs";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const DECK_KEY = "yugioh-goat-deck-v1";

/** Nível 5–6 (precisam de 1 tributo) e nível 4 (o tributo em si). */
const TRIBUTO = [48202661, 67371383, 14015067, 48365709];
const BAIXOS = [23771716, 49881766, 15480588, 20277860];

function deck() {
  const main = [];
  for (const code of TRIBUTO) for (let i = 0; i < 3; i += 1) main.push(code);
  for (const code of BAIXOS) for (let i = 0; i < 3; i += 1) main.push(code);
  while (main.length < 40) main.push(BAIXOS[main.length % BAIXOS.length]);

  const contagem = new Map();
  for (const code of main.slice(0, 40)) contagem.set(code, (contagem.get(code) ?? 0) + 1);
  return {
    id: "cancel", name: "Cancel", format: "goat",
    main: [...contagem].map(([passcode, quantity]) => ({ passcode, quantity })),
    extra: [], side: [], updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const LER = `
  const mesa = document.querySelector(".tf-playmat") ?? document.body;
  const util = (b) => !b.disabled && b.offsetParent !== null && !b.innerText.includes("\\u{1F50A}");
  return {
    texto: mesa.innerText,
    botoes: [...document.querySelectorAll("button")].filter(util).map((b) => b.innerText.trim()).filter(Boolean),
    cartas: document.querySelectorAll(".tf-slot-active").length,
    monstrosEmCampo: document.querySelectorAll("[data-zone^='0:4:'] img").length,
    // Na BARRA de seleção, não na mesa inteira: o histórico também fala de
    // tributo (a dica "Selecione os monstros para a Invocação-Tributo" fica no
    // log), e procurar no texto todo achava um prompt que já tinha passado.
    pedindoTributo: [...document.querySelectorAll(".tf-panel.rounded-full")].some((el) => /tributo/i.test(el.innerText)),
  };
`;

async function main() {
  const { child, port } = await launchChrome({ headless: !process.argv.includes("--headed") });
  try {
    const page = await openPage(port);
    await page.goto(`${BASE}/duel`);
    // O perfil vem ANTES do deck: sem nome, a portaria (`PlayerProvider`)
    // segura a aplicação na pergunta "como você quer ser chamado?" e o botão
    // de iniciar nem aparece.
    await page.evaluate(
      `localStorage.setItem("yugioh-goat-profile-v1", ${JSON.stringify(
        JSON.stringify({ id: "harnessbrowserca", name: "Testador" }),
      )});
       localStorage.setItem(${JSON.stringify(DECK_KEY)}, ${JSON.stringify(JSON.stringify(deck()))}); return true;`,
    );
    await page.goto(`${BASE}/duel`);
    for (let i = 0; i < 60; i += 1) {
      const t = await page.evaluate("return document.body.innerText");
      if (!t.includes("Carregando catálogo")) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    // Espera o botão existir: o catálogo (TCG inteiro) e a biblioteca de decks
    // carregam antes, e clicar cedo demais não acha nada.
    await page.waitForText("Iniciar duelo", { timeout: 60000 }).catch(() => {});
    if (!(await page.clickText("Iniciar duelo"))) throw new Error("não iniciou o duelo");

    let viuPromptDeTributo = false;
    let viuBotaoCancelar = false;
    let cancelou = false;
    let monstrosAntes = 0;
    let monstrosDepois = -1;
    const prazo = Date.now() + 1000 * 200;

    while (Date.now() < prazo && !cancelou) {
      const e = await page.evaluate(LER);

      if (e.pedindoTributo) {
        viuPromptDeTributo = true;
        const cancelar = e.botoes.find((b) => b.startsWith("Cancelar"));
        viuBotaoCancelar = Boolean(cancelar);
        if (cancelar) {
          monstrosAntes = e.monstrosEmCampo;
          await page.clickText(cancelar);
          await new Promise((r) => setTimeout(r, 700));
          const depois = await page.evaluate(LER);
          monstrosDepois = depois.monstrosEmCampo;
          // Voltou ao Main Phase e o tributo continua lá? Então desistiu mesmo.
          cancelou = !depois.pedindoTributo;
        }
        continue;
      }

      // Percorre as cartas acionáveis da MÃO em ordem, procurando uma que
      // ofereça "Invocar". Escolher ao acaso fazia o teste invocar sempre um
      // nível 4 e nunca chegar ao tributo.
      if (e.cartas > 0) {
        const total = await page.evaluate(
          `return document.querySelectorAll("[data-hand='0'] .tf-slot-active").length`,
        );
        let agiu = false;
        for (let i = 0; i < total && !agiu; i += 1) {
          await page.evaluate(`
            const c = document.querySelectorAll("[data-hand='0'] .tf-slot-active");
            if (c[${i}]) c[${i}].click();
            return true;
          `);
          await new Promise((r) => setTimeout(r, 160));
          const depois = await page.evaluate(LER);
          const invocar = depois.botoes.find((b) => b.startsWith("Invocar"));
          if (invocar) {
            await page.clickText(invocar);
            agiu = true;
          }
        }
        if (!agiu) {
          // Nenhuma invocação possível: age no tabuleiro ou passa a fase.
          await page.evaluate(`const c=[...document.querySelectorAll(".tf-slot-active")]; if(c.length) c[0].click(); return true;`);
          await new Promise((r) => setTimeout(r, 160));
          const depois = await page.evaluate(LER);
          const acao = depois.botoes.find((b) => /^(Baixar|Ativar|Confirmar)/.test(b));
          if (acao) await page.clickText(acao);
          else {
            const passar = e.botoes.find((b) => b.includes("Encerrar turno")) ?? e.botoes.find((b) => b === "EP");
            if (passar) await page.clickText(passar);
          }
        }
      } else {
        const acao =
          e.botoes.find((b) => b.includes("Encerrar turno")) ??
          e.botoes.find((b) => b === "EP") ?? e.botoes[0];
        if (acao) await page.clickText(acao);
      }
      await new Promise((r) => setTimeout(r, 220));
    }

    if (!viuPromptDeTributo) {
      const fim = await page.evaluate(LER);
      process.stdout.write(
        `diagnóstico: monstros em campo=${fim.monstrosEmCampo} ` +
        `acionáveis=${fim.cartas} botões=[${fim.botoes.slice(0, 6).join(", ")}]\n`,
      );
    }
    process.stdout.write(`prompt de tributo apareceu: ${viuPromptDeTributo}\n`);
    process.stdout.write(`botão "Cancelar" na barra:   ${viuBotaoCancelar}\n`);
    process.stdout.write(`cancelou e voltou ao turno:  ${cancelou}\n`);
    process.stdout.write(`monstros em campo antes/depois: ${monstrosAntes}/${monstrosDepois}\n`);

    const erros = page.console.filter((c) => c.level === "error");
    process.stdout.write(`erros de console: ${erros.length} | exceções: ${page.errors.length}\n`);

    const passou =
      viuPromptDeTributo && viuBotaoCancelar && cancelou &&
      monstrosDepois === monstrosAntes && erros.length === 0 && page.errors.length === 0;
    process.stdout.write(`\n${passou ? "OK" : "FALHA"}\n`);
    if (!passou) process.exitCode = 1;
  } finally {
    child.kill();
  }
}

await main();
