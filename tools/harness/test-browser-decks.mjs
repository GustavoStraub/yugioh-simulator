/**
 * Biblioteca de decks e idioma das cartas, no navegador de verdade.
 *
 * O que este teste existe para provar é a promessa que motivou tirar o deck do
 * `localStorage`: **o deck sobrevive**. Recarregar a página, e até limpar os
 * dados do navegador, não pode levar junto o que o jogador montou — ele mora
 * num arquivo do servidor. Nenhum teste anterior olhava para isso.
 *
 * Uso: node tools/harness/test-browser-decks.mjs [--headed]
 */
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { launchChrome, openPage } from "./browser.mjs";
import { REPO } from "./env.mjs";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const DECKS_DIR = join(REPO, ".data/decks");

const falhas = [];
function conferir(condicao, descricao) {
  console.log(`  ${condicao ? "✓" : "✗"} ${descricao}`);
  if (!condicao) falhas.push(descricao);
}

const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Escreve num input controlado do React (o `value` direto não dispara nada). */
const DIGITAR = (seletor, valor) => `
  const campo = document.querySelector(${JSON.stringify(seletor)});
  if (!campo) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(campo, ${JSON.stringify(valor)});
  campo.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
`;

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

/** Nomes dos decks no seletor da biblioteca. */
const LER_BIBLIOTECA = `
  const select = document.querySelector('select[aria-label="Deck aberto"]');
  if (!select) return null;
  return {
    opcoes: [...select.options].map((o) => o.text),
    aberto: select.selectedOptions[0]?.text ?? "",
  };
`;

async function main() {
  const headed = process.argv.includes("--headed");
  const { child, port } = await launchChrome({ headless: !headed });
  /** Apelido desta execução — o arquivo da biblioteca dele é apagado no fim. */
  let apelidoDoTeste = null;

  try {
    const page = await openPage(port);
    await page.goto(`${BASE}/`);
    // Apelido único por execução: o id do perfil sai do nome, e um apelido
    // fixo faria cada rodada herdar (e depois mexer em) a biblioteca das
    // anteriores — foi o que fez este teste apagar o deck da rodada passada.
    const apelido = `Teste Decks ${Date.now() % 1000000}`;
    apelidoDoTeste = apelido;
    await apresentarSe(page, apelido);
    await esperarCatalogo(page);

    const inicial = await page.evaluate(LER_BIBLIOTECA);
    conferir(Boolean(inicial), "a biblioteca de decks aparece no construtor");
    if (!inicial) return;

    // --- cria um deck novo ---
    conferir(await page.clickText("Novo"), "criou um deck novo");
    await espera(500);
    const nomeUnico = `Deck de teste ${Date.now() % 100000}`;
    await page.evaluate(DIGITAR('input[aria-label="Nome do deck"]', nomeUnico));
    await espera(900);

    // --- põe cartas nele ---
    for (let i = 0; i < 5; i += 1) {
      await page.evaluate(`
        const cartas = [...document.querySelectorAll('button[title^="Adicionar"]')];
        cartas[${i}]?.click();
        return true;
      `);
      await espera(120);
    }
    await espera(1200); // deixa o debounce gravar

    const antes = await page.evaluate(LER_BIBLIOTECA);
    conferir(
      antes.opcoes.some((texto) => texto.startsWith(nomeUnico)),
      `o deck novo aparece na biblioteca (${antes.aberto})`,
    );

    // --- gravou no disco? ---
    const arquivos = existsSync(DECKS_DIR) ? readdirSync(DECKS_DIR) : [];
    const conteudo = arquivos
      .filter((nome) => nome.endsWith(".json"))
      .map((nome) => readFileSync(join(DECKS_DIR, nome), "utf8"))
      .join("\n");
    conferir(
      conteudo.includes(nomeUnico),
      "o deck foi gravado num arquivo do servidor",
    );

    // --- o teste que importa: sobrevive a recarregar? ---
    await page.goto(`${BASE}/`);
    await esperarCatalogo(page);
    const depois = await page.evaluate(LER_BIBLIOTECA);
    conferir(
      depois?.aberto.startsWith(nomeUnico),
      `o deck continua aberto depois de recarregar (${depois?.aberto})`,
    );
    conferir(
      /·\s*[1-9]/.test(depois?.aberto ?? ""),
      "as cartas continuam no deck depois de recarregar",
    );

    // --- e a limpeza dos dados do navegador? ---
    await page.evaluate(`
      const perfil = localStorage.getItem("yugioh-goat-profile-v1");
      localStorage.clear();
      sessionStorage.clear();
      // O perfil é a chave da coleção; sem ele o servidor não sabe de quem é.
      localStorage.setItem("yugioh-goat-profile-v1", perfil);
      return true;
    `);
    await page.goto(`${BASE}/`);
    await esperarCatalogo(page);
    const apagado = await page.evaluate(LER_BIBLIOTECA);
    conferir(
      apagado?.opcoes.some((texto) => texto.startsWith(nomeUnico)),
      "o deck sobrevive à limpeza dos dados do navegador",
    );

    // --- idioma das cartas ---
    // Uma carta cujo nome MUDA entre os idiomas: a primeira do catálogo é a
    // "7", que se chama igual nos dois e não provaria nada.
    await page.evaluate(DIGITAR('input[placeholder^="Buscar"]', "mago negro"));
    await espera(500);
    const nomePt = await page.evaluate(`
      const carta = document.querySelector('button[title^="Adicionar"]');
      return carta?.title ?? "";
    `);
    await page.clickText("EN", "button");
    await espera(500);
    const nomeEn = await page.evaluate(`
      const carta = document.querySelector('button[title^="Adicionar"]');
      return carta?.title ?? "";
    `);
    conferir(
      Boolean(nomePt) && Boolean(nomeEn) && nomePt !== nomeEn,
      `o seletor de idioma troca o nome da carta (${nomePt} → ${nomeEn})`,
    );

    // --- formato TCG: pool inteiro, Extra de 15, banlist TCG ---
    await page.clickText("PT", "button");
    await espera(300);
    await page.evaluate(DIGITAR('input[placeholder^="Buscar"]', ""));
    const trocou = await page.evaluate(`
      const botao = [...document.querySelectorAll("[data-format-switch] button")].find((b) => b.innerText.trim() === "TCG");
      botao?.click();
      return Boolean(botao);
    `);
    await espera(800);
    const poolTcg = await page.evaluate(`return Number(document.querySelector("[data-virtual-grid]")?.dataset.virtualGrid ?? 0);`);
    conferir(trocou && poolTcg > 10000, `o deck virou TCG e o catálogo mostra o pool inteiro (${poolTcg} cartas)`);
    await page.evaluate(DIGITAR('input[placeholder^="Buscar"]', "link spider"));
    await espera(600);
    await page.evaluate(`
      const carta = [...document.querySelectorAll('button[title^="Adicionar"]')].find((b) => /Link Spider|Link Aranha/.test(b.title));
      carta?.click();
      return Boolean(carta);
    `);
    await espera(500);
    const extra = await page.evaluate(`
      const caixa = [...document.querySelectorAll("p")].find((p) => p.textContent.trim() === "Extra");
      return caixa?.parentElement?.textContent.replace(/\s+/g, " ") ?? "";
    `);
    conferir(/1\s*\/15/.test(extra), `o Link foi para o Extra, com o limite do TCG (${extra})`);
    const banlist = await page.evaluate(`return document.querySelector("[data-banlist-summary]")?.innerText ?? "";`);
    conferir(/banlist TCG/.test(banlist), `o resumo da banlist TCG aparece (${banlist.trim()})`);
    // De volta ao Goat, o Link fica marcado como fora do pool — sem sumir.
    await page.evaluate(`
      [...document.querySelectorAll("[data-format-switch] button")].find((b) => b.innerText.includes("Goat"))?.click();
      return true;
    `);
    await espera(600);
    // A aba "Extra" da grade do deck (o filtro de categoria do catálogo também
    // se chama "Extra").
    await page.evaluate(`
      [...document.querySelectorAll("button")].find((b) => /^Extra\\s*\\d+$/.test(b.textContent.trim()))?.click();
      return true;
    `);
    await espera(400);
    const fora = await page.evaluate(`return document.querySelectorAll("[data-fora-do-pool]").length;`);
    conferir(fora === 1, "voltando ao Goat, o Link fica marcado como fora do pool", String(fora));

    // --- apaga o deck de teste ---
    await page.clickText("PT", "button");
    await espera(300);
    // Apagar age no deck ABERTO, e a limpeza do armazenamento acima levou
    // junto qual era ele — reabrir explicitamente antes.
    const abriu = await page.evaluate(`
      const select = document.querySelector('select[aria-label="Deck aberto"]');
      const opcao = [...select.options].find((o) => o.text.startsWith(${JSON.stringify(nomeUnico)}));
      if (!opcao) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
      setter.call(select, opcao.value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return opcao.text;
    `);
    conferir(Boolean(abriu), `reabriu o deck de teste para apagar (${abriu})`);
    await espera(400);
    await page.clickText("Apagar");
    await espera(200);
    await page.clickText("Confirmar?");
    await espera(1200);
    const final = await page.evaluate(LER_BIBLIOTECA);
    conferir(
      !final?.opcoes.some((texto) => texto.startsWith(nomeUnico)),
      "apagar o deck tira ele da biblioteca",
    );

    const erros = page.console.filter((c) => c.level === "error");
    conferir(page.errors.length === 0, "sem exceções não tratadas");
    page.errors.slice(0, 3).forEach((e) => console.log(`      ${e.split("\n")[0]}`));
    conferir(erros.length === 0, "sem erros de console");
    erros.slice(0, 3).forEach((e) => console.log(`      ${e.text.slice(0, 160)}`));
  } finally {
    child.kill();
    // `.data/decks` é a biblioteca DE VERDADE dos jogadores: o perfil que o
    // teste criou não pode ficar lá (antes ficava um `teste-decks-*.json` a
    // cada rodada).
    if (apelidoDoTeste && existsSync(DECKS_DIR)) {
      for (const nome of readdirSync(DECKS_DIR).filter((n) => n.endsWith(".json"))) {
        try {
          const dono = JSON.parse(readFileSync(join(DECKS_DIR, nome), "utf8")).profile?.name;
          if (dono === apelidoDoTeste) rmSync(join(DECKS_DIR, nome));
        } catch {
          // Arquivo de outra pessoa, ilegível: não é nosso, fica.
        }
      }
    }
  }

  console.log("");
  if (falhas.length > 0) {
    console.log(`${falhas.length} falha(s):`);
    for (const falha of falhas) console.log(`  - ${falha}`);
    process.exit(1);
  }
  console.log("Tudo certo.");
}

await main();
