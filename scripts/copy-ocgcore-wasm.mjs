import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(
  root,
  "node_modules/@n1xx1/ocgcore-wasm/lib/ocgcore.sync.wasm",
);
const targetDir = join(root, "public/ocgcore");
const target = join(targetDir, "ocgcore.sync.wasm");

mkdirSync(targetDir, { recursive: true });
copyFileSync(source, target);
console.log("Copied ocgcore.sync.wasm to public/ocgcore/");

const modJsPath = join(root, "node_modules/@n1xx1/ocgcore-wasm/mod.js");
const modJsSource = readFileSync(modJsPath, "utf-8");
if (!modJsSource.includes("export { default }")) {
  writeFileSync(
    modJsPath,
    'export * from "./dist/index.js";\nexport { default } from "./dist/index.js";\n',
  );
  console.log("Patched @n1xx1/ocgcore-wasm mod.js default export");
}

const modDtsPath = join(root, "node_modules/@n1xx1/ocgcore-wasm/_dist/mod.d.ts");
writeFileSync(
  modDtsPath,
  'export * from "../dist/index.d.ts";\nexport { default } from "../dist/index.d.ts";\n',
);
console.log("Patched @n1xx1/ocgcore-wasm mod.d.ts default export");
