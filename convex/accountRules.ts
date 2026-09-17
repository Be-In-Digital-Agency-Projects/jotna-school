/**
 * Identifiants, codes et validations des comptes créés PAR une école — fonctions
 * pures, sans aucun import.
 *
 * Même découpage que `importCodes`, `linkRules`, `roleRules` et `profileRules`,
 * et pour la même raison : ce dépôt n'utilise pas `convex-test` et vitest tourne
 * en `jsdom`, donc un handler Convex n'est pas testable directement. Ce qui
 * décide vit ici ; les enveloppes Convex lisent et écrivent.
 *
 * Ce module ne voit NI base NI session. Il ne sait donc pas si un identifiant
 * est déjà pris : la collision se constate en base, elle appartient à
 * l'appelant, qui réessaie — exactement comme pour les codes d'élèves.
 */

// ---------------------------------------------------------------------------
// Alphabet
// ---------------------------------------------------------------------------

/**
 * L'alphabet des codes lus sur papier, repris de `importCodes.buildParentCode`.
 *
 * Il EXCLUT `0 O 1 I L 5 S 2 Z` : ce sont exactement les paires qu'une
 * photocopie confond. Un adulte tape ce qu'il croit lire, comme un enfant.
 */
const READABLE_ALPHABET = "34679ABCDEFGHJKMNPQRTUVWXY";

function draw(
  length: number,
  randomInt: (minInclusive: number, maxInclusive: number) => number,
): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += READABLE_ALPHABET[randomInt(0, READABLE_ALPHABET.length - 1)];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Identifiant de connexion
// ---------------------------------------------------------------------------

/** Les rôles qu'une école peut créer. Ni `admin`, ni `student`. */
export type SchoolCreatedRole = "directeur" | "professeur" | "parent";

/**
 * Le préfixe de l'identifiant imprimé, par rôle.
 *
 * IL DIT À QUI LE BILLET APPARTIENT, et c'est son seul rôle : un directeur qui
 * distribue quinze billets à la rentrée les trie sans les déchiffrer. `PIO-`
 * n'est pas repris — il désigne déjà un code de RATTACHEMENT d'enfant dans
 * `importCodes.buildParentCode`, et deux choses qui se saisissent au même
 * endroit ne doivent pas se ressembler.
 */
const LOGIN_PREFIX: Record<SchoolCreatedRole, string> = {
  directeur: "DIR",
  professeur: "PROF",
  parent: "FAM",
};

/**
 * L'identifiant de connexion d'un adulte SANS e-mail — forme `PROF-7C4K2M`.
 *
 * SIX CARACTÈRES sur 26 symboles, soit 309 millions de combinaisons. La
 * collision n'est pas le sujet ici non plus : la lisibilité l'est, et
 * l'appelant réessaie sur collision.
 *
 * IL N'EST PAS SECRET, et il ne doit pas l'être. Il tient la place d'une adresse
 * e-mail : c'est un nom d'utilisateur, connu de l'école, réutilisé à chaque
 * connexion. Ce qui protège le compte est le mot de passe que la personne
 * choisit à l'activation, et lui seul.
 */
export function buildLoginId(
  role: SchoolCreatedRole,
  randomInt: (minInclusive: number, maxInclusive: number) => number,
): string {
  return `${LOGIN_PREFIX[role]}-${draw(6, randomInt)}`;
}

/**
 * Le code d'ACTIVATION — forme `4C7K2MQR`, huit caractères, sans préfixe.
 *
 * SANS PRÉFIXE, DÉLIBÉRÉMENT : il ne se trie pas, il se saisit une fois puis
 * meurt. Un préfixe apprendrait à qui le trouve quel rôle il déverrouille.
 *
 * HUIT CARACTÈRES et non six, parce que celui-ci EST un secret : il autorise à
 * poser le mot de passe d'un compte qui lit des dossiers d'élèves. 26^8 vaut
 * 2·10^11, et il expire.
 */
export function buildActivationCode(
  randomInt: (minInclusive: number, maxInclusive: number) => number,
): string {
  return draw(8, randomInt);
}

/**
 * La forme sous laquelle un identifiant ou un code SE COMPARE et SE STOCKE.
 *
 * MÊME RAISON QUE `importCodes.normalizeCode`, et ce n'est pas un confort :
 * `Password.authorize` de `@convex-dev/auth` passe l'identifiant par le
 * `profile()` de `convex/auth.ts`, qui le met en minuscules — à la connexion
 * comme à la création. Un compte enregistré sous `PROF-7C4K2M` tel quel serait
 * introuvable au moment où la personne tape son identifiant.
 *
 * L'affichage garde les majuscules : elles se lisent mieux sur un billet.
 */
export function normalizeIdentifier(raw: string): string {
  return raw.trim().replace(/\s+/g, "").toLowerCase();
}

// ---------------------------------------------------------------------------
// Validation de ce que l'école saisit
// ---------------------------------------------------------------------------

/** Longueur maximale d'un nom, pour que le billet et les écrans restent lisibles. */
const NAME_MAX = 80;

export type NameCheck =
  | { ok: true; name: string }
  | { ok: false; reason: "empty" | "too_long" };

/**
 * Le nom tel qu'il sera stocké, ou le refus.
 *
 * LE NOM EST LE SEUL CHAMP OBLIGATOIRE d'un compte créé par l'école. C'est lui
 * que le directeur lit dans sa liste, lui qui figure sur le billet, et lui qui
 * nomme la personne dans les journaux. Un compte sans nom serait une ligne que
 * personne ne sait rattacher à un humain.
 */
export function checkName(raw: string): NameCheck {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name === "") return { ok: false, reason: "empty" };
  if (name.length > NAME_MAX) return { ok: false, reason: "too_long" };
  return { ok: true, name };
}

export type EmailCheck =
  | { ok: true; email: string | null }
  | { ok: false; reason: "malformed" };

/**
 * L'e-mail normalisé, `null` quand l'école n'en fournit pas, ou le refus.
 *
 * L'ABSENCE EST UN CAS NORMAL, pas une erreur : au Sénégal, un parent d'élève de
 * CI n'a pas toujours d'adresse, et exiger un e-mail reviendrait à lui refuser
 * l'accès au suivi de son enfant. C'est exactement pourquoi le canal « code
 * imprimé » existe à côté.
 *
 * LA VALIDATION RESTE VOLONTAIREMENT GROSSIÈRE — une arobase, un point après.
 * Une expression rationnelle stricte refuse des adresses valides et n'empêche
 * pas les fautes de frappe ; seul l'envoi réel dira si l'adresse existe, et
 * c'est le canal qui le constatera.
 */
export function checkEmail(raw: string | undefined | null): EmailCheck {
  if (raw === undefined || raw === null || raw.trim() === "") {
    return { ok: true, email: null };
  }
  const email = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, reason: "malformed" };
  }
  return { ok: true, email };
}

// ---------------------------------------------------------------------------
// Canal et durée de vie
// ---------------------------------------------------------------------------

/** Par quel chemin la personne reçoit son code. */
export type ActivationChannel = "email" | "printed";

/**
 * Le canal découle de l'e-mail, il ne se choisit pas en plus.
 *
 * Un formulaire qui demanderait le canal ET l'e-mail laisserait créer un compte
 * « par e-mail » sans adresse — donc un compte que personne ne peut activer.
 * Une seule saisie, une seule vérité.
 */
export function channelFor(email: string | null): ActivationChannel {
  return email === null ? "printed" : "email";
}

/**
 * Durée de vie d'un code d'activation : quatorze jours.
 *
 * ASSEZ LONG pour couvrir une rentrée, des vacances scolaires courtes et un
 * parent qui ne relève ses messages qu'une fois par semaine. ASSEZ COURT pour
 * qu'un billet oublié dans un cartable en février ne déverrouille plus rien.
 * Le directeur peut toujours en réémettre un.
 */
export const ACTIVATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export type ActivationVerdict =
  | { ok: true }
  | { ok: false; reason: "unknown" | "expired" | "already_used" };

/**
 * Ce qu'il advient d'un code présenté à l'activation.
 *
 * LES TROIS REFUS SE DISTINGUENT, à l'inverse de ce qui se fait sur une
 * connexion. Ici la personne est de bonne foi et tient un papier : « ce code a
 * déjà servi » lui dit d'aller se connecter, « il a expiré » lui dit de
 * redemander à l'école, et « inconnu » lui dit qu'elle s'est trompée en
 * recopiant. Confondre les trois transformerait chacun de ces cas en un
 * abandon.
 *
 * L'ordre compte : un code expiré ET déjà utilisé se dit « déjà utilisé », le
 * fait qu'il ait servi étant la seule information utile.
 */
export function verifyActivation(
  row: { expiresAt: number; activatedAt?: number | null } | null | undefined,
  now: number,
): ActivationVerdict {
  if (!row) return { ok: false, reason: "unknown" };
  if (row.activatedAt !== undefined && row.activatedAt !== null) {
    return { ok: false, reason: "already_used" };
  }
  if (row.expiresAt <= now) return { ok: false, reason: "expired" };
  return { ok: true };
}

/** Longueur minimale du mot de passe, alignée sur `convex/auth.ts`. */
const PASSWORD_MIN = 6;

export type PasswordCheck =
  | { ok: true }
  | { ok: false; reason: "too_short" | "mismatch" };

/**
 * Le mot de passe que la personne choisit à l'activation.
 *
 * LA MÊME LIMITE QUE `convex/auth.ts` — six caractères — et pas une plus
 * sévère : deux règles différentes pour le même secret produiraient un compte
 * activable dont la connexion refuse le mot de passe.
 *
 * LA CONFIRMATION SE VÉRIFIE ICI ET NON DANS LE FORMULAIRE. Une faute de frappe
 * dans un mot de passe qu'on ne relit pas enferme dehors quelqu'un qui croit
 * avoir activé son compte ; c'est au serveur de refuser, parce que c'est lui
 * qui écrit.
 */
export function checkPassword(
  password: string,
  confirmation: string,
): PasswordCheck {
  if (password.length < PASSWORD_MIN) return { ok: false, reason: "too_short" };
  if (password !== confirmation) return { ok: false, reason: "mismatch" };
  return { ok: true };
}

/** Les phrases que lit un adulte, une par refus. */
export const ACCOUNT_ERROR_MESSAGES = {
  name_empty: "Le nom est obligatoire.",
  name_too_long: `Le nom ne peut pas dépasser ${NAME_MAX} caractères.`,
  email_malformed: "Cette adresse e-mail n'est pas valide.",
  activation_unknown:
    "Ce code d'activation est inconnu. Vérifiez la saisie, lettre par lettre.",
  activation_expired:
    "Ce code d'activation a expiré. Demandez-en un nouveau à votre école.",
  activation_already_used:
    "Ce code a déjà servi : votre compte est actif. Connectez-vous avec votre identifiant.",
  password_too_short: `Le mot de passe doit contenir au moins ${PASSWORD_MIN} caractères.`,
  password_mismatch: "Les deux mots de passe ne sont pas identiques.",
} as const;
