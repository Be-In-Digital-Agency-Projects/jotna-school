import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { createAccount } from "@convex-dev/auth/server";
import {
  buildLoginCode,
  buildParentCode,
  normalizeCode,
} from "./importCodes";
// CES CODES SONT DES SECRETS : le code de connexion est à la fois
// l'identifiant et le mot de passe de l'enfant, et le code parent ouvre son
// dossier scolaire. `Math.random()` les rendait prédictibles — voir
// `convex/secureRandom.ts`.
import { secureRandomInt } from "./secureRandom";

// ---------------------------------------------------------------------------
// LE TRAVAIL PROPREMENT DIT — spec §6.1, étape 4.
//
// SÉPARÉ DE `studentImport.ts` PARCE QUE LES DEUX NE SE RESSEMBLENT PAS. Ce
// fichier est une ACTION : pas de `ctx.db`, pas de transaction, et il peut
// mourir n'importe où. `studentImport.ts` est fait de mutations et de requêtes
// transactionnelles. Les mêler dans un module ferait croire que tout s'y exécute
// sous les mêmes garanties, ce qui est précisément l'erreur à ne pas faire ici.
//
// CE QUI SE PASSE SI L'ACTION MEURT : les lignes déjà scellées sont `created` et
// ne seront pas reprises ; celles qui restent sont `pending`. Relancer reprend
// exactement là. Le seul déchet possible est un compte `users` créé juste avant
// la mort, sans profil rattaché à une école — il n'a aucun accès, aucune
// inscription, aucun code, et sa ligne d'import restera `pending` donc sera
// retentée avec un NOUVEAU code. C'est un déchet inerte, pas une incohérence.
// ---------------------------------------------------------------------------

/** Essais de tirage d'un code avant d'abandonner une ligne. */
const CODE_ATTEMPTS = 12;

/**
 * Tire un code libre, ou rend `null` après `CODE_ATTEMPTS` essais.
 *
 * LA COLLISION SE CONSTATE EN BASE, donc elle ne peut pas vivre dans le module
 * pur : `importCodes` génère, cette boucle vérifie. Douze essais sur 9 000
 * valeurs par classe : l'échec suppose une classe déjà très pleine, et il vaut
 * mieux une ligne `failed` nommée qu'une boucle qui ne finit pas.
 */
async function drawFreeCode(
  build: () => string,
  taken: (candidate: string) => Promise<boolean>,
): Promise<string | null> {
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
    const candidate = build();
    if (!(await taken(normalizeCode(candidate)))) return candidate;
  }
  return null;
}

/**
 * Mot de passe initial d'un élève importé.
 *
 * IL EST ÉGAL AU CODE DE CONNEXION, et ce n'est pas un raccourci : un enfant de
 * huit ans ne retient pas deux secrets, et le billet n'en porte qu'un. Ce qui
 * protège le compte n'est donc pas le mot de passe mais la distribution du
 * billet — exactement comme pour un carnet de correspondance.
 *
 * CONSÉQUENCE ASSUMÉE : quiconque lit le billet peut entrer dans ce compte.
 * C'est le modèle voulu à cet âge, où le personnel réinitialise
 * (`studentCredentials.resetStudentLoginCode`) plutôt que l'enfant. Le jour où
 * ces comptes porteront autre chose que des tentatives d'exercices, il faudra
 * revoir ceci EN PREMIER.
 *
 * Le SECRET garde les majuscules, lui : `Password.authorize` ne fait passer que
 * l'identifiant par `profile()`, jamais le mot de passe. C'est bien le code tel
 * qu'il est imprimé que l'enfant tape.
 */
function initialPassword(loginCode: string): string {
  return loginCode;
}

export const processBatch = internalAction({
  args: { jobId: v.id("studentImportJobs") },
  handler: async (ctx, args): Promise<void> => {
    const job = await ctx.runQuery(internal.studentImport.getJob, {
      jobId: args.jobId,
    });
    if (!job) return;
    if (job.status === "completed" || job.status === "failed") return;

    const batch = await ctx.runQuery(internal.studentImport.nextBatch, {
      jobId: args.jobId,
    });

    for (const row of batch) {
      if (row.schoolId === null) {
        await ctx.runMutation(internal.studentImport.failRow, {
          rowId: row.rowId,
          reason: "Classe supprimée pendant l'import",
        });
        continue;
      }

      const loginCode = await drawFreeCode(
        () => buildLoginCode(row.level, row.label, secureRandomInt),
        (candidate) =>
          ctx.runQuery(internal.studentImport.loginCodeTaken, {
            code: candidate,
          }),
      );
      if (loginCode === null) {
        await ctx.runMutation(internal.studentImport.failRow, {
          rowId: row.rowId,
          reason:
            "Aucun code de connexion libre pour cette classe après douze essais",
        });
        continue;
      }

      const parentCode = await drawFreeCode(
        () => buildParentCode(secureRandomInt),
        (candidate) =>
          ctx.runQuery(internal.studentImport.parentCodeTaken, {
            code: candidate,
          }),
      );
      if (parentCode === null) {
        await ctx.runMutation(internal.studentImport.failRow, {
          rowId: row.rowId,
          reason: "Aucun code de rattachement libre après douze essais",
        });
        continue;
      }

      try {
        // L'IDENTIFIANT PART EN MINUSCULES, ET C'EST CE QUI PERMET DE SE
        // CONNECTER. `Password.authorize` passe par le `profile()` de
        // `convex/auth.ts` À LA CONNEXION AUSSI, et celui-ci met en minuscules :
        // un compte créé avec `CM1A-4821` tel quel serait introuvable au moment
        // où l'enfant tape son code. Le billet, lui, affiche les majuscules.
        const normalized = normalizeCode(loginCode);
        const { user } = await createAccount(ctx, {
          provider: "password",
          account: {
            id: normalized,
            secret: initialPassword(loginCode),
          },
          profile: {
            email: normalized,
            name: row.name,
            role: "student",
          } as unknown as Parameters<typeof createAccount>[1]["profile"],
        });

        await ctx.runMutation(internal.studentImport.commitRow, {
          rowId: row.rowId,
          studentUserId: user._id,
          schoolClassId: row.schoolClassId,
          loginCode,
          parentCode,
          actorProfileId: job.createdBy,
        });
      } catch (err: unknown) {
        // Le motif est écrit sur la ligne, pas seulement journalisé : c'est ce
        // que le directeur lira en face du nom de l'élève qui manque.
        const reason =
          err instanceof Error ? err.message : "Erreur inconnue à la création";
        await ctx.runMutation(internal.studentImport.failRow, {
          rowId: row.rowId,
          reason: reason.slice(0, 200),
        });
      }
    }

    const { remaining } = await ctx.runMutation(
      internal.studentImport.advanceJob,
      { jobId: args.jobId },
    );

    // SE REPLANIFIER PLUTÔT QUE BOUCLER : une action a une durée maximale, et
    // quatre cents créations de comptes la dépasseraient. `runAfter(0)` rend la
    // main entre deux lots.
    if (remaining > 0) {
      await ctx.scheduler.runAfter(0, internal.studentImportRun.processBatch, {
        jobId: args.jobId,
      });
    }
  },
});
