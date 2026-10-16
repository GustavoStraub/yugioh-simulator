/**
 * Construtor de deck e lobby contra o bot, pela tela (Fases 9 e 10 do plano).
 *
 * Construtor: desfazer (botão e Ctrl+Z), "Limpar" que pede confirmação e que
 * o desfazer traz de volta, estatísticas que batem com o deck, mão de teste
 * (5 e +1), exportar ydke:// e importar o mesmo link como deck NOVO com as
 * mesmas cartas, e arrastar e soltar nos dois sentidos.
 *
 * Lobby: a prévia do deck do bot, e "o bot começa" — o turno 1 é dele, a mão
 * de quem joga fica embaixo (assento 1) e a revanche mantém a ordem; a moeda
 * deixa a linha do sorteio no histórico.
 *
 * Os perfis criados aqui têm a biblioteca apagada de `.data/decks` no fim:
 * é a biblioteca DE VERDADE dos jogadores.
 *
 * Uso: APP_URL=http://127.0.0.1:3000 npm run test:browser-builder [-- --headed]
 */
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { launchChrome, openPage } from "./browser.mjs";
import { REPO } from "./env.mjs";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const DECKS_DIR = join(REPO, ".data/decks");

const falhas = [];
function conferir(condicao, descricao, detalhe = "") {
  console.log(condicao ? `  ✓ ${descricao}` : `  ✗ ${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  if (!condicao) falhas.push(descricao);
}
const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DIGITAR = (seletor, valor, tipo = "HTMLInputElement") => `
  const campo = document.querySelector(${JSON.stringify(seletor)});
  if (!campo) return false;
  const setter = Object.getOwnPropertyDescriptor(${tipo}.prototype, "value").set;
  setter.call(campo, ${JSON.stringify(valor)});
  campo.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
`;

async function ate(page, js, { tentativas = 60, intervalo = 250 } = {}) {
  for (let i = 0; i < tentativas; i += 1) {
    const valor = await page.evaluate(js).catch(() => null);
    if (valor) return valor;
    await espera(intervalo);
  }
  return null;
}

async function apresentarSe(page, nome) {
  for (let tentativa = 0; tentativa < 30; tentativa += 1) {
    const texto = await page.evaluate("return document.body.innerText");
    if (!texto.includes("Como você quer ser chamado")) return;
    await page.evaluate(DIGITAR('input[aria-label="Seu nome"]', nome));
    await espera(150);
    await page.clickText("Começar");
    await espera(400);
  }
}

async function esperarCatalogo(page) {
  for (let i = 0; i < 90; i += 1) {
    const texto = await page.evaluate("return document.body.innerText");
    if (!texto.includes("Carregando")) return;
    await espera(1000);
  }
  throw new Error("o catálogo não carregou");
}

/** Cartas no Deck Principal, pela aba "Principal N" da grade do deck. */
const PRINCIPAL = `
  const aba = [...document.querySelectorAll("button")].find((b) => /^Principal\\s*\\d+$/.test(b.textContent.trim()));
  return aba ? Number(aba.textContent.replace(/\\D+/g, "")) : -1;
`;

const tecla = (key, extra = {}) => `
  window.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, bubbles: true, ...${JSON.stringify(extra)} }));
  return true;
`;

/** Arrasta `origem` (seletor) e solta em `destino`, com o mesmo DataTransfer. */
const ARRASTAR = (origem, destino) => `
  const de = document.querySelector(${JSON.stringify(origem)});
  const para = document.querySelector(${JSON.stringify(destino)});
  if (!de || !para) return false;
  const dt = new DataTransfer();
  de.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
  para.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
  para.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  return true;
`;

async function construtor(page) {
  console.log("Construtor");
  conferir(await page.clickText("Novo"), "criou um deck novo");
  await espera(500);
  await page.evaluate(`
    const card = document.querySelector('[data-catalog-drop] [data-builder-card]');
    card?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    card?.focus(); return true;
  `);
  await espera(100);
  conferir(!(await page.evaluate(`return Boolean(document.querySelector('[data-card-reader], [data-card-image-zoom]'));`)),
    "#5: passar o mouse ou focar não abre os detalhes");
  await page.evaluate(`document.querySelector('[data-catalog-drop] [data-builder-card]')?.click(); return true;`);
  await espera(150);
  conferir((await page.evaluate(PRINCIPAL)) === 0, "#5: clicar só inspeciona, sem adicionar");
  conferir(await page.evaluate(`return document.querySelector('[data-reader-remove]')?.disabled === true && /apenas um aviso/.test(document.querySelector('[data-reader-banlist]')?.textContent);`),
    "#5: remover começa desabilitado e a regra da banlist é explícita");
  for (let i = 0; i < 3; i += 1) {
    await page.evaluate(`document.querySelector('[data-reader-add]')?.click(); return true;`);
    await espera(80);
  }
  conferir((await page.evaluate(PRINCIPAL)) === 3 && await page.evaluate(`return document.querySelector('[data-reader-add]')?.disabled;`),
    "#5: três cópias bloqueiam Adicionar, mas os detalhes continuam abertos");
  await page.evaluate(`document.querySelector('[data-card-reader] [data-card-image-zoom]')?.click(); return true;`);
  await espera(100);
  conferir(await page.evaluate(`return Boolean(document.querySelector('[data-card-image-dialog][open]'));`), "#5: a imagem dos detalhes pode ser ampliada");
  await page.evaluate(`document.querySelector('[aria-label="Fechar imagem ampliada"]')?.click(); return true;`);
  for (let i = 0; i < 3; i += 1) {
    await page.evaluate(`document.querySelector('[data-reader-remove]')?.click(); return true;`);
    await espera(80);
  }
  conferir((await page.evaluate(PRINCIPAL)) === 0 && await page.evaluate(`return document.querySelector('[data-reader-remove]')?.disabled && !document.querySelector('[data-reader-add]')?.disabled;`),
    "#5: remover a última cópia atualiza os dois botões");
  await page.evaluate(`document.querySelector('[aria-label="Fechar detalhes da carta"]')?.click(); return true;`);

  for (let i = 0; i < 8; i += 1) {
    await page.evaluate(`document.querySelectorAll('[data-catalog-drop] [data-builder-card]')[${i}]?.click(); return true;`);
    await espera(100);
    await page.evaluate(`document.querySelector('[data-reader-add]')?.click(); return true;`);
    await page.evaluate(`document.querySelector('[aria-label="Fechar detalhes da carta"]')?.click(); return true;`);
    await espera(100);
  }
  const oito = await page.evaluate(PRINCIPAL);
  conferir(oito === 8, `8 cartas no Principal (${oito})`);
  await page.evaluate(`document.querySelector('[data-deck-drop] [data-builder-card]')?.click(); return true;`);
  await espera(100);
  conferir((await page.evaluate(PRINCIPAL)) === 8, "#5: clicar em carta do deck também só inspeciona");
  await page.evaluate(`document.querySelector('[aria-label="Fechar detalhes da carta"]')?.click(); return true;`);

  // --- desfazer ---
  await page.evaluate(`document.querySelector("[data-undo]")?.click(); return true;`);
  await espera(150);
  conferir((await page.evaluate(PRINCIPAL)) === 7, "Desfazer tira a última carta adicionada");
  await page.evaluate(tecla("z", { ctrlKey: true }));
  await espera(150);
  conferir((await page.evaluate(PRINCIPAL)) === 6, "Ctrl+Z também desfaz");

  // --- limpar pede confirmação, e o desfazer traz de volta ---
  await page.evaluate(`document.querySelector("[data-clear-deck]")?.click(); return true;`);
  await espera(150);
  const confirmando = await page.evaluate(`return document.querySelector("[data-clear-deck]")?.textContent ?? "";`);
  conferir(/Limpar tudo\?/.test(confirmando) && (await page.evaluate(PRINCIPAL)) === 6, "o primeiro clique em Limpar só pede confirmação");
  await page.evaluate(`document.querySelector("[data-clear-deck]")?.click(); return true;`);
  await espera(150);
  conferir((await page.evaluate(PRINCIPAL)) === 0, "o segundo clique limpa");
  await page.evaluate(`document.querySelector("[data-undo]")?.click(); return true;`);
  await espera(150);
  conferir((await page.evaluate(PRINCIPAL)) === 6, "e o Desfazer traz as 6 cartas de volta");

  // --- estatísticas ---
  await page.evaluate(`document.querySelector('[data-tool="stats"]')?.click(); return true;`);
  await espera(200);
  const soma = await page.evaluate(`
    const caixa = document.querySelector("[data-deck-stats]");
    if (!caixa) return -1;
    return [...caixa.querySelectorAll("p.font-mono")].reduce((t, p) => t + Number(p.textContent), 0);
  `);
  conferir(soma === 6, `as estatísticas somam o Deck Principal (${soma})`);
  await page.evaluate(tecla("Escape"));
  await espera(150);
  conferir(!(await page.evaluate(`return Boolean(document.querySelector("[data-deck-stats]"));`)), "Esc fecha as estatísticas");

  // --- mão de teste ---
  await page.evaluate(`document.querySelector('[data-tool="mao"]')?.click(); return true;`);
  await espera(200);
  await page.evaluate(`document.querySelector("[data-test-hand-draw]")?.click(); return true;`);
  await espera(200);
  const cinco = await page.evaluate(`return document.querySelectorAll("[data-test-hand] img").length;`);
  conferir(cinco === 5, `a mão de teste compra 5 (${cinco})`);
  await page.clickText("+1 carta");
  await espera(150);
  conferir((await page.evaluate(`return document.querySelectorAll("[data-test-hand] img").length;`)) === 6, "+1 compra mais uma");
  await page.evaluate(tecla("Escape"));
  await espera(150);

  // --- exportar e importar o mesmo link ---
  await page.evaluate(`document.querySelector('[data-tool="io"]')?.click(); return true;`);
  await espera(200);
  const link = await page.evaluate(`return document.querySelector("[data-ydke-export]")?.value ?? "";`);
  conferir(link.startsWith("ydke://"), "o link ydke:// do deck aparece");
  await page.evaluate(DIGITAR("[data-deck-import]", link, "HTMLTextAreaElement"));
  await espera(150);
  await page.clickText("Importar como deck novo");
  await espera(400);
  const resultado = await page.evaluate(`return document.querySelector("[data-import-result]")?.textContent ?? "";`);
  conferir(/Importado como deck novo \(6 cartas\)/.test(resultado), `o mesmo link volta como deck novo (${resultado})`);
  await page.evaluate(tecla("Escape"));
  await espera(300);
  const aberto = await page.evaluate(`return document.querySelector('[data-deck-select] > button[aria-label="Deck aberto"]')?.textContent.trim() ?? "";`);
  conferir(/^Deck importado/.test(aberto) && (await page.evaluate(PRINCIPAL)) === 6, `o deck importado abre com as 6 cartas (${aberto})`);

  // --- arrastar e soltar ---
  const antes = await page.evaluate(PRINCIPAL);
  conferir(
    await page.evaluate(ARRASTAR('[data-catalog-drop] [data-builder-card][draggable="true"]', "[data-deck-drop]")),
    "arrastou uma carta do catálogo para o deck",
  );
  await espera(200);
  conferir((await page.evaluate(PRINCIPAL)) === antes + 1, "soltar no deck adiciona");
  await page.evaluate(ARRASTAR("[data-deck-drop] button[draggable='true']", "[data-catalog-drop]"));
  await espera(200);
  conferir((await page.evaluate(PRINCIPAL)) === antes, "soltar no catálogo tira do deck");
}

async function lobby(page) {
  console.log("Lobby contra o bot");
  await page.goto(`${BASE}/duel`);
  await esperarCatalogo(page);
  await ate(page, `return Boolean(document.querySelector("[data-deck-preview]"));`);
  const previa = await page.evaluate(`return document.querySelector("[data-deck-preview]")?.innerText ?? "";`);
  conferir(/\d+ cartas · \d+ monstros/.test(previa), `a prévia do deck do bot mostra a composição (${previa.split("\\n")[0]})`);
  await page.clickText("Ver a lista completa");
  await espera(200);
  conferir(Boolean(await page.evaluate(`return document.querySelector("[data-deck-preview-list]")?.innerText.length > 50;`)), "e a lista completa abre");

  await page.evaluate(`document.querySelector('[data-first-turn="bot"]')?.click(); return true;`);
  await espera(150);
  conferir(
    (await page.evaluate(`return document.querySelector('[data-first-turn="bot"]')?.getAttribute("aria-checked");`)) === "true",
    "escolheu 'O bot começa'",
  );
  await page.clickText("Iniciar duelo");
  const turno1 = await ate(
    page,
    `const log = document.querySelector("[data-duel-log]")?.innerText ?? ""; return /Turno 1 — O oponente/i.test(log) ? true : null;`,
    { tentativas: 80, intervalo: 500 },
  );
  conferir(Boolean(turno1), "o turno 1 é do bot");
  const minhaVez = await ate(
    page,
    `
    const maos = [...document.querySelectorAll(".tf-playmat [data-hand]")];
    const baixo = maos.at(-1);
    // De quem é a vez, na mesa do MD, é o dono do botão de fase (o selo "Sua
    // vez" da placa saiu com o HUD novo).
    return baixo?.getAttribute("data-hand") === "1" && document.querySelector('[data-turn-owner="me"]') && baixo.querySelectorAll(".tf-slot-active").length > 0 ? true : null;
  `,
    { tentativas: 120, intervalo: 500 },
  );
  conferir(Boolean(minhaVez), "depois chega a minha vez, com a minha mão embaixo (assento 1) e jogável");

  // Revanche mantém "o bot começa".
  await page.evaluate(`document.querySelector('.tf-playmat [data-pile="deck-1"][role="button"]')?.click(); return true;`);
  await espera(200);
  await page.clickAction("🏳️ Render-se");
  await espera(150);
  await page.clickAction("🏳️ Confirmar rendição?");
  await ate(page, `return Boolean(document.querySelector("[data-rematch]"));`);
  await page.evaluate(`document.querySelector("[data-rematch]")?.click(); return true;`);
  const revanche = await ate(
    page,
    `const log = document.querySelector("[data-duel-log]")?.innerText ?? ""; return !document.querySelector("[data-result]") && /Turno 1 — O oponente/i.test(log) ? true : null;`,
    { tentativas: 80, intervalo: 500 },
  );
  conferir(Boolean(revanche), "a revanche mantém o bot começando");

  // Moeda.
  await page.goto(`${BASE}/duel`);
  await esperarCatalogo(page);
  await ate(page, `return Boolean(document.querySelector('[data-first-turn="coin"]'));`);
  await page.evaluate(`document.querySelector('[data-first-turn="coin"]')?.click(); return true;`);
  await espera(150);
  await page.clickText("Iniciar duelo");
  const moeda = await ate(
    page,
    `const log = document.querySelector("[data-duel-log]")?.innerText ?? ""; return /🪙 Moeda: (você|o oponente) começa/.test(log) ? log.match(/🪙 Moeda: [^\\n]+/)[0] : null;`,
    { tentativas: 80, intervalo: 500 },
  );
  conferir(Boolean(moeda), `a moeda deixa a linha do sorteio no histórico (${moeda})`);
}

async function main() {
  const { child, port } = await launchChrome({ headless: !process.argv.includes("--headed") });
  const apelido = `Teste Construtor ${Date.now() % 1000000}`;
  try {
    const page = await openPage(port);
    await page.setViewport(1440, 900);
    await page.goto(`${BASE}/`);
    await apresentarSe(page, apelido);
    await esperarCatalogo(page);
    await construtor(page);

    // O lobby precisa de um deck pronto: carrega o primeiro deck oficial.
    await page.clickText("Carregar deck oficial");
    await espera(400);
    await page.evaluate(`document.querySelector("[data-preset-id]")?.click(); return true;`);
    await espera(200);
    await page.evaluate(`
      [...document.querySelectorAll("[data-preset-picker] button")].find((b) => b.textContent.trim() === "Carregar deck")?.click();
      return true;
    `);
    await espera(1500);
    await lobby(page);

    const erros = page.console.filter((c) => c.level === "error");
    conferir(page.errors.length === 0, "sem exceções na página", page.errors.join(" | "));
    conferir(erros.length === 0, "sem erros de console", erros.map((e) => e.text).join(" | ").slice(0, 300));
  } finally {
    child.kill();
    if (existsSync(DECKS_DIR)) {
      for (const nome of readdirSync(DECKS_DIR).filter((n) => n.endsWith(".json"))) {
        try {
          const dono = JSON.parse(readFileSync(join(DECKS_DIR, nome), "utf8")).profile?.name;
          if (dono === apelido) rmSync(join(DECKS_DIR, nome));
        } catch {
          // Arquivo de outra pessoa, ilegível: não é nosso, fica.
        }
      }
    }
  }

  if (falhas.length) {
    console.log(`\n${falhas.length} falha(s).`);
    process.exitCode = 1;
  } else {
    console.log("\nConstrutor e lobby: tudo certo.");
  }
}

await main();
