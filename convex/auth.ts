import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ResendOTPPasswordReset } from "./ResendOTPPasswordReset";
import { decideSignupRole } from "./roleRules";

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

      // UN RÔLE QUI CONFÈRE UNE AUTORITÉ NE S'ATTRIBUE PAS SOI-MÊME. C'est la
      // règle, et elle vaut pour les trois : `admin` administre la plateforme,
      // `directeur` engage une école, `professeur` lit et réécrit le catalogue
      // — énoncés, corrigés, indices — que des élèves payants jouent.
      //
      // `professeur` était accepté ici, et l'écran d'inscription l'offrait dans
      // un menu déroulant : il suffisait de trente secondes pour obtenir un
      // compte que `callerIsStaff` reconnaît comme « membre du personnel ».
      // Toute garde de rôle du dépôt en dépendait, sans le savoir. Les
      // écritures sur les exercices sont depuis passées à une garde de LIEN
      // (`exercises.ts`), mais la cause était ici.
      //
      // ON REFUSE PLUTÔT QUE DE RETOMBER EN SILENCE. Le repli `: "student"`
      // plus bas aurait transformé une demande de compte professeur en compte
      // ÉLÈVE, sans un mot : la personne aurait découvert bien plus tard que
      // son rôle n'est pas celui qu'elle a demandé. Un refus explicite se lit.
      // CONSÉQUENCE ASSUMÉE : plus AUCUN chemin applicatif ne crée un profil
      // `professeur`, `directeur` ou `admin`. `schools.addStaff` ne le fait pas
      // — il exige `profile.role === staffRole` et RATTACHE un profil existant
      // à une école, il ne le crée pas. Ces trois rôles se posent donc hors de
      // l'application, comme le faisaient déjà `admin` et `directeur`.
      //
      // La décision vit dans `convex/roleRules.ts`, pure et testée : ce
      // handler-ci n'est atteignable par aucun test du dépôt.
      const role = decideSignupRole(rawRole);

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
