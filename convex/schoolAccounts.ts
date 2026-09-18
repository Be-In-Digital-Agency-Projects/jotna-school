import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
  action,
  type ActionCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { createAccount, modifyAccountCredentials } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";
import { callerAuthorityOverSchool, callerSchoolAuthority } from "./access";
import {
  ACCOUNT_ERROR_MESSAGES,
  ACTIVATION_TTL_MS,
  buildActivationCode,
  buildLoginId,
  channelFor,
  checkEmail,
  checkName,
  checkPassword,
  normalizeIdentifier,
  verifyActivation,
} from "./accountRules";
// Le code d'activation EST un secret : il autorise à poser le mot de passe d'un
// compte qui lit des dossiers d'élèves. `Math.random()` le rendrait prédictible.
import { secureRandomInt } from "./secureRandom";

// ---------------------------------------------------------------------------
// LES COMPTES QUE L'ÉCOLE CRÉE — professeurs, directeurs, parents.
//
// LES ÉLÈVES NE SONT PAS ICI, et c'est voulu : ils arrivent par centaines d'un
// seul collage (`studentImport.ts`, `studentImportRun.ts`), avec un travail de
// fond, des lignes en échec et une reprise. Un adulte se crée à l'unité, dans
// une transaction, et son compte n'a pas de mot de passe utilisable avant qu'il
// ne l'ait choisi. Les deux mécaniques partagent `createAccount` et le marqueur
// `schoolCreated`, rien de plus.
//
// CE MODULE EST UNE ACTION POUR SA PARTIE CRÉATION. `createAccount` et
// `modifyAccountCredentials` de `@convex-dev/auth` exigent un contexte
// d'action ; les gardes et les écritures passent donc par des fonctions
// internes. Conséquence assumée : la création n'est PAS transactionnelle. Ce qui
// peut rester derrière une mort d'action est un compte `users` sans rattachement
// ni code — inerte, sans accès, sans école — exactement le déchet que
// `studentImportRun` documente déjà.
// ---------------------------------------------------------------------------

/** Essais de tirage d'un identifiant ou d'un code avant d'abandonner. */
const DRAW_ATTEMPTS = 12;

/** Lignes d'activation lues pour une école. Une rentrée en crée quelques dizaines. */
const ACTIVATIONS_PER_SCHOOL_LIMIT = 200;

const staffRoleValidator = v.union(
  v.literal("directeur"),
  v.literal("professeur"),
);

// ---------------------------------------------------------------------------
// Gardes et lectures internes
// ---------------------------------------------------------------------------

/**
 * L'autorité de l'appelant sur cette école, pour une ACTION.
 *
 * Une action n'a pas de `ctx.db` : elle ne peut donc pas lire le profil de
 * l'appelant elle-même, et la garde doit passer par une requête. Rendre
 * l'identifiant du profil et non un booléen, parce que l'écriture qui suit doit
 * NOMMER celui qui a créé le compte — même règle que les cinq mutations de
 * `schools.ts` qui portent un `actorProfileId`.
 */
export const authorityFor = internalQuery({
  args: { schoolId: v.id("schools") },
  returns: v.union(
    v.object({ actorProfileId: v.id("profiles"), schoolName: v.string() }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const authority = await callerAuthorityOverSchool(ctx, args.schoolId);
    if (!authority) return null;
    const school = await ctx.db.get(args.schoolId);
    if (!school) return null;
    return { actorProfileId: authority.profile._id, schoolName: school.name };
  },
});

/** Vrai si cet identifiant de connexion est déjà pris par un compte. */
export const loginIdTaken = internalQuery({
  args: { loginId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.loginId))
      .first();
    return user !== null;
  },
});

/** Vrai si ce code d'activation est déjà en base. */
export const activationCodeTaken = internalQuery({
  args: { code: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("accountActivations")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .first();
    return row !== null;
  },
});

/**
 * Scelle un compte d'adulte : profil rattaché, lien à l'école, code posé.
 *
 * UNE SEULE TRANSACTION POUR LES TROIS ÉCRITURES. Un profil créé sans son lien
 * `schoolStaff` serait un professeur qu'aucune école ne voit ; un lien sans
 * ligne d'activation serait un compte que personne ne peut activer. Les trois
 * ne se séparent pas, et c'est pourquoi l'action délègue ici plutôt que
 * d'écrire en trois appels.
 */
export const commitAdultAccount = internalMutation({
  args: {
    schoolId: v.id("schools"),
    userId: v.string(),
    role: v.union(staffRoleValidator, v.literal("parent")),
    loginId: v.string(),
    code: v.string(),
    channel: v.union(v.literal("email"), v.literal("printed")),
    expiresAt: v.number(),
    createdBy: v.id("profiles"),
    /** L'enfant que ce parent suit, quand l'école le rattache dès la création. */
    studentId: v.optional(v.id("profiles")),
  },
  returns: v.object({
    profileId: v.id("profiles"),
    activationId: v.id("accountActivations"),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    if (!profile) {
      throw new ConvexError("Profil introuvable après création du compte");
    }

    if (args.role === "parent") {
      if (args.studentId) {
        // Par `by_guardianId` : un parent suit un à quatre enfants, un élève a
        // un à deux tuteurs. La fenêtre part donc du parent, pas de l'élève.
        const already = await ctx.db
          .query("studentGuardians")
          .withIndex("by_guardianId", (q) => q.eq("guardianId", profile._id))
          .take(20);
        if (!already.some((row) => row.studentId === args.studentId)) {
          await ctx.db.insert("studentGuardians", {
            studentId: args.studentId,
            guardianId: profile._id,
            relation: "parent",
          });
        }
      }
    } else {
      await ctx.db.insert("schoolStaff", {
        schoolId: args.schoolId,
        profileId: profile._id,
        staffRole: args.role,
        status: "active",
      });
    }

    const activationId = await ctx.db.insert("accountActivations", {
      profileId: profile._id,
      schoolId: args.schoolId,
      loginId: args.loginId,
      code: args.code,
      channel: args.channel,
      expiresAt: args.expiresAt,
      createdBy: args.createdBy,
      createdAt: now,
    });

    return { profileId: profile._id, activationId };
  },
});

/** La ligne d'activation que porte ce code, telle qu'elle est en base. */
export const activationByCode = internalQuery({
  args: { code: v.string() },
  returns: v.union(
    v.object({
      _id: v.id("accountActivations"),
      loginId: v.string(),
      expiresAt: v.number(),
      activatedAt: v.union(v.number(), v.null()),
      name: v.string(),
      role: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("accountActivations")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .first();
    if (!row) return null;
    const profile = await ctx.db.get(row.profileId);
    return {
      _id: row._id,
      loginId: row.loginId,
      expiresAt: row.expiresAt,
      activatedAt: row.activatedAt ?? null,
      name: profile?.name ?? "",
      role: profile?.role ?? "",
    };
  },
});

/** Marque une activation consommée. Appelée après que le secret est posé. */
export const markActivated = internalMutation({
  args: { activationId: v.id("accountActivations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.activationId, { activatedAt: Date.now() });
    return null;
  },
});

// ---------------------------------------------------------------------------
// Tirages
// ---------------------------------------------------------------------------

async function drawFree(
  build: () => string,
  taken: (candidate: string) => Promise<boolean>,
): Promise<string | null> {
  for (let attempt = 0; attempt < DRAW_ATTEMPTS; attempt++) {
    const candidate = build();
    if (!(await taken(normalizeIdentifier(candidate)))) return candidate;
  }
  return null;
}

/**
 * Un secret que personne ne connaît, posé à la création du compte.
 *
 * LE COMPTE NAÎT INUTILISABLE, ET C'EST LE POINT. `createAccount` exige un
 * secret ; en tirer un de 48 caractères que rien ne transmet ni ne stocke rend
 * le compte inaccessible jusqu'à l'activation, où
 * `modifyAccountCredentials` le remplace par celui que la personne choisit.
 *
 * L'ALTERNATIVE ÉTAIT LE MODÈLE DES ÉLÈVES — mot de passe égal au code
 * imprimé. Tenable pour un enfant de huit ans dont le compte ne porte que des
 * tentatives d'exercices ; pas pour un professeur qui lit les dossiers de ses
 * soixante élèves, ni pour un parent qui lit celui de son enfant. Le
 * commentaire de `studentImportRun.initialPassword` prévient exactement de ce
 * jour-là.
 */
function unusableSecret(): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 48; i++) {
    out += alphabet[secureRandomInt(0, alphabet.length - 1)];
  }
  return out;
}

export type CreatedAccount = {
  profileId: Id<"profiles">;
  name: string;
  /** Ce que la personne tapera dans « identifiant » — e-mail ou code imprimé. */
  loginId: string;
  /** Le code d'activation, en majuscules, tel qu'il s'imprime. */
  activationCode: string;
  channel: "email" | "printed";
  expiresAt: number;
};

/**
 * Crée un compte d'adulte pour une école et rend de quoi le lui remettre.
 *
 * L'IDENTIFIANT DE CONNEXION EST L'E-MAIL QUAND IL Y EN A UN. Un adulte qui a
 * une adresse la retient déjà ; lui imposer un `PROF-7C4K2M` en plus serait un
 * secret de plus à perdre. Sans adresse, l'identifiant est tiré et imprimé.
 *
 * LE CODE EST RENDU À L'APPELANT DANS LES DEUX CAS, y compris quand un e-mail
 * part. L'école doit pouvoir le lire à l'écran et le dicter au téléphone : un
 * e-mail qui n'arrive pas — adresse mal saisie, boîte pleine, filtre — ne doit
 * pas transformer un compte créé en compte perdu.
 */
async function createAdultAccount(
  ctx: ActionCtx,
  input: {
    schoolId: Id<"schools">;
    name: string;
    email: string | undefined;
    role: "directeur" | "professeur" | "parent";
    studentId?: Id<"profiles">;
  },
): Promise<CreatedAccount> {
  const authority = await ctx.runQuery(internal.schoolAccounts.authorityFor, {
    schoolId: input.schoolId,
  });
  if (!authority) {
    throw new ConvexError(
      "Vous ne dirigez pas cette école : sa gestion n'est pas de votre ressort.",
    );
  }

  const named = checkName(input.name);
  if (!named.ok) {
    throw new ConvexError(
      named.reason === "empty"
        ? ACCOUNT_ERROR_MESSAGES.name_empty
        : ACCOUNT_ERROR_MESSAGES.name_too_long,
    );
  }

  const mailed = checkEmail(input.email);
  if (!mailed.ok) {
    throw new ConvexError(ACCOUNT_ERROR_MESSAGES.email_malformed);
  }

  const channel = channelFor(mailed.email);

  let printable: string;
  if (mailed.email !== null) {
    if (
      await ctx.runQuery(internal.schoolAccounts.loginIdTaken, {
        loginId: normalizeIdentifier(mailed.email),
      })
    ) {
      throw new ConvexError(
        "Un compte existe déjà avec cette adresse e-mail. Si c'est la bonne " +
          "personne, elle peut se connecter ou réinitialiser son mot de passe.",
      );
    }
    printable = mailed.email;
  } else {
    const drawn = await drawFree(
      () => buildLoginId(input.role, secureRandomInt),
      (candidate) =>
        ctx.runQuery(internal.schoolAccounts.loginIdTaken, {
          loginId: candidate,
        }),
    );
    if (drawn === null) {
      throw new ConvexError(
        "Aucun identifiant libre après douze essais. Réessayez.",
      );
    }
    printable = drawn;
  }

  const activationCode = await drawFree(
    () => buildActivationCode(secureRandomInt),
    (candidate) =>
      ctx.runQuery(internal.schoolAccounts.activationCodeTaken, {
        code: candidate,
      }),
  );
  if (activationCode === null) {
    throw new ConvexError(
      "Aucun code d'activation libre après douze essais. Réessayez.",
    );
  }

  // L'IDENTIFIANT PART EN MINUSCULES. `Password.authorize` passe par le
  // `profile()` de `convex/auth.ts` À LA CONNEXION AUSSI, et celui-ci met en
  // minuscules : un compte créé avec `PROF-7C4K2M` tel quel serait introuvable
  // au moment où la personne tape son identifiant. L'affichage, lui, garde les
  // majuscules — elles se lisent mieux sur un billet.
  const normalizedLogin = normalizeIdentifier(printable);

  const { user } = await createAccount(ctx, {
    provider: "password",
    account: { id: normalizedLogin, secret: unusableSecret() },
    profile: {
      email: normalizedLogin,
      name: named.name,
      role: input.role,
      // Marqueur infalsifiable : voir `createOrUpdateUser` dans
      // `convex/auth.ts`. Sans lui, la création est refusée.
      schoolCreated: true,
    } as unknown as Parameters<typeof createAccount>[1]["profile"],
  });

  const expiresAt = Date.now() + ACTIVATION_TTL_MS;

  const { profileId } = await ctx.runMutation(
    internal.schoolAccounts.commitAdultAccount,
    {
      schoolId: input.schoolId,
      userId: user._id as unknown as string,
      role: input.role,
      loginId: normalizedLogin,
      code: normalizeIdentifier(activationCode),
      channel,
      expiresAt,
      createdBy: authority.actorProfileId,
      ...(input.studentId ? { studentId: input.studentId } : {}),
    },
  );

  if (channel === "email" && mailed.email !== null) {
    // L'ENVOI NE FAIT PAS ÉCHOUER LA CRÉATION. Le compte existe, le code est en
    // base et l'école l'a sous les yeux : un e-mail qui part mal ne doit pas
    // effacer un travail déjà fait. L'échec se journalise, l'école dicte.
    await ctx.scheduler.runAfter(
      0,
      internal.schoolAccountsEmail.sendActivationEmail,
      {
        to: mailed.email,
        recipientName: named.name,
        schoolName: authority.schoolName,
        loginId: printable,
        activationCode: activationCode.toUpperCase(),
        role: input.role,
      },
    );
  }

  return {
    profileId,
    name: named.name,
    loginId: printable,
    activationCode: activationCode.toUpperCase(),
    channel,
    expiresAt,
  };
}

// ---------------------------------------------------------------------------
// Ce que l'école appelle
// ---------------------------------------------------------------------------

const createdAccountValidator = v.object({
  profileId: v.id("profiles"),
  name: v.string(),
  loginId: v.string(),
  activationCode: v.string(),
  channel: v.union(v.literal("email"), v.literal("printed")),
  expiresAt: v.number(),
});

/** Crée le compte d'un professeur ou d'un directeur de cette école. */
export const createStaffAccount = action({
  args: {
    schoolId: v.id("schools"),
    name: v.string(),
    email: v.optional(v.string()),
    staffRole: staffRoleValidator,
  },
  returns: createdAccountValidator,
  handler: async (ctx, args): Promise<CreatedAccount> =>
    await createAdultAccount(ctx, {
      schoolId: args.schoolId,
      name: args.name,
      email: args.email,
      role: args.staffRole,
    }),
});

/**
 * Crée le compte d'un parent, et le rattache à son enfant si l'école le précise.
 *
 * LE RATTACHEMENT DANS LE MÊME GESTE, et c'est le changement de fond. Un parent
 * qui s'inscrivait seul obtenait un compte vide, puis devait saisir un code
 * `PIO-` pour voir quoi que ce soit : le compte précédait le droit. Ici l'école,
 * qui sait déjà quel adulte suit quel enfant, pose les deux ensemble.
 */
export const createParentAccount = action({
  args: {
    schoolId: v.id("schools"),
    name: v.string(),
    email: v.optional(v.string()),
    studentId: v.optional(v.id("profiles")),
  },
  returns: createdAccountValidator,
  handler: async (ctx, args): Promise<CreatedAccount> =>
    await createAdultAccount(ctx, {
      schoolId: args.schoolId,
      name: args.name,
      email: args.email,
      role: "parent",
      ...(args.studentId ? { studentId: args.studentId } : {}),
    }),
});

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

/**
 * Ce qu'un code d'activation déverrouille, sans rien consommer.
 *
 * SERT À NOMMER LA PERSONNE AVANT QU'ELLE CHOISISSE SON MOT DE PASSE : « Bonjour
 * Awa Diop, votre école a créé votre compte de professeure » vaut mieux qu'un
 * formulaire muet, et confirme à la personne qu'elle n'a pas recopié le code de
 * quelqu'un d'autre.
 *
 * NE DIT RIEN DE PLUS QUE LE NOM ET LE RÔLE. Un code trouvé par terre ne doit
 * pas raconter l'école, l'adresse ni les enfants rattachés.
 */
export const previewActivation = query({
  args: { code: v.string() },
  returns: v.union(
    v.object({ name: v.string(), role: v.string(), loginId: v.string() }),
    v.object({ error: v.string() }),
  ),
  handler: async (ctx, args) => {
    const normalized = normalizeIdentifier(args.code);
    const row = await ctx.db
      .query("accountActivations")
      .withIndex("by_code", (q) => q.eq("code", normalized))
      .first();

    const verdict = verifyActivation(
      row ? { expiresAt: row.expiresAt, activatedAt: row.activatedAt } : null,
      Date.now(),
    );
    if (!verdict.ok || !row) {
      return {
        error:
          verdict.ok === false
            ? ACCOUNT_ERROR_MESSAGES[`activation_${verdict.reason}`]
            : ACCOUNT_ERROR_MESSAGES.activation_unknown,
      };
    }

    const profile = await ctx.db.get(row.profileId);
    return {
      name: profile?.name ?? "",
      role: profile?.role ?? "",
      loginId: row.loginId.toUpperCase(),
    };
  },
});

/**
 * Pose le mot de passe d'un compte créé par une école, et rend son identifiant.
 *
 * LE CLIENT SE CONNECTE ENSUITE, il n'est pas connecté ici : cette action n'a pas
 * de session à ouvrir, et `signIn` vit dans le navigateur. Rendre l'identifiant
 * permet à la page d'enchaîner sans redemander à la personne ce qu'elle vient
 * de lire sur son billet.
 *
 * LE CODE EST CONSOMMÉ APRÈS que le secret est posé, jamais avant. L'ordre
 * inverse laisserait, si `modifyAccountCredentials` échouait, un code mort sur un
 * compte toujours inactivable — et la personne devrait redemander un billet pour
 * une panne qui n'est pas la sienne.
 */
export const activateAccount = action({
  args: {
    code: v.string(),
    password: v.string(),
    confirmation: v.string(),
  },
  returns: v.object({ loginId: v.string(), name: v.string() }),
  handler: async (ctx, args): Promise<{ loginId: string; name: string }> => {
    const secretCheck = checkPassword(args.password, args.confirmation);
    if (!secretCheck.ok) {
      throw new ConvexError(
        ACCOUNT_ERROR_MESSAGES[`password_${secretCheck.reason}`],
      );
    }

    const normalized = normalizeIdentifier(args.code);
    const row = await ctx.runQuery(internal.schoolAccounts.activationByCode, {
      code: normalized,
    });

    const verdict = verifyActivation(row, Date.now());
    if (!verdict.ok) {
      throw new ConvexError(
        ACCOUNT_ERROR_MESSAGES[`activation_${verdict.reason}`],
      );
    }
    if (!row) {
      throw new ConvexError(ACCOUNT_ERROR_MESSAGES.activation_unknown);
    }

    await modifyAccountCredentials(ctx, {
      provider: "password",
      account: { id: row.loginId, secret: args.password },
    });

    await ctx.runMutation(internal.schoolAccounts.markActivated, {
      activationId: row._id,
    });

    return { loginId: row.loginId, name: row.name };
  },
});

// ---------------------------------------------------------------------------
// Ce que l'école lit
// ---------------------------------------------------------------------------

/**
 * Les comptes créés pour cette école, avec l'état de leur activation.
 *
 * L'ÉTAT EST CALCULÉ ET NON STOCKÉ : « expiré » dépend de l'heure qu'il est, et
 * un champ figé aurait menti dès la minute suivante.
 *
 * LE CODE N'EST PAS RENDU. Il est rendu UNE FOIS, à la création, à l'écran de
 * celui qui crée. Le relire ensuite dans une liste en ferait un secret partagé
 * par tout le personnel, et durablement lisible par qui passe derrière un
 * écran laissé ouvert. Une école qui a perdu un billet en réémet un.
 */
export const listAccounts = query({
  args: { schoolId: v.id("schools") },
  returns: v.array(
    v.object({
      profileId: v.id("profiles"),
      name: v.string(),
      role: v.string(),
      loginId: v.string(),
      channel: v.union(v.literal("email"), v.literal("printed")),
      state: v.union(
        v.literal("active"),
        v.literal("pending"),
        v.literal("expired"),
      ),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const authority = await callerAuthorityOverSchool(ctx, args.schoolId);
    if (!authority) return [];

    const rows = await ctx.db
      .query("accountActivations")
      .withIndex("by_school", (q) => q.eq("schoolId", args.schoolId))
      .take(ACTIVATIONS_PER_SCHOOL_LIMIT);

    const now = Date.now();
    const out: {
      profileId: Id<"profiles">;
      name: string;
      role: string;
      loginId: string;
      channel: "email" | "printed";
      state: "active" | "pending" | "expired";
      createdAt: number;
    }[] = [];

    for (const row of rows) {
      const profile: Doc<"profiles"> | null = await ctx.db.get(row.profileId);
      out.push({
        profileId: row.profileId,
        name: profile?.name ?? "",
        role: profile?.role ?? "",
        loginId: row.loginId.toUpperCase(),
        channel: row.channel,
        state:
          row.activatedAt !== undefined
            ? "active"
            : row.expiresAt <= now
              ? "expired"
              : "pending",
        createdAt: row.createdAt,
      });
    }

    return out.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/** Les écoles que l'appelant dirige — la racine de l'espace directeur. */
export const mySchools = query({
  args: {},
  returns: v.array(
    v.object({
      schoolId: v.id("schools"),
      name: v.string(),
      city: v.union(v.string(), v.null()),
      status: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const authority = await callerSchoolAuthority(ctx);
    if (!authority) return [];

    // Un `admin` n'a pas d'école à lui : il passe par `/admin`, qui les liste
    // toutes. Lui en rendre une ici brouillerait les deux espaces.
    if (authority.platformWide) return [];

    const out: {
      schoolId: Id<"schools">;
      name: string;
      city: string | null;
      status: string;
    }[] = [];
    for (const schoolId of authority.schoolIds) {
      const school = await ctx.db.get(schoolId);
      if (school) {
        out.push({
          schoolId,
          name: school.name,
          city: school.city ?? null,
          status: school.status,
        });
      }
    }
    return out;
  },
});
