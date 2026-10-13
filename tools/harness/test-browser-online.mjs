/**
 * Duas abas, dois jogadores — o cenário que o duelo online existe para servir.
 *
 * O `test-multiplayer` prova o servidor; este prova o resto do caminho: o
 * lobby, o socket do navegador, a identidade por aba (`sessionStorage`) e —
 * o que nenhum outro teste cobre — a mesa desenhada na ótica do assento **1**.
 * Todo o tabuleiro foi escrito quando "você" era sempre o jogador 0; é do lado
 * de baixo espelhado que um erro de perspectiva aparece.
 *
 * Uso: node tools/harness/test-browser-online.mjs [--headed]
 */
import { launchChrome, openPage } from "./browser.mjs";

const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:3000";
/**
 * Jogadas antes de derrubar a aba do Bruno. A queda precisa de um duelo EM
 * ANDAMENTO (terminado, não há o que encerrar), e com decks TCG um duelo
 * acaba em ~50 ações — com 60 o teste às vezes testava a queda depois do
 * fim. 24 exercitam bem a mesa e deixam o duelo vivo.
 */
const MAX_ACOES = 24;

/**
 * Endereço pelo qual o teste abre o app.
 *
 * Sai do IP da REDE, e não de `127.0.0.1`, de propósito: `localhost` é
 * "contexto seguro" para o navegador e `192.168.x.y` não é. Metade da API de
 * `crypto` some fora de contexto seguro (`randomUUID`, `subtle`), e um teste
 * rodando só em localhost jura que está tudo bem enquanto o amigo do outro
 * computador vê a página quebrar antes de renderizar. Foi exatamente esse o
 * primeiro bug que passou por aqui.
 */
async function enderecoDeRede() {
  if (!/^https?:\/\/(localhost|127\.|\[::1\])/.test(APP_URL)) return APP_URL;
  try {
    const response = await fetch(`${APP_URL}/api/duel/net-info`);
    const { urls } = await response.json();
    if (urls?.[0]) {
      const porta = new URL(APP_URL).port;
      const alvo = new URL(urls[0]);
      if (porta) alvo.port = porta;
      return alvo.origin;
    }
  } catch {
    // Sem rede alcançável, testar em localhost ainda é melhor que não testar.
  }
  return APP_URL;
}

const LER_ESTADO = `
  const mesa = document.querySelector(".tf-playmat");
  if (!mesa) return { naMesa: false, texto: document.body.innerText.slice(0, 300) };
  const util = (b) =>
    !b.disabled && b.offsetParent !== null &&
    !b.closest("[data-table-control]") && !b.innerText.includes("\\u{1F50A}") && !b.innerText.includes("\\u{1F507}") &&
    !b.closest('[aria-label="Idioma das cartas"]');
  const texto = mesa.innerText;
  return {
    naMesa: true,
    botoes: [...document.querySelectorAll("button")].filter(util).map((b) => b.innerText.trim()).filter(Boolean),
    cartas: document.querySelectorAll(".tf-slot-active").length,
    aguardando: /aguardando /i.test(texto),
    processando:
      mesa.dataset?.processing === "1" ||
      mesa.dataset?.waitingFoe === "1" ||
      /Processando|Preparando duelo/.test(texto),
    erro: texto.includes("Erro:") || texto.includes("interrompido"),
    acabou: texto.includes("venceu") || texto.includes("empatad"),
    trecho: texto.slice(0, 300),
  };
`;

/** Identidade da mesa desta aba: de quem é a mão de baixo e o deck de baixo. */
const LER_PERSPECTIVA = `
  const minhaMao = document.querySelector(".tf-playmat [data-hand]:last-of-type");
  const maos = [...document.querySelectorAll(".tf-playmat [data-hand]")].map((el) => el.getAttribute("data-hand"));
  const pilhas = [...document.querySelectorAll(".tf-playmat [data-pile]")].map((el) => el.getAttribute("data-pile"));
  void minhaMao;
  return { maos, pilhas };
`;

const CLICAR_CARTA = `
  const cartas = [...document.querySelectorAll(".tf-slot-active")];
  if (cartas.length === 0) return null;
  const escolhida = cartas[Math.floor(Math.random() * cartas.length)];
  escolhida.click();
  return escolhida.closest("[data-zone]")?.getAttribute("data-zone") ?? "?";
`;

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

const falhas = [];
function conferir(condicao, descricao, detalhe = "") {
  console.log(`  ${condicao ? "✓" : "✗"} ${descricao}${!condicao && detalhe ? ` — ${detalhe}` : ""}`);
  if (!condicao) falhas.push(descricao);
}

const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(fn, label, timeout = 60000) {
  const fim = Date.now() + timeout;
  for (;;) {
    const valor = await fn();
    if (valor) return valor;
    if (Date.now() > fim) throw new Error(`tempo esgotado esperando ${label}`);
    await espera(200);
  }
}

/**
 * `FORMATO=tcg` joga a sala inteira com decks TCG (os dois do mesmo formato,
 * senão a sala não abre o jokenpô); o padrão é Goat.
 */
const GRUPO = process.env.FORMATO === "tcg" ? "TCG" : "Goat";

/** Escolhe um deck pronto do formato no seletor do lobby (o jogador não tem deck salvo). */
async function escolherPreset(page, indice) {
  return page.evaluate(`
    const select = document.querySelector("select");
    if (!select) return false;
    // Só os grupos do formato: "Meus decks" (o deck salvo, vazio nesta aba)
    // e os do outro formato ficam de fora.
    const opcao = [...select.querySelectorAll("optgroup")]
      .filter((grupo) => grupo.label.startsWith(${JSON.stringify(GRUPO)}))
      .flatMap((grupo) => [...grupo.querySelectorAll("option")])[${indice}];
    if (!opcao) return false;
    select.value = opcao.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return opcao.text;
  `);
}

async function esperarCatalogo(page) {
  await until(
    async () => !(await page.evaluate("return document.body.innerText")).includes("Carregando catálogo"),
    "o catálogo de cartas",
  );
}

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
  const BASE = await enderecoDeRede();
  const { child, port } = await launchChrome({ headless: !headed });

  try {
    const seguro = /^https:|^https?:\/\/(localhost|127\.|\[::1\])/.test(BASE);
    console.log(`abrindo duas abas em ${BASE}/duel/online`);
    console.log(`contexto ${seguro ? "SEGURO (não cobre a API de crypto restrita)" : "inseguro — como o amigo da LAN vê"}\n`);
    const [ana, bruno] = [await openPage(port), await openPage(port)];

    // --- Ana cria a sala ---
    await ana.goto(`${BASE}/duel/online`);
    await apresentarSe(ana, "Ana");
    await esperarCatalogo(ana);
    conferir(Boolean(await escolherPreset(ana, 0)), "Ana escolheu um deck pronto");
    conferir(await ana.clickText("Criar sala nova"), "Ana criou a sala");

    const url = await until(
      async () => {
        const atual = await ana.evaluate("return location.pathname");
        return /^\/duel\/online\/[A-Z0-9]{4}$/.test(atual) ? atual : null;
      },
      "a navegação para a sala",
    );
    const code = url.split("/").pop();
    console.log(`  sala: ${code}`);

    await ana.waitForText("Aguardando o segundo duelista", { timeout: 30000 });
    conferir(true, "Ana entrou e vê a sala vazia");

    // --- Bruno entra pelo link ---
    await bruno.goto(`${BASE}/duel/online?room=${code}`);
    await apresentarSe(bruno, "Bruno");
    await esperarCatalogo(bruno);
    conferir(Boolean(await escolherPreset(bruno, 1)), "Bruno escolheu outro deck");
    conferir(await bruno.clickText("Entrar na sala"), "Bruno entrou na sala");

    await bruno.waitForText("Duelistas (2/2)", { timeout: 30000 });
    await ana.waitForText("Duelistas (2/2)", { timeout: 30000 });
    conferir(true, "as duas abas se veem como jogadores distintos");

    // As duas abas dividem o mesmo `localStorage`, logo o mesmo perfil e o
    // mesmo nome. Quem separa é o servidor, que desambigua na entrada — é
    // exatamente o caso de "abri a mesma URL duas vezes".
    const nomes = await ana.evaluate(`
      return [...document.querySelectorAll("li")]
        .filter((li) => /Pronto|Escolhendo/.test(li.innerText))
        .map((li) => li.innerText.split("\\n")[0].trim());
    `);
    conferir(
      nomes.length === 2 && nomes[0] !== nomes[1],
      `cada aba tem identidade própria (${nomes.join(" / ")})`,
    );

    // --- troca de deck dentro da sala, sem sair dela ---
    // A ÚLTIMA opção de propósito: pegar "a próxima diferente" caía no mesmo
    // deck que a Ana já tinha escolhido, e aí o nome aparecer na tela dela era
    // legítimo — a checagem de privacidade acusava um vazamento que não havia.
    // A última dos grupos **Goat**: a Ana está num deck Goat, e com os decks
    // TCG no fim da lista a última opção virou um deck TCG — a sala, com
    // razão, não abria o jokenpô entre formatos diferentes.
    const trocado = await bruno.evaluate(`
      const select = document.querySelector("select");
      if (!select) return null;
      const opcao = [...select.querySelectorAll("optgroup")]
        .filter((grupo) => grupo.label.startsWith(${JSON.stringify(GRUPO)}))
        .flatMap((grupo) => [...grupo.querySelectorAll("option")])
        .filter((o) => o.value)
        .at(-1);
      if (!opcao) return null;
      select.value = opcao.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return opcao.text;
    `);
    conferir(Boolean(trocado), `Bruno trocou de deck dentro da sala (${trocado})`);

    await espera(600);
    // A lista segue a ordem de entrada: [0] é a Ana, [1] é o Bruno.
    const linhas = async (page) =>
      page.evaluate(
        `return [...document.querySelectorAll("li")].filter((li) => /Pronto|Escolhendo/.test(li.innerText)).map((li) => li.innerText)`,
      );
    const naTelaDaAna = await linhas(ana);
    const naTelaDoBruno = await linhas(bruno);
    const rotuloDoDeck = String(trocado).split(" (")[0];

    conferir(
      (naTelaDoBruno[1] ?? "").includes(rotuloDoDeck),
      "Bruno vê o próprio deck na lista da sala",
    );
    conferir(
      !(naTelaDaAna[1] ?? "").includes(rotuloDoDeck),
      `Ana NÃO vê qual deck o Bruno escolheu (ela lê "${(naTelaDaAna[1] ?? "").replace(/\n/g, " ")}")`,
    );

    // --- prontos ---
    await ana.clickText("Estou pronto");
    await bruno.clickText("Estou pronto");

    // --- jokenpô pelo primeiro turno ---
    // Com os dois prontos a sala não começa o duelo: ela abre a disputa de
    // quem joga primeiro. Aqui isso é exercitado pela TELA, inclusive o
    // empate, que é o caminho que mais fácil deixa a interface travada
    // (esperando uma decisão que já foi tomada).
    console.log("\njokenpô pelo primeiro turno...");
    for (const [nome, page] of [["Ana", ana], ["Bruno", bruno]]) {
      const apareceu = await until(
        async () => page.evaluate(`return /Quem começa/.test(document.body.innerText)`),
        `o jokenpô na aba do ${nome}`,
        15000,
      ).catch(() => false);
      conferir(Boolean(apareceu), `${nome} vê a disputa do primeiro turno`);
    }

    // Empate de propósito: os dois na pedra.
    await ana.clickText("Pedra");
    await bruno.clickText("Pedra");
    const empatou = await until(
      async () => ana.evaluate(`return /empate/i.test(document.body.innerText)`),
      "o empate ser anunciado",
      15000,
    ).catch(() => false);
    conferir(Boolean(empatou), "o empate é anunciado e a rodada recomeça");

    // Agora com vencedora: papel ganha de pedra.
    await ana.clickText("Papel");
    await bruno.clickText("Pedra");
    const escolhe = await until(
      async () => ana.evaluate(`return /Jogar primeiro/.test(document.body.innerText)`),
      "a escolha da ordem",
      15000,
    ).catch(() => false);
    conferir(Boolean(escolhe), "quem ganhou escolhe começar ou não");
    const esperando = await bruno.evaluate(
      `return /está escolhendo/.test(document.body.innerText)`,
    );
    conferir(Boolean(esperando), "quem perdeu vê que o outro está escolhendo");
    await ana.clickText("Jogar primeiro");

    console.log("\nesperando o duelo começar...");
    for (const page of [ana, bruno]) {
      await until(
        async () => (await page.evaluate(LER_ESTADO)).naMesa,
        "a mesa aparecer",
        90000,
      );
    }
    conferir(true, "as duas abas chegaram à mesa");

    // --- perspectiva: cada aba tem que ancorar os dois assentos absolutos ---
    for (const [nome, page] of [["Ana", ana], ["Bruno", bruno]]) {
      const p = await page.evaluate(LER_PERSPECTIVA);
      conferir(
        p.maos.includes("0") && p.maos.includes("1"),
        `${nome}: as duas mãos ancoradas por índice absoluto (${p.maos.join(",")})`,
      );
      conferir(
        p.pilhas.includes("deck-0") && p.pilhas.includes("deck-1"),
        `${nome}: os dois decks ancorados por índice absoluto (${p.pilhas.join(",")})`,
      );
    }

    // --- joga ---
    console.log("\njogando...");
    let acoes = 0;
    let parado = 0;
    const prazo = Date.now() + 1000 * 60 * 4;
    let viuAguardando = false;
    let duelosAcabados = false;

    while (acoes < MAX_ACOES && Date.now() < prazo) {
      let agiu = false;

      for (const [nome, page] of [["Ana", ana], ["Bruno", bruno]]) {
        const estado = await page.evaluate(LER_ESTADO);
        if (!estado.naMesa) continue;
        if (estado.aguardando) viuAguardando = true;
        if (estado.acabou) {
          console.log(`  duelo terminou após ${acoes} ações (${nome} viu o resultado).`);
          duelosAcabados = true;
          acoes = MAX_ACOES;
          break;
        }
        if (estado.erro) {
          conferir(false, `erro na tela de ${nome}: ${estado.trecho}`);
          acoes = MAX_ACOES;
          break;
        }
        if (estado.processando || (estado.botoes.length === 0 && estado.cartas === 0)) continue;

        if (estado.cartas > 0) {
          await page.evaluate(CLICAR_CARTA);
          await espera(180);
          const depois = await page.evaluate(LER_ESTADO);
          const acao = escolherAcao(depois.botoes);
          if (acao) await page.clickAction(acao);
        } else {
          const acao = escolherAcao(estado.botoes);
          if (acao) await page.clickAction(acao);
        }
        acoes += 1;
        agiu = true;
        await espera(200);
      }

      if (!agiu) {
        parado += 1;
        // Trinta leituras sem nada acionável nas DUAS abas é congelamento —
        // o engine espera uma resposta que nenhuma das telas sabe pedir.
        if (parado > 30) {
          for (const [nome, page] of [["Ana", ana], ["Bruno", bruno]]) {
            const diag = await page.evaluate(`
              const mesa = document.querySelector(".tf-playmat");
              const barra = [...document.querySelectorAll("div")].find(
                (d) => d.querySelector("button") && /Confirmar/.test(d.innerText) && d.innerText.length < 400,
              );
              return {
                modais: document.querySelectorAll(".tf-modal-scrim").length,
                botoesTodos: [...document.querySelectorAll("button")].map((b) => (b.disabled ? "[x]" : "") + b.innerText.trim()).filter(Boolean).slice(0, 12),
                ativos: document.querySelectorAll(".tf-slot-active").length,
                barra: barra ? barra.innerText.replace(/\\n+/g, " | ").slice(0, 260) : "(sem barra de seleção)",
                zonas: [...document.querySelectorAll("[data-zone]")].length,
                texto: mesa ? mesa.innerText.replace(/\\n+/g, " | ").slice(0, 260) : "(sem mesa)",
              };
            `);
            console.log(`      [${nome}] modais=${diag.modais} ativos=${diag.ativos} zonas=${diag.zonas}`);
            console.log(`      [${nome}] botões: ${JSON.stringify(diag.botoesTodos)}`);
            console.log(`      [${nome}] seleção: ${diag.barra}`);
            console.log(`      [${nome}] mesa: ${diag.texto}`);
          }
          conferir(false, `travou após ${acoes} ações — nada clicável nas duas abas`);
          break;
        }
        await espera(400);
      } else {
        parado = 0;
      }
    }

    // --- queda no meio do duelo ---
    // A falha que isto cobre é silenciosa: o outro fecha a aba, o engine fica
    // esperando a resposta dele, e a tela de quem ficou continua idêntica à de
    // um duelo normal — "Aguardando Fulano…" para sempre.
    console.log("\nfechando a aba do Bruno no meio do duelo...");
    // Fecha a ABA, não navega para `about:blank`: ver `Page.close`.
    await bruno.close();

    const avisou = await until(
      async () => /caiu/i.test(await ana.evaluate("return document.body.innerText")),
      "o aviso de que o adversário caiu",
      15000,
    ).catch(() => false);
    conferir(Boolean(avisou), "a mesa avisa que o adversário caiu");

    const tolerancia = Number(process.env.DUEL_DISCONNECT_GRACE_MS ?? 45000);
    const podeEncerrar = await until(
      async () =>
        ana.evaluate(
          `return [...document.querySelectorAll("button")].some((b) => b.innerText.includes("Encerrar duelo"))`,
        ),
      "o botão de encerrar",
      tolerancia + 15000,
    ).catch(() => false);
    if (!podeEncerrar) {
      const diag = await ana.evaluate(`
        const mesa = document.querySelector(".tf-playmat");
        return {
          jaAcabou: /venceu|Empate/.test(document.body.innerText),
          aviso: (document.body.innerText.match(/.*caiu.*/) || [""])[0].slice(0, 120),
          botoes: [...document.querySelectorAll("button")].map((b) => b.innerText.trim()).filter(Boolean).slice(0, 10),
          mesa: mesa ? mesa.innerText.replace(/\\n+/g, " | ").slice(0, 160) : "(sem mesa)",
        };
      `);
      console.log(`      duelo já tinha acabado antes da queda? ${diag.jaAcabou}`);
      console.log(`      aviso: ${diag.aviso}`);
      console.log(`      botões: ${JSON.stringify(diag.botoes)}`);
    }
    conferir(
      Boolean(podeEncerrar),
      "passada a tolerância aparece como encerrar",
      duelosAcabados ? "o duelo acabou ANTES da queda — nada a encerrar; jogar menos ações antes" : "",
    );

    if (podeEncerrar) {
      await ana.clickText("Encerrar duelo");
      const terminou = await until(
        async () => /venceu|Empate/.test(await ana.evaluate("return document.body.innerText")),
        "o resultado",
        15000,
      ).catch(() => false);
      conferir(Boolean(terminou), "encerrar o duelo abandonado mostra o resultado");
    }

    console.log("");
    conferir(acoes >= 10, `o duelo avançou nas duas abas (${acoes} ações)`);
    conferir(viuAguardando, "quem não é o da vez vê o aviso de 'aguardando'");

    for (const [nome, page] of [["Ana", ana], ["Bruno", bruno]]) {
      const consoleErros = page.console.filter((c) => c.level === "error");
      conferir(page.errors.length === 0, `${nome}: sem exceções não tratadas`);
      page.errors.slice(0, 5).forEach((e) => console.log(`      ${e.split("\n")[0]}`));
      conferir(consoleErros.length === 0, `${nome}: sem erros de console`);
      consoleErros.slice(0, 5).forEach((e) => console.log(`      ${e.text.slice(0, 200)}`));
    }
  } finally {
    child.kill();
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
