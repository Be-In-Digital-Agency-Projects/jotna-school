import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Le mobile n'est pas du Next : `eslint-config-next` y signalerait des
    // règles qui n'ont pas de sens en React Native (`next/image`, liens,
    // etc.). Il a sa propre configuration.
    "apps/**",
  ]),
]);

export default eslintConfig;
