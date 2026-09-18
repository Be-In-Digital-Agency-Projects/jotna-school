import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ResendOTPPasswordReset } from "./ResendOTPPasswordReset";
import { decideProfileRole } from "./roleRules";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        const rawEmail = (params.email as string) ?? "";
        return {
          email: rawEmail.trim().toLowerCase(),
          name: (params.name as string) ?? "",
          // Pass role through so createOrUpdateUser can read it.
          // This field is NOT stored on the users table -- we strip it
          // out in createOrUpdateUser and store it on the profiles table.
          role: (params.role as string) ?? "student",
        };
      },
      validatePasswordRequirements(password: string) {
        if (password.length < 6) {
          throw new Error("Le mot de passe doit contenir au moins 6 caractères.");
        }
      },
      reset: ResendOTPPasswordReset,
    }),
  ],
  callbacks: {
    async createOrUpdateUser(ctx, { existingUserId, profile }) {
      // --- Existing user (sign-in): just return the id ---
      if (existingUserId !== null) {
        return existingUserId;
      }

      // --- New user (sign-up): create user + profile ---
      const rawRole = (profile as Record<string, unknown>).role as
        | string
        | undefined;

      // AUCUN COMPTE NE SE CRÉE TOUT SEUL. C'est l'école qui crée les comptes
      // de ses professeurs, de ses parents et de ses élèves ; la personne ne
      // fait que les ACTIVER, avec un code que l'école lui remet. La décision
      // vit dans `convex/roleRules.ts`, pure et testée.
      //
      // `schoolCreated` N'EST PAS FALSIFIABLE, et c'est tout le mécanisme. Sur
      // une inscription client, ce handler ne reçoit que ce que retourne le
      // `profile(params)` ci-dessus — exactement `{ email, name, role }`. Un
      // client ne peut donc pas faire apparaître `schoolCreated` dans cet
      // objet, quoi qu'il envoie dans ses paramètres. Seul un appel serveur à
      // `createAccount`, qui passe son `profile` directement au callback, peut
      // porter le marqueur : `convex/schoolAccounts.ts` pour les adultes,
      // `convex/studentImportRun.ts` pour les élèves.
      const schoolCreated =
        (profile as Record<string, unknown>).schoolCreated === true;
      const role = decideProfileRole({ rawRole, schoolCreated });

      const name = (profile.name as string) ?? "";
      const email = (profile.email as string) ?? undefined;

      const userId = await ctx.db.insert("users", {
        name,
        email,
      });

      await ctx.db.insert("profiles", {
        userId: userId,
        role,
        name,
      });

      return userId;
    },
  },
});
