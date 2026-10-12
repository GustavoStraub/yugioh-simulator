/**
 * Registra o resolvedor de `@/...` no loader de módulos do Node.
 *
 * Use com `node --import ./tools/harness/ts-loader-register.mjs <script>`.
 */
import { registerHooks } from "node:module";

import { resolve } from "./ts-loader.mjs";

registerHooks({ resolve });
