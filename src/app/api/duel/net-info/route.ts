import { NextResponse } from "next/server";

import { lanUrls, serverPort } from "@/server/net-info";

/**
 * Endereços pelos quais um amigo da mesma rede alcança este servidor.
 *
 * O navegador não tem como descobrir isso sozinho: `window.location.origin`
 * devolve `localhost` para quem hospeda, que é justamente o endereço que não
 * funciona para o convidado.
 */
export function GET() {
  return NextResponse.json({ urls: lanUrls(serverPort()) });
}
