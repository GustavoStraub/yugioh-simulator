/**
 * Teste de ponta a ponta no navegador de verdade.
 *
 * Sobe a aplicação, abre o duelo num Chrome real e joga: escolhe os decks,
 * entra na mesa e clica nas ações que a tela oferece, turno após turno. É o
 * único teste aqui que passa pelo React, pelo `buildPromptPlan` e pelo
 * tabuleiro — o resto valida a engine, que pode estar perfeita enquanto a tela
 * não deixa o jogador responder.
 *
 * O que se mede: erro no console, exceção não tratada, e — o mais importante —
 * **travamento**: a tela parar de oferecer qualquer ação com o duelo em aberto.
 *
 * `PRESET=<id>` escolhe o deck do jogador entre os prontos; um id `tcg-…`
 * (ex.: `PRESET=tcg-ys17`) joga o duelo inteiro em regras TCG, contra um deck
 * TCG do bot — Extra Deck, Zonas Extra, Link e companhia pela tela.
 *
 * Uso: [PRESET=tcg-ys17] node tools/harness/test-browser.mjs [--headed] [--url http://...]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { launchChrome, openPage } from "./browser.mjs";
import { REPO } from "./env.mjs";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";

/** Quantas ações tentar antes de considerar o duelo suficientemente exercido. */
const MAX_ACOES = 250;

/**
 * Lê o que a tela oferece agora.
 *
 * Interessa distinguir três estados: há botão para clicar, há carta clicável,
 * ou não há nada — e nesse caso saber se o engine está processando (legítimo)
 * ou parado à espera de uma resposta que a tela não sabe pedir (o bug).
 *
 * `tf-slot-active` é a classe que o `DuelCardSlot` põe numa carta acionável, e
 * `data-zone` identifica a zona — é assim que o teste "vê" o tabuleiro.
 */
/** Cliques iguais seguidos que contam como laço (ver o laço principal). */
const LACO = 25;

const LER_ESTADO = `
  // O painel de log guarda para sempre linhas como "Carregando engine...", e
  // procurar por elas no texto da página inteira faz o teste achar que o duelo
  // está sempre processando. Só o tabuleiro interessa.
  const mesa = document.querySelector(".tf-playmat") ?? document.body;
  const texto = mesa.innerText;
  const util = (b) =>
    !b.disabled &&
    b.offsetParent !== null &&
    // O controle de som está sempre habilitado e não é uma jogada; sem
    // excluí-lo o teste clica nele o duelo inteiro e não exercita nada.
    !b.closest("[data-table-control]") && !b.innerText.includes("\u{1F50A}") &&
    !b.innerText.includes("\u{1F507}") &&
    // Nem o seletor de idioma das cartas (PT/EN, na navegação): também está
    // sempre habilitado, e o teste o clicava em vez de esperar — um duelo
    // travado virava "250 ações" e nunca era acusado.
    !b.closest('[aria-label="Idioma das cartas"]') &&
    // Nem os de "ver" (👁 cartas reveladas, 👁 ver o tabuleiro): ajudam a
    // ler a mesa, não são jogada — e clicados em laço gastavam as 250 ações.
    !b.innerText.trim().startsWith("\u{1F441}");
  const botoes = [...document.querySelectorAll("button")].filter(util).map((b) => b.innerText.trim()).filter(Boolean);
  const menu = [...document.querySelectorAll(".tf-menu-item, [data-menu-item]")].map((b) => b.innerText.trim());
  const cartas = [...document.querySelectorAll(".tf-slot-active")].length;
  return {
    botoes,
    menu,
    cartas,
    // O motor trabalhando (turno ritmado do bot, resolução de corrente) ou
    // esperando o outro assento: nada a clicar é o esperado, não trava.
    processando:
      mesa.dataset?.processing === "1" ||
      mesa.dataset?.waitingFoe === "1" ||
      /Processando|Preparando duelo/.test(texto),
    erro: texto.includes("Erro:") || texto.includes("falhou") || texto.includes("interrompido"),
    acabou: texto.includes("venceu") || texto.includes("empatad"),
    trecho: texto.slice(0, 500),
  };
`;

/**
 * Clica numa carta acionável e devolve as opções do menu que abriu.
 *
 * É por aqui que se joga de verdade: as ações de carta (Ativar, Invocar,
 * Baixar) não são botões fixos na tela, elas aparecem no menu de contexto da
 * própria carta.
 */
const CLICAR_CARTA = `
  const cartas = [...document.querySelectorAll(".tf-slot-active")];
  if (cartas.length === 0) return null;
  const escolhida = cartas[Math.floor(Math.random() * cartas.length)];
  escolhida.click();
  return escolhida.closest("[data-zone]")?.getAttribute("data-zone") ?? "?";
`;

/**
 * Passa pela portaria de nome, se ela estiver na tela.
 *
 * O app pede o nome do jogador na primeira visita (perfil novo por navegador),
 * e sem preenchê-lo nenhuma tela renderiza — todo teste de navegador precisa
 * atravessar isso antes de qualquer coisa.
 */
async function apresentarSe(page, nome) {
  for (let tentativa = 0; tentativa < 30; tentativa += 1) {
    const texto = await page.evaluate("return document.body.innerText");
    if (!texto.includes("Como você quer ser chamado")) return false;
    await page.evaluate(`
      const campo = document.querySelector('input[aria-label="Seu nome"]');
      if (!campo) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(campo, ${JSON.stringify(nome)});
      campo.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    `);
    await new Promise((r) => setTimeout(r, 150));
    await page.clickText("Começar");
    await new Promise((r) => setTimeout(r, 400));
  }
  return true;
}

async function main() {
  const headed = process.argv.includes("--headed");
  const { child, port } = await launchChrome({ headless: !headed });

  try {
    const page = await openPage(port);

    process.stdout.write(`abrindo ${BASE}/duel ...\n`);
    await page.goto(`${BASE}/duel`);
    await apresentarSe(page, "Teste");

    // O lobby exige um deck do jogador com 40+ cartas, que normalmente vem do
    // deck builder. Semear o localStorage com um preset evita ter que montar
    // um deck carta a carta e mantém o teste focado no duelo.
    await page.evaluate(
      `localStorage.setItem(${JSON.stringify(DECK_STORAGE_KEY)}, ${JSON.stringify(JSON.stringify(deckDoJogador()))}); return true;`,
    );
    await page.goto(`${BASE}/duel`);

    // O catálogo vem da YGOPRODeck; até ele chegar o lobby só mostra o aviso
    // de carregamento e não há botão nenhum.
    await esperarCatalogo(page);

    const entrou = await page.clickText("Iniciar duelo");
    process.stdout.write(`entrou no duelo: ${entrou}\n`);

    if (!entrou) {
      process.stdout.write("não achei o botão de iniciar; texto do lobby:\n");
      process.stdout.write(await page.evaluate("return document.body.innerText.slice(0, 1200)") + "\n");
      process.exitCode = 1;
      return;
    }

    await page.waitForText("LP", { timeout: 60000 }).catch(() => {});

    // ---- rendição, antes de jogar de verdade ----
    // O gesto é clicar no PRÓPRIO deck: é a única pilha que não abre para
    // consulta, e é de lá que sai a desistência. Testado primeiro porque
    // encerra o duelo — o laço de jogadas recomeça logo abaixo.
    await verificarRendicao(page);

    // Volta para o lobby e entra de novo, agora para jogar.
    await page.goto(`${BASE}/duel`);
    await esperarCatalogo(page);
    await page.clickText("Iniciar duelo");
    await page.waitForText("LP", { timeout: 60000 }).catch(() => {});

    let acoes = 0;
    let paradoSeguidas = 0;
    let esperas = 0;
    const historico = [];
    // Trava de tempo: sem ela um estado que o teste não sabe ler vira espera
    // infinita, e o teste some em vez de falhar.
    const prazo = Date.now() + 1000 * 60 * 4;

    while (acoes < MAX_ACOES) {
      if (Date.now() > prazo) {
        process.stdout.write(`tempo esgotado após ${acoes} ações.\n`);
        break;
      }
      const estado = await page.evaluate(LER_ESTADO);

      if (estado.acabou) {
        process.stdout.write(`duelo terminou após ${acoes} ações.\n`);
        break;
      }
      if (estado.erro) {
        process.stdout.write(`ERRO na tela após ${acoes} ações:\n${estado.trecho}\n`);
        process.exitCode = 1;
        break;
      }
      // "Nada para fazer" é também nenhum botão que o `escolherAcao` aceite —
      // não só a lista vazia: um filtro de botões mal posto já fez o teste
      // registrar 250 "(nada)" em vez de acusar a mesa parada.
      const semJogada =
        estado.botoes.length === 0 || escolherAcao(estado.botoes) === undefined;
      if (estado.processando || (semJogada && estado.cartas === 0)) {
        paradoSeguidas += 1;
        esperas += 1;
        // Vinte leituras sem nada acionável e sem "processando" é a assinatura
        // do congelamento: o engine espera resposta que a tela não pede.
        if (paradoSeguidas > 20 && !estado.processando) {
          // O diagnóstico precisa dizer O QUE a tela mostrava: botões (até os
          // desabilitados), modais, cartas ativas, o texto da mesa e uma foto.
          const diag = await page.evaluate(`
            const mesa = document.querySelector(".tf-playmat");
            return {
              botoes: [...document.querySelectorAll("button")]
                .filter((b) => !b.closest("header, nav"))
                .map((b) => (b.disabled ? "[x]" : "") + b.innerText.trim().replace(/\\s+/g, " "))
                .filter(Boolean)
                .slice(0, 30),
              modais: document.querySelectorAll(".tf-modal-scrim").length,
              ativos: document.querySelectorAll(".tf-slot-active").length,
              mesa: mesa ? mesa.innerText.replace(/\\s+/g, " ").slice(0, 1500) : "(sem mesa)",
            };
          `);
          const foto = join(REPO, ".cache/shots", `travou-${process.env.PRESET ?? "goat"}.png`);
          try {
            mkdirSync(dirname(foto), { recursive: true });
            const { data } = await page.screenshot();
            writeFileSync(foto, Buffer.from(data, "base64"));
          } catch {
            // Sem foto, o resto do diagnóstico ainda serve.
          }
          process.stdout.write(
            `TRAVOU após ${acoes} ações — nada clicável e o engine não está processando.\n` +
            `botões: ${JSON.stringify(diag.botoes)}\nmodais: ${diag.modais} | cartas ativas: ${diag.ativos}\n` +
            `mesa: ${diag.mesa}\nfoto: ${foto}\n`,
          );
          process.exitCode = 1;
          break;
        }
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }

      paradoSeguidas = 0;

      // Carta acionável primeiro: é o que exercita efeito. Botão de fase só
      // quando não há jogada — passar o turno não testa carta nenhuma.
      if (estado.cartas > 0) {
        const zona = await page.evaluate(CLICAR_CARTA);
        await new Promise((r) => setTimeout(r, 180));
        const depois = await page.evaluate(LER_ESTADO);
        const acao = escolherAcao(depois.botoes);
        if (acao) {
          historico.push(`${zona}:${acao}`);
          await page.clickAction(acao);
        } else {
          historico.push(`${zona}:(sem menu)`);
        }
      } else {
        const alvo = escolherAcao(estado.botoes);
        historico.push(alvo ?? "(nada)");
        if (alvo) await page.clickAction(alvo);
      }

      acoes += 1;
      // O mesmo clique 25 vezes seguidas é um laço, não um duelo: o botão não
      // faz o que o teste acha que faz. Antes isso só aparecia no "últimas"
      // do fim, para alguém ler — e o teste passava com 240 cliques no
      // "Cemitério" do glossário em vez da carta do seletor.
      const ultimas = historico.slice(-LACO);
      if (ultimas.length === LACO && ultimas.every((h) => h === ultimas[0])) {
        const botoesNaTela = await page.evaluate(`
          return [...document.querySelectorAll("button")]
            .filter((b) => b.offsetParent !== null && !b.closest("header, nav"))
            .map((b) => (b.closest("[data-table-control]") ? "[mesa]" : "") + b.innerText.trim().replace(/\\s+/g, " "))
            .filter(Boolean)
            .slice(0, 30);
        `);
        process.stdout.write(
          `LAÇO após ${acoes} ações: "${ultimas[0]}" ${LACO}× seguidas sem a mesa mudar.\n` +
          `botões: ${JSON.stringify(botoesNaTela)}\n`,
        );
        process.exitCode = 1;
        break;
      }
      // Saiu da mesa (navegou para outra página): o laço não está mais
      // testando duelo nenhum — e pode estar mexendo em dado de verdade.
      if (!(await page.evaluate(`return Boolean(document.querySelector(".tf-playmat"))`))) {
        process.stdout.write(`SAIU DA MESA após ${acoes} ações (última: ${historico.at(-1)}).\n`);
        process.exitCode = 1;
        break;
      }
      await new Promise((r) => setTimeout(r, 220));
    }

    process.stdout.write(`\nações executadas: ${acoes} (esperas: ${esperas})\n`);
    process.stdout.write(`sequência: ${historico.slice(0, 30).join(" > ")}\n`);
    // O fim importa tanto quanto o começo: 250 ações que terminam em
    // "Ativar > Confirmar > EP" são um duelo andando; terminando no mesmo
    // botão repetido, um laço.
    if (historico.length > 30) {
      process.stdout.write(`últimas: ${historico.slice(-30).join(" > ")}\n`);
    }

    const erros = page.errors;
    const consoleErros = page.console.filter((c) => c.level === "error");
    process.stdout.write(`\nexceções não tratadas: ${erros.length}\n`);
    erros.slice(0, 10).forEach((e) => process.stdout.write(`  ${e.split("\\n")[0]}\n`));
    process.stdout.write(`erros de console: ${consoleErros.length}\n`);
    consoleErros.slice(0, 10).forEach((e) => process.stdout.write(`  ${e.text.slice(0, 200)}\n`));

    if (erros.length || consoleErros.length) process.exitCode = 1;
  } finally {
    child.kill();
  }
}

/**
 * Clica no próprio deck, pede rendição e confirma.
 *
 * Vale como teste porque a rendição não passa pelo engine: o resultado é
 * escrito no snapshot, e se esse caminho quebrar o duelo simplesmente não
 * termina — sem erro nenhum na tela.
 */
async function verificarRendicao(page) {
  // Espera o deck ficar clicável — e não o texto "LP", que a placa de LP
  // mostra desde o primeiro quadro, antes de o duelo ter cartas (o deck com
  // 0 cartas não abre). Com a placa antiga o "LP" nunca aparecia e o teste
  // seguia por acaso, depois do timeout de 60 s.
  let abriu = false;
  for (let i = 0; i < 120 && !abriu; i += 1) {
    abriu = await page.evaluate(`
      const deck = document.querySelector('.tf-playmat [data-pile^="deck-"][role="button"]');
      if (!deck) return false;
      deck.click();
      return true;
    `);
    if (!abriu) await new Promise((r) => setTimeout(r, 500));
  }
  if (!abriu) {
    process.stdout.write("RENDIÇÃO: não achei o deck clicável\n");
    process.exitCode = 1;
    return;
  }

  await page.waitForText("Render-se", { timeout: 5000 }).catch(() => {});
  await page.clickText("Render-se");
  await new Promise((r) => setTimeout(r, 200));
  const confirmou = await page.clickText("Confirmar rendição");
  await page.waitForText("venceu", { timeout: 8000 }).catch(() => {});

  const texto = await page.evaluate("return document.body.innerText");
  const acabou = /venceu/.test(texto);
  process.stdout.write(
    `rendição: pediu confirmação=${confirmou} · duelo encerrado=${acabou}\n`,
  );
  if (!confirmou || !acabou) process.exitCode = 1;
}

const DECK_STORAGE_KEY = "yugioh-goat-deck-v1";

/** Monta o deck do jogador a partir de um preset, no formato do deck builder. */
function deckDoJogador(presetId = process.env.PRESET ?? "starter-yugi") {
  const tcg = presetId.startsWith("tcg-");
  const presets = JSON.parse(
    readFileSync(join(REPO, tcg ? "src/data/preset-decks-tcg.json" : "src/data/preset-decks.json"), "utf8"),
  );
  const preset = presets.find((p) => p.id === presetId) ?? presets[0];

  const agrupar = (codes) => {
    const contagem = new Map();
    for (const code of codes) contagem.set(code, (contagem.get(code) ?? 0) + 1);
    return [...contagem].map(([passcode, quantity]) => ({ passcode, quantity }));
  };

  return {
    id: "teste-navegador",
    name: preset.namePt ?? preset.name,
    format: tcg ? "tcg" : "goat",
    main: agrupar(preset.main),
    extra: agrupar(preset.extra ?? []),
    side: agrupar(preset.side ?? []),
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** O catálogo da YGOPRODeck pode demorar; sem ele o lobby não renderiza nada. */
async function esperarCatalogo(page) {
  for (let tentativa = 0; tentativa < 60; tentativa += 1) {
    const texto = await page.evaluate("return document.body.innerText");
    if (!texto.includes("Carregando catálogo")) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("o catálogo de cartas não carregou");
}

/** Prefere agir a passar o turno — passar não exercita efeito nenhum. */
function escolherAcao(botoes) {
  const prioridade = [
    "Ativar", "Invocação-Especial", "Invocar", "Atacar", "Baixar",
    "Sim", "Opção", "Confirmar", "Concluir", "Mudar posição",
  ];
  for (const chave of prioridade) {
    const achado = botoes.find((b) => b.startsWith(chave));
    if (achado) return achado;
  }
  const avancar = botoes.find((b) => b.includes("Battle Phase") || b.includes("Main Phase 2"));
  if (avancar) return avancar;
  return (
    botoes.find((b) => b.includes("Encerrar turno")) ??
    botoes.find((b) => b === "EP" || b === "BP") ??
    botoes.find((b) => b.includes("Não")) ??
    botoes[0]
  );
}

await main();
