/**
 * Verifica que o monstro NÃO gira sozinho ao atacar.
 *
 * O fantasma da investida é um elemento novo, e se ele nascer com um giro
 * diferente do da carta na mesa ela parece girar no instante em que o ataque
 * começa — que foi a reclamação, quando as cartas do oponente ficavam de
 * cabeça para baixo. Na mesa do Master Duel elas ficam de pé (só a defesa
 * deita), mas a regra continua: como `transform` é uma propriedade só, a
 * rotação (se houver) precisa ser a MESMA em todos os quadros da animação.
 *
 * O teste intercepta a animação do fantasma de ataque e confere quadro a
 * quadro. Olhar uma foto não resolveria: o giro indevido dura um quadro.
 *
 * Uso: APP_URL=http://127.0.0.1:3100 node tools/harness/test-attack-rotation.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { FASES_DISPONIVEIS, launchChrome, openPage } from "./browser.mjs";
import { REPO } from "./env.mjs";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";

function deck() {
  const presets = JSON.parse(readFileSync(join(REPO, "src/data/preset-decks.json"), "utf8"));
  const contagem = new Map();
  for (const code of presets[0].main) contagem.set(code, (contagem.get(code) ?? 0) + 1);
  return {
    id: "atk", name: "Atk", format: "goat",
    main: [...contagem].map(([passcode, quantity]) => ({ passcode, quantity })),
    extra: [], side: [], updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/**
 * O fantasma do ataque é o elemento `.md-attack-ghost` (era o do anel
 * vermelho, `ring-red-400`, antes da mesa do MD). Guardamos os quadros e a
 * rotação que a carta de origem tinha, para comparar depois.
 */
const GRAMPO = `
  if (window.__grampoAtaque) return true;
  window.__grampoAtaque = true;
  window.__ataques = [];
  const original = Element.prototype.animate;
  Element.prototype.animate = function (quadros, opcoes) {
    try {
      const fantasma = this instanceof HTMLElement && /md-attack-ghost|ring-red-400/.test(this.className);
      if (fantasma && Array.isArray(quadros)) {
        window.__ataques.push(quadros.map((q) => q.transform ?? ""));
      }
    } catch {}
    return original.call(this, quadros, opcoes);
  };
  return true;
`;

/** Prefere agir e atacar; passar o turno é o último recurso. */
function escolher(botoes) {
  const ordem = [
    "Atacar", "Ataque", "Ativar", "Invocação-Especial", "Invocar",
    "Confirmar", "Concluir", "Sim", "Baixar", "Mudar posição",
  ];
  for (const chave of ordem) {
    const achado = botoes.find((b) => b.startsWith(chave));
    if (achado) return achado;
  }
  const avancar = botoes.find((b) => b.includes("Battle Phase")) ?? botoes.find((b) => b === "BP");
  if (avancar) return avancar;
  return (
    botoes.find((b) => b.includes("Encerrar turno")) ??
    botoes.find((b) => b === "EP") ??
    botoes.find((b) => b.includes("Não")) ??
    botoes[0]
  );
}

async function main() {
  const { child, port } = await launchChrome({ headless: !process.argv.includes("--headed") });
  try {
    const page = await openPage(port);
    await page.goto(`${BASE}/duel`);
    // O perfil vem ANTES do deck: sem nome, a portaria (`PlayerProvider`)
    // segura a aplicação na pergunta "como você quer ser chamado?".
    await page.evaluate(
      `localStorage.setItem("yugioh-goat-profile-v1", ${JSON.stringify(
        JSON.stringify({ id: "harnessattackrot", name: "Testador" }),
      )});
       localStorage.setItem("yugioh-goat-deck-v1", ${JSON.stringify(JSON.stringify(deck()))}); return true;`,
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
    await new Promise((r) => setTimeout(r, 1500));
    await page.evaluate(GRAMPO);

    const prazo = Date.now() + 1000 * 200;
    let ataques = [];

    // Joga até acontecerem ataques — o bot ataca sozinho quando tem monstro.
    while (Date.now() < prazo && ataques.length < 2) {
      ataques = await page.evaluate("return window.__ataques ?? []");

      const estado = await page.evaluate(`
        const util = (b) => !b.disabled && b.offsetParent !== null && !b.closest("[data-table-control]") && !b.innerText.includes("\\u{1F50A}") && !b.closest('[aria-label="Idioma das cartas"]');
        return {
          botoes: [...document.querySelectorAll("button")].filter(util).map((b) => b.innerText.trim()).filter(Boolean).concat(${FASES_DISPONIVEIS}),
          cartas: document.querySelectorAll(".tf-slot-active").length,
        };
      `);
      // Mesma condução do test-browser.mjs, que comprovadamente chega à
      // Battle Phase: carta acionável primeiro, e só então avança de fase.
      if (estado.cartas > 0) {
        await page.evaluate(`const c=[...document.querySelectorAll(".tf-slot-active")]; if(c.length) c[Math.floor(Math.random()*c.length)].click(); return true;`);
        await new Promise((r) => setTimeout(r, 180));
        // Sem os controles da mesa (`data-table-control`): com a leitura da
        // carta aberta, o glossário oferece "Invocação-Especial" e "Baixar"
        // como botões, e o teste os escolhia em vez da jogada do menu.
        const depois = await page.evaluate(`return [...document.querySelectorAll("button")].filter(b=>!b.disabled&&b.offsetParent&&!b.closest("[data-table-control]")).map(b=>b.innerText.trim()).filter(Boolean)`);
        const acao = escolher(depois);
        if (acao) await page.clickAction(acao);
      } else {
        const acao = escolher(estado.botoes);
        if (acao) await page.clickAction(acao);
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    if (ataques.length === 0) {
      process.stdout.write("nenhum ataque observado — teste inconclusivo\n");
      process.exitCode = 1;
      return;
    }

    let falhas = 0;
    for (const [i, quadros] of ataques.entries()) {
      const rotacoes = quadros.map((t) => /rotate\((-?[\d.]+)deg\)/.exec(t)?.[1] ?? null);
      const distintas = [...new Set(rotacoes)];
      // A rotação precisa ser a MESMA em todos os quadros: variar significa
      // que a carta gira durante o voo.
      const ok = distintas.length === 1;
      if (!ok) falhas += 1;
      process.stdout.write(
        `ataque ${i + 1}: ${quadros.length} quadros, rotação por quadro = ` +
        `[${rotacoes.map((r) => r ?? "nenhuma").join(", ")}]  ${ok ? "OK" : "GIRA — FALHA"}\n`,
      );
    }

    const comGiro = ataques.filter((q) => q.some((t) => /rotate/.test(t))).length;
    process.stdout.write(
      `\nataques medidos: ${ataques.length} | com carta girada (oponente/defesa): ${comGiro} | ` +
      `giraram durante o voo: ${falhas}\n`,
    );
    if (comGiro === 0) {
      process.stdout.write(
        "· nenhum ataque partiu de carta girada (na mesa do MD as do oponente ficam de pé).\n",
      );
    }
    if (falhas > 0) process.exitCode = 1;
  } finally {
    child.kill();
  }
}

await main();
