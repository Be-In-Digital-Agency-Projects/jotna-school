# Parcours école — import, codes, rattachement (plan 2/3)

**Spec :** `docs/superpowers/specs/2026-09-14-abonnement-ecoles-design.md`, §6.1 à
§6.4, plus la dette §8.5 bis que la spec rattache explicitement à ce plan.

**Goal :** une école se remplit. Le directeur colle sa liste, chaque élève
obtient un identifiant de connexion qu'un enfant de huit ans peut taper, et sa
famille se rattache avec un code imprimé sur un billet.

**Livrable du plan 1/3, déjà en place :** les trois tables
(`studentImportJobs`, `studentImportRows`, `parentLinkCodes`) sont au schéma
mais **aucune fonction ne les touche**. `createSchool`, les classes, le
personnel, l'inscription, le transfert et la libération existent. Ce plan est
du câblage, pas de la pose.

---

## Ce qui reste, exactement

| Spec | État à l'ouverture de ce plan |
|---|---|
| §6.1 import en masse | rien |
| §6.2 identifiants sans email | rien |
| §6.3 rattachement parent par code | rien |
| §6.4 espace professeur | **fait au plan 1/3** (`studentIdsTaughtBy`) |
| §6.5 `linkChild` refermée | **fait au plan 1/3** (passée interne) |
| §8.5 bis message adulte | rien — `accessMessageForAdult` est écrite et appelée par personne |

---

## Décisions tranchées pour ce plan

### D28 — Le code de connexion se stocke en MINUSCULES, sinon personne ne se connecte

Vérifié dans `node_modules/@convex-dev/auth/dist/providers/Password.js`, et non
supposé :

```js
const profile = config.profile?.(params, ctx) ?? defaultProfile(params);
const { email } = profile;
...
account: { id: email, secret }        // signUp ET signIn
```

Le `profile()` du dépôt (`convex/auth.ts`) fait `rawEmail.trim().toLowerCase()`.
Il s'exécute donc **aussi au moment de la connexion** : un enfant qui tape
`CM1A-4821` cherche le compte `cm1a-4821`. Un code créé tel quel par
`createAccount` serait introuvable, et l'élève ne pourrait jamais entrer.

**Conséquence :** `account.id` reçoit la forme minuscule ; l'affichage sur le
billet garde les majuscules, qui se lisent mieux.

**Défaut préexistant de même cause, corrigé au passage :**
`profiles.createChildAccount` passe `account: { id: args.email }` sans
normaliser. Un parent qui saisit la moindre majuscule dans l'adresse de son
enfant crée un compte auquel cet enfant ne peut pas se connecter.

### D29 — Le format du code : lisible par un enfant, jamais ambigu

`CM1A-4821` : niveau et libellé de la classe collés, tiret, quatre chiffres.

- **Le préfixe vient de la classe**, donc le code se range tout seul quand un
  professeur en distribue trente.
- **Les chiffres seuls après le tiret** — pas de lettres. `O`/`0`, `I`/`1`,
  `S`/`5` se confondent sur un billet photocopié, et l'enfant tape ce qu'il
  croit lire.
- **La détection de collision appartient à l'appelant**, pas à la fonction
  pure : elle seule voit la base. La fonction génère, l'enveloppe Convex
  réessaie.

### D30 — L'import reste réservé à l'`admin`, et ce n'est pas un relâchement

La spec §6.5 veut que chaque mutation école dérive **le directeur** de la
session. Mais tout `convex/schools.ts` est réservé à l'`admin` depuis le plan
1/3, et **aucune console directeur n'existe** : `app/(admin)` est le seul
espace d'administration du dépôt.

Inventer cette console ici doublerait le périmètre du plan. Et `admin` est
strictement **plus étroit** que `directeur` : s'aligner dessus ne desserre
aucune garde, cela retarde seulement une délégation. La console directeur, avec
la dérivation que §6.5 décrit, est un chantier à part entière — elle est notée
comme telle.

### D31 — Le plafond de sièges se vérifie UNE FOIS, sur le lot entier, avant toute création

Spec §6.1, étape 3. Le contrôle réutilise **le couple exact**
d'`enrollStudent` — `currentSchoolSubscription` puis `readSeatState` — et non
une seconde lecture qui lui ressemblerait : deux façons de compter les sièges
finiraient par se contredire, et c'est la règle D18 du plan 1/3.

Refus **sans rien créer** : un import à moitié fait laisse une école avec des
comptes enfants qu'elle n'a pas commandés et ne sait pas retrouver.

### D32 — L'idempotence vit dans le statut de la ligne, pas dans un curseur

Une ligne `created` n'est jamais retraitée. Si l'action meurt à la 213ᵉ, la
reprise repart de là sans qu'aucun compteur n'ait à être juste. Un curseur, lui,
serait faux dès la première reprise partielle.

Le compteur de sièges s'incrémente **une fois par lot**, pas une fois par élève
— sinon vingt-cinq écritures sur le même document se disputent la transaction.

### D33 — Le code parent expire au bout d'un trimestre

Un billet remis à une famille en septembre doit encore marcher en novembre. Un
trimestre est la durée déjà retenue par le dépôt pour la péremption des paliers ;
la reprendre évite d'inventer une seconde notion de durée.

Usage unique : `redeemedBy` et `redeemedAt` sont posés dans la transaction qui
crée le lien, jamais après.

---

## Tâches

- [ ] **1. Modules purs** — `convex/importCodes.ts` : génération et
      normalisation du code élève, génération du code parent, découpage du
      collage en lignes (nom + classe) avec ses refus. Testé.
- [ ] **2. Ouverture de l'import** — mutation qui valide le collage, vérifie le
      plafond **une fois**, et crée le job plus ses lignes. Rien créé si refus.
- [ ] **3. Traitement par lots** — `internalAction` : 25 lignes `pending`,
      `createAccount` par ligne, patch en `created`, `schoolMemberships`,
      incrément unique du compteur, replanification tant qu'il reste des lignes.
- [ ] **4. Codes parent** — émission à la création de l'élève, consommation par
      le parent, refus lisibles.
- [ ] **5. Réinitialisation élève** — un élève à code n'a pas de boîte mail :
      mutation réservée au personnel **lié** à cet élève.
- [ ] **6. Écrans** — import et suivi dans la console école, billets
      imprimables, saisie du code côté parent.
- [ ] **7. Dette §8.5 bis** — l'adulte voit la vraie raison du refus, et les
      layouts gardent le rôle.

## Contraintes reprises du plan 1/3

Elles valent toutes, sans exception : contrôle d'accès côté serveur dans chaque
fonction ; les requêtes ne lèvent jamais, les mutations lèvent des
`ConvexError` dont la donnée est la phrase ; jamais `.collect()` ni
`ctx.db.query().filter()` ; jamais d'identifiant d'utilisateur en argument pour
autoriser ; tests sur fonctions pures exportées ; **pnpm, jamais npm**.

## Ce que ce plan ne fait pas

- **La console directeur** (D30) — l'import reste admin.
- **Le plan 3/3** : tranches, PayDunya, webhook, cron d'échéance.
- **Le téléversement de fichier** : le collage couvre le besoin, un analyseur de
  CSV ajouterait une surface d'erreur pour un gain nul à ce stade.
