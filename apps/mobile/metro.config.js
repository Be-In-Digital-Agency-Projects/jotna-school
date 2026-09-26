// Metro dans un workspace pnpm — décision D2 du plan.
//
// `watchFolders` — Metro ne surveille par défaut que le dossier de
// l'application. Sans la racine du dépôt, `convex/_generated` régénéré par
// `npx convex dev` ne déclenche PAS de rechargement : on continue de
// travailler contre l'ancienne API, et l'erreur ressemble à un bug
// applicatif, pas à un problème de bundler.
//
// `nodeModulesPaths` — pnpm n'aplatit pas `node_modules`. On indique donc les
// deux racines de résolution : celle de l'application et celle du dépôt.
//
// ---------------------------------------------------------------------------
// CE QU'IL NE FAUT SURTOUT PAS AJOUTER : `disableHierarchicalLookup = true`.
//
// C'est la recommandation courante pour les monorepos npm et yarn, où elle
// empêche une dépendance non déclarée de se résoudre par accident depuis la
// racine aplatie. SOUS PNPM ELLE CASSE LA RÉSOLUTION, et la panne a été
// observée ici, pas supposée : `expo export` échouait sur
//
//     Unable to resolve module whatwg-fetch from
//     .../@expo/metro-runtime/src/location/install.native.ts
//
// La raison tient à la forme du magasin pnpm : les dépendances d'un paquet
// vivent dans `node_modules/.pnpm/<paquet>@<version>/node_modules/`, à côté de
// lui. SEULE la remontée hiérarchique depuis le fichier qui importe va les
// chercher là. La couper revient à interdire à chaque paquet d'atteindre ses
// PROPRES dépendances — exactement l'inverse de l'effet recherché.
//
// La protection contre les dépendances fantômes, sous pnpm, vient du magasin
// lui-même : il a d'ailleurs fait son travail ici en révélant que
// `@expo/metro-runtime`, importé par `expo-router/entry`, n'était déclaré par
// personne. Il est maintenant une dépendance explicite de cette application.
// ---------------------------------------------------------------------------
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

module.exports = config;
