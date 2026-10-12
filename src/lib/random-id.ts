/**
 * Identificador aleatório que funciona **fora de contexto seguro**.
 *
 * `crypto.randomUUID()` é restrito a contexto seguro — https ou `localhost`.
 * O duelo em rede local é jogado exatamente onde ele não existe: o amigo abre
 * `http://192.168.x.y:3000`, que é http puro e não é localhost, e ali
 * `crypto.randomUUID` vem `undefined`. O sintoma é cruel porque não parece um
 * problema de rede: a página quebra no `module evaluation`, antes de qualquer
 * coisa aparecer na tela.
 *
 * `crypto.getRandomValues` **não** tem essa restrição, então é dele que sai o
 * fallback. O formato continua o de um UUID v4 para não invalidar os ids já
 * guardados no `localStorage` de quem jogou antes.
 */
export function randomId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  // Marca versão (4) e variante (RFC 4122), como manda o formato.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
