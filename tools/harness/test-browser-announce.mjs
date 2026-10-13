/**
 * Renderiza de verdade os prompts raros, num Chrome real.
 *
 * O `test-ui-rare-prompts.mjs` prova que o `buildPromptPlan` devolve um plano
 * acionável — mas ele nunca renderiza React. O modal de declarar raça, a busca
 * por nome de carta e a barra de seleção de zonas existem só como JSX, e JSX
 * que compila não é JSX que funciona.
 *
 * Aqui o deck do jogador é montado só com as cartas que produzem esses
 * prompts, para eles aparecerem em poucos turnos em vez de nunca.
 *
 * Uso: node tools/harness/test-browser-announce.mjs [--headed]
 */
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { launchChrome, openPage } from "./browser.mjs";
import { REPO, loadGoatPool } from "./env.mjs";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const DECK_STORAGE_KEY = "yugioh-goat-deck-v1";

/**
 * Cartas que produzem os prompts que queremos ver na tela, 3 cópias cada.
 * O resto do deck é monstro comum, só para chegar às 40 e ter o que invocar.
 */
const PROTAGONISTAS = [
  "Tribe-Infecting Virus", // ANNOUNCE_RACE (monstro, efeito de ignição)
  "DNA Surgery",           // ANNOUNCE_RACE (armadilha contínua)
  "Rivalry of Warlords",   // ANNOUNCE_RACE
  "DNA Transplant",        // ANNOUNCE_ATTRIB
  "Prohibition",           // ANNOUNCE_CARD (busca por nome)
  "Reasoning",             // ANNOUNCE_NUMBER
  "Ground Collapse",       // SELECT_DISFIELD com count 2
  "Poison of the Old Man", // SELECT_OPTION (texto real da opção)
];

const ENCHIMENTO = [
  "Battle Ox", "Mystical Elf", "Feral Imp", "Silver Fang",
  "Mammoth Graveyard", "Sangan",
];

function montarDeck(pool) {
  const porNome = new Map(pool.map((c) => [c.name, c]));
  const main = [];
  const faltando = [];

  for (const nome of PROTAGONISTAS) {
    const card = porNome.get(nome);
    if (!card) { faltando.push(nome); continue; }
    // O limite de cópias do Goat é respeitado pelo lobby; 3 é o teto normal e
    // as cartas limitadas simplesmente entram em menor número.
    const copias = card.banlist_info?.ban_goat === "Limited" ? 1
      : card.banlist_info?.ban_goat === "Semi-Limited" ? 2 : 3;
    for (let i = 0; i < copias; i += 1) main.push(card.id);
  }

  let cursor = 0;
  while (main.length < 40) {
    const card = porNome.get(ENCHIMENTO[cursor % ENCHIMENTO.length]);
    cursor += 1;
    if (!card) continue;
    if (main.filter((c) => c === card.id).length >= 3) continue;
    main.push(card.id);
    if (cursor > 200) break;
  }

  const contagem = new Map();
  for (const code of main) contagem.set(code, (contagem.get(code) ?? 0) + 1);

  return {
    deck: {
      id: "teste-announce",
      name: "Teste de prompts",
      format: "goat",
      main: [...contagem].map(([passcode, quantity]) => ({ passcode, quantity })),
      extra: [],
      side: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    faltando,
    total: main.length,
  };
}

/** Assinaturas na tela de cada prompt que queremos ver renderizado. */
const ASSINATURAS = [
  { nome: "ANNOUNCE_RACE", regex: /Declare \d+ raça/ },
  { nome: "ANNOUNCE_ATTRIB", regex: /Declare \d+ atributo/ },
  { nome: "ANNOUNCE_CARD", regex: /Declare o nome de uma carta/ },
  { nome: "ANNOUNCE_NUMBER", regex: /Declare um número/ },
  { nome: "SELECT_DISFIELD_2", regex: /Escolha 2 zonas/ },
  { nome: "SELECT_OPTION", regex: /Escolha um efeito/ },
];

const LER = `
  const mesa = document.querySelector(".tf-playmat") ?? document.body;
  const texto = mesa.innerText;
  const util = (b) => !b.disabled && b.offsetParent !== null &&
    !b.closest("[data-table-control]") && !b.innerText.includes("\\u{1F50A}") && !b.innerText.includes("\\u{1F507}") &&
    !b.closest('[aria-label="Idioma das cartas"]');
  return {
    texto,
    botoes: [...document.querySelectorAll("button")].filter(util).map((b) => b.innerText.trim()).filter(Boolean),
    cartas: document.querySelectorAll(".tf-slot-active").length,
    // Precisa ser o campo de texto do modal — o controle de som tem um
    // \`input[type=range]\` sempre presente, e um seletor genérico \`input\`
    // faz o teste achar que o modal de declarar carta está aberto o duelo
    // inteiro.
    temBusca: Boolean(document.querySelector("input[type=text]")),
    processando:
      mesa.dataset?.processing === "1" ||
      mesa.dataset?.waitingFoe === "1" ||
      /Processando|Preparando duelo/.test(texto),
    acabou: /venceu|empatad/.test(texto),
  };
`;

async function main() {
  const headed = process.argv.includes("--headed");
  const pool = loadGoatPool();
  const { deck, faltando, total } = montarDeck(pool);
  if (faltando.length) process.stdout.write(`cartas não encontradas no pool: ${faltando.join(", ")}\n`);
  process.stdout.write(`deck montado com ${total} cartas\n`);

  const { child, port } = await launchChrome({ headless: !headed });
  const vistos = new Map();

  try {
    const page = await openPage(port);
    await page.goto(`${BASE}/duel`);
    // O perfil vem ANTES do deck: sem nome, a portaria (`PlayerProvider`)
    // segura a aplicação na pergunta "como você quer ser chamado?" e o lobby
    // nem renderiza — sem isto o teste morria em "não consegui iniciar".
    await page.evaluate(
      `localStorage.setItem("yugioh-goat-profile-v1", ${JSON.stringify(
        JSON.stringify({ id: "harnessannounce01", name: "Locutor" }),
      )});
       localStorage.setItem(${JSON.stringify(DECK_STORAGE_KEY)}, ${JSON.stringify(JSON.stringify(deck))}); return true;`,
    );
    await page.goto(`${BASE}/duel`);

    for (let i = 0; i < 60; i += 1) {
      const t = await page.evaluate("return document.body.innerText");
      if (!t.includes("Carregando catálogo")) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!(await page.clickText("Iniciar duelo"))) {
      process.stdout.write("não consegui iniciar o duelo\n");
      process.exitCode = 1;
      return;
    }

    const prazo = Date.now() + 1000 * 60 * 5;
    let acoes = 0;

    while (acoes < 400 && Date.now() < prazo) {
      const estado = await page.evaluate(LER);

      for (const { nome, regex } of ASSINATURAS) {
        if (regex.test(estado.texto) && !vistos.has(nome)) {
          vistos.set(nome, {
            botoes: estado.botoes.slice(0, 6),
            busca: estado.temBusca,
          });
          process.stdout.write(
            `✓ ${nome} renderizado — botões: ${estado.botoes.slice(0, 5).join(" | ") || "(nenhum)"}` +
            `${estado.temBusca ? " [campo de busca presente]" : ""}\n`,
          );
        }
      }

      if (estado.acabou) break;
      if (estado.processando || (estado.botoes.length === 0 && estado.cartas === 0)) {
        await new Promise((r) => setTimeout(r, 300));
        continue;
      }

      // ANNOUNCE_CARD: é preciso digitar, escolher um nome e só então declarar.
      // Sem isso o botão "Declarar" fica desabilitado e o duelo trava aqui.
      if (estado.temBusca) {
        const escolheu = await page.evaluate(`
          const campo = document.querySelector("input[type=text]");
          if (!campo) return "sem campo";
          const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, "value",
          ).set;
          setter.call(campo, "Battle Ox");
          campo.dispatchEvent(new Event("input", { bubbles: true }));
          return "digitou";
        `);
        await new Promise((r) => setTimeout(r, 260));
        // O hover do resultado tem que alimentar o painel de leitura da
        // esquerda: declarar um nome se decide pelo TEXTO da carta, e a grade
        // de resultados só mostra a arte. O modal cobre só a coluna do campo,
        // então o trilho continua visível enquanto se procura.
        const leitura = await page.evaluate(`
          const alvo = [...document.querySelectorAll("button")]
            .find((b) => b.innerText.includes("Battle Ox") || b.innerText.includes("Boi de Batalha"));
          if (!alvo) return "sem alvo";
          alvo.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
          alvo.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
          return "ok";
        `);
        await new Promise((r) => setTimeout(r, 160));
        const painel = await page.evaluate(`
          const aside = document.querySelector("aside .tf-panel");
          return aside ? aside.innerText.slice(0, 80) : "(sem painel)";
        `);
        // Só relatado: `vistos` conta os prompts das ASSINATURAS, e uma chave
        // extra ali estragaria o "N/6" do resumo.
        process.stdout.write(
          `  hover no resultado (${leitura}) → painel de leitura: ${JSON.stringify(painel)}\n`,
        );
        await page.evaluate(`
          const alvo = [...document.querySelectorAll("button")]
            .find((b) => b.innerText.includes("Battle Ox") || b.innerText.includes("Boi de Batalha"));
          if (alvo) alvo.click();
          return true;
        `);
        await new Promise((r) => setTimeout(r, 160));
        const declarou = await page.clickText("Declarar");
        process.stdout.write(`  ANNOUNCE_CARD: ${escolheu}, declarou=${declarou}\n`);
        acoes += 1;
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }

      if (estado.cartas > 0) {
        await page.evaluate(`
          const c = [...document.querySelectorAll(".tf-slot-active")];
          if (c.length) c[Math.floor(Math.random() * c.length)].click();
          return true;
        `);
        await new Promise((r) => setTimeout(r, 150));
        const depois = await page.evaluate(LER);
        const acao = escolher(depois.botoes);
        if (acao) await page.clickAction(acao);
      } else {
        const acao = escolher(estado.botoes);
        if (acao) await page.clickAction(acao);
      }
      acoes += 1;
      await new Promise((r) => setTimeout(r, 160));
    }

    process.stdout.write(`\nações: ${acoes}\n`);
    process.stdout.write(`prompts renderizados: ${vistos.size}/${ASSINATURAS.length}\n`);
    const faltaram = ASSINATURAS.filter((a) => !vistos.has(a.nome)).map((a) => a.nome);
    if (faltaram.length) process.stdout.write(`não apareceram: ${faltaram.join(", ")}\n`);

    const erros = page.errors;
    const consoleErros = page.console.filter((c) => c.level === "error");
    process.stdout.write(`exceções: ${erros.length} | erros de console: ${consoleErros.length}\n`);
    erros.slice(0, 6).forEach((e) => process.stdout.write(`  ${String(e).split("\\n")[0]}\n`));
    consoleErros.slice(0, 6).forEach((e) => process.stdout.write(`  ${e.text.slice(0, 200)}\n`));
    if (erros.length || consoleErros.length) process.exitCode = 1;
  } finally {
    child.kill();
    // `.data/decks` é a biblioteca DE VERDADE dos jogadores: o perfil
    // "Locutor" que este teste cria (com o deck "Teste de prompts") não pode
    // ficar lá — ficava um `locutor.json` a cada rodada.
    const pasta = join(REPO, ".data/decks");
    if (existsSync(pasta)) {
      for (const nome of readdirSync(pasta).filter((n) => n.endsWith(".json"))) {
        try {
          const arquivo = JSON.parse(readFileSync(join(pasta, nome), "utf8"));
          if (arquivo.profile?.name === "Locutor" && arquivo.decks?.every((d) => d.id === "teste-announce")) {
            rmSync(join(pasta, nome));
          }
        } catch {
          // Ilegível ou de outra pessoa: não é nosso, fica.
        }
      }
    }
  }
}

/** Prefere agir; declarar/confirmar antes de passar o turno. */
function escolher(botoes) {
  const ordem = [
    "Declarar", "Confirmar", "Concluir", "Ativar", "Invocar",
    "Invocação-Especial", "Atacar", "Baixar", "Sim",
  ];
  for (const chave of ordem) {
    const achado = botoes.find((b) => b.startsWith(chave));
    if (achado) return achado;
  }
  // Um rótulo de opção/raça/atributo: qualquer botão curto que não seja fase.
  const escolha = botoes.find(
    (b) => b.length > 2 && !["DP", "SP", "M1", "BP", "M2", "EP"].includes(b) && !b.includes("Encerrar"),
  );
  if (escolha) return escolha;
  return botoes.find((b) => b.includes("Encerrar turno")) ?? botoes.find((b) => b === "EP" || b === "BP") ?? botoes[0];
}

await main();
