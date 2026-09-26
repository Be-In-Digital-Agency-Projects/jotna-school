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
effacement du jeton, **et rattrapage du journal hors-ligne avant de partir**
(D15). Ce qu'il ne faut SURTOUT pas faire : garder deux sessions ouvertes —
l'enfant jouerait sous le nom d'un autre.

**CORRIGÉ EN PHASE 3 : la « purge » n'en est pas une.** Cette décision disait
d'effacer le journal non synchronisé après l'avoir envoyé. La première moitié
est juste, la seconde était une faute. Une tablette d'école n'a pas toujours de
réseau au moment où l'enfant suivant s'assied : tout effacer jetterait alors
des réponses vraiment données — ce que D18 interdit, à un autre endroit.

Et le garder ne risque rien, parce que le serveur ne peut pas se tromper de
propriétaire : `syncOfflineJournal` relit la tentative et refuse dès que
`attempt.userId` n'est pas le profil qui appelle. Les lignes de l'enfant
précédent sont donc INENVOYABLES par le suivant, et repartiront le jour où leur
auteur se reconnectera sur cette tablette.

`purgeSyncedWork` efface donc les lots dont plus rien n'attend, et leur journal
avec eux. Le raffinement qui paraît évident — « tant qu'on y est, effaçons
partout les lignes confirmées » — est FAUX : le serveur enregistre le
`attemptNumber` que l'appareil déclare, et l'appareil le calcule en comptant
ses propres lignes. Les effacer sur un lot encore jouable ferait repartir le
compte à un, et une quatrième tentative serait notée 10 au lieu de 3.

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

### D24 — Les trois types au doigt se jouent au TAP, pas au glissé.

Le plan ne l'avait tranché que pour « relier ». C'est étendu aux trois, et pour
les mêmes raisons — auxquelles s'en ajoutent deux que la phase 0 a révélées.

1. **La précision.** Tracer une liaison ou traîner une étiquette sur un écran
   de cinq pouces échoue souvent à huit ans. Deux taps ne ratent jamais.
2. **L'accessibilité, qui n'est pas optionnelle ici.** Le glisser-déposer est
   notoirement illisible pour un lecteur d'écran. Les catégories Enfants et
   Families (D9) regardent ce point, et un enfant à motricité fine limitée est
   exactement celui que cette application doit servir. Deux taps s'annoncent :
   chaque élément porte son `accessibilityHint`.
3. **Une chaîne de construction plus courte.** Le glissé demanderait
   `react-native-reanimated`, `react-native-gesture-handler` et
   `react-native-worklets` — trois modules natifs couplés entre eux et au SDK,
   sur un chantier qui vise Android d'entrée de gamme et une montée de version
   annuelle. Ils viendront en 2.9 pour les célébrations, où une panne est
   COSMÉTIQUE ; les mettre sur le chemin critique d'une réponse d'exercice
   rendrait une panne BLOQUANTE.
4. **Ce que je ne peux pas vérifier d'ici.** Aucun appareil dans ce conteneur :
   un geste s'écrit à l'aveugle et ne se prouve ni au typecheck ni au paquet
   Metro. Un tap, si.

**LA CHAÎNE SOUMISE EST IDENTIQUE.** « Glisser-déposer » est le nom du TYPE au
schéma, pas de son geste : l'enfant classe des étiquettes dans des catégories,
et `encodeDragDropAnswer` produit le même objet `étiquette -> zone` dans les
deux cas. Ajouter le glissé plus tard est donc purement additif — un geste de
plus sur les mêmes composants, sans toucher au contrat ni au serveur.

**C'est une décision de produit, et elle se retourne.** Si le glissé est voulu
pour lui-même — parce qu'il est plus amusant, ce qui est un argument recevable
chez un enfant — il s'ajoute en surcouche. Ce qu'il ne faut pas faire, c'est le
REMPLACER : le tap doit rester, comme chemin accessible.

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

**CORRECTION APPORTÉE EN PHASE 3 — UNE SEULE EMPREINTE NE MARCHE PAS.**
Ce qui précède tient pour le QCM, la remise en ordre et la réponse courte. Cela
s'effondre pour « relier » et « ranger », et la raison est dans le code du
serveur, pas dans la théorie : `verifyMatch` teste une LONGUEUR puis une
APPARTENANCE par élément, donc pour quatre paires TOUT multi-ensemble de taille
quatre pris dans les paires correctes est accepté — 35 réponses, aux formes
canoniques toutes différentes. `verifyDragDrop` ignore les clés en trop, donc
le nombre de réponses acceptées est littéralement infini. Une empreinte unique
en aurait reconnu UNE, et l'appareil aurait compté FAUX ce que le serveur
compte JUSTE — divergence découverte en production, chez un enfant, les lots
déjà distribués.

**CE QUI MARCHE : L'EMPREINTE SUIT LA STRUCTURE DU VÉRIFICATEUR.** On ne hache
pas la réponse, on hache ses ATOMES.

| type | atomes livrés | ce que l'appareil teste |
|---|---|---|
| qcm | l'indice correct | l'atome soumis est connu |
| order | la séquence entière | idem |
| short-answer | chaque réponse acceptée | idem |
| match | chaque paire correcte | bon NOMBRE, et chacune connue |
| drag-drop | chaque `étiquette → zone` | chacune posée, et connue |

Les deux laxismes de D21 sont alors reproduits **gratuitement** : ils découlent
de la même structure. Chaque atome est préfixé de son type, sans quoi la
réponse courte « 2 » et le QCM d'indice 2 partageraient une empreinte.

**UNE EMPREINTE SALÉE, PAS UN HMAC.** Le HMAC suppose une clé SECRÈTE ; or
l'appareil doit calculer hors ligne, donc il détient la clé. Un HMAC à clé
connue n'apporte rien sur un hachage salé — ce qu'il protège en plus
(l'extension de longueur) n'a aucun rôle ici. Ce serait du décorum. Le sel
achète qu'une même réponse ne donne pas la même empreinte d'un exercice à
l'autre ; ce qu'il n'achète pas est écrit en D20.

L'appareil ne peut pas LIRE la réponse ; il peut seulement reconnaître la bonne
quand elle est tapée — ou la chercher par force brute.

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

**UNE CONTRAINTE D'OUTILLAGE DÉCOUVERTE EN PHASE 3**, à connaître avant de
créer un module Convex. `convex/_generated/api.d.ts` est GÉNÉRÉ par
`npx convex dev`, et un nouveau MODULE n'y apparaît qu'après régénération —
impossible sans déploiement, donc impossible depuis un conteneur de
développement. Un nouvel EXPORT dans un module existant, lui, est typé
immédiatement (`palierAttempts: typeof palierAttempts`). La synchronisation a
donc rejoint `palierAttempts.ts`, où elle a d'ailleurs sa place : elle écrit
des lignes `attempts` d'une tentative de palier.

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
- [x] 2.5 Remise en ordre — **deux taps échangent deux éléments** (D24)
- [x] 2.6 Relier — **au tap** : tap à gauche, tap à droite, la paire se marque
      d'une couleur des deux côtés (pas d'un trait : un trait se mesure à
      l'écran et se décale dès que la police grandit)
- [x] 2.7 Ranger dans les zones — **tap sur l'étiquette, tap sur la case**
      (D24). La chaîne soumise est rigoureusement celle du glissé
- [x] 2.8 Indices — un par un, par `requestHint`, avec l'avertissement sur les
      étoiles AVANT que l'enfant les demande — **et l'explication**, offerte
      seulement à essais ÉPUISÉS : le serveur la fabrique en donnant la bonne
      réponse à l'IA, donc elle la dévoile ; plus tôt, les cinq essais
      deviendraient décoratifs
- [x] 2.9 Retours : sons, haptique, confettis. **Pio reste à faire** (4.x avec
      le reste de l'habillage)
- [x] 2.10 Fin de palier : étoiles, « j'en veux encore », plafond de
      régénération — **tous les chiffres viennent de `submitPalier`**, aucun
      n'est recalculé sur l'appareil
- [x] 2.11 **Tests de conformité par type** — **REMONTÉ EN TÊTE DE PHASE**, et
      c'est ce qui la rend sûre : 22 tests d'aller-retour couvrent les CINQ
      types, y compris ceux dont le composant n'existe pas encore. Un composant
      écrit ensuite n'a plus qu'à appeler l'encodeur déjà éprouvé
      (`convex/__tests__/answers.test.ts`)
- [~] 2.12 Parcours Maestro — `apps/mobile/e2e/palier.yaml` est écrit et
      **n'a JAMAIS été exécuté** : ni Maestro ni l'application ne tournent dans
      ce conteneur. C'est un point de départ, pas une garantie. Son en-tête
      liste ce qu'il faut vérifier au premier passage, à commencer par poser
      des `testID` — les sélecteurs visent du texte, ce qui est fragile

**LES RETOURS SENSORIELS, ET CE QU'ILS ÉVITENT.** Trois choix méritent d'être
relus avant d'y toucher :

- **les confettis sont en `Animated` de React Native, sans bibliothèque.** Vingt
  carrés qui tombent font soixante lignes ; une dépendance de plus est une
  montée de version annuelle à honorer (même raison qu'en D24). `useNativeDriver`
  partout, parce que le fil JavaScript est occupé à charger l'exercice suivant
  au moment précis où l'animation joue ;
- **le mouvement réduit est respecté**, et l'état par défaut est « réduire » :
  au pire on n'anime pas, jamais l'inverse ;
- **les sons sont ceux du dépôt**, pris dans `public/sounds/` par `require()`
  — Metro les atteint grâce aux `watchFolders` de la phase 0, et le paquet les
  embarque (50 Ko, 50 Ko, 18 Ko). Dupliquer trois MP3 dans `apps/mobile/` aurait
  marché aussi, et les deux copies auraient divergé à la première retouche.
  La préférence de son vient du SERVEUR, pour qu'elle suive l'enfant d'un
  appareil à l'autre : une tablette d'école n'est pas la sienne.

**LA SÉANCE EST BRANCHÉE, ET C'EST CE QUI REND LE RESTE RÉEL.**
`src/session/palier-session.tsx` enchaîne `getBucket` → `startPalierAttempt` →
`getExercisesForPalier` → lecteur → `submitPalier` → écran de fin. Trois points
qui viennent du serveur et non du goût :

- **l'amorçage est verrouillé par un `ref`** : `getBucket` peut déclencher une
  génération IA, longue et facturée. Un effet qui repartirait à chaque rendu en
  lancerait plusieurs pour un seul enfant ;
- **la tentative se crée AVANT les exercices**, parce que le mélange des
  colonnes est semé avec son identifiant (Décision 75). C'est exactement ce que
  la phase 3 exigera du téléchargement hors-ligne (D14), pour la même raison ;
- **le compilateur a trouvé un garde** : `getBucket` n'accepte que les classes
  primaires VISIBLES, or un topic peut porter une classe de collège ou aucune.
  Le garde est posé à l'exécution plutôt que le type forcé, sans quoi l'appel
  lèverait côté serveur et l'enfant lirait une erreur de validateur.

**Une navigation MINIMALE a été tirée de la phase 4** — matières, puis
thématiques, puis palier — uniquement pour rendre le moteur essayable sur un
appareil. Sans un chemin qui y mène, la phase 2 ne se vérifie que par le
typecheck et le paquet. Le vrai accueil (série, niveau, progression) reste 4.1.

### Phase 3 — Le hors-ligne — **FAITE**, sauf 3.13

- [x] 3.1 **FAIT** — `convex/paliers/offline.ts`, à côté des vérificateurs
      qu'il doit refléter (et non dans `packages/core`, voir **D23**).
      24 tests croisés (`convex/__tests__/offline.test.ts`) posent la même
      question aux deux côtés et exigent le même verdict, sur les cinq types
      **et sur les deux laxismes**. C'est ce corpus qui a révélé que le schéma
      d'empreintes de D11 ne pouvait pas fonctionner tel qu'écrit — D11 est
      corrigée en conséquence
- [x] 3.2 **FAIT** — `api.paliers.index.getOfflineBundle`, une REQUÊTE posée
      juste à côté de `getExercisesForPalier` pour que les deux ne dérivent
      pas. Elle prend un `palierAttemptId` : l'appareil appelle
      `startPalierAttempt` d'abord (D14), ce qui garde toute la garde de
      progression sans la dupliquer. Le lot ajoute `hints`, `verifier` et
      `accessValidUntil` — rien d'autre, et le corrigé ne descend toujours pas.
      Le SEL est DÉRIVÉ de `(tentative, exercice)` plutôt que tiré : une
      mutation Convex peut être rejouée, et un sel tiré devrait être persisté
      pour que le rejeu ne change pas des empreintes déjà livrées
- [x] 3.3 **FAIT** — `expo-sqlite`, deux tables : `bundles` (de quoi JOUER) et
      `journal` (de quoi RENDRE COMPTE, dans la forme exacte qu'`attempts`
      attend). Le journal est **append-only** et les lignes envoyées sont
      MARQUÉES, pas effacées : une suppression après envoi laisserait une
      fenêtre où la ligne n'existe plus localement alors que le serveur ne l'a
      peut-être pas commise
- [x] 3.4 **FAIT** — et le lecteur n'a pas changé d'une ligne. C'était le pari
      de la phase 2 : il reçoit `onVerify` et `onRequestHint` en RAPPELS, donc
      c'est la séance qui branche le moteur local ou les mutations. Le lecteur
      ne sait pas s'il y a du réseau, et il n'a pas à le savoir
- [x] 3.5 **FAIT** — le texte de l'indice vient du lot, seul le COMPTE part au
      journal, sous la forme du serveur (sentinelle `attemptNumber: 0`,
      `__HINT_<i>`). Un indice redemandé après réouverture ne se compte pas
      deux fois
- [x] 3.6 **FAIT** — `attempts.clientAttemptId` optionnel + index
      `by_clientAttemptId`. Sans clé d'idempotence, une synchronisation coupée
      puis reprise DOUBLERAIT les tentatives, et `computeExerciseScore` note
      selon le RANG du premier succès : une bonne réponse du premier coup
      rejouée deviendrait 7 au lieu de 10. L'enfant perdrait des points pour
      une coupure réseau
- [x] 3.7 **FAIT pour le cas ordinaire** — `api.palierAttempts.syncOfflineJournal`
      enregistre : idempotent, verdict RECALCULÉ côté serveur (D12), horloge
      bornée (D17), divergences consignées (D20.4). **Et le palier se clôt
      maintenant**, mais pas là où on le cherchait : la question supposait que
      la clôture devait venir de la synchronisation, et donc qu'il fallait
      remanier `submitPalier`. Elle vient de l'APPAREIL. `closePendingPaliers`
      appelle `submitPalier` TEL QUEL au retour du réseau, une fois le journal
      parti — aucune modification du serveur, qui recalcule depuis les lignes
      `attempts` comme pour une séance en ligne.
      Le marqueur est EXPLICITE (colonne `bundles.pendingCloseAt`, posée quand
      l'enfant passe le dernier exercice) et jamais DÉDUIT : croire qu'un
      palier est fini parce que chaque exercice porte une réponse ferait clore
      à sa place l'enfant qui s'arrête à huit sur dix, et noter les deux
      derniers à zéro. **Ce qui reste** est le seul cas de l'abonnement expiré :
      `submitPalier` lève, le marqueur demeure, la clôture se retente à chaque
      retour du réseau. Voir §5, point 5
- [x] 3.8 **FAIT** — la synchronisation PLANIFIE `verifyShortAnswerWithAI`
      pour chaque réponse courte qu'elle vient de compter fausse. Hors ligne,
      `verifyShortAnswer` est LITTÉRAL : l'enfant qui écrit « la ville de
      Dakar » quand on attend « Dakar » est compté faux, et personne ne pouvait
      le rattraper. Vers le haut seulement, et **planifié, pas attendu** — une
      mutation est une transaction, y attendre OpenAI la tiendrait ouverte
      plusieurs secondes
- [x] 3.9 **FAIT** — `syncOfflineJournal` n'appelle PAS `requireAccess`, et un
      commentaire de quinze lignes dit pourquoi, pour que personne ne l'ajoute
      « par cohérence » avec les cinq autres chemins. Le mur se tient sur
      `getOfflineBundle`, qui refuse d'OUVRIR un lot quand l'accès est fermé
- [x] 3.10 **FAIT** — une divergence entre ce que l'appareil a montré et ce que
      le serveur relit est comptée et journalisée (`console.warn` structuré),
      **sans jamais retomber sur l'enfant** : un écart signale un trafiquage OU
      un défaut de canonicalisation, et le second est infiniment plus probable.
      Une table dédiée viendra si le signal se révèle utile ; un journal suffit
      pour le mesurer d'abord
- [x] 3.11 **FAIT** — le lot du palier EN COURS se télécharge tout seul
      pendant qu'on y joue en ligne : l'enfant n'a rien à demander, et une
      coupure en pleine séance ne l'arrête pas.
      **Les « paliers suivants » ne sont pas ceux qu'on croyait, et c'est le
      serveur qui l'impose.** `startPalierAttempt` refuse d'ouvrir le palier N
      tant que 1..N-1 ne portent pas chacun une tentative `validated` : on ne
      peut pas prendre d'avance DANS une thématique. Ce qu'on prépare, c'est
      donc le prochain palier de CHAQUE thématique ouverte — de l'avance en
      LARGEUR. Pour un enfant qui suit cinq thématiques, cela fait cinq
      paliers, ce qui était le besoin (partir en week-end).
      **Préférence Wi-Fi** : VRAIE par défaut, et elle ne gouverne que le
      téléchargement DÉLIBÉRÉ — le lot du palier en cours continue de
      descendre, l'enfant ayant déjà consenti à cette connexion en ouvrant le
      palier. `UNKNOWN` compte comme « décompté » : certains Android ne savent
      pas dire leur type de connexion, et les mettre du côté gratuit ferait
      payer ceux-là mêmes qu'on protège. C'est pourquoi l'interrupteur existe.
      **Plafond** : 8 Mo, et il CÈDE devant trois protections — un lot dont des
      réponses attendent, un lot qui attend sa clôture, le lot qu'on joue. La
      décision est extraite en pur (`offline/eviction.ts`) et éprouvée : c'est
      le seul code de l'appareil capable de détruire le travail d'un enfant
- [x] 3.12 **FAIT** — les quatre écrans. Une **bannière** pendant la séance dit
      à l'enfant qu'il joue sans réseau et que ses réponses sont gardées : sans
      elle, l'explication et « j'en veux encore » disparaissent sans un mot, et
      à huit ans c'est l'application qui est cassée, pas le réseau. Un
      **indicateur** sur l'accueil compte ce qui attend d'être envoyé.
      **« Je prépare pour plus tard »** (`app/prepare.tsx`) répond à la
      question que l'enfant se pose vraiment — « est-ce que je pourrai jouer
      tout à l'heure ? » — par un mot par thématique, prêt ou pas prêt ; les
      mégaoctets sont écrits une fois, en bas, pour l'adulte.
      **« Ton coffre t'attend »** n'annonce AUCUNE étoile, et c'est le point :
      le verdict de l'appareil est consultatif (D12), annoncer « 24 ⭐ » serait
      crédible et pourrait se révéler faux au retour du réseau. On annonce ce
      qui est certain. La promesse est tenue par du code, pas par une phrase —
      `closePendingPaliers` clôt vraiment, et l'écran laisse alors place au
      VRAI résultat. Les deux ont été écrits ensemble ; sans la clôture, cet
      écran mentirait
- [~] 3.13 **PARTIEL, ET LA LIMITE RESTE STRUCTURELLE — mais elle a reculé.**
      Ce qui est PUR est testé : 27 tests croisés appareil/serveur (3.1), 12
      sur le bornage d'horloge (D17), et désormais **11 sur l'éviction**
      (`apps/mobile/src/offline/eviction.test.ts`), avec leur propre
      configuration Vitest en environnement `node` — séparée de celle de la
      racine, qui est en `jsdom` avec l'alias `@` du web ; les ramener ensemble
      rouvrirait ce que la phase 0 a fermé. L'éviction méritait ses tests plus
      que tout le reste : c'est le seul code de l'appareil qui puisse DÉTRUIRE
      du travail, et son erreur ne se voit pas — elle efface un lot, la
      synchronisation se met à rendre `null` en silence, et des réponses déjà
      données disparaissent.
      Les scénarios restants — double synchronisation, coupure en plein palier,
      abonnement expiré pendant le jeu — portent sur des MUTATIONS et une base
      SQLite, et **le dépôt n'a pas `convex-test`** (constat déjà posé dans
      `convex/pricing.ts`). Les éprouver demande soit d'installer
      `convex-test`, soit un appareil et un déploiement de développement. À
      décider ; ce n'est pas un oubli

### Phase 4 — Autour de l'exercice — **FAITE**

**Une barre d'onglets est apparue**, et ce n'était pas au plan. Les phases 0 à
3 n'avaient qu'un écran ; avec le coffre et le profil, trois boutons qu'il faut
faire DÉFILER pour trouver, c'est-à-dire pour savoir qu'ils existent. À huit
ans, ce qu'on ne voit pas n'existe pas. `app/(tabs)/` porte les trois
destinations, le reste (matière, palier, préparation) se empile par-dessus.
L'import vient de `expo-router/js-tabs` : `Tabs` est toujours exporté par
`expo-router`, mais ses propres types le marquent déprécié, et prendre le
chemin déprécié c'est une panne à la prochaine montée de SDK.

- [x] 4.1 **FAIT** — l'accueil répond à trois questions, dans l'ordre où un
      enfant se les pose : « est-ce qu'on me reconnaît » (son prénom),
      « où j'en suis » (série, niveau, étoiles), « qu'est-ce que je fais »
      (ses matières). Le DÉMARRAGE À FROID est un écran à part (D8 du web) :
      trois zéros disent « tu n'as rien », donc on les cache.
      **Un défaut de la phase 2 est corrigé au passage** : `subjects.icon`
      contient un nom d'icône Lucide — `convex/testSeeds.ts` y écrit
      « Calculator » —, et l'accueil affichait `subject.icon ?? "📘"`, donc le
      MOT « Calculator » en corps 32 sur la carte d'un enfant. Personne ne
      l'aurait vu avant un appareil. `theme/subject-icon.ts` porte la table du
      web, et ses tests exigent qu'aucun nom Lucide ne ressorte tel quel
      **Le ruban de série se calcule en UTC**, pas dans le fuseau de
      l'appareil : le serveur définit le jour en Africa/Dakar, qui EST l'UTC
      (`convex/streak.ts` le dit). Le ruban du web emploie `new Date()` et
      coïncide à Dakar ; sur un téléphone réglé ailleurs il dessinerait une
      semaine décalée d'un jour par rapport à la série comptée
- [x] 4.2 **FAIT** — dix pastilles par thématique, et non plus une flèche vers
      « la suite ». L'enfant voit le chemin parcouru, ce qui reste, et peut
      revenir sur un palier réussi — le serveur l'autorise, `startPalierAttempt`
      ne vérifie que les paliers PRÉCÉDENTS. Un 💾 discret marque ce qui est
      déjà sur l'appareil.
      **`nextPalierIndex` ne suffit pas à dessiner la grille**, et c'est le
      piège de cette tâche : il vaut `min(10, maxValidé + 1)`, donc 10 se lit
      aussi bien « le dixième reste à faire » que « tout est fini ». Le
      `status` de la thématique tranche. `validatedPaliers` ne le pourrait
      PAS — il compte des TENTATIVES validées, pas des paliers distincts, et
      refaire deux fois le palier 3 le fait passer à 2. La logique est en pur
      (`progress/palier-state.ts`) et éprouvée sur les deux lectures du 10
- [x] 4.3 **FAIT** — le coffre montre les badges VERROUILLÉS autant que les
      autres, avec leur `criteriaText` : un enfant qui ne voit que ce qu'il a
      n'a rien à viser, et sur un téléphone il n'y a pas de page voisine où
      aller chercher la liste.
      **La fête DIFFÉRÉE (D19) est la vraie raison d'être de cet écran sur
      mobile.** Un badge gagné sans réseau n'est décerné qu'à la
      synchronisation, longtemps après que l'enfant a fermé l'application :
      personne ne l'a fêté. `getMyStats().unseenBadges` s'en souvient CÔTÉ
      SERVEUR, donc la fête suit l'enfant d'une tablette à l'autre. On ne
      marque « vu » qu'au GESTE, jamais à l'affichage — marquer au rendu
      ferait disparaître une fête que l'enfant n'a pas regardée, et elle ne
      revient pas.
      Les icônes de badges sont des emojis : `badges.icon` porte un nom Lucide,
      et `lucide-react-native` tirerait `react-native-svg`, un module natif, pour
      quarante pictogrammes décoratifs (le raisonnement de D22, encore)
- [x] 4.4 **FAIT** — l'avatar est des INITIALES, comme sur le web : aucun écran
      élève ne permet d'en choisir un et l'import scolaire n'en pose pas, donc
      inventer un choix ici donnerait une fonction que la moitié de
      l'application ignore. Une image distante s'affiche si le champ en porte
      une, et retombe sur les initiales si elle échoue — ce qui, sans réseau,
      arrive.
      Le son est un réglage de SERVEUR (il suit l'enfant d'une tablette à
      l'autre) mais l'interrupteur est OPTIMISTE : attendre le serveur pour
      bouger un interrupteur donne l'impression qu'il est cassé.
      **« Changer d'élève » a quitté l'accueil** pour ce profil : c'est un geste
      d'adulte, et il était exposé au doigt d'un enfant qui fait défiler

**Deux garde-fous posés pendant cette phase, hors périmètre annoncé.**

`apps/mobile/tsconfig.json` prend `noUnusedLocals` et `noUnusedParameters` :
le lint de la racine ignore `apps/**` depuis la phase 0, donc RIEN ne
rattrapait un import devenu inutile après un remaniement — le drapeau en a
trouvé un dès la première exécution. **Il juge aussi `convex/`**, que l'alias
`@convex/*` fait entrer en entier via `_generated/api.d.ts` : un import
inutile dans n'importe quel module du serveur fera rougir le job MOBILE. C'est
écrit dans le `tsconfig.json`, et l'unique violation existante
(`convex/linkRequests.ts`, `action`) a été retirée plutôt que contournée — ce
qui fait passer `pnpm lint` de 145 à **144 problèmes**.

### Phase 5 — Terrain — **le code est fait ; deux tâches attendent un appareil**

Le protocole de ce qui demande du matériel est écrit et exécutable tel quel :
`docs/superpowers/plans/2026-09-26-protocole-terrain-mobile.md`. Il porte les
commandes, les seuils, et ce qu'il faut conclure de chaque résultat.

- [x] 5.1 **FAIT — et la tâche cachait un défaut qui annulait la phase 3.**
      `SessionGate` attendait `getAccessState` avant de montrer quoi que ce
      soit. Sans socket, cette requête ne revient JAMAIS : l'écran restait sur
      « Un instant… » jusqu'à l'abandon. **Le hors-ligne tombait donc à la
      porte d'entrée** — l'enfant qui prépare ses paliers le vendredi à l'école
      et ouvre l'application le samedi au village n'atteignait jamais ce qu'il
      avait préparé. Tout le travail de la phase 3 ne servait qu'aux coupures
      survenant en pleine séance.
      **La source de vérité change.** `useNetworkOnline` (`expo-network`)
      répondait à « une interface réseau est-elle active ? » ; son propre
      commentaire admettait que ce n'était pas la bonne question. `session/
      reach.ts` lit `useConvexConnectionState().isWebSocketConnected` : derrière
      un portail captif, la socket ne s'ouvre pas, et l'appareil le sait au
      lieu de lancer des requêtes qui pendent. `expo-network` ne garde que ce
      qu'il est SEUL à savoir — le type de connexion, donc `isUnmeteredNow`.
      **Trois états et non deux** : `connecting` est un état d'attente à part
      entière. Un booléen forcerait à trancher au démarrage, et les deux
      réponses seraient mauvaises — lancer des requêtes qui pendent, ou envoyer
      l'enfant sur un lot local alors que le réseau arrivait dans la seconde.
      **Ce qui est livré** : un verdict d'accès gardé (`session/last-verdict.ts`,
      deux bornes — abonnement et fraîcheur — éprouvées en pur), un **accueil
      hors-ligne** qui liste ce qui est jouable, un écran « pas de connexion »
      SANS bouton « réessayer » (le client Convex se reconnecte seul ; un bouton
      ferait croire à l'enfant que c'est à lui de réparer), et un état hors-ligne
      sur chaque écran qui filait sans fin.
      **Un second défaut au passage, qui se retournait contre l'enfant** : sans
      réseau, `signIn` lève comme pour un mauvais code, et le pavé répondait
      « regarde bien ton billet ». Il regardait, retapait, échouait encore, et
      concluait que son billet était cassé
- [x] 5.2 **FAIT** — audit puis garde. Tout ce qui joue est dans le paquet :
      30 assets, dont les 3 sons par `require()`. La seule ressource distante
      est l'avatar facultatif d'un profil, qui n'est pas un asset de jeu et
      retombe sur les initiales.
      **L'audit ne suffisait pas.** Remplacer un `require()` par une URL ne
      casse ni le typecheck, ni les tests, ni la construction : la panne
      n'apparaît que chez un enfant sans réseau qui répond juste et n'entend
      rien. `scripts/check-bundled-assets.mjs` lit le manifeste de l'export et
      exige les trois sons ; il tourne en CI, et il a été éprouvé dans les deux
      sens
- [~] 5.3 **BLOQUÉ SUR LE MATÉRIEL, et mesuré pour ce qui peut l'être.**
      Bytecode Hermes 3,45 Mo, assets 1,2 Mo, export 4,5 Mo. Ce qui demande
      l'appareil — démarrage à froid, PSS, poids réel d'un lot, fluidité du
      glissé — est au §2 du protocole, avec ses seuils. **Un émulateur ne
      répond pas à la question** : il tourne sur le processeur de l'hôte, et
      ce qui fait souffrir un Android d'entrée de gamme n'y existe pas
- [x] 5.4 **FAIT côté code ; l'œil reste à passer (§4 du protocole).**
      Mouvement réduit : déjà respecté par les confettis, seule animation de
      l'application. Cibles tactiles : auditées une à une, toutes ≥ 48 dp.
      **Mise à l'échelle** : tout ce qui se LIT grandit sans plafond ; seuls les
      glyphes enfermés dans une boîte de taille fixe — l'emoji d'une matière,
      la flamme du ruban, les initiales, le rang d'un exercice — sont plafonnés
      à 1,3 (`GLYPH_MAX_SCALE`), faute de quoi ils débordent à 200 %.
      **Une faute corrigée** : la barre d'onglets portait une `height` fixe, et
      `getTabBarHeight` rend cette valeur TELLE QUELLE sans plus ajouter
      l'encoche du bas — sur un téléphone à barre gestuelle, les onglets se
      seraient retrouvés sous le trait système
- [~] 5.5 **BLOQUÉ SUR LE MATÉRIEL.** Le code de la bascule est en place et
      durci (le verdict d'accès s'efface avec le jeton, le travail non envoyé
      ne se jette pas). Les quatre scénarios sont au §3 du protocole, dont
      **celui qui compte** : bascule d'élève SANS réseau, où il faut prouver
      que le travail de l'enfant précédent n'est pas détruit. Si ce test
      échoue, D18 est violée et il faut s'arrêter

### Phase 6 — Publication — **COMMENCÉE**

- [x] 6.1 **FAIT — et l'icône vient du VRAI logo, pas d'une invention.**
      `public/jotna-logo.png` existe : un wordmark illustré, superbe et
      inimitablement sénégalais — djembé, globe, crayon, acacia, toque.
      **Il ne peut pas servir d'icône** : 1024×656, donc pas carré, et à 48 px
      sur un écran d'accueil ses huit éléments deviendraient une bouillie.
      Il est en revanche parfait pour l'ÉCRAN DE LANCEMENT, où il s'affiche
      centré et en grand — c'est exactement ce pour quoi il a été dessiné.
      Pour l'icône, on en extrait le **globe**, recadré et masqué en disque
      (le globe est rond, le masque est donc exact — sans lui le carré
      emportait des morceaux du « J » et du « t »), posé sur l'ambre de la
      marque. Le conteneur n'a ni PIL, ni ImageMagick, ni sharp : le PNG à
      palette a été décodé, masqué, rééchantillonné et réencodé à la main avec
      `zlib`. **C'est un mark DÉRIVÉ, pas un mark DESSINÉ** : il vaut mieux que
      l'icône Expo par défaut sur une application pour enfants, et il doit être
      remplacé par un vrai mark avant la mise en boutique.
      **Vérifié par `expo prebuild`**, pas par l'export : l'icône et l'écran de
      lancement sont consommés à la construction NATIVE, et un `expo export`
      vert n'en dit rien. Le prebuild génère bien les `ic_launcher` et les
      `splashscreen_logo` — et il a signalé au passage une entrée devenue
      morte, `android.edgeToEdgeEnabled`, qu'Android 16 rend obligatoire et que
      le plugin refuse désormais de personnaliser. Retirée
- [~] 6.7 **LA MOITIÉ QUI COMPTE EST FAITE ; la livraison attend un projet EAS.**
      Le danger de D21 n'est pas la mise à jour elle-même, c'est ce qu'elle
      fait aux lots DÉJÀ sur l'appareil. Les empreintes d'un lot ont été
      calculées par le SERVEUR au téléchargement ; l'appareil, lui, recalcule
      les atomes avec le code EMBARQUÉ DANS SON PAQUET. Une mise à jour à chaud
      remplace ce code sans toucher aux lots : qu'elle change un `trim()`, un
      séparateur, un préfixe de type, et l'appareil calcule des atomes que les
      empreintes livrées ne reconnaissent plus.
      **LA PANNE NE RESSEMBLE PAS À UNE PANNE.** Rien ne plante : l'enfant
      répond juste, l'application lui dit faux, il recommence. Le serveur
      recalcule tout à la synchronisation et son score finit même par être
      correct — seul l'enfant aura passé l'après-midi à se croire nul. Aucun
      journal ne le signale.
      `ATOM_SCHEME_VERSION` voyage donc AVEC le lot, l'appareil compare, et un
      écart rend le lot injouable comme un bail expiré. Un lot d'avant cette
      version, qui n'a pas de numéro, est tenu pour INCOMPATIBLE : le refuser
      coûte un téléchargement, l'accepter coûte un après-midi. La règle est
      pure et éprouvée (`offline/bundle-validity.ts`), et l'éviction traite ces
      lots comme des morts, à évincer AVANT de regarder la moindre taille.
      `runtimeVersion: { policy: "appVersion" }` est posé : une mise à jour à
      chaud ne s'applique qu'aux versions d'application identiques, donc
      **correctifs seulement**, tout changement natif repassant par la boutique.
      **Ce qui manque** : `expo-updates` et son `updates.url`, qui demandent un
      projet EAS et son identifiant. On ne les invente pas — une URL de mise à
      jour fausse est pire que pas de mise à jour du tout
- [x] 6.2 **FAIT** — la politique est une PAGE PUBLIQUE, `/legal/confidentialite`,
      parce qu'Apple et Google exigent une URL atteignable sans compte et
      qu'un document rangé dans `docs/` ne se soumet pas.
      **Son chemin n'a pas été choisi, il était imposé** :
      `components/landing/footer.tsx` pointait vers `/legal/confidentialite`
      depuis le premier jour — vers une route inexistante. Le pied de page du
      site annonçait donc une politique et rendait un 404, ce qu'un relecteur
      de boutique vérifie en premier.
      Chaque phrase est vérifiée dans le code, pas recopiée d'un modèle : une
      politique générique promet ce que le produit ne fait pas et tait ce
      qu'il fait. Les deux faits inhabituels sont dits en toutes lettres — un
      élève scolaire n'a **ni adresse, ni téléphone, ni photo** (son
      identifiant EST son code), et **des données d'exercice résident sur
      l'appareil**, réponses non encore envoyées comprises.
      Le formulaire *Data safety* et les étiquettes Apple sont préparés dans
      `docs/legal/data-safety.md`, chaque réponse avec sa source
- [x] 6.3 **FAIT — et deux trouvailles n'apparaissaient qu'en générant le
      projet natif** (`docs/legal/kids-category.md`).
      **`SYSTEM_ALERT_WINDOW` partait en production.** Le manifeste principal
      demandait « dessiner par-dessus les autres applications » — la
      permission des surcouches publicitaires et des rançongiciels — sur une
      application pour enfants, et rien dans le code ne s'en sert : elle vient
      du gabarit Expo. Deux permissions de stockage externe étaient dans le
      même cas. `android.blockedPermissions` les retire du manifeste principal
      tout en laissant la variante *debug* garder la sienne pour le menu de
      développement. **La directive de retrait est vérifiée ; la fusion finale
      se fait par Gradle, qui demande le SDK Android** — à confirmer sur le
      premier APK, `aapt dump permissions`.
      Le reste est en règle, et deux points le sont de façon inattendue :
      **aucun analytics nulle part** (zéro occurrence dans tout le dépôt) et
      **aucun lien sortant dans l'application mobile**, donc aucune barrière
      parentale à construire — il n'y a rien à barrer.
      **Cinq liens légaux du pied de page restent morts** (`mentions`, `cgu`,
      `cookies`, `mineurs`, `accessibilite`) : ils demandent des informations
      d'entreprise et une relecture juridique, et ne s'inventent pas
- [x] 6.4 **FAIT — et c'était le défaut le plus ancien de ce chantier.**
      `profiles.aiDataConsentGranted` et `aiDataConsentGrantedAt` étaient au
      schéma depuis le début, avec le commentaire « Loi 2008-12, Sénégal »,
      et **lus par personne**. Pendant ce temps trois chemins envoyaient le
      travail d'enfants de huit ans chez OpenAI sans qu'aucune garde ne se
      pose la question. Ce n'est pas un défaut du mobile : il vit sur le web
      depuis le premier jour, et la garde vivant dans `convex/`, la corriger
      la corrige partout.
      **Trois chemins sur quatre sont gardés**, et le quatrième ne l'est pas
      pour une raison vérifiée ligne à ligne : `explainMistake.explainExercise`
      n'envoie que le type, l'énoncé et le corrigé — aucune donnée personnelle
      ne part, et le garder coûterait une fonction pédagogique pour rien.
      **Modèle d'autorité, décidé par le propriétaire :** l'école déclare
      détenir l'autorisation des parents, tout parent rattaché peut refuser, et
      son refus l'emporte — immédiatement, sans délai de grâce. Un « non » qui
      attendrait trente jours n'en serait pas un, et c'est le test qui
      verrouille l'ordre des règles.
      **Délai de grâce de 30 jours**, jusqu'au 26 octobre 2026, écrit en clair
      comme une DATE et non comme « trente jours après le déploiement » — un
      délai relatif repartirait à zéro à chaque redéploiement et l'échéance ne
      tomberait jamais. Un test échoue si quelqu'un le remplace par un calcul.
      **Le mobile n'a rien eu à changer** : les trois refus empruntent les
      formes de retour existantes (`{isCorrect:false}`, `{explanation}`,
      `{ok:false, kidMessage}`), que les écrans affichent déjà. Le pari des
      rappels de la phase 2 paie une troisième fois.
      **Deux surfaces posées** : la déclaration sur l'écran d'administration de
      l'école — et non chez le directeur, qui n'a aucune surface à lui, ce que
      la mutation dit en toutes lettres plutôt que de faire semblant — et le
      levier à trois états dans les réglages du parent, hors du formulaire
      pour qu'un refus prenne effet au clic.
      **Une trace morte retirée** : `app/(auth)/register/page.tsx` portait un
      état `aiConsent` jamais affiché, jamais lu, jamais envoyé — le vestige
      d'une première tentative abandonnée
- [~] 6.5 **CONFIGURÉ DEPUIS LA PHASE 0, BLOQUÉ SUR EAS.** Le profil `preview`
      d'`eas.json` porte déjà `distribution: internal` et
      `android.buildType: apk` : c'est exactement le canal voulu — un APK
      installable à la main, sans passer par une boutique, pour les écoles
      pilotes. La commande est `eas build --platform android --profile
      preview`, et elle rend un lien d'installation.
      **Ce qui manque n'est pas du code** : un compte et un projet EAS. Le même
      blocage que 6.7, et pour la même raison qu'on ne le contourne pas — un
      identifiant de projet inventé ne produit rien d'installable
- [~] 6.6 **LE TEXTE EST PRÊT, LES CAPTURES SONT BLOQUÉES**
      (`docs/legal/fiches-boutique.md`). Les deux fiches sont écrites et
      tiennent dans les limites de caractères — vérifiées par comptage, pas à
      l'estime. Elles mettent le HORS-LIGNE en avant, puisque c'est ce qui
      distingue ce produit, et elles ne disent **ni prix, ni abonnement, ni
      achat** : le modèle est B2B (D7), et une fiche qui parle d'abonnement
      attire une revue sur des achats intégrés qui n'existent pas.
      **Aucun écran n'a jamais été rendu** : les captures demandent un appareil
      ou un simulateur, comme 5.3 et 5.5. Les cinq écrans à prendre sont listés
      dans l'ordre où ils racontent le produit, avec la consigne de les prendre
      sur un compte GARNI — une capture de démarrage à froid montre trois zéros
      et ne vend rien


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
5. **Qui CLÔT un palier joué hors ligne quand l'abonnement a expiré ?**
   *(Le cas ORDINAIRE est désormais traité ; celui-ci reste ouvert — lire la
   réduction plus bas.)*

   `syncOfflineJournal` enregistre les réponses sans condition d'accès (D18),
   mais `submitPalier` — qui calcule les étoiles, valide le palier et décerne
   les badges — commence par `requireAccess`. Un enfant dont l'école a laissé
   filer l'abonnement pendant qu'il jouait verrait donc son travail ENREGISTRÉ
   et jamais NOTÉ : son palier resterait `in_progress` pour toujours.

   **CE QUI A ÉTÉ FAIT SANS TOUCHER AU SERVEUR.** La question posée ci-dessus
   supposait que la clôture devait venir de la synchronisation. Elle peut
   venir de l'APPAREIL : `closePendingPaliers` (`offline/sync.ts`) appelle
   `submitPalier` tel quel, au retour du réseau, une fois le journal parti.
   Le serveur recalcule alors depuis les lignes `attempts` — exactement ce
   qu'il fait pour une séance en ligne. Le cas ordinaire (l'école est
   abonnée, l'enfant retrouve ses étoiles en revenant) est donc réglé, et
   c'est lui qui arrivera presque toujours.

   **CE QUI RESTE.** Quand l'accès est fermé, `submitPalier` lève. Le palier
   garde alors son marqueur et la clôture se retentera à chaque retour du
   réseau — y compris le jour où l'école renouvelle. Rien n'est détruit, mais
   un enfant dont l'école ne renouvelle jamais n'aura jamais ses étoiles.

   **Ma recommandation, inchangée :** clore un palier que l'enfant a réellement
   terminé relève de l'ENREGISTREMENT, pas de l'OUVERTURE — le même
   raisonnement que D18. Cela demande de séparer, dans `submitPalier`, le
   contrôle d'accès du calcul. C'est un remaniement d'une fonction EN SERVICE,
   donc à faire les yeux ouverts plutôt qu'en passant ; la réduction ci-dessus
   fait qu'il n'est plus urgent.

6. **Les enfants inscrits par un PARENT, pas par une école.**
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
