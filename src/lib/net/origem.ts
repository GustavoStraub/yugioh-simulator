/**
 * De onde a página está sendo servida.
 *
 * A resposta muda o que a tela deve oferecer: rodando em rede local, o convite
 * útil é o IP da máquina; atrás de um túnel (Cloudflare, ngrok) ou de um
 * domínio público, esse IP não leva a lugar nenhum e só confunde quem recebe.
 */

/** Só esta máquina — inútil para qualquer outra pessoa. */
export function ehLocalhost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname.startsWith("127.")
  );
}

/**
 * Endereço alcançável apenas de dentro da rede.
 *
 * Cobre as três faixas privadas do RFC 1918, o `.local` do mDNS e a faixa
 * 100.64/10 — que é onde o Tailscale põe seus endereços, e um duelo por
 * Tailscale é tão "rede local" quanto um pelo Wi-Fi de casa.
 */
export function ehOrigemLocal(hostname: string): boolean {
  if (ehLocalhost(hostname) || hostname.endsWith(".local")) return true;
  if (hostname.startsWith("192.168.") || hostname.startsWith("10.")) return true;

  const partes = hostname.split(".").map(Number);
  if (partes.length !== 4 || partes.some((n) => !Number.isInteger(n))) return false;

  const [a, b] = partes;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}
