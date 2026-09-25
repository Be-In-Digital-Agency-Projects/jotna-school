# Application mobile élève — iOS & Android (plan)

**But :** un enfant de huit à dix ans ouvre une application sur le téléphone ou
la tablette de sa classe, tape le code de son billet, et fait ses paliers
d'exercices. Rien d'autre.

**Périmètre :** l'espace ÉLÈVE, et lui seul. Le parent, le professeur, le
directeur et l'administrateur restent sur le web — leur travail est de la
saisie au clavier (collage d'import, dépôt de PDF, relecture d'énoncés,
facturation), que ce plan ne déplace pas.

**Ce que ce plan NE fait PAS**, et c'est délibéré :

- il ne rend pas l'application jouable hors connexion (décision D4, et la
  raison n'est pas la difficulté) ;
- il n'ouvre aucun paiement dans l'application (décision D7) ;
- il ne déplace pas l'application web dans un sous-dossier (décision D2) ;
- il ne touche à AUCUNE fonction Convex existante. Le mobile est un second
  client du même déploiement, pas une seconde application.

---

## 1. Ce qui existe déjà — inventaire vérifié

Le back-end est écrit, testé et en service. Le mobile n'a rien à y ajouter pour
la v1 : tout ce dont l'enfant a besoin est déjà exposé.

| Besoin de l'écran mobile | Fonction Convex existante |
|---|---|
| ouvrir un palier | `api.paliers.index.getBucket` (action), `startPalierAttempt` |
| charger les 10 exercices | `api.paliers.index.getExercisesForPalier` |
| répondre | `api.palierAttempts.verifyAttempt` |
| demander un indice | `api.palierAttempts.requestHint` |
| clore le palier | `api.palierAttempts.submitPalier` |
| « j'en veux encore » | `api.paliers.index.regenerateFailedExercises` |
| explication pas à pas | `convex/attemptsExplain.ts` |
| accueil, matières, progression | `api.students.getMyStats`, `getStudentSubjectMap` |
| coffre à badges | `api.badges.listMyEarned`, `api.students.getMyEarnedBadges` |
| son, niveau vu, série | `api.students.getMySoundEnabled`, `markLevelSeen`, `api.streak.setSoundEnabled` |
| mur de paiement | `convex/access.ts` (`checkAccess` / `requireAccess`) |

Côté interface, cinq types d'exercice existent en React DOM
(`components/exercises/`), plus la mascotte `Pio`, la barre d'étoiles, le
niveau, le coffre et les sons. **Aucun de ces composants ne se réutilise tel
quel** (décision D6) ; les TEXTES et les RÈGLES, si.

---

## 2. Décisions tranchées

### D1 — Expo / React Native. Ni WebView, ni natif écrit deux fois.

Trois options existaient, une seule tient.

**Capacitor (emballer le site dans une WebView) — écarté.** Le cœur de
l'application est le geste : `@dnd-kit` pose des écouteurs de pointeur sur des
nœuds DOM, et ce qui est déjà inconfortable au doigt dans un navigateur mobile
ne s'améliore pas d'être empaqueté. S'y ajoute la règle App Store 4.2
(*Minimum Functionality*), qui vise explicitement les sites repackagés.

**Natif (Swift + Kotlin) — écarté.** Il faudrait écrire le moteur d'exercices
DEUX fois, et réimplémenter le client Convex — websocket, réactivité, file
d'attente des mutations — dans deux langages où il n'existe pas.

**Expo / React Native — retenu.** Le client `convex` fonctionne en React
Native, et `@convex-dev/auth` le prend en charge NOMMÉMENT. Vérifié dans le
paquet publié, version `0.0.91` (celle du `package.json`), fichier
`dist/react/index.d.ts` :

```
 * Optional custom storage object that implements the TokenStorage interface,
 * otherwise localStorage is used.
 *
 * You must set this for React Native.
    storage?: TokenStorage;
```

et plus bas, sur `TokenStorage` : *« In React Native we recommend wrapping
`expo-secure-store` »*. Le même commentaire précise que `storageNamespace`
ignore les caractères non alphanumériques « for RN compatibility ». La prise en
charge n'est donc pas déduite d'un billet de blog : elle est écrite dans les
types du paquet installé.

### D2 — L'application web NE BOUGE PAS. On ajoute à côté.

`pnpm-workspace.yaml` ne déclare aujourd'hui que `ignoredBuiltDependencies`,
donc aucun `packages:`. La tentation serait de passer en monorepo propre —
`apps/web`, `apps/mobile` — mais déplacer l'application web signifie toucher
les 70 fichiers de `app/`, les alias `@/`, la configuration Next, ESLint,
Vitest, Playwright et le job CI, **avant d'avoir écrit un seul écran mobile**.
Un chantier qui commence par casser ce qui marche se juge mal.

La racine reste donc la racine du workspace ET l'application web. On ajoute :

```
jotna-school/
├─ app/ components/ lib/ stores/     ← le web, inchangé
├─ convex/                           ← UN déploiement, UN schéma, partagé
├─ apps/
│  └─ mobile/                        ← l'application Expo
└─ packages/
   └─ core/                          ← logique pure partagée web ↔ mobile
```

`pnpm-workspace.yaml` gagne `packages: ['apps/*', 'packages/*']` — ajout
purement additif, la racine n'a pas besoin d'y figurer.

**`convex/` ne se duplique JAMAIS.** Le mobile importe `convex/_generated/api`
par un alias `tsconfig` vers `../../convex`. Une copie divergerait au premier
`npx convex dev`, et la divergence ne se verrait qu'à l'exécution, chez
l'enfant.

**Piège Metro à traiter en phase 0 :** pnpm installe en liens symboliques et
Metro ne surveille par défaut que le dossier de l'application. Il faut
`watchFolders` pointant sur la racine du dépôt, sinon un `convex` régénéré ne
se recharge pas — et l'erreur ressemble à un bug applicatif, pas à un problème
de bundler.

### D3 — L'application est celle de l'ENFANT.

Un adulte qui se connecte avec un compte parent, professeur, directeur ou
administrateur voit un écran qui le lui dit et le déconnecte. Pas de navigation
dégradée, pas de menu caché : une application d'enfant qui laisse entrevoir un
espace d'adulte apprend à l'enfant qu'il existe une porte à pousser.

### D4 — La vérification reste SERVEUR. Pas de jeu hors connexion en v1.

C'est la décision structurante de ce plan, et elle mérite son raisonnement en
entier parce qu'elle sera contestée — le Sénégal, la 3G, les tablettes d'école.

Le dépôt protège les corrigés par construction :

- `getExercisesForPalier` ne rend jamais l'exercice brut. Il passe par
  `stripAnswerFromExercise`, qui retire `answerKey` et assainit le `payload` ;
- `verifyAttempt` rend `{ isCorrect, attemptNumber, hintsUsedSoFar,
  attemptsRemaining }` et porte ce commentaire : *« Server-only feedback. We DO
  NOT return the correct answer — Decision 61 »* ;
- les indices arrivent UN À UN par `requestHint`, jamais en bloc.

Jouer hors connexion exige de poser le corrigé sur l'appareil. Une empreinte
cryptographique ne sauve rien pour un QCM : quatre options, donc quatre essais
pour retrouver la bonne. Et la réponse courte est vérifiée par l'IA
(`convex/attemptsVerify.ts`) — aucune version embarquée n'existe.

**Retenu pour la v1 :** en ligne, avec une tenue honnête du réseau (phase 4) —
un écran « pas de connexion » explicite et un bouton « réessayer », jamais un
sablier infini. Les mutations non critiques (préférence de son, niveau vu) sont
déjà mises en file par le client Convex quand le réseau tombe ; le site s'y
appuie (`app/(student)/student/profil/page.tsx`).

**Ouvert pour la v2**, à trancher par le propriétaire (§4) : un **mode
entraînement hors connexion**, sur un lot d'exercices téléchargés dont le
corrigé PEUT voyager — parce que rien n'y est noté. Pas d'étoile, pas de
validation de palier, pas de badge. Le palier reste en ligne, donc la Décision
61 reste intacte, et l'enfant sans réseau a tout de même quelque chose à faire.

### D5 — On entre par un CODE, pas par une adresse électronique.

Le web n'a qu'un formulaire courriel + mot de passe
(`app/(auth)/login/page.tsx`). Un enfant de huit ans y tape son code dans un
champ marqué « Email ». Le mobile corrige cela, et la correction est précise.

Vérifié dans `convex/studentImportRun.ts` : `createAccount` reçoit
`account: { id: normalizeCode(loginCode), secret: initialPassword(loginCode) }`,
et `initialPassword` rend le code **tel qu'il est imprimé**. Le commentaire est
explicite : *« Le SECRET garde les majuscules, lui : `Password.authorize` ne
fait passer que l'identifiant par `profile()`, jamais le mot de passe. »*
`studentCredentials.resetStudentLoginCode` fait pareil
(`{ id: normalized, secret: printable }`), donc les DEUX chemins de création
produisent la même forme.

**Conséquence pour l'écran mobile**, et c'est exactement le genre de détail
qu'un nouveau client casse en silence :

```ts
await signIn("password", {
  email:    normalizeCode(saisie),      // minuscules, sans espace
  password: formePrintable(saisie),     // préfixe en MAJUSCULES + 4 chiffres
  flow:     "signIn",
});
```

L'écran est un pavé : préfixe de classe mémorisé après la première connexion
(un enfant revient dans la même classe toute l'année), quatre chiffres en gros,
affichage en majuscules. **Pas de « code oublié »** — `ResendOTPPasswordReset`
n'a nulle part où écrire, et c'est voulu : c'est un adulte de l'école qui
dépanne.

### D6 — Les cinq exercices se réécrivent. La moitié du travail est déjà faite.

Ce qui ne passe pas la frontière du DOM, et par quoi le remplacer :

| Web | Mobile | Pourquoi |
|---|---|---|
| `@dnd-kit` | `react-native-gesture-handler` + `react-native-reanimated` | dnd-kit manipule des nœuds DOM |
| `framer-motion` | `moti` (au-dessus de reanimated) | API proche, animations sur le fil natif |
| `canvas-confetti` | `react-native-confetti-cannon` | `<canvas>` n'existe pas |
| `howler` | `expo-audio` | module audio courant d'Expo (`57.0.5`, aligné SDK) |
| `lottie-react` | `lottie-react-native` | même format de fichier |
| `lucide-react` | `lucide-react-native` | même jeu d'icônes |
| Tailwind v4 | `nativewind` v4, ou `StyleSheet` | à trancher en phase 0 sur un écran témoin |

Ce qui PASSE, et qu'il faut extraire plutôt que recopier (phase 2.1) : les
textes enfant (`lib/kidCopy.ts`), les messages de refus
(`lib/accessCopy.ts`, `lib/refusalMessage.ts`), les paliers de rareté des
badges (`lib/badges.ts`), la machine d'état de session
(`stores/exercise-session-store.ts`, déjà en Zustand, déjà testée). Ces
fichiers partent dans `packages/core` AVEC leurs tests, et le web les importe
de là — sinon les deux copies divergeront, et c'est l'enfant qui lira les deux
versions du même message.

**La forme de la réponse soumise ne change pas d'un caractère.** `verifyByType`
côté serveur est le contrat ; le mobile produit la même chaîne que le web, ou
l'enfant a faux en ayant raison. Un test de conformité par type d'exercice
(phase 2.11) garde cet invariant.

### D7 — Aucun paiement, aucun prix, aucun lien vers un paiement.

Le modèle est B2B : l'école achète des sièges
(`subscriptions.ownerType: "school"`, barème `convex/pricing.ts`), par PayDunya
ou Bictorys, hors application. L'enfant n'achète rien.

Tant que l'application ne propose ni achat ni lien vers un achat, la règle App
Store 3.1.1 (achat intégré obligatoire) ne s'applique pas : on accède à un
contenu acquis ailleurs, cas prévu par 3.1.3(b). **Le jour où un bouton
« renouveler » apparaît dans l'application, c'est un refus immédiat** — et un
partage de 15 à 30 % sur un abonnement scolaire libellé en francs CFA.

L'écran de mur de paiement affiche donc le message enfant (`kidMessages`, via
`checkAccess` qui rend `null`) : l'abonnement de l'école est à revoir, parles-en
à ton maître. Rien de cliquable qui mène à une caisse.

### D8 — Android d'abord.

Le terrain est sénégalais : appareils Android d'entrée de gamme, tablettes
partagées, 3G. Expo construit les deux, mais l'ordre de mise en service est
Android, puis iOS. On ajoute un canal de **distribution interne (APK)** dès la
phase 0 : une école équipée de tablettes installe sans passer par le Play
Store, et l'itération avec les classes pilotes ne dépend pas d'une revue.

### D9 — Catégorie Enfants : les contraintes se posent AVANT d'écrire, pas après le refus.

Apple *Kids Category* (tranche 9-11 ans) et Google Play *Designed for Families*
imposent, entre autres : aucune publicité ciblée, aucun analytics tiers sans
consentement, une barrière parentale devant tout lien sortant, une politique de
confidentialité, et le formulaire *Data safety* rempli.

Deux points appellent une action, pas seulement une case à cocher :

1. **`profiles.aiDataConsentGranted` n'est lu par PERSONNE.** Vérifié : le champ
   est déclaré au schéma (`convex/schema.ts:42`, commenté « Loi 2008-12,
   Sénégal ») et `grep` sur `convex/`, `app/`, `components/` et `lib/` ne trouve
   aucune autre occurrence. Les travaux de l'enfant partent pourtant chez
   OpenAI (génération de paliers, vérification de réponse courte, explication).
   Une revue de boutique sur une application d'enfants posera la question.
2. **Suppression de compte (App Store 5.1.1(v)).** La règle vise les
   applications qui CRÉENT des comptes. L'application élève n'en crée pas — les
   codes viennent de l'import scolaire — ce qui est défendable en revue. Mais
   le jour où une application parent avec inscription sort, le chemin de
   suppression devient obligatoire, et il n'existe nulle part dans le dépôt.

### D10 — Une tablette, plusieurs enfants.

Le cas courant à l'école n'est pas un appareil par élève. « Changer d'élève »
est donc une fonction de premier plan : déconnexion complète, effacement du
jeton dans `expo-secure-store`, retour au pavé de code avec le préfixe de
classe conservé. Ce qu'il ne faut SURTOUT pas faire : garder plusieurs sessions
ouvertes côte à côte — l'enfant jouerait sous le nom d'un autre, et les
tentatives comme les badges iraient au mauvais profil.

---

## 3. Phases

### Phase 0 — Socle

- [ ] 0.1 `pnpm-workspace.yaml` : `packages: ['apps/*', 'packages/*']`
- [ ] 0.2 `apps/mobile` — Expo SDK 57, `expo-router`, TypeScript, Hermes
- [ ] 0.3 `ConvexReactClient` + `ConvexAuthProvider` avec l'adaptateur
      `TokenStorage` → `expo-secure-store` (D1)
- [ ] 0.4 Alias `tsconfig` vers `../../convex` ; `metro.config.js` avec
      `watchFolders` sur la racine (D2)
- [ ] 0.5 Écran témoin : une requête Convex authentifiée qui s'affiche
- [ ] 0.6 Trancher le style sur cet écran témoin : `nativewind` ou `StyleSheet`
- [ ] 0.7 `eas.json` — profils `development`, `preview` (APK interne), `production`
- [ ] 0.8 CI : ajouter `typecheck` + tests du mobile au workflow existant, sans
      toucher au job web (`.github/workflows/`)

### Phase 1 — Entrer

- [ ] 1.1 Pavé « Mon code » : préfixe mémorisé, gros chiffres, majuscules
- [ ] 1.2 Connexion selon D5 (identifiant normalisé / secret imprimable)
- [ ] 1.3 Session persistée, reconnexion automatique au lancement
- [ ] 1.4 « Changer d'élève » : déconnexion + effacement du jeton (D10)
- [ ] 1.5 Garde de rôle : un adulte connecté voit un écran d'explication et sort
- [ ] 1.6 Écran mur de paiement, message enfant, **sans lien de paiement** (D7)
- [ ] 1.7 Tests : normalisation du code, garde de rôle, persistance

### Phase 2 — Le moteur d'exercices

- [ ] 2.1 `packages/core` : extraire `kidCopy`, `accessCopy`, `refusalMessage`,
      `badges`, `exercise-session-store` **avec leurs tests** ; le web importe
      de là (D6)
- [ ] 2.2 `ExercisePlayer` mobile — orchestration, 5 essais, chronomètre, indices
- [ ] 2.3 QCM
- [ ] 2.4 Réponse courte (+ clavier qui ne masque pas l'énoncé)
- [ ] 2.5 Remise en ordre (liste triable reanimated)
- [ ] 2.6 Relier — **au tap, pas au glissé** : tap sur l'élément, tap sur sa
      paire. Tracer une liaison au doigt sur un écran de cinq pouces échoue une
      fois sur trois à cet âge. La chaîne soumise est identique (D6)
- [ ] 2.7 Glisser-déposer (gesture-handler, zones mesurées à `onLayout`)
- [ ] 2.8 Indices progressifs (`requestHint`) + explication pas à pas
- [ ] 2.9 Retours : sons (`expo-audio`), haptique (`expo-haptics`), confettis, Pio
- [ ] 2.10 Fin de palier : étoiles, « j'en veux encore », plafond de régénération
- [ ] 2.11 Tests de conformité par type : la chaîne soumise par le mobile est
      acceptée par `verifyByType` exactement comme celle du web
- [ ] 2.12 Parcours complet automatisé (Maestro) : code → palier → 10 exercices → fin

### Phase 3 — Autour de l'exercice

- [ ] 3.1 Accueil : matières, série, niveau (`students.getMyStats`)
- [ ] 3.2 Matière → thématiques → paliers 1 à 10
- [ ] 3.3 Coffre à badges + animation de déblocage
- [ ] 3.4 Profil : avatar, statistiques, son
- [ ] 3.5 Montée de niveau

### Phase 4 — Terrain : réseau, appareils, enfants

- [ ] 4.1 Écran « pas de connexion » explicite avec « réessayer », partout où
      une requête peut ne jamais revenir (D4)
- [ ] 4.2 Préchauffer le palier avant que l'enfant appuie sur « commencer » —
      `getBucket` peut déclencher une génération IA, longue en 3G
- [ ] 4.3 Sons, icônes et illustrations de badges **dans le paquet**, jamais
      téléchargés au moment du jeu
- [ ] 4.4 Budget d'appareil bas de gamme : mesurer démarrage et mémoire sur un
      Android 2 Go réel, pas sur un émulateur
- [ ] 4.5 Accessibilité : `prefers-reduced-motion` (déjà honoré côté web via
      `MotionConfig`), cibles tactiles ≥ 48 dp, mise à l'échelle des polices
- [ ] 4.6 Tablette partagée : bascule d'élève testée sur le terrain

### Phase 5 — Publication

- [ ] 5.1 Identité : icône, écran de lancement, nom, identifiant de paquet
- [ ] 5.2 Politique de confidentialité + formulaire *Data safety*
- [ ] 5.3 Liste de contrôle Kids Category / Designed for Families (D9)
- [ ] 5.4 Consentement IA parental : le brancher (D9, point 1)
- [ ] 5.5 Canal APK interne pour les écoles pilotes (D8)
- [ ] 5.6 Fiches de boutique en français, captures d'écran
- [ ] 5.7 Politique de mise à jour à chaud (`expo-updates`) : correctifs
      seulement, jamais un changement de nature de l'application

---

## 4. Ce que ce plan laisse ouvert — à trancher par le propriétaire

Quatre questions changent le contenu des phases. Aucune n'empêche de commencer
la phase 0.

1. **Hors connexion.** La v1 part en ligne seule (D4). Le mode entraînement
   hors connexion — corrigés embarqués, rien de noté — est-il attendu pour la
   première mise en service, ou après les classes pilotes ?
2. **Application parent.** Ce plan dit non pour la v1 (D3). Si oui, elle amène
   l'inscription, donc la suppression de compte obligatoire (D9, point 2).
3. **Consentement IA.** Le champ existe et ne sert à rien (D9, point 1).
   Faut-il le brancher avant la mise en boutique — et sur le web en même temps,
   puisque le défaut y est déjà ?
4. **Coûts.** Programme développeur Apple (99 USD/an), compte Google Play
   (25 USD une fois), EAS, et au moins un appareil Android d'entrée de gamme
   pour mesurer ce que la phase 4.4 demande.

---

## 5. Versions relevées au 25/09/2026

Interrogées au registre npm le jour de ce plan, pour que les choix ci-dessus
reposent sur ce qui existe et non sur un souvenir. Ce sont des RELEVÉS, pas des
épinglages : c'est le SDK Expo retenu en 0.2 qui fixera les versions réelles.

| Paquet | Version |
|---|---|
| `expo` | 57.0.25 |
| `expo-secure-store` | 57.0.4 |
| `expo-audio` | 57.0.5 |
| `expo-haptics` | 57.0.3 |
| `react-native-reanimated` | 4.7.0 |
| `react-native-gesture-handler` | 3.3.0 |
| `moti` | 0.30.0 |
| `nativewind` | 4.2.7 |
| `lucide-react-native` | 1.48.0 |
| `lottie-react-native` | 7.5.0 |
| `react-native-confetti-cannon` | 1.5.2 |
| `@convex-dev/auth` | 0.0.95 au registre ; **0.0.91** au dépôt, et c'est cette version-là qui a été lue pour D1 |

---

## 6. Risques

| Risque | Ce qui le contient |
|---|---|
| Le mobile diverge du web sur les textes et les règles | `packages/core` partagé, pas de copie (D6, 2.1) |
| Une chaîne de réponse mobile refusée par `verifyByType` | tests de conformité par type (2.11) |
| `convex/_generated` copié dans le mobile, puis périmé | alias `tsconfig`, jamais de copie (D2) |
| Metro ne recharge pas un `convex` régénéré | `watchFolders` sur la racine (0.4) |
| Refus de boutique sur la catégorie Enfants | phase 5 traitée AVANT la soumission, pas après (D9) |
| Un bouton « payer » ajouté plus tard | D7 écrite ici pour que l'ajout se discute |
| L'enfant sans réseau n'a rien à faire | assumé en v1, ouvert en §4 point 1 |
