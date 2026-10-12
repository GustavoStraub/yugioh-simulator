import { networkInterfaces } from "node:os";

/**
 * Endereços IPv4 desta máquina na rede local.
 *
 * Existe porque o anfitrião quase sempre abre o app em `localhost`, e
 * `localhost` não serve para o amigo do outro computador. Sem isto, convidar
 * alguém exigiria ir buscar o IP num terminal.
 *
 * A ordem importa: a lista vem cheia de interfaces virtuais (Docker,
 * OrbStack, VPN) que respondem `192.168.x.y` sem alcançar ninguém, e é o
 * PRIMEIRO endereço que vira o link de convite. Duas peneiras dão conta do
 * caso comum sem precisar adivinhar topologia:
 *
 * 1. último octeto 0 é endereço de REDE, nunca de máquina — as pontes do
 *    OrbStack aparecem assim;
 * 2. no macOS a placa de verdade é `en0`/`en1`; no Linux, `eth*`/`wl*`. Elas
 *    vão para a frente, e o resto fica como alternativa em vez de sumir (numa
 *    máquina de nome diferente, sumir seria pior).
 */
const INTERFACES_FISICAS = /^(en|eth|wl)\d/;

interface Endereco {
  address: string;
  fisica: boolean;
}

function enderecos(): Endereco[] {
  const encontrados: Endereco[] = [];

  for (const [nome, nics] of Object.entries(networkInterfaces())) {
    for (const nic of nics ?? []) {
      if (nic.family !== "IPv4" || nic.internal) continue;
      if (nic.address.endsWith(".0")) continue;
      encontrados.push({
        address: nic.address,
        fisica: INTERFACES_FISICAS.test(nome),
      });
    }
  }

  return encontrados.sort(
    (a, b) => Number(b.fisica) - Number(a.fisica),
  );
}

export function lanAddresses(): string[] {
  return enderecos().map((endereco) => endereco.address);
}

export function lanUrls(port: number, path = ""): string[] {
  return lanAddresses().map((address) => `http://${address}:${port}${path}`);
}

/** Porta em que o servidor está escutando (definida pelo `server.mjs`). */
export function serverPort(): number {
  return Number(process.env.PORT ?? 3000);
}
