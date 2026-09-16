# Encaissement — ce qu'il reste à faire pour encaisser

Le code de l'encaissement est sur `main`. **Rien de ce qui suit n'est dans le
dépôt**, et rien ne peut l'être : ce sont des secrets et une configuration de
compte. Tant que ce document n'est pas exécuté, l'application fonctionne — elle
n'encaisse simplement pas en ligne.

**Le prestataire retenu est Bictorys** : 1,5 % en mobile money contre 2,25 %
chez PayDunya sur le palier qui nous concerne, et ce palier est le seul qui nous
concernera longtemps — le premier de la grille PayDunya va jusqu'à cent millions
de francs **par mois**. Les deux sont agréés par la BCEAO comme établissements
de paiement.

**PayDunya reste entièrement câblé**, et le restera jusqu'au premier
encaissement réel chez Bictorys. Une variable bascule de l'un à l'autre sans
déploiement de code :

```bash
npx convex env set BILLING_PROVIDER bictorys    # défaut
npx convex env set BILLING_PROVIDER paydunya    # repli
```

> **Ce que vous risquez si vous ne faites rien :** rien. Le bouton « Payer »
> refuse avec une phrase lisible, le webhook répond 503, et les règlements se
> constatent à la main sur la fiche de l'école (« Déjà réglée hors ligne »).
> L'échéancier, lui, est créé et réclamé normalement.

## 0. D'abord, le schéma — sans lui, rien ne marche

```bash
npx convex deploy
```

À faire **avant** le reste, et une seule fois. Le dépôt ne déploie Convex nulle
part tout seul : `package.json` n'a que `next build`, et la CI ne lance aucun
`convex deploy`.

Le cumul des trois plans attend ce déploiement — 14 tables et 5 index (plan 1/3),
`studentImportRows.by_student` (plan 2/3), et pour le plan 3/3 :

| Table | Changement |
|---|---|
| `installments` | `by_subscription` remplacé par `by_subscription_status_dueAt`, ajout de `by_subscription_index` |
| `payments` | `provider` accepte `"bictorys"` et `"manual"` en plus de `"paydunya"`, et un `actorProfileId` optionnel |

Tout est additif côté documents : aucune ligne existante ne devient invalide.

---

## 1. Récupérer les clés chez Bictorys

Créez un compte sur [register.bictorys.com](https://register.bictorys.com), puis
ouvrez **Développeurs** dans le menu de gauche du tableau de bord.

| Ce qu'il faut | Nom de la variable | D'où ça vient |
|---|---|---|
| Clé d'API | `BICTORYS_API_KEY` | délivrée par Bictorys |
| Secret de webhook | `BICTORYS_WEBHOOK_SECRET` | **une chaîne que VOUS choisissez** et déposez sur leur tableau de bord |
| Le mode | `BICTORYS_MODE` | `test` ou `live` |

Le secret de webhook n'est pas fourni : c'est à vous d'inventer une chaîne
aléatoire et de la coller dans leur formulaire. Générez-la sérieusement —
`openssl rand -hex 32` — et ne la réutilisez nulle part ailleurs.

**Un bouton du tableau de bord bascule entre Test et Live**, avec les mêmes
identifiants de connexion. Mais **la clé d'API de Live est différente**, et le
webhook doit être configuré séparément en mode Live.

## 2. Poser les variables sur le déploiement Convex

```bash
npx convex env set BICTORYS_API_KEY        "…"
npx convex env set BICTORYS_WEBHOOK_SECRET "…"
npx convex env set BICTORYS_MODE           test
npx convex env set BILLING_PROVIDER        bictorys
```

**Par déploiement.** Ces commandes visent le déploiement de développement ;
ajoutez `--prod` pour la production, qui a ses propres variables. `npx convex
env list` montre ce qui est posé, sans les valeurs.

**`BICTORYS_MODE` vaut `test` par défaut, et tout ce qui n'est pas exactement
`live` reste le bac à sable** — l'inverse ferait d'une faute de frappe un
prélèvement réel. Ne passez à `live` qu'une fois l'étape 4 faite en entier.

*(Si vous voulez aussi garder PayDunya utilisable en repli :
`PAYDUNYA_MASTER_KEY`, `PAYDUNYA_PRIVATE_KEY`, `PAYDUNYA_TOKEN`, `PAYDUNYA_MODE`,
et son propre webhook `/paydunya-webhook`.)*

## 3. Déclarer l'URL de notification (webhook)

C'est la moitié qu'on oublie. Sans elle, le directeur paie, Bictorys encaisse,
et **l'accès des élèves ne s'ouvre jamais** : c'est ce rappel-là qui solde la
tranche, pas le retour du navigateur.

```
https://<déploiement>.convex.site/bictorys-webhook
```

- `.convex.site`, **pas** `.convex.cloud` : les routes HTTP de Convex sont
  servies sur le premier domaine, l'API sur le second.
- `<déploiement>` est le nom de votre déploiement. Celui qui apparaît en repli
  dans `convex/linkRequestsEmail.ts` est `impartial-ermine-150` — **à confirmer
  dans le tableau de bord** (`npx convex dashboard`), et à refaire séparément
  pour la production, qui porte un autre nom.
- L'URL et le secret se déclarent ensemble, dans **Développeurs** → nouveau
  webhook.

## 4. Le vrai test, en bac à sable, dans cet ordre

Rien n'a pu être essayé contre Bictorys depuis l'environnement où le code a été
écrit : leur domaine y est bloqué. **Le premier paiement en bac à sable est le
premier essai réel.**

1. Enregistrer un contrat sur une école (fiche école → « Contrat »), en
   **attente de paiement**. Trois tranches doivent apparaître aussitôt sous
   « Échéancier », et leur somme doit égaler le total du contrat — l'écran
   affiche un avertissement en clair si ce n'est pas le cas.
2. Cliquer « Payer » sur la tranche 1. Un lien vers la page Bictorys doit
   s'afficher, **au bon montant**, avec le choix entre Wave, Orange Money, Free
   Money et carte.
3. Payer avec les moyens de test de Bictorys.
4. Vérifier, sans recharger la page : la tranche passe à « Réglée », le contrat
   passe à « Actif », et les élèves inscrits obtiennent l'accès.
5. Si la tranche reste « À payer », c'est le webhook : vérifiez l'URL et le
   secret de l'étape 3, puis les journaux (`npx convex logs`). La route répond
   `401` sur un secret faux, `503` si les clés manquent, et `200` avec un mot
   qui dit ce qu'elle a fait (`credited`, `replayed`, `amount_short`,
   `not_completed`, `unknown_installment`).

### ⚠️ Le point à surveiller en priorité : `amount_short`

**Si la tranche ne se solde pas et que la route répond `amount_short`, c'est le
piège du montant net.**

L'OpenAPI de Bictorys décrit `transactions/{id}.amount` comme « the amount
received or paid by the merchant, **net of fees** ». Le code reconstitue donc le
brut en ajoutant `merchantFees`. Si cette reconstitution est fausse — frais
supportés par le client, taxe comptée à part, champ absent — chaque paiement
serait vu comme partiel et **aucune tranche ne serait jamais créditée**.

Le correctif vit à un seul endroit : le calcul de `amountFcfa` dans
`convex/billingBictorys.ts`, fonction `confirmCharge`. Le premier paiement en
bac à sable dira si l'hypothèse tient.

## 5. Ce qui reste supposé

| Point | Ce que le code suppose | Ce qui se passerait si c'est faux |
|---|---|---|
| `amount` net de frais | reconstitué par `amount + merchantFees` | aucune tranche créditée — voir l'encadré ci-dessus |
| Plafonds par moyen de paiement | aucun connu | une école au contrat élevé pourrait buter dessus ; l'échéancier permet déjà de fractionner |
| `authorized` | traité comme une ATTENTE, pas un encaissement | un paiement carte autorisé mais non capturé n'ouvrirait pas l'accès — c'est le choix prudent |
| `reversed` | traité comme un échec | un paiement rétracté APRÈS avoir soldé une tranche laisse la tranche réglée : trou connu, il appartient au plan de facturation |

**Et un point de sécurité à connaître : Bictorys ne signe pas ses webhooks.**
Leur page « Comment valider les webhooks » le dit : chaque rappel porte un
en-tête `X-Secret-Key` contenant **le secret en clair**. Ce n'est pas une
signature du contenu. Le code ne s'y fie donc pas seul — après avoir comparé le
secret en temps constant, il **redemande la transaction à Bictorys** et ne croit
que cette réponse-là. Traitez malgré tout ce secret comme un mot de passe, et
**ne le laissez jamais apparaître dans un journal**.

## 6. En attendant — encaisser sans prestataire

Le parcours est complet sans aucune clé :

- l'échéancier est créé avec le contrat et réclamé par le cron quotidien ;
- un règlement reçu par virement, chèque ou espèces se constate sur la fiche de
  l'école : « Déjà réglée hors ligne » → « Confirmer le règlement ». La tranche
  est soldée, l'accès s'ouvre exactement comme après un paiement en ligne, et la
  ligne porte le nom de qui l'a constaté ;
- **ce geste est sans retour** : rien ne défait un règlement déclaré à tort.

---

## Récapitulatif

- [ ] `npx convex deploy`
- [ ] Compte Bictorys créé, clé d'API de **test** récupérée
- [ ] Secret de webhook généré (`openssl rand -hex 32`) et déposé chez eux
- [ ] `npx convex env set` × 4, avec `BICTORYS_MODE=test`
- [ ] URL de notification déclarée chez Bictorys (`.convex.site`, pas `.cloud`)
- [ ] Parcours de l'étape 4 fait en entier, en bac à sable
- [ ] **`amount + merchantFees` confirmé** par un vrai paiement
- [ ] Clés de **production** posées avec `--prod`, webhook de production
      déclaré, puis `BICTORYS_MODE=live`
