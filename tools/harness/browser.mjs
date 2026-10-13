/**
 * Driver de navegador mínimo, falando CDP direto com o Chrome.
 *
 * Existe porque o teste que mais importa é o que o jogador faz: abrir a
 * página, escolher um deck, clicar nas cartas. O harness headless prova que a
 * engine responde; só o navegador prova que a tela deixa jogar.
 *
 * Sem Playwright/Puppeteer de propósito — ambos baixam um navegador inteiro e
 * entram no package.json. O Chrome já está instalado, o Node 26 já tem
 * WebSocket, e o CDP é o mesmo protocolo que aquelas bibliotecas usam por baixo.
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** Espera uma condição virar verdadeira, ou desiste. */
async function until(check, { timeout = 20000, interval = 100, label = "condição" } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`tempo esgotado esperando ${label}`);
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

export async function launchChrome({
  // Porta variável por padrão: dois testes de navegador ao mesmo tempo na
  // mesma porta fazem o segundo conversar com o Chrome do primeiro.
  port = Number(process.env.CDP_PORT ?? 0) || 9300 + (process.pid % 500),
  headless = true,
} = {}) {
  const profile = mkdtempSync(join(tmpdir(), "ygo-chrome-"));
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    // A página instancia WebAssembly; o sandbox padrão do Chrome sem GPU em
    // headless às vezes derruba o processo antes de o wasm terminar.
    "--disable-gpu",
    "--window-size=1440,900",
    ...(headless ? ["--headless=new"] : []),
    "about:blank",
  ];

  const child = spawn(CHROME, args, { stdio: "ignore", detached: false });

  const version = await until(
    async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`);
        return response.ok ? await response.json() : null;
      } catch {
        return null;
      }
    },
    { label: "o Chrome subir" },
  );

  return { child, port, webSocketDebuggerUrl: version.webSocketDebuggerUrl };
}

/** Sessão CDP numa aba nova. */
export class Page {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    /** Tudo que a página logou — é onde um erro de React aparece. */
    this.console = [];
    this.errors = [];

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
        return;
      }
      if (message.method === "Runtime.consoleAPICalled") {
        const text = (message.params.args ?? [])
          .map((arg) => arg.value ?? arg.description ?? arg.type)
          .join(" ");
        this.console.push({ level: message.params.type, text });
      }
      if (message.method === "Runtime.exceptionThrown") {
        const details = message.params.exceptionDetails;
        this.errors.push(details.exception?.description ?? details.text);
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Avalia uma expressão na página e devolve o valor já serializado. */
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression: `(() => { ${expression} })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? "erro na página");
    }
    return result.result.value;
  }

  async goto(url) {
    await this.send("Page.navigate", { url });
    await until(
      () => this.evaluate("return document.readyState === 'complete'"),
      { label: `${url} carregar` },
    );
  }

  /** Espera um texto aparecer em algum lugar da página. */
  waitForText(text, options = {}) {
    return until(
      () => this.evaluate(`return document.body.innerText.includes(${JSON.stringify(text)})`),
      { label: `o texto ${JSON.stringify(text)}`, ...options },
    );
  }

  /** Clica no primeiro elemento cujo texto casa. Devolve se achou. */
  clickText(text, selector = "button, a, [role=button]") {
    return this.evaluate(`
      const alvo = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((el) => el.innerText.trim().includes(${JSON.stringify(text)}));
      if (!alvo) return false;
      alvo.click();
      return true;
    `);
  }

  /**
   * Clica num BOTÃO DE JOGO pelo texto — o que os laços de jogada usam.
   *
   * Diferente do `clickText`, ignora o cabeçalho do site (navegação, seletor
   * de idioma) e prefere o texto exato. O `clickText` pega o primeiro
   * elemento da página que CONTÉM o texto: um "Deck" escolhido na mesa casava
   * antes com o link "Deck Builder" da navegação, o teste saía do duelo e
   * passava o resto da rodada clicando "Novo" no construtor — criando decks
   * no perfil de teste.
   */
  clickAction(text) {
    return this.evaluate(`
      const botoes = [...document.querySelectorAll("button")].filter(
        (b) => !b.disabled && b.offsetParent !== null && !b.closest("header, nav"),
      );
      const texto = (b) => b.innerText.trim();
      const alvo =
        botoes.find((b) => texto(b) === ${JSON.stringify(text)}) ??
        botoes.find((b) => texto(b).startsWith(${JSON.stringify(text)}));
      if (!alvo) return false;
      alvo.click();
      return true;
    `);
  }

  screenshot() {
    return this.send("Page.captureScreenshot", { format: "png" });
  }

  /**
   * Fecha a aba.
   *
   * É o gesto de quem sai do duelo, e é o único que garante a queda do
   * WebSocket: navegar para `about:blank` deixa a página elegível ao cache de
   * navegação do Chrome (bfcache), onde ela é congelada em vez de destruída — o
   * socket sobrevive, o servidor continua achando que a pessoa está lá, e o
   * teste de queda não observa queda nenhuma.
   */
  close() {
    return this.send("Page.close").catch(() => {});
  }

  /** Redimensiona a janela lógica — para conferir telas menores. */
  setViewport(width, height) {
    return this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
  }

  /**
   * Finge a preferência de sistema "menos movimento".
   *
   * A queda para movimento reduzido é fácil de escrever e fácil de nunca
   * testar: quem desenvolve raramente liga a opção. Emulando dá para conferir
   * que a tela continua legível e que o realce de carta acionável não some.
   */
  setReducedMotion(on) {
    return this.send("Emulation.setEmulatedMedia", {
      features: on ? [{ name: "prefers-reduced-motion", value: "reduce" }] : [],
    });
  }
}

export async function openPage(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
  const target = await response.json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  const page = new Page(socket);
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  return page;
}
