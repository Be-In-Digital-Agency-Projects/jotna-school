import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { FOOTER_COLUMNS } from "@/components/landing/footer-links";
import { CONTACT_EMAIL, PRIVACY_URL, SITE_DOMAIN } from "@/lib/brand";

/**
 * LA SURFACE PUBLIQUE — ce qu'un relecteur de boutique ouvre en premier.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE FICHIER EXISTE PARCE QUE DEUX DÉFAUTS SE SONT INSTALLÉS SANS UN BRUIT.
 *
 * LE PREMIER : six liens légaux du pied de page rendaient un 404. Le site
 * annonçait une politique de confidentialité depuis le premier jour et n'en
 * servait aucune. Apple et Google vérifient cette URL AVANT de regarder
 * l'application ; ils l'auraient trouvée morte.
 *
 * LE SECOND : trois domaines pour une seule marque. Les courriels partaient
 * de `jotnaschool.app` — non possédé, refusé par Resend, aucun envoi ne
 * passait. Corrigé en `jotnaschool.com`. Puis les pages légales, les fiches de
 * boutique et un écran du mobile ont donné `jotna.school`, également non
 * possédé, sans que rien ne le relève.
 *
 * Les deux ont la même forme : une adresse écrite à la main, jamais visitée,
 * jamais comparée. Une application ne plante pas parce qu'elle ment sur son
 * adresse — elle continue, et c'est le parent qui écrit dans le vide.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER NE PEUT PAS FAIRE : dire si `jotnaschool.com` est
 * RÉELLEMENT à nous. Aucun test ne visite le DNS. Il garantit l'UNITÉ, pas la
 * possession — et l'unité est déjà ce qui a manqué trois fois.
 */

const ROOT = path.resolve(__dirname, "../..");

/** Les routes servies, telles que Next les dérive de `app/`. */
function discoverRoutes(dir: string, prefix = ""): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (entry === "page.tsx") {
      routes.push(prefix === "" ? "/" : prefix);
      continue;
    }
    if (!statSync(full).isDirectory()) continue;
    // Un dossier entre parenthèses est un GROUPE : il organise les fichiers
    // et ne paraît pas dans l'URL. Un dossier commençant par `_` est tenu
    // hors du routage — c'est ce qui range `_components`.
    if (entry.startsWith("_")) continue;
    const isGroup = entry.startsWith("(") && entry.endsWith(")");
    routes.push(
      ...discoverRoutes(full, isGroup ? prefix : `${prefix}/${entry}`),
    );
  }
  return routes;
}

const ROUTES = new Set(discoverRoutes(path.join(ROOT, "app")));

/**
 * Les deux pages légales qui ne sont pas encore écrites, ET QUI SONT LIÉES.
 *
 * Elles demandent la forme juridique, l'adresse, le NINEA et une relecture
 * juridique : elles ne s'inventent pas, et les retirer du pied de page
 * reviendrait à cacher le manque plutôt qu'à le porter.
 *
 * LA LISTE EST UNE DETTE, PAS UNE EXEMPTION. Le test du bas échoue le jour où
 * l'une d'elles existe, pour forcer son retrait d'ici.
 */
const PENDING = ["/legal/mentions", "/legal/cgu"];

const FOOTER_LINKS = FOOTER_COLUMNS.flatMap((c) => c.links);

describe("les liens du pied de page", () => {
  const internal = FOOTER_LINKS.filter(
    (l) => l.external !== true && l.href.startsWith("/"),
  );

  it("il y en a, sans quoi ce fichier ne garderait rien", () => {
    expect(internal.length).toBeGreaterThan(5);
  });

  it.each(internal.filter((l) => !l.href.includes("#")))(
    "« $label » mène à une page qui existe",
    ({ href }) => {
      if (PENDING.includes(href)) return;
      expect(
        ROUTES.has(href),
        `${href} n'a pas de page. Écrivez-la, ou inscrivez-la dans PENDING — ` +
          `ne la laissez pas rendre un 404 au relecteur de la boutique.`,
      ).toBe(true);
    },
  );

  it.each(internal.filter((l) => l.href.includes("#")))(
    "« $label » vise une ancre présente dans la page",
    ({ href }) => {
      const [route, anchor] = href.split("#");
      expect(ROUTES.has(route === "" ? "/" : route)).toBe(true);
      // Une ancre absente ne casse rien de visible : le clic ne défile
      // simplement pas. C'est le genre de panne qu'on ne trouve qu'en
      // cliquant, donc qu'on ne trouve pas.
      expect(
        grepRepo(`id="${anchor}"`, ["app", "components"]).length,
        `Aucun élément ne porte id="${anchor}" : le lien ne défile nulle part.`,
      ).toBeGreaterThan(0);
    },
  );

  it.each(PENDING)(
    "%s est toujours à écrire — sinon retirez-la de PENDING",
    (href) => {
      expect(
        ROUTES.has(href),
        `${href} existe maintenant. Retirez-la de PENDING pour que le test la garde.`,
      ).toBe(false);
    },
  );
});

describe("un seul domaine pour toute la marque", () => {
  /** Les surfaces qui montrent une adresse à un humain. */
  const SURFACES = [
    "components/landing/footer.tsx",
    "app/legal",
    "apps/mobile/src/screens",
    "docs/legal",
    "lib/email-brand.ts",
  ];

  it("le pied de page et les pages légales donnent la même adresse", () => {
    const footer = readFileSync(
      path.join(ROOT, "components/landing/footer.tsx"),
      "utf8",
    );
    // Les deux importent la constante ; le test le vérifie plutôt que de
    // faire confiance, car c'est précisément la recopie qui avait dérivé.
    expect(footer).toContain("CONTACT_EMAIL");
    expect(CONTACT_EMAIL).toBe(`contact@${SITE_DOMAIN}`);
    expect(PRIVACY_URL).toBe(`https://${SITE_DOMAIN}/legal/confidentialite`);
  });

  it("la politique de confidentialité que les boutiques visitent est servie", () => {
    // `PRIVACY_URL` est soumise telle quelle dans les deux fiches. Si la page
    // disparaissait ou changeait de chemin, la fiche resterait juste fausse.
    expect(ROUTES.has(new URL(PRIVACY_URL).pathname)).toBe(true);
  });

  it("aucune surface ne mentionne un autre domaine de marque", () => {
    const offenders: string[] = [];
    for (const surface of SURFACES) {
      for (const file of filesUnder(path.join(ROOT, surface))) {
        const text = readFileSync(file, "utf8");
        for (const [i, line] of text.split("\n").entries()) {
          // On cherche « jotna » suivi d'un point ou d'un tiret bas, c'est-à-
          // dire un NOM DE DOMAINE. `com.jotna.school` est l'identifiant de
          // paquet en DNS inversé, et `jotna-logo.png` un fichier : ni l'un
          // ni l'autre n'est une adresse.
          const found = line.match(/\bjotna[a-z]*\.[a-z]{2,}/gi) ?? [];
          for (const hit of found) {
            if (hit.toLowerCase() === SITE_DOMAIN) continue;
            if (line.includes(`com.${hit}`)) continue;
            // Les commentaires qui RACONTENT la panne citent forcément les
            // mauvais domaines. Ils sont la documentation du garde.
            if (isPurelyExplanatory(line)) continue;
            offenders.push(`${path.relative(ROOT, file)}:${i + 1} → ${hit}`);
          }
        }
      }
    }
    expect(
      offenders,
      `Un autre domaine que ${SITE_DOMAIN} est présenté à un humain. ` +
        `Importez la constante de lib/brand.ts.`,
    ).toEqual([]);
  });
});

/** Les lignes de commentaire ne présentent rien à un utilisateur. */
function isPurelyExplanatory(line: string): boolean {
  const t = line.trim();
  return t.startsWith("*") || t.startsWith("//") || t.startsWith("> ");
}

function filesUnder(target: string): string[] {
  if (!statSync(target).isDirectory()) return [target];
  return readdirSync(target).flatMap((entry) =>
    filesUnder(path.join(target, entry)),
  );
}

function grepRepo(needle: string, dirs: string[]): string[] {
  const hits: string[] = [];
  for (const dir of dirs) {
    for (const file of filesUnder(path.join(ROOT, dir))) {
      if (!/\.tsx?$/.test(file)) continue;
      if (readFileSync(file, "utf8").includes(needle)) hits.push(file);
    }
  }
  return hits;
}
