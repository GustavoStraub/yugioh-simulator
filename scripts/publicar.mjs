/**
 * Sobe o jogo e o publica na internet num comando só.
 *
 * Existe porque a alternativa é o ritual de sempre: buildar num terminal,
 * subir o servidor noutro, abrir o túnel num terceiro e depois garimpar a URL
 * no meio do log do cloudflared. Convidar um amigo para jogar não deveria
 * custar três terminais.
 *
 * O túnel é a saída para quem NÃO controla o roteador: ele abre uma conexão de
 * dentro para fora, então não depende de encaminhamento de porta nem de
 * autorização de ninguém. E, de brinde, o endereço vem em HTTPS — o que faz o
 * botão de copiar link voltar a funcionar (a API de área de transferência do
 * navegador só existe em contexto seguro).
 *
 * Uso:
 *   npm run public                 # builda, sobe e publica
 *   npm run public -- --sem-build  # pula o build (útil ao reabrir o túnel)
 *   PORT=3001 npm run public
 */
import { spawn } from "node:child_process";

const PORTA = Number.parseInt(process.env.PORT ?? "3000", 10);
const PULAR_BUILD = process.argv.includes("--sem-build");

/** A URL que o cloudflared anuncia num quadro no meio do log. */
const URL_DO_TUNEL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

/** Processos filhos, para derrubar todos juntos. */
const filhos = new Set();

function encerrar(codigo = 0) {
  for (const filho of filhos) {
    // `SIGTERM` primeiro: o cloudflared fecha o túnel direito quando avisado.
    filho.kill("SIGTERM");
  }
  process.exit(codigo);
}

for (const sinal of ["SIGINT", "SIGTERM"]) {
  process.on(sinal, () => {
    console.log("\n  encerrando servidor e túnel...");
    encerrar(0);
  });
}

function rodar(comando, args, opcoes = {}) {
  const filho = spawn(comando, args, opcoes);
  filhos.add(filho);
  filho.on("exit", () => filhos.delete(filho));
  return filho;
}

/** `cloudflared` existe? Sem ele não há o que fazer. */
async function temCloudflared() {
  return new Promise((resolve) => {
    const teste = spawn("cloudflared", ["--version"], { stdio: "ignore" });
    teste.on("error", () => resolve(false));
    teste.on("exit", (codigo) => resolve(codigo === 0));
  });
}

async function build() {
  console.log("  compilando...");
  return new Promise((resolve, reject) => {
    const filho = rodar("npm", ["run", "build"], { stdio: "inherit" });
    filho.on("exit", (codigo) =>
      codigo === 0 ? resolve() : reject(new Error(`build falhou (${codigo})`)),
    );
  });
}

/** Sobe o servidor e resolve quando ele estiver escutando. */
async function servidor() {
  console.log(`  subindo o servidor na porta ${PORTA}...`);

  const filho = rodar(
    process.execPath,
    ["--import", "./tools/harness/ts-loader-register.mjs", "server.mjs"],
    {
      env: { ...process.env, NODE_ENV: "production", PORT: String(PORTA) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  // O servidor morrer no meio da partida não pode deixar um túnel órfão
  // apontando para uma porta vazia.
  filho.on("exit", (codigo) => {
    console.error(`\n  o servidor encerrou (código ${codigo}).`);
    encerrar(codigo ?? 1);
  });

  return new Promise((resolve, reject) => {
    const prazo = setTimeout(
      () => reject(new Error("o servidor não subiu a tempo")),
      90_000,
    );

    const olhar = (dado) => {
      const texto = String(dado);
      // O `server.mjs` imprime a linha do convite quando já está escutando.
      if (texto.includes("convite:") || texto.includes(`:${PORTA}`)) {
        clearTimeout(prazo);
        resolve();
      }
      if (/error|Error/.test(texto)) process.stderr.write(texto);
    };

    filho.stdout.on("data", olhar);
    filho.stderr.on("data", olhar);
  });
}

/** Abre o túnel e resolve com a URL pública. */
async function tunel() {
  console.log("  abrindo o túnel...");

  const filho = rodar(
    "cloudflared",
    ["tunnel", "--url", `http://localhost:${PORTA}`],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  filho.on("exit", (codigo) => {
    console.error(`\n  o túnel encerrou (código ${codigo}).`);
    encerrar(codigo ?? 1);
  });

  return new Promise((resolve, reject) => {
    const prazo = setTimeout(
      () => reject(new Error("o túnel não devolveu uma URL a tempo")),
      60_000,
    );

    const olhar = (dado) => {
      const achado = URL_DO_TUNEL.exec(String(dado));
      if (achado) {
        clearTimeout(prazo);
        resolve(achado[0]);
      }
    };

    // O cloudflared anuncia pelo stderr; o stdout é vigiado por garantia.
    filho.stdout.on("data", olhar);
    filho.stderr.on("data", olhar);
  });
}

function anunciar(url) {
  const convite = `${url}/duel/online`;
  const moldura = "─".repeat(convite.length + 4);

  console.log(`
  ┌${moldura}┐
  │  ${" ".repeat(convite.length)}  │
  │  ${convite}  │
  │  ${" ".repeat(convite.length)}  │
  └${moldura}┘

  Mande esse link para quem vai jogar. Enquanto este terminal estiver
  aberto, o jogo está no ar; Ctrl+C derruba servidor e túnel juntos.

  Local: http://localhost:${PORTA}
`);
}

if (!(await temCloudflared())) {
  console.error(`
  cloudflared não está instalado — é ele que abre o túnel.

    brew install cloudflared

  Depois rode de novo: npm run public
`);
  process.exit(1);
}

try {
  if (!PULAR_BUILD) await build();
  await servidor();
  anunciar(await tunel());
} catch (erro) {
  console.error(`\n  ${erro instanceof Error ? erro.message : erro}`);
  encerrar(1);
}
