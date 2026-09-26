#!/usr/bin/env node
/**
 * TOUT CE QUI JOUE DOIT ÊTRE DANS LE PAQUET — le garde de la tâche 5.2.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QU'IL EMPÊCHE, ET POURQUOI RIEN D'AUTRE NE L'EMPÊCHAIT.
 *
 * Les trois sons de récompense sont chargés par `require()` dans
 * `src/feedback/sounds.ts`, ce qui les fait entrer dans le paquet. Rien ne
 * garantissait qu'ils y RESTENT : il suffit qu'un jour quelqu'un remplace un
 * `require()` par une URL — un CDN, un stockage Convex — pour que le son
 * disparaisse sans que le typecheck, les tests ni la construction bronchent.
 *
 * Et le jour où cela arrive, la panne ne se voit pas ici. Elle se voit chez un
 * enfant, au village, sans réseau, qui répond juste et n'entend rien. C'est
 * exactement la classe de défaut que la phase 5 existe pour attraper.
 *
 * Ce script lit le manifeste que `expo export` écrit et exige que les trois
 * extensions attendues y soient. Il ne vérifie pas le contenu des fichiers :
 * ce qui se perd, ce n'est jamais le son lui-même, c'est le fait qu'il soit
 * EMBARQUÉ.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const EXPORT_DIR = process.argv[2] ?? ".expo/export-check";
const EXPECTED_MP3 = 3;

const manifestPath = resolve(EXPORT_DIR, "metadata.json");

let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch (error) {
  console.error(
    `Manifeste introuvable ou illisible : ${manifestPath}\n` +
      `Lancez d'abord \`pnpm bundle:check\`.\n${String(error)}`,
  );
  process.exit(1);
}

const assets = manifest?.fileMetadata?.android?.assets;
if (!Array.isArray(assets)) {
  console.error(
    "Le manifeste ne porte pas `fileMetadata.android.assets` — le format " +
      "d'`expo export` a changé, ce garde est à réécrire plutôt qu'à supprimer.",
  );
  process.exit(1);
}

const mp3 = assets.filter((a) => a?.ext === "mp3").length;

if (mp3 < EXPECTED_MP3) {
  console.error(
    `Sons embarqués : ${mp3}, attendu ${EXPECTED_MP3}.\n` +
      "Un son de récompense a quitté le paquet. S'il est désormais chargé " +
      "depuis une URL, l'enfant sans réseau ne l'entendra plus — et personne " +
      "ne le verra avant le terrain. Remettez un `require()` dans " +
      "`src/feedback/sounds.ts`, ou corrigez ce compte en disant pourquoi.",
  );
  process.exit(1);
}

console.log(
  `Assets embarqués : ${assets.length} au total, dont ${mp3} sons. ✔`,
);
