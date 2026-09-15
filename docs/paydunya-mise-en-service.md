# PayDunya — ce qu'il reste à faire pour encaisser

Le code de l'encaissement est sur `main` depuis `611503a` (plan 3/3, spec §8).
**Rien de ce qui suit n'est dans le dépôt**, et rien ne peut l'être : ce sont des
secrets et une configuration de compte. Tant que ce document n'est pas exécuté,
l'application fonctionne — elle n'encaisse simplement pas en ligne.

> **Ce que vous risquez si vous ne faites rien :** rien. Le bouton « Payer »
> refuse avec une phrase lisible, le webhook répond 503, et les règlements se
> constatent à la main sur la fiche de l'école (« Déjà réglée hors ligne »).
> L'échéancier, lui, est créé et réclamé normalement.

---

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
| `payments` | `provider` accepte `"manual"` en plus de `"paydunya"`, et un `actorProfileId` optionnel |

Tout est additif côté documents : aucune ligne existante ne devient invalide.

---

## 1. Récupérer les quatre valeurs chez PayDunya

Dans votre compte PayDunya, **l'application** (la « boutique » rattachée au
compte) porte trois clés. Elles se trouvent dans la fiche de cette application,
à la section des clés d'API — les libellés exacts de l'interface sont à vérifier
sur place, ils ont bougé d'une version à l'autre.

| Ce qu'il faut | Nom de la variable | Remarque |
|---|---|---|
| Master Key | `PAYDUNYA_MASTER_KEY` | sert aussi à vérifier l'empreinte du webhook |
| Private Key | `PAYDUNYA_PRIVATE_KEY` | préfixée `test_` en bac à sable |
| Token | `PAYDUNYA_TOKEN` | préfixé `test_` en bac à sable |
| Le mode | `PAYDUNYA_MODE` | `test` ou `live` |

**Les clés de bac à sable et celles de production sont DIFFÉRENTES.** Prenez
d'abord les clés de test : le premier paiement réel ne doit pas être le premier
essai.

---

## 2. Poser les variables sur le déploiement Convex

```bash
npx convex env set PAYDUNYA_MASTER_KEY  "…"
npx convex env set PAYDUNYA_PRIVATE_KEY "…"
npx convex env set PAYDUNYA_TOKEN       "…"
npx convex env set PAYDUNYA_MODE        test
```

**Par déploiement.** Ces commandes visent le déploiement de développement ;
ajoutez `--prod` pour la production, qui a ses propres variables :

```bash
npx convex env set --prod PAYDUNYA_MODE live
```

`npx convex env list` (et `--prod`) montre ce qui est posé — sans les valeurs.

**`PAYDUNYA_MODE` vaut `test` par défaut, et tout ce qui n'est pas exactement
`live` reste le bac à sable.** C'est délibéré : l'inverse ferait d'une faute de
frappe un prélèvement réel sur le compte d'une école. Ne passez à `live` que
lorsque le parcours de l'étape 4 aura été fait en entier.

---

## 3. Déclarer l'URL de notification (IPN) chez PayDunya

C'est la moitié qu'on oublie. Sans elle, le directeur paie, PayDunya encaisse,
et **l'accès des élèves ne s'ouvre jamais** : c'est ce rappel-là qui solde la
tranche, pas le retour du navigateur.

```
https://<déploiement>.convex.site/paydunya-webhook
```

- `.convex.site`, **pas** `.convex.cloud` : les routes HTTP de Convex sont
  servies sur le premier domaine, l'API sur le second.
- `<déploiement>` est le nom de votre déploiement. Celui qui apparaît en repli
  dans `convex/linkRequestsEmail.ts` est `impartial-ermine-150`, ce qui donnerait
  `https://impartial-ermine-150.convex.site/paydunya-webhook` — **à confirmer
  dans le tableau de bord** (`npx convex dashboard`), et à refaire séparément
  pour la production, qui porte un autre nom.
- L'URL se déclare dans la configuration de l'application côté PayDunya. Le code
  l'envoie aussi à chaque facture (`callback_url`), mais la déclarer dans le
  compte est ce qui couvre les rappels tardifs et les rejeux.

---

## 4. Le vrai test, en bac à sable, dans cet ordre

Rien de tout ceci n'a pu être essayé depuis l'environnement où le code a été
écrit : le domaine PayDunya y est bloqué et aucun déploiement Convex n'était
joignable. **Le premier paiement en bac à sable est le premier essai réel.**

1. Enregistrer un contrat sur une école (fiche école → « Contrat »), en
   **attente de paiement**. Trois tranches doivent apparaître aussitôt sous
   « Échéancier », et leur somme doit égaler le total du contrat — l'écran
   affiche un avertissement en clair si ce n'est pas le cas.
2. Cliquer « Payer » sur la tranche 1. Un lien vers la page PayDunya doit
   s'afficher, **au bon montant**.
3. Payer avec les moyens de test de PayDunya.
4. Vérifier, sans recharger la page : la tranche passe à « Réglée », le contrat
   passe à « Actif », et les élèves inscrits obtiennent l'accès.
5. Si la tranche reste « À payer », c'est le webhook : vérifiez l'URL de
   l'étape 3, puis les journaux du déploiement (`npx convex logs`). La route
   répond `401` sur une empreinte fausse, `503` si les clés manquent, et `200`
   avec un mot qui dit ce qu'elle a fait (`credited`, `replayed`,
   `amount_short`, `not_completed`, `unknown_installment`).

---

## 5. Ce qui reste supposé, et qu'il faudra regarder en vrai

Trois points de la spec §8.7 n'ont pas de réponse documentée publiquement. Le
code fait un choix explicite pour chacun ; c'est en bac à sable qu'on saura s'il
était juste.

| Point | Ce que le code suppose | Ce qui se passerait si c'est faux |
|---|---|---|
| Durée de validité d'une facture | courte — la facture est donc créée **au clic**, jamais d'avance | rien : c'est le choix prudent |
| Plafonds de montant par moyen de paiement | aucun connu | une école au contrat élevé pourrait buter dessus ; l'échéancier permet déjà de fractionner davantage |
| Paiement partiel | n'acquitte **rien** ; un trop-perçu acquitte | un versement partiel resterait visible comme paiement « Échoué », la tranche non soldée |

Et un point de sécurité à connaître : **l'empreinte de PayDunya est le SHA-512
de votre Master Key — la même chaîne à chaque appel.** Ce n'est pas une
signature du contenu, c'est un mot de passe partagé. C'est pour cela que le code
ne s'y fie pas seul : après l'avoir vérifiée, il **redemande la facture à
PayDunya** avec vos clés, et ne croit que cette réponse-là. Traitez malgré tout
la Master Key comme un secret de premier ordre, et **ne la laissez jamais
apparaître dans un journal**.

---

## 6. En attendant — encaisser sans PayDunya

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
- [ ] Les trois clés de **bac à sable** récupérées chez PayDunya
- [ ] `npx convex env set` × 4, avec `PAYDUNYA_MODE=test`
- [ ] URL de notification déclarée chez PayDunya (`.convex.site`, pas `.cloud`)
- [ ] Parcours de l'étape 4 fait en entier, en bac à sable
- [ ] Clés de **production** posées avec `--prod`, URL de notification de
      production déclarée, puis `PAYDUNYA_MODE=live`
