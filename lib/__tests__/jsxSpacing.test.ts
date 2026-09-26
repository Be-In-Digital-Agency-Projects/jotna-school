import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * L'ESPACE QUE LE COMPILATEUR MANGE — un défaut que seul le RENDU a montré.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUI S'EST PASSÉ.
 *
 * Les pages légales portaient dix listes de la forme « terme en gras, puis
 * explication » :
 *
 *     <Strong>Aucun achat.</Strong> Ni prix affiché, ni abonnement, ni
 *     bouton menant à un paiement.
 *
 * L'espace après `</Strong>` appartient à un nœud JSXText qui contient un
 * retour à la ligne. SWC, le compilateur de Next, le MANGE dès que ce nœud
 * fait trois lignes ou plus. Le HTML prégénéré portait donc
 * « Aucun achat.Ni prix affiché », quatre fois sur cinq dans la même liste —
 * la cinquième, dont le texte tenait en deux lignes, gardait son espace.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POURQUOI RIEN NE L'AVAIT VU, ET POURQUOI UN TEST DE SOURCE.
 *
 * Le typecheck passe : le source est valide. Les tests passent : ils ne
 * rendent pas ces pages. Le build passe : il produit du HTML, pas un
 * jugement. Et Prettier — qui suit la sémantique de Babel, où l'espace
 * SURVIT — ANNULE toute correction écrite dans la page : `</Strong>{" "}` y
 * redevient `</Strong> ` au formatage suivant.
 *
 * Il n'y avait donc aucun endroit du source où la correction tienne, sauf
 * derrière une frontière de composant. D'où `Term`
 * (`app/legal/_components/legal-page.tsx`), qui porte l'espace lui-même.
 *
 * Ce test interdit le retour du motif fragile. Il est CONSERVATEUR : il
 * signale aussi les nœuds de deux lignes, que SWC épargne aujourd'hui. Se
 * fier à cette grâce-là, c'est se fier à une largeur de ligne — donc au
 * prochain reformatage.
 */

const ROOT = path.resolve(__dirname, "../..");

/** Les balises en ligne après lesquelles un espace est du SENS, pas du style. */
const CLOSERS = [
  "</Strong>",
  "</strong>",
  "</a>",
  "</span>",
  "</em>",
  "</b>",
  "</Link>",
  "</code>",
];

/**
 * La ponctuation qui se COLLE au mot qui précède.
 *
 * `<Strong>Aucune publicité</Strong>, d'aucune sorte` est juste : il ne faut
 * pas d'espace avant la virgule, et le compilateur n'en mange aucun.
 */
const GLUED = ".,;!?)»…";

function tsxFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFilesUnder(full));
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/**
 * Retire les commentaires avant d'analyser.
 *
 * Sans cela, l'en-tête ci-dessus — qui CITE le motif fragile pour l'expliquer
 * — se dénoncerait lui-même, et la seule façon de faire passer le test serait
 * de cesser de documenter le défaut.
 */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

function fragileSites(src: string): { closer: string; text: string }[] {
  const code = withoutComments(src);
  const sites: { closer: string; text: string }[] = [];
  const pattern = new RegExp(
    CLOSERS.map((c) => c.replace("/", "\\/")).join("|"),
    "g",
  );
  for (const m of code.matchAll(pattern)) {
    const rest = code.slice(m.index + m[0].length);
    // Le nœud texte court jusqu'à la prochaine balise ou accolade.
    const bounds = [rest.indexOf("<"), rest.indexOf("{")].filter(
      (i) => i !== -1,
    );
    const text = rest.slice(
      0,
      bounds.length > 0 ? Math.min(...bounds) : rest.length,
    );
    if (text.length === 0 || !/\s/.test(text[0])) continue;
    if (!text.includes("\n")) continue; // pas de repli : l'espace survit
    const trimmed = text.trim();
    if (trimmed.length === 0 || GLUED.includes(trimmed[0])) continue;
    sites.push({ closer: m[0], text: trimmed.slice(0, 40) });
  }
  return sites;
}

describe("l'espace après une balise en ligne", () => {
  const files = [
    ...tsxFilesUnder(path.join(ROOT, "app")),
    ...tsxFilesUnder(path.join(ROOT, "components")),
  ];

  it("il y a des fichiers à juger", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("aucun ne confie un espace signifiant à un nœud texte replié", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const site of fragileSites(readFileSync(file, "utf8"))) {
        offenders.push(
          `${path.relative(ROOT, file)} — ${site.closer} suivi de « ${site.text}… »`,
        );
      }
    }
    expect(
      offenders,
      "Le compilateur mangera cet espace et les deux mots se colleront. " +
        'Écrire {" "} ne tient pas : Prettier le retire au formatage suivant. ' +
        "Passez par un composant qui porte l'espace (voir Term dans " +
        "app/legal/_components/legal-page.tsx), ou tournez la phrase pour que " +
        "la balise soit suivie d'une ponctuation.",
    ).toEqual([]);
  });

  it("le détecteur reconnaît le motif fautif", () => {
    // LE GARDE DU GARDE : un test qui ne peut plus échouer ne garde rien.
    const bad =
      "<p><Strong>Aucun achat.</Strong> Ni prix affiché, ni\n  abonnement.</p>";
    expect(fragileSites(bad)).toHaveLength(1);
  });

  it("il laisse passer ce qui est juste", () => {
    const glued =
      "<p><Strong>Aucune publicité</Strong>, d&apos;aucune sorte. Il\n  n&apos;y a rien.</p>";
    expect(fragileSites(glued)).toEqual([]);
    const oneLine = "<p><Strong>Oui</Strong> et non.</p>";
    expect(fragileSites(oneLine)).toEqual([]);
    const commented = "/* <Strong>x</Strong> du texte qui\n   se replie */";
    expect(fragileSites(commented)).toEqual([]);
  });
});
