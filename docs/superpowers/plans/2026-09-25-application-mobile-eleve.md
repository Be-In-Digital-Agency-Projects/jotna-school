# Application mobile élève — iOS & Android (plan)

**But :** un enfant de huit à dix ans ouvre une application sur le téléphone ou
la tablette de sa classe, tape le code de son billet, et fait ses paliers
d'exercices — **y compris sans réseau**. Rien d'autre.

**Périmètre :** l'espace ÉLÈVE, et lui seul. Le parent, le professeur, le
directeur et l'administrateur restent sur le web — leur travail est de la
saisie au clavier (collage d'import, dépôt de PDF, relecture d'énoncés,
facturation), que ce plan ne déplace pas.

**Ce que ce plan NE fait PAS :**

- il n'ouvre aucun paiement dans l'application (D7) ;
- il ne déplace pas l'application web dans un sous-dossier (D2) ;
- il ne réécrit AUCUNE fonction Convex existante. Le hors-ligne s'ajoute à
  côté du chemin en ligne, qui ne bouge pas d'une ligne (D12).

---

## 1. Ce qui existe déjà — inventaire vérifié

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
| coffre à badges | `api.badges.listMyEarned` |
| mur de paiement | `convex/access.ts` (`checkAccess` / `requireAccess`) |

Cinq types d'exercice existent en React DOM (`components/exercises/`), plus la
mascotte `Pio`, les étoiles, le niveau, le coffre et les sons. **Aucun de ces
composants ne se réutilise tel quel** (D6) ; les TEXTES et les RÈGLES, si.

---

## 2. Décisions tranchées

### D1 — Expo / React Native. Ni WebView, ni natif écrit deux fois.

**Capacitor — écarté.** Le cœur du produit est le geste : `@dnd-kit` pose des
écouteurs de pointeur sur des nœuds DOM, et ce qui est déjà inconfortable au
doigt dans un navigateur ne s'améliore pas d'être empaqueté. S'y ajoute la
règle App Store 4.2 (*Minimum Functionality*), qui vise les sites repackagés.
Et une WebView ne donne pas de base locale sérieuse pour le hors-ligne (§3).

**Natif (Swift + Kotlin) — écarté.** Le moteur d'exercices s'écrirait DEUX
fois, et le client Convex — websocket, réactivité, file de mutations — serait à
réimplémenter dans deux langages où il n'existe pas.

**Expo / React Native — retenu.** `@convex-dev/auth` prend React Native en
charge NOMMÉMENT. Vérifié dans le paquet publié `0.0.91`, celle du
`package.json`, fichier `dist/react/index.d.ts` :

```
 * Optional custom storage object that implements the TokenStorage interface,
 * otherwise localStorage is used.
 *
 * You must set this for React Native.
    storage?: TokenStorage;
```

et sur `TokenStorage` : *« In React Native we recommend wrapping
`expo-secure-store` »*. `storageNamespace` précise même ignorer les caractères
non alphanumériques « for RN compatibility ». La prise en charge est lue dans
les types, pas espérée.

### D2 — L'application web NE BOUGE PAS. On ajoute à côté.

`pnpm-workspace.yaml` ne déclare aujourd'hui que `ignoredBuiltDependencies`.
Passer en `apps/web` casserait les alias `@/`, Next, ESLint, Vitest, Playwright
et le job CI **avant le premier écran mobile**. Un chantier qui commence par
casser ce qui marche se juge mal.

```
jotna-school/
├─ app/ components/ lib/ stores/     ← le web, inchangé
├─ convex/                           ← UN déploiement, UN schéma, partagé
├─ apps/
│  └─ mobile/                        ← l'application Expo
└─ packages/
   └─ core/                          ← logique PURE, partagée web ↔ mobile ↔ serveur
```

`pnpm-workspace.yaml` gagne `packages: ['apps/*', 'packages/*']` — ajout
additif, la racine n'a pas à y figurer.

**`convex/` ne se duplique JAMAIS** : alias `tsconfig` vers `../../convex`. Une
copie divergerait au premier `npx convex dev`, et la divergence ne se verrait
qu'à l'exécution, chez l'enfant.

**Pièges Metro — CONSTATÉS en phase 0, pas anticipés.** Le premier était
prévu ; les deux autres ont été trouvés en faisant tourner `expo export`, et
aucun des deux n'aurait été pris par le typecheck.

1. **`watchFolders` sur la racine.** Metro ne surveille que le dossier de
   l'application. Sans cela, un `convex` régénéré ne se recharge pas, et
   l'erreur ressemble à un bug applicatif, pas à un problème de bundler.
2. **`@expo/metro-runtime` est une dépendance FANTÔME.** `expo-router/entry`
   l'importe, et ni `expo` ni `expo-router` ne le déclarent — npm le masque
   par aplatissement, pnpm le révèle. Il est désormais une dépendance
   explicite d'`apps/mobile`, et ne doit pas en être retiré.
3. **`disableHierarchicalLookup: true` CASSE pnpm.** C'est la recommandation
   courante pour les monorepos npm et yarn, et elle était dans la première
   version de `metro.config.js`. Sous pnpm, les dépendances d'un paquet vivent
   à côté de lui dans `node_modules/.pnpm/…/node_modules/`, et SEULE la
   remontée hiérarchique les atteint : la couper interdit à chaque paquet
   d'atteindre ses propres dépendances. La panne observée était
   `Unable to resolve module whatwg-fetch from @expo/metro-runtime`.

**Conséquence de méthode, qui vaut pour la suite du chantier :** `expo export`
est le garde qui compte, pas le typecheck. Les deux pannes ci-dessus sont
passées sous un `tsc --noEmit` vert. La CI construit donc le paquet Metro à
chaque fois (tâche 0.8).

### D3 — L'application est celle de l'ENFANT.

Un adulte qui se connecte voit un écran qui le lui dit et le déconnecte. Pas de
navigation dégradée, pas de menu caché : une application d'enfant qui laisse
entrevoir un espace d'adulte apprend à l'enfant qu'il existe une porte.

### D4 — Les paliers NOTÉS se jouent hors connexion. Décision du propriétaire, prise en connaissance du coût.

C'est la décision structurante, et elle a un prix qui est assumé : **le verdict
de correction descend sur l'appareil**. Le §3 dit exactement sous quelle forme,
ce que cela concède, et ce que cela ne concède pas.

Ce que ce plan affirmait dans sa première version est **corrigé** : j'avais
écrit que la réponse courte était vérifiée par l'IA, ce qui rendait le
hors-ligne impossible pour ce type. C'est faux sur le chemin PALIER. Vérifié
dans `convex/palierAttempts.ts` : `verifyByType` appelle cinq fonctions
**pures et déterministes** — `verifyQcm`, `verifyMatch`, `verifyOrder`,
`verifyDragDrop`, `verifyShortAnswer` — et cette dernière est une simple
comparaison normalisée :

```ts
const norm = submitted.toLowerCase().trim();
return payload.acceptedAnswers.some((a) => a.toLowerCase().trim() === norm);
```

L'IA (`attemptsVerify.verifyShortAnswerWithAI`) n'intervient qu'en SECONDE
chance, appelée par le lecteur web APRÈS l'échec littéral, pour rattraper une
réponse sémantiquement juste. C'est un rattrapage **vers le haut**, jamais un
verdict initial — et cela tombe parfaitement pour le hors-ligne (D16).

### D5 — On entre par un CODE, pas par une adresse électronique.

Vérifié dans `convex/studentImportRun.ts` : `createAccount` reçoit
`account: { id: normalizeCode(loginCode), secret: initialPassword(loginCode) }`,
et `initialPassword` rend le code **tel qu'il est imprimé**. Le commentaire est
explicite : *« Le SECRET garde les majuscules, lui : `Password.authorize` ne
fait passer que l'identifiant par `profile()`, jamais le mot de passe. »*
`studentCredentials.resetStudentLoginCode` fait pareil
(`{ id: normalized, secret: printable }`) : les deux chemins de création
produisent la même forme.

```ts
await signIn("password", {
  email:    normalizeCode(saisie),      // minuscules, sans espace
  password: formePrintable(saisie),     // préfixe en MAJUSCULES + 4 chiffres
  flow:     "signIn",
});
```

L'écran est un pavé : préfixe de classe mémorisé après la première connexion,
quatre chiffres en gros, affichage en majuscules. **Pas de « code oublié »** —
`ResendOTPPasswordReset` n'a nulle part où écrire, et c'est voulu : c'est un
adulte de l'école qui dépanne.

### D6 — Les cinq exercices se réécrivent. Une partie du travail est déjà faite.

| Web | Mobile | Pourquoi |
|---|---|---|
| `@dnd-kit` | `react-native-gesture-handler` + `react-native-reanimated` | dnd-kit manipule des nœuds DOM |
| `framer-motion` | `moti` (au-dessus de reanimated) | API proche, animations sur le fil natif |
| `canvas-confetti` | `react-native-confetti-cannon` | `<canvas>` n'existe pas |
| `howler` | `expo-audio` | module audio courant d'Expo (`57.0.5`, aligné SDK) |
| `lottie-react` | `lottie-react-native` | même format de fichier |
| `lucide-react` | `lucide-react-native` | même jeu d'icônes |
| Tailwind v4 | `StyleSheet` + jetons | tranché en phase 0 — voir **D22** |

Ce qui PASSE, et qu'il faut extraire plutôt que recopier : les textes enfant
(`lib/kidCopy.ts`), les messages de refus (`lib/accessCopy.ts`,
`lib/refusalMessage.ts`), la rareté des badges (`lib/badges.ts`), la machine
d'état de session (`stores/exercise-session-store.ts`), et surtout
**`convex/paliers/scoring.ts`, qui se déclare lui-même « pure functions, no
Convex imports »** — il descend donc tel quel dans `packages/core`, et le
serveur continue de l'importer. Un seul barème, jamais deux.

### D7 — Aucun paiement, aucun prix, aucun lien vers un paiement.

Le modèle est B2B : l'école achète des sièges (`subscriptions.ownerType:
"school"`, barème `convex/pricing.ts`). L'enfant n'achète rien. Sans achat ni
lien vers un achat, la règle App Store 3.1.1 ne s'applique pas ; on accède à un
contenu acquis ailleurs, cas prévu par 3.1.3(b). **Le jour où un bouton
« renouveler » apparaît, c'est un refus immédiat** — et 15 à 30 % sur un
abonnement scolaire libellé en francs CFA.

### D8 — Android d'abord.

Appareils d'entrée de gamme, tablettes partagées, 3G. Expo construit les deux,
mais l'ordre de mise en service est Android, puis iOS. Un canal de
**distribution interne (APK)** dès la phase 0 : une école équipée installe sans
passer par le Play Store, et l'itération avec les classes pilotes ne dépend pas
d'une revue.

### D9 — Catégorie Enfants : les contraintes se posent AVANT d'écrire.

Apple *Kids Category* (9-11 ans) et Google *Designed for Families* imposent :
aucune publicité ciblée, aucun analytics tiers sans consentement, barrière
parentale devant tout lien sortant, politique de confidentialité, formulaire
*Data safety*.

Deux points appellent une action :

1. **`profiles.aiDataConsentGranted` n'est lu par PERSONNE.** Vérifié : déclaré
   au schéma (`convex/schema.ts:42`, commenté « Loi 2008-12, Sénégal »), et
   `grep` sur `convex/`, `app/`, `components/`, `lib/` ne trouve aucune autre
   occurrence. Les travaux des enfants partent pourtant chez OpenAI.
2. **Suppression de compte (App Store 5.1.1(v)).** L'application élève ne crée
   pas de compte — les codes viennent de l'import scolaire — ce qui est
   défendable en revue. Le jour où une application parent avec inscription
   sort, le chemin devient obligatoire, et il n'existe nulle part.

### D10 — Une tablette, plusieurs enfants.

« Changer d'élève » est une fonction de premier plan : déconnexion complète,
effacement du jeton, **et purge du journal hors-ligne non synchronisé après
l'avoir envoyé** (D15). Ce qu'il ne faut SURTOUT pas faire : garder deux
sessions ouvertes — l'enfant jouerait sous le nom d'un autre.

### D23 — Le contrat de réponse vit dans `convex/`, et `packages/core` attend.

**Ce qui a été fait.** `convex/paliers/answers.ts` tient désormais les DEUX
bouts de la chaîne `attempts.submittedAnswer` : les `encode*` que les clients
emploient pour la fabriquer, et les `verify*` que le serveur emploie pour la
relire. `palierAttempts.ts` délègue et ne porte plus de copie.

**Pourquoi c'est le point qui comptait.** Les vérificateurs étaient côté
serveur, et chaque composant d'exercice du web fabriquait sa chaîne dans son
coin. Avec UN client, une divergence se voit tout de suite. Avec DEUX — web et
mobile — un encodage qui dérive d'un caractère donne un enfant qui a RAISON et
que le serveur compte FAUX, sans que rien ne signale l'écart. Les deux moitiés
sont maintenant dans un fichier pur, sous 22 tests d'aller-retour.

**Pourquoi PAS `packages/core`.** Deux raisons, dans cet ordre.

1. **L'extraction ne corrige rien.** Le but de D6 est qu'il n'existe qu'une
   définition de chaque chose partagée. C'est DÉJÀ le cas : le mobile lit
   `lib/` et `convex/` par alias, sans copie. `packages/core` ajouterait une
   frontière de construction et de la clarté — pas une correction.
2. **Son risque principal n'est pas vérifiable ici.** `convex/explainMistake.ts`
   importe `lib/kidCopy`, et trois modules Convex importent `lib/accessCopy` ;
   `lib/refusalMessage.ts` en a **29**. Déplacer ces fichiers dans un paquet du
   workspace change ce que le bundler de Convex doit résoudre. Or aucun outil
   Convex ne tourne dans ce conteneur — `npx convex codegen` s'arrête sur
   `No CONVEX_DEPLOYMENT set`. On ne pousserait donc pas une modification
   vérifiée, mais une modification espérée, sur un chemin qui sert des enfants.

**Ce qu'il faut pour la faire.** Un déploiement Convex de développement, et
l'ordre suivant : créer le paquet, y déplacer d'abord UN module consommé par
`convex/` (`kidCopy`, le plus petit), lancer `npx convex dev --once`, et
n'enchaîner que si le bundle passe. Tant que ce n'est pas fait, `lib/` reste la
couche partagée qu'elle est déjà — `convex/` l'utilise depuis bien avant le
mobile.

**Ce que cela ne coûte pas.** Le jour de l'extraction, le mobile changera
d'ALIAS, pas de code : `@lib/kidCopy` deviendra `@jotna/core`. Rien de ce qui
est écrit ici ne la complique.

### D22 — `StyleSheet` et des jetons, pas NativeWind.

La phase 0 devait trancher sur un écran témoin (tâche 0.6). Trois raisons ont
décidé, et aucune n'est « Tailwind c'est moins bien » :

1. **La surface est petite.** L'application élève tient en une quinzaine
   d'écrans, pas cent. Ce que NativeWind fait gagner — une convention partagée
   sur un grand nombre d'écrans — ne se rembourse pas ici.
2. **Le cœur du produit n'est pas stylable par classes.** Les cinq exercices
   sont animés au doigt, sur `react-native-reanimated` : ces composants
   écrivent des styles calculés dans un worklet, où une chaîne de classes n'a
   rien à dire.
3. **C'est une pièce de moins dans la chaîne de construction.** NativeWind
   s'insère dans Babel ET dans Metro, et se couple à la version de Reanimated.
   Sur un chantier qui vise Android d'entrée de gamme et une montée de version
   annuelle du SDK, chaque pièce du pipeline est un rendez-vous à honorer.

**Ce choix se retourne** : `apps/mobile/src/theme/tokens.ts` porte des
constantes, pas des classes. Adopter NativeWind plus tard les reprend telles
quelles dans un thème, sans réécrire un écran. Les couleurs sont les valeurs
Tailwind qu'emploie déjà `app/(student)/layout.tsx` sur le web.

---

## 3. Le hors-ligne, en détail

### D11 — Ce qui descend sur l'appareil n'est pas le corrigé, mais une EMPREINTE.

`sanitizePayload` (`convex/paliers/index.ts`) retire aujourd'hui exactement les
champs qui portent la réponse : `correctIndex` (qcm), l'appariement (match),
`correctSequence` (order), `correctZone` (drag-drop), `acceptedAnswers`
(short-answer). Le lot hors-ligne garde ce même assainissement et ajoute, par
exercice :

```
verifier: {
  salt:    string,     // tiré au hasard, propre à (tentative, exercice)
  digests: string[],   // HMAC-SHA256(salt, forme canonique acceptée)
}
```

L'appareil canonicalise la réponse de l'enfant, calcule l'empreinte, et teste
l'appartenance. Il ne peut pas LIRE la réponse ; il peut seulement reconnaître
la bonne quand elle est tapée — ou la chercher par force brute.

**Coût réel, par type, dit franchement :**

| Type | Espace à fouiller | Ce que l'empreinte protège |
|---|---|---|
| **qcm** | ~4 options | **presque rien — et c'est déjà vrai en ligne** : `verifyAttempt` rend `attemptsRemaining: max(0, 5 - attemptNumber)`, donc 5 essais pour 4 options. Le hors-ligne ne concède ici rien de neuf. |
| match | permutations des paires | 4 paires → 24 formes ; faible mais non nul |
| order | permutations de la séquence | idem |
| drag-drop | zones^items | correct dès 3 zones / 4 items |
| **short-answer** | texte libre | **réelle** : rien à énumérer |

### D12 — Le serveur reste la SOURCE DE VÉRITÉ. Il ne fait pas confiance au verdict de l'appareil.

C'est ce qui sauve la Décision 61 pour l'essentiel : **ce qui se synchronise,
ce sont les RÉPONSES SOUMISES, jamais les verdicts.** Au retour du réseau, le
serveur relit chaque réponse avec `verifyByType` — qu'il a déjà — et recalcule
tout avec `scoring.ts`. La base s'écrit exactement comme aujourd'hui.

L'empreinte embarquée ne sert donc qu'à **montrer la coche verte tout de
suite**. Formulé autrement, et c'est la phrase à retenir : *la Décision 61 est
relâchée pour le RETOUR À L'ENFANT, pas pour la NOTE.*

### D13 — La synchronisation réécrit des lignes `attempts`, et rien d'autre.

C'est la découverte qui rend ce chantier petit. `submitPalier` ne lit aucun
état intermédiaire : il recalcule tout depuis les lignes `attempts` rattachées
à la tentative. Deux formes existent, relevées dans le code :

| | `attemptNumber` | `submittedAnswer` | `hintsUsedCount` |
|---|---|---|---|
| vraie réponse (`verifyAttempt`) | 1..5 | la réponse | `0` |
| indice (`requestHint`) | `0` (sentinelle) | `__HINT_<i>` | `1` |

Le journal hors-ligne est donc **exactement cette liste**. La mutation de
synchronisation insère les lignes dans l'ordre, en recalculant `isCorrect`
elle-même, puis appelle la logique de `submitPalier` **inchangée**. Aucun
nouveau calcul de score, aucun nouveau chemin de validation.

### D14 — La tentative se crée AU TÉLÉCHARGEMENT, pas au retour du réseau.

Non par confort : `sanitizePayload` mélange les colonnes avec une graine
`` `${attemptId}:${exerciseId}:right` ``. **Le mélange dépend de l'identifiant
de la tentative**, qui doit donc exister avant que le lot soit construit.
Fabriquer des identifiants locaux et les remapper plus tard obligerait à
rejouer le mélange — donc à divergence garantie entre ce que l'enfant a vu et
ce que le serveur relit.

Le téléchargement appelle donc `startPalierAttempt` en ligne, et le lot
embarque le vrai `palierAttemptId`.

### D15 — Rejouer deux fois ne doit rien écrire deux fois.

Une synchronisation coupée puis reprise ne doit pas doubler les tentatives —
elles feraient chuter le score, `computeExerciseScore` pénalisant le rang du
premier succès. Il faut donc un identifiant tiré par le client :

- **ajout additif au schéma** : `attempts.clientAttemptId: v.optional(v.string())`
  plus un index `by_clientAttemptId`. Champ optionnel : aucun document existant
  n'est invalidé, et le chemin en ligne ne le pose pas ;
- la mutation de synchronisation ignore silencieusement une ligne déjà vue.

### D16 — Le rattrapage IA de la réponse courte s'applique À LA SYNCHRONISATION, et seulement vers le haut.

Hors ligne, `verifyShortAnswer` est littéral : l'enfant qui écrit « la Terre
tourne autour du soleil » au lieu de « le Soleil » sera marqué faux. Au retour
du réseau, le serveur fait ce que le lecteur web fait déjà — il appelle
`attemptsVerify` pour les réponses courtes fausses, et **retourne le verdict
vers le haut** si l'IA le juge équivalent.

Jamais vers le bas : une coche verte montrée à un enfant ne se reprend pas.

### D17 — L'horloge de l'appareil ne se croit pas, mais ne se jette pas non plus.

`submittedAt`, `timeSpentMs` et les séries (`convex/streak.ts`,
`dailyStreakRollover`) dépendent d'une date que l'appareil fournit et qu'un
enfant peut avancer. La règle : **on garde la date déclarée quand elle tombe
dans `[téléchargement du lot, réception de la synchronisation]`, on la ramène
dans cet intervalle sinon.**

Un enfant qui joue vraiment lundi sans réseau et synchronise vendredi garde son
lundi — donc sa série. Une horloge avancée d'un mois est ramenée. `timeSpentMs`
est plafonné.

### D18 — Un abonnement échu ne DÉTRUIT JAMAIS le travail déjà fait.

Le piège est facile à poser et coûteux : mettre `requireAccess` en tête de la
mutation de synchronisation, comme le font les cinq autres chemins. Si
l'abonnement de l'école expire pendant que l'enfant joue hors ligne, la
synchronisation lèverait — et une semaine de travail partirait en silence.

La règle : **on enregistre toujours, on ouvre au cas par cas.** Le travail déjà
fait s'écrit ; c'est l'ouverture d'un NOUVEAU palier que le mur de paiement
refuse. Le lot embarque par ailleurs une échéance
(`min(fin d'abonnement, téléchargement + 14 jours)`) au-delà de laquelle
l'appareil redemande le réseau avant de laisser commencer.

### D19 — Ce qui ne peut pas fonctionner hors ligne, et qu'il faut dire à l'enfant.

Trois choses tiennent à l'IA ou au serveur, et aucune ruse ne les descend :

- **« J'en veux encore »** (`regenerateFailedExercises`) : génère des variations
  par IA ;
- **l'explication pas à pas** (`attemptsExplain`) ;
- **les badges** (`badges.checkAndAward`, interne) : ils se décernent à la
  synchronisation. L'animation de déblocage arrive donc au retour du réseau —
  ce qui se raconte très bien à un enfant (« ton coffre t'attend »).

L'écran doit le dire en mots d'enfant, pas griser un bouton sans explication.

### D20 — Ce que le hors-ligne concède, en une liste, pour que personne ne le découvre plus tard.

1. Qui sait extraire la base locale peut chercher la bonne réponse par force
   brute — trivial en QCM (mais déjà vrai en ligne, D11), coûteux ailleurs,
   sans objet en réponse courte.
2. **Le nombre d'indices est déclaré par l'appareil.** Hors ligne, `requestHint`
   ne passe pas par le serveur ; un journal trafiqué peut sous-déclarer et
   gonfler le score. Le serveur ne peut pas le contredire.
3. Les textes des indices descendent avec le lot. Ils approchent la réponse
   sans la donner — c'est déjà le cas en ligne, un par un.
4. La divergence entre le verdict local et le verdict serveur se journalise
   (D12). Un taux anormal sur un appareil signale un trafiquage ou un défaut de
   canonicalisation — **on le consigne, on ne punit pas un enfant dessus**.

### D21 — La forme canonique doit copier le serveur, y compris ses laxismes.

L'empreinte n'est juste que si l'appareil canonicalise **exactement** comme
`verifyByType` compare. Relevé dans le code, et à reproduire tel quel :

- `verifyMatch` teste la longueur puis l'appartenance de chaque paire à
  l'ensemble correct. Il **n'interdit pas les doublons** : quatre fois la même
  bonne paire passent. `verifyDragDrop` de même ignore les clés en trop.
- La forme canonique doit donc porter ces laxismes, sinon l'appareil et le
  serveur rendront des verdicts différents sur la même réponse.

**Corollaire :** resserrer ces deux vérificateurs est un changement légitime,
mais il doit alors atterrir **des deux côtés en même temps**, et invalider les
lots déjà téléchargés. C'est pour cela que `canonicalize` vit dans
`packages/core` et que le serveur l'importe : une seule définition, versionnée
avec le lot.

---

## 4. Phases

### Phase 0 — Socle — **FAITE**

- [x] 0.1 `pnpm-workspace.yaml` : `packages: ['apps/*', 'packages/*']`
- [x] 0.2 `apps/mobile` — Expo SDK 57, `expo-router`, TypeScript, Hermes
- [x] 0.3 `ConvexReactClient` + `ConvexAuthProvider` avec l'adaptateur
      `TokenStorage` → `expo-secure-store` (D1)
- [x] 0.4 Alias `@convex/*` → `../../convex/*` ; `metro.config.js` avec
      `watchFolders` sur la racine (D2)
- [x] 0.5 Écran témoin — `app/index.tsx`
- [x] 0.6 Style tranché : `StyleSheet` + jetons (**D22**)
- [x] 0.7 `eas.json` — `development`, `preview` (APK interne), `production`
- [x] 0.8 CI : job `mobile` séparé — typecheck **et paquet Metro**

**Trois garde-fous qu'il a fallu poser à la racine**, sans quoi le job CI web
tombait pour une raison sans rapport visible avec le mobile :

- `tsconfig.json` exclut `apps` — son `include` est un glob sur tout le dépôt
  (`**/*.ts`), donc `pnpm tsc --noEmit` aurait typechecké du React Native avec
  `lib: ["dom"]` et le plugin Next ;
- `vitest.config.ts` exclut `apps/**` — il aurait ramassé les tests mobiles
  dans un environnement `jsdom` avec l'alias `@` du web ;
- `eslint.config.mjs` ignore `apps/**`.

`packages/` n'est exclu de rien : ce qui y vivra est du TypeScript pur que le
web importe et doit typechecker.

**Vérifié, pas supposé** — le web est intact : `tsc --noEmit` vert,
506 tests sur 29 fichiers passent, `next build` réussit, et `pnpm lint` rend
exactement **145 problèmes avant comme après** (échec préexistant, d'où le
`continue-on-error` du workflow). Côté mobile, `expo export --platform android`
produit 3,1 Mo de bytecode Hermes portant `ConvexReactClient` et
`convexAuthJWT` : l'alias traverse jusqu'au paquet.

### Phase 1 — Entrer — **FAITE**

- [x] 1.1 Pavé « Mon code » : préfixe mémorisé, gros chiffres, majuscules
- [x] 1.2 Connexion selon D5 (identifiant normalisé / secret imprimable)
- [x] 1.3 Session persistée, reconnexion automatique au lancement
- [x] 1.4 « Changer d'élève » : déconnexion et effacement du jeton (D10) —
      la purge du journal hors-ligne attend que ce journal existe (phase 3) ;
      `src/session/change-student.ts` est le seul point de sortie de session,
      et porte le rappel
- [x] 1.5 Garde de rôle : un adulte voit un écran d'explication et sort (D3)
- [x] 1.6 Mur de paiement, message enfant, **sans lien de paiement** (D7)

**UNE SEULE REQUÊTE PORTE 1.5 ET 1.6.** `api.access.getAccessState` suffit,
parce que `decideAccess` (`convex/accessRules.ts`) ordonne ses motifs :
`not_authenticated` puis `not_student` sont testés AVANT tous les autres, donc
le premier désigne exactement un déconnecté, le second exactement un adulte, et
tout le reste un élève authentifié dont l'école n'est pas à jour. La déduction
tient par CONSTRUCTION de la fonction — `components/AccessGate.tsx` s'appuie
déjà dessus côté web et la documente. Demander le profil en plus pour lire
`role` aurait été une requête de trop, et surtout une SECONDE source de vérité
sur la même question.

**`loginCredentials` vit dans `convex/importCodes.ts`**, avec le format des
codes, et non dans l'application mobile. C'est le piège D5 mis sous test par le
runner qui existe déjà (`convex/__tests__/importCodes.test.ts`, +6 tests) :
identifiant en minuscules, secret en MAJUSCULES. Le web pourra s'en servir le
jour où son écran de connexion distinguera un code d'une adresse.

**Le pavé COMPOSE le code, il ne le fait pas saisir.** Deux champs — la classe,
puis quatre chiffres — suppriment d'un coup les trois erreurs d'un champ libre :
le tiret, l'espace, la casse. Le préfixe étant retenu, un enfant qui revient ne
tape plus que quatre chiffres. Le clavier est celui du système
(`keyboardType="number-pad"`), pas un pavé dessiné : grandes touches connues,
annoncées par les lecteurs d'écran, mises à l'échelle par le système.

**Une friction résolue au passage :** `lib/accessCopy.ts` importait
`@/convex/accessRules`, l'alias `@` du WEB. Le mobile mappe `@` vers `src/`, et
ce module est lu par trois consommateurs aux résolutions différentes. L'import
est passé en relatif — `convex/explainMistake.ts` importait déjà `../lib/kidCopy`
de cette façon, la convention existait.

**`packages/core` n'est pas créé, et c'est délibéré.** Le mobile lit
`lib/kidCopy` et `lib/accessCopy` par un alias `@lib/*`, sans copie. Extraire
ces fichiers un par un au fil des besoins éparpillerait le chantier ;
`lib/refusalMessage.ts` compte à lui seul **29 importateurs**. L'extraction
reste la tâche 2.1, faite d'un coup. Rien ici ne la complique : le mobile
changera d'alias, pas de code.

**Vérifié, pas supposé** — mobile : typecheck vert, et le paquet Metro porte
`jotna.classPrefix`, `not_student` et le texte partagé « Ton espace n'est pas
encore ouvert » (en UTF-16 dans le bytecode Hermes, d'où un `strings -el` pour
le lire). Web intact : `tsc --noEmit` vert, **512 tests** sur 29 fichiers
(506 + 6), `next build` réussi, `pnpm lint` toujours à 145 problèmes.

**CE QUE LA PHASE 1 NE COUVRE PAS, et qu'il faut trancher.** `createChildAccount`
(`convex/profiles.ts`, action publique) crée des comptes enfants avec une
ADRESSE ÉLECTRONIQUE, pas un code — la voie d'un parent qui inscrit son enfant
hors école. Ces enfants-là **ne peuvent pas entrer par le pavé**, qui ne compose
que des codes. Trois sorties possibles : leur ouvrir une seconde voie de
connexion dans l'application, réserver le mobile aux élèves scolaires (cohérent
avec le modèle B2B de D7), ou leur faire émettre un code par l'école. Aucune ne
se décide dans un chantier technique — voir §5.

### Phase 2 — Le moteur d'exercices — **EN COURS**

- [ ] 2.1 `packages/core` — **NON FAIT, ET PAS PAR OUBLI.** Voir **D23** :
      l'extraction n'apporte aucune correction, et son risque principal n'est
      pas vérifiable depuis ce conteneur
- [x] 2.2 `ExercisePlayer` mobile — 5 essais, chronomètre, indices
- [x] 2.3 QCM
- [x] 2.4 Réponse courte (clavier qui ne masque pas l'énoncé)
- [ ] 2.5 Remise en ordre (liste triable reanimated)
- [ ] 2.6 Relier — **au tap, pas au glissé** : tap sur l'élément, tap sur sa
      paire. Tracer une liaison au doigt sur cinq pouces échoue une fois sur
      trois à cet âge. La chaîne soumise reste identique
- [ ] 2.7 Glisser-déposer (gesture-handler, zones mesurées à `onLayout`)
- [ ] 2.8 Indices + explication pas à pas (en ligne)
- [ ] 2.9 Retours : sons (`expo-audio`), haptique, confettis, Pio
- [ ] 2.10 Fin de palier : étoiles, « j'en veux encore », plafond de régénération
- [x] 2.11 **Tests de conformité par type** — **REMONTÉ EN TÊTE DE PHASE**, et
      c'est ce qui la rend sûre : 22 tests d'aller-retour couvrent les CINQ
      types, y compris ceux dont le composant n'existe pas encore. Un composant
      écrit ensuite n'a plus qu'à appeler l'encodeur déjà éprouvé
      (`convex/__tests__/answers.test.ts`)
- [ ] 2.12 Parcours complet automatisé (Maestro) : code → palier → 10 exos → fin

### Phase 3 — Le hors-ligne

- [ ] 3.1 `canonicalize(type, submitted)` dans `packages/core`, **copie fidèle
      de `verifyByType`, laxismes compris** (D21), avec tests croisés :
      pour un corpus d'exercices, `canonicalize` + empreinte et `verifyByType`
      rendent le même verdict
- [ ] 3.2 Construction du lot côté serveur : `startPalierAttempt` (D14), payload
      assaini + `verifier { salt, digests }` (D11) + échéance d'accès (D18)
- [ ] 3.3 Base locale (`expo-sqlite`) : lots téléchargés + journal d'`attempts`
- [ ] 3.4 Le lecteur d'exercices sait rendre un verdict local (D12) — même
      composant, deux sources de vérité selon l'état du réseau
- [ ] 3.5 Indices hors ligne : textes embarqués, comptage journalisé (D20.2)
- [ ] 3.6 Schéma : `attempts.clientAttemptId` optionnel + index (D15)
- [ ] 3.7 Mutation de synchronisation : insertion idempotente, re-vérification
      serveur, bornage d'horloge (D17), puis logique `submitPalier` inchangée
- [ ] 3.8 Rattrapage IA des réponses courtes, vers le haut seulement (D16)
- [ ] 3.9 Enregistrer même si l'abonnement a expiré (D18)
- [ ] 3.10 Journaliser les divergences verdict local / verdict serveur (D20.4)
- [ ] 3.11 Politique de téléchargement : palier courant + 2 suivants par
      matière, en Wi-Fi de préférence, TTL aligné sur `paliers.expiresAt`
- [ ] 3.12 Écrans : « je prépare pour plus tard », « pas de réseau, tu peux
      quand même jouer », « ton coffre t'attend » (D19)
- [ ] 3.13 Tests : coupure en plein palier, synchronisation coupée puis reprise,
      double synchronisation, horloge avancée, abonnement expiré pendant le jeu

### Phase 4 — Autour de l'exercice

- [ ] 4.1 Accueil : matières, série, niveau
- [ ] 4.2 Matière → thématiques → paliers 1 à 10, avec l'état de téléchargement
- [ ] 4.3 Coffre à badges + animation de déblocage (y compris différée, D19)
- [ ] 4.4 Profil : avatar, statistiques, son

### Phase 5 — Terrain

- [ ] 5.1 Écran « pas de connexion » partout où une requête peut ne pas revenir
- [ ] 5.2 Sons, icônes et illustrations **dans le paquet**, jamais téléchargés
      au moment du jeu
- [ ] 5.3 Budget d'appareil bas de gamme : démarrage et mémoire mesurés sur un
      Android 2 Go **réel**, pas sur un émulateur — la base locale et les lots
      pèsent, et c'est là que ça se verra
- [ ] 5.4 Accessibilité : mouvement réduit, cibles ≥ 48 dp, mise à l'échelle
- [ ] 5.5 Tablette partagée : bascule d'élève testée sur le terrain

### Phase 6 — Publication

- [ ] 6.1 Identité : icône, écran de lancement, nom, identifiant de paquet
- [ ] 6.2 Politique de confidentialité + formulaire *Data safety* — **en disant
      que des données d’exercice résident sur l’appareil** (§3)
- [ ] 6.3 Liste de contrôle Kids Category / Designed for Families (D9)
- [ ] 6.4 Consentement IA parental : le brancher (D9, point 1)
- [ ] 6.5 Canal APK interne pour les écoles pilotes (D8)
- [ ] 6.6 Fiches de boutique en français, captures d'écran
- [ ] 6.7 Mises à jour à chaud (`expo-updates`) : correctifs seulement ; **une
      version qui change `canonicalize` doit invalider les lots** (D21)

---

## 5. Ce qui reste ouvert

Le hors-ligne et le périmètre élève seul sont tranchés. Restent :

1. **Consentement IA.** Le champ existe et ne sert à rien (D9). À brancher
   avant la mise en boutique — et sur le web en même temps, le défaut y étant
   déjà.
2. **Coûts.** Apple (99 USD/an), Google Play (25 USD une fois), EAS, et au
   moins un Android d'entrée de gamme pour mesurer ce que la phase 5.3 demande.
3. **Resserrer `verifyMatch` et `verifyDragDrop`** (D21) : défaut préexistant,
   indépendant du mobile. À corriger avant la phase 3 si on le corrige, pour
   n'écrire la forme canonique qu'une fois.
4. **Les enfants inscrits par un PARENT, pas par une école.**
   `profiles.createChildAccount` leur donne une adresse électronique, pas un
   code ; le pavé de la phase 1 ne sait pas les faire entrer. Leur ouvrir une
   seconde voie de connexion, réserver le mobile aux élèves scolaires, ou leur
   faire émettre un code par une école : c'est une décision de produit, et elle
   conditionne un écran de la phase 1 bis.

---

## 6. Versions — ce qui est ÉPINGLÉ, et d'où ça vient

La première version de ce plan relevait les dernières versions du registre npm,
en les donnant pour des relevés et non des épinglages. **La prudence était
justifiée** : plusieurs étaient en avance sur le SDK, et les employer aurait
cassé le paquet.

| Paquet | dernière au registre | **retenue (SDK 57)** |
|---|---|---|
| `react-native` | 0.87.1 | **0.86.3** |
| `react-native-gesture-handler` | 3.3.0 | **~2.32.0** |
| `react-native-reanimated` | 4.7.0 | **4.5.1** |
| `react` | — | **19.2.3** (le web reste en 19.2.4, pnpm les isole) |
| `typescript` | — | **~6.0.3** (la racine reste en `^5`) |

La source d'autorité est **`expo-template-default@57`**, le paquet dont
`create-expo-app` tire ses versions. C'est lui qu'il faut relire à chaque
montée de SDK, et `npx expo install <paquet>` plutôt que `pnpm add` pour toute
dépendance native.

Versions réellement installées : `apps/mobile/package.json`. S'y ajoute
`@expo/metro-runtime`, absent du template parce que l'aplatissement de npm le
masque — voir D2, piège 2.

## 7. Risques

| Risque | Ce qui le contient |
|---|---|
| `canonicalize` diverge de `verifyByType` → l'enfant voit vert, le serveur écrit faux | une seule définition dans `packages/core`, importée par le serveur, + tests croisés (3.1) |
| Synchronisation rejouée → tentatives doublées → score effondré | `clientAttemptId` + insertion idempotente (D15) |
| Abonnement échu pendant le jeu → travail détruit | on enregistre toujours (D18) |
| Horloge avancée → séries et scores faussés | bornage `[téléchargement, synchronisation]` (D17) |
| Le mobile diverge du web sur les textes et les règles | `packages/core` partagé, pas de copie (D6) |
| `convex/_generated` copié puis périmé | alias `tsconfig`, jamais de copie (D2) |
| Metro ne recharge pas un `convex` régénéré | `watchFolders` sur la racine (0.4) |
| Refus de boutique sur la catégorie Enfants | phase 6 traitée AVANT la soumission (D9) |
| Un bouton « payer » ajouté plus tard | D7 écrite ici pour que l'ajout se discute |
| Les lots gonflent le stockage d'une tablette partagée | plafond de téléchargement + TTL (3.11), mesuré en 5.3 |
