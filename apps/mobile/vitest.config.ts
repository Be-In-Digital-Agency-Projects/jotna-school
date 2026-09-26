import { defineConfig } from "vitest/config";

/**
 * LES TESTS DE L'APPLICATION MOBILE — et ce qu'ils couvrent VRAIMENT.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ILS NE RENDENT AUCUN COMPOSANT, ET C'EST DÉLIBÉRÉ.
 *
 * Éprouver du React Native sous Node demande `react-test-renderer` ou
 * `@testing-library/react-native`, un préréglage Babel, et des doublures pour
 * chaque module natif (`expo-sqlite`, `expo-secure-store`, `expo-audio`…).
 * C'est une chaîne entière à entretenir, et elle n'éprouverait toujours pas ce
 * qui compte : la manière dont ces modules natifs se comportent VRAIMENT.
 *
 * Ce qui est ici, c'est la LOGIQUE PURE — celle qui décide, et qui peut avoir
 * tort sans que rien ne plante. `environment: "node"` et aucune doublure : un
 * fichier testé ici ne doit rien importer d'`expo`, faute de quoi le test
 * échoue à l'import, ce qui est exactement le rappel qu'on veut.
 *
 * Le reste — écrans, base SQLite, synchronisation réelle — attend un appareil
 * et un déploiement de développement. C'est dit sans détour à la tâche 3.13 du
 * plan ; ce fichier réduit ce reste, il ne le supprime pas.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * IL EST SÉPARÉ DU `vitest.config.ts` DE LA RACINE, et il doit le rester : le
 * config du web tourne en `jsdom`, avec l'alias `@` pointant sur le web et
 * `vitest/globals` dans les types. Ramener ces tests-ci dedans rouvrirait
 * exactement ce que la phase 0 a fermé.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
