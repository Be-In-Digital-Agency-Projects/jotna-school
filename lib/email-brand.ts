/**
 * L'en-tête de marque des courriels — UN SEUL EXEMPLAIRE.
 *
 * POURQUOI ELLE EXISTE. Quatre gabarits portaient le même bloc, copié au
 * caractère près : bandeau `#0d9488`, `<h1>Jotna School</h1>`, sous-titre en
 * `#ccfbf1`. Y poser un logo aurait voulu dire modifier quatre fichiers, puis
 * quatre fois encore au prochain changement de marque — et le cinquième
 * gabarit, le reçu, aurait fini par diverger sans que personne le voie.
 *
 * LE LOGO EST FACULTATIF, ET L'ABSENCE EST LE CAS NORMAL. `EMAIL_LOGO_URL`
 * n'est pas posée sur tous les déploiements ; sans elle on retombe sur le
 * texte, qui a le mérite de toujours s'afficher. Un `<img>` pointant vers une
 * URL morte donnerait un rectangle barré en haut de chaque courriel.
 *
 * L'URL EST VÉRIFIÉE AVANT D'ÊTRE ÉCRITE. Elle vient d'une variable
 * d'environnement, donc d'un humain pressé : une valeur mal formée casserait
 * l'attribut `src` et, avec un guillemet, le balisage entier.
 */

type Tone = "onTeal" | "onWhite";

/** Une URL exploitable dans un `src`, ou `null`. */
function safeLogoUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  const url = raw.trim();
  if (!url.startsWith("https://")) return null;
  if (/["'<>\s]/.test(url)) return null;
  return url;
}

/**
 * La balise `<img>` du logo, ou une chaîne vide quand rien n'est publié.
 *
 * 200 px de large : au-delà, le logo déborde sur les clients mobiles, qui
 * affichent le corps du courriel autour de 320 px. `width` est répété en
 * attribut ET en style parce qu'Outlook ignore le second.
 */
export function emailLogoImgHtml(logoUrl: string | undefined, width = 200): string {
  const logo = safeLogoUrl(logoUrl);
  if (!logo) return "";
  return `<img src="${logo}" alt="Jotna School" width="${width}" style="display:block;width:${width}px;max-width:100%;height:auto;border:0;" />`;
}

export function emailBrandHtml(options: {
  subtitle: string;
  logoUrl?: string;
  tone?: Tone;
}): string {
  const tone: Tone = options.tone ?? "onTeal";
  const logo = safeLogoUrl(options.logoUrl);

  const brand =
    emailLogoImgHtml(options.logoUrl) ||
    `<h1 style="margin:0;color:${tone === "onTeal" ? "#ffffff" : "#111827"};font-size:24px;font-weight:700;">Jotna School</h1>`;

  const subtitleColor = tone === "onTeal" ? "#ccfbf1" : "#6b7280";
  const gap = logo ? "12px" : "4px";

  return `${brand}
              <p style="margin:${gap} 0 0;color:${subtitleColor};font-size:14px;">${escapeHtml(options.subtitle)}</p>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
