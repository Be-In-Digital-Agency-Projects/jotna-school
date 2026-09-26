/**
 * Codes et collage de l'import d'élèves — fonctions pures, sans aucun import.
 *
 * Même découpage que `accessRules`, `linkRules`, `roleRules` et `profileRules`,
 * et pour la même raison : ce dépôt n'utilise pas `convex-test` et vitest tourne
 * en `jsdom`, donc un handler Convex n'est pas testable directement. Ce qui
 * décide vit ici ; les enveloppes Convex lisent et écrivent.
 *
 * Ce module ne voit NI base NI session : il ne sait pas si un code est déjà
 * pris, et c'est voulu. La collision se constate en base, donc elle appartient
 * à l'appelant, qui réessaie. Une fonction pure qui prétendrait garantir
 * l'unicité mentirait.
 */

/** Niveaux du primaire sénégalais, dans l'ordre. */
export type SchoolClassLevel = "CI" | "CP" | "CE1" | "CE2" | "CM1" | "CM2";

const CLASS_LEVELS: readonly string[] = [
  "CI",
  "CP",
  "CE1",
  "CE2",
  "CM1",
  "CM2",
];

/** Lignes acceptées d'un seul collage — au-delà, l'import se fait en deux fois. */
export const IMPORT_ROWS_LIMIT = 400;

/** Longueur maximale d'un nom d'élève, pour que le billet reste lisible. */
const NAME_MAX = 80;

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

/**
 * Le code de connexion d'un élève — forme `CM1A-4821`.
 *
 * DES CHIFFRES SEULS APRÈS LE TIRET, jamais de lettres. Un billet passe par une
 * photocopieuse puis par les mains d'un enfant de huit ans : `O` et `0`, `I` et
 * `1`, `S` et `5` s'y confondent, et l'enfant tape ce qu'il croit lire. Le
 * préfixe, lui, vient de la classe — il est déjà connu de l'enfant, et il range
 * les billets tout seuls quand un professeur en distribue trente.
 *
 * QUATRE CHIFFRES, soit 9 000 valeurs par classe (1000-9999, jamais de zéro en
 * tête : `0821` se lit `821` et l'élève tape faux). Une classe de soixante
 * élèves a donc moins d'une chance sur cent de collision par tirage, que
 * l'appelant absorbe en réessayant.
 *
 * `randomInt` est injecté : une fonction pure ne tire pas au sort toute seule,
 * et les tests exigent des codes reproductibles.
 */
export function buildLoginCode(
  level: string,
  label: string,
  randomInt: (minInclusive: number, maxInclusive: number) => number,
): string {
  const prefix = `${level}${label}`.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return `${prefix}-${randomInt(1000, 9999)}`;
}

/**
 * Le code qu'une famille saisit pour se rattacher — forme `PIO-7C4K2M`.
 *
 * Il ne se range pas par classe, et c'est délibéré : il désigne UN enfant, se
 * saisit une fois, et un préfixe de classe apprendrait à qui le trouve dans
 * quelle classe est l'enfant. Un adulte le tape depuis un billet qu'il a en
 * main, donc six caractères sur un alphabet sans ambiguïté sont confortables.
 *
 * L'alphabet EXCLUT `0 O 1 I L 5 S 2 Z` : ce sont exactement les paires qu'une
 * photocopie confond. Restent 23 symboles, soit 148 millions de combinaisons —
 * la collision n'est pas le sujet, la lisibilité l'est.
 */
const PARENT_CODE_ALPHABET = "34679ABCDEFGHJKMNPQRTUVWXY";

export function buildParentCode(
  randomInt: (minInclusive: number, maxInclusive: number) => number,
): string {
  let body = "";
  for (let i = 0; i < 6; i++) {
    body += PARENT_CODE_ALPHABET[randomInt(0, PARENT_CODE_ALPHABET.length - 1)];
  }
  return `PIO-${body}`;
}

/**
 * La forme sous laquelle un code SE COMPARE et SE STOCKE — minuscules, sans
 * espace.
 *
 * CE N'EST PAS UN CONFORT, C'EST CE QUI PERMET DE SE CONNECTER. Vérifié dans
 * `node_modules/@convex-dev/auth/dist/providers/Password.js` : `authorize`
 * appelle `config.profile(params)` puis prend `account: { id: email }` — pour
 * `signUp` COMME POUR `signIn`. Et le `profile()` de `convex/auth.ts` fait
 * `.trim().toLowerCase()`. L'identifiant cherché à la connexion est donc
 * toujours minuscule : un compte créé avec `CM1A-4821` tel quel serait
 * introuvable, et l'élève ne pourrait jamais entrer.
 *
 * L'affichage garde les majuscules — elles se lisent mieux sur un billet.
 */
export function normalizeCode(raw: string): string {
  return raw.trim().replace(/\s+/g, "").toLowerCase();
}

/**
 * La forme IMPRIMÉE d'un code — celle du billet, majuscules comprises.
 *
 * C'est ce que `buildLoginCode` produit (préfixe mis en majuscules, tiret,
 * quatre chiffres), et donc ce que vaut le SECRET du compte.
 */
export function printableCode(raw: string): string {
  return raw.trim().replace(/\s+/g, "").toUpperCase();
}

/**
 * Les deux formes d'un même code, telles que `Password.authorize` les attend.
 *
 * ELLES NE SONT PAS ÉGALES, et c'est tout l'objet de cette fonction. Vérifié
 * dans `node_modules/@convex-dev/auth/dist/providers/Password.js`, branche
 * `signIn` :
 *
 *     const profile = config.profile?.(params, ctx) ?? defaultProfile(params);
 *     const { email } = profile;
 *     const secret = params.password;
 *     ...
 *     retrieveAccount(ctx, { provider, account: { id: email, secret } });
 *
 * Seul `email` traverse `config.profile()` — celui de `convex/auth.ts`, qui
 * fait `.trim().toLowerCase()`. `password` est pris BRUT. Or le compte a été
 * créé par `studentImportRun.ts` avec
 * `{ id: normalizeCode(code), secret: initialPassword(code) }`, et
 * `initialPassword` rend le code TEL QU'IMPRIMÉ.
 *
 * L'identifiant cherché est donc en minuscules et le secret en majuscules.
 * Un écran qui enverrait la même chaîne aux deux champs marcherait pour un
 * enfant qui tape en majuscules et échouerait pour celui qui tape en
 * minuscules — sans que rien, nulle part, n'explique pourquoi.
 *
 * `studentCredentials.resetStudentLoginCode` réinitialise avec la même paire
 * (`{ id: normalized, secret: printable }`) : les deux chemins de création du
 * dépôt produisent la même forme, donc cette fonction les couvre tous les deux.
 *
 * Elle est PURE et vit ici, avec le reste du format des codes, pour qu'il n'en
 * existe qu'une définition — le web, le mobile et les tests la partagent.
 */
export function loginCredentials(raw: string): {
  email: string;
  password: string;
} {
  const printable = printableCode(raw);
  return { email: normalizeCode(printable), password: printable };
}

// ---------------------------------------------------------------------------
// Collage
// ---------------------------------------------------------------------------

export type ParsedImportRow = {
  /** Numéro de la ligne dans le collage, pour que le refus se localise. */
  line: number;
  name: string;
  class: SchoolClassLevel;
  /**
   * Le libellé de la classe, quand le directeur l'a précisé — `A` dans
   * « CM1 A ». Vide quand il a écrit le seul niveau : l'appelant résout alors
   * contre les classes de l'école, et REFUSE si le niveau en compte plusieurs.
   * C'est à lui de trancher, il est le seul à voir la base.
   */
  label: string;
};

export type ImportParseError = {
  line: number;
  raw: string;
  reason:
    | "missing_class"
    | "unknown_class"
    | "missing_name"
    | "name_too_long";
};

export type ImportParseResult = {
  rows: ParsedImportRow[];
  errors: ImportParseError[];
  /** Vrai quand le collage dépasse `IMPORT_ROWS_LIMIT` lignes exploitables. */
  toolong: boolean;
};

/**
 * Découpe le collage du directeur en lignes exploitables.
 *
 * FORMAT : `Nom complet, CM1` ou `Nom complet, CM1 A` — un nom, une virgule,
 * un niveau, et le libellé de la classe s'il y en a plusieurs à ce niveau. Le
 * point-virgule et la tabulation sont acceptés comme séparateurs, parce qu'un
 * tableur en produit sans prévenir et qu'un directeur n'a pas à le savoir.
 *
 * LES LIGNES VIDES SONT IGNORÉES, PAS REFUSÉES : un collage se termine
 * presque toujours par un saut de ligne, et refuser là-dessus rendrait l'outil
 * insupportable. Tout le reste est refusé NOMMÉMENT, avec son numéro de ligne :
 * un import de quatre cents élèves qui échoue sans dire où est un import qu'on
 * recommence à l'aveugle.
 *
 * LES ERREURS N'ARRÊTENT PAS L'ANALYSE. Le directeur voit tout ce qui cloche
 * d'un coup, corrige, et recolle une fois — au lieu de découvrir ses fautes
 * l'une après l'autre. C'est l'appelant qui refuse s'il reste une erreur.
 */
export function parseImportPaste(paste: string): ImportParseResult {
  const rows: ParsedImportRow[] = [];
  const errors: ImportParseError[] = [];

  const lines = paste.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = i + 1;
    if (raw.trim() === "") continue;

    const parts = raw.split(/[,;\t]/);
    if (parts.length < 2) {
      errors.push({ line, raw, reason: "missing_class" });
      continue;
    }

    // La classe est le DERNIER champ, pas le second : « Diop, Awa, CM1 » est
    // une façon naturelle d'écrire un nom, et la refuser ferait passer l'outil
    // pour capricieux.
    const rawClass = parts[parts.length - 1].trim().toUpperCase();
    const name = parts
      .slice(0, parts.length - 1)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (name === "") {
      errors.push({ line, raw, reason: "missing_name" });
      continue;
    }
    if (name.length > NAME_MAX) {
      errors.push({ line, raw, reason: "name_too_long" });
      continue;
    }

    // NIVEAU PUIS LIBELLÉ FACULTATIF — « CM1 » ou « CM1 A ». Une école qui a un
    // CM1 A et un CM1 B ne peut pas être servie par le seul niveau, et ce sont
    // précisément les grandes écoles qui ont besoin d'un import en masse. Le
    // libellé se colle ou se sépare (`CM1A` comme `CM1 A`) : un directeur écrit
    // les deux sans y penser.
    const classParts = rawClass.split(/\s+/);
    const head = classParts[0];
    const level = CLASS_LEVELS.find(
      (l) => head === l || head.startsWith(l),
    );
    if (level === undefined) {
      errors.push({ line, raw, reason: "unknown_class" });
      continue;
    }
    const label = [head.slice(level.length), ...classParts.slice(1)]
      .join("")
      .trim();

    rows.push({ line, name, class: level as SchoolClassLevel, label });
  }

  return {
    rows: rows.slice(0, IMPORT_ROWS_LIMIT),
    errors,
    toolong: rows.length > IMPORT_ROWS_LIMIT,
  };
}

/** La phrase que lit le directeur, pour chaque motif de refus d'une ligne. */
export const PARSE_ERROR_MESSAGES: Record<ImportParseError["reason"], string> = {
  missing_class: "il manque la classe — écrivez « Nom complet, CM1 »",
  unknown_class: "classe inconnue — attendu CI, CP, CE1, CE2, CM1 ou CM2",
  missing_name: "il manque le nom de l'élève",
  name_too_long: `le nom dépasse ${NAME_MAX} caractères`,
};
