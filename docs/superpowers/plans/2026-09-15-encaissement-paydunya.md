# Encaissement — tranches, PayDunya, échéances (plan 3/3)

**Spec :** `docs/superpowers/specs/2026-09-14-abonnement-ecoles-design.md`, §8 en
entier, plus l'invariante que §8.5 lègue explicitement à ce plan.

**Goal :** une école paie. Le contrat signé porte son échéancier, le directeur
ouvre une facture PayDunya pour une tranche, l'encaissement ouvre l'accès des
élèves, et une tranche oubliée déclenche vingt et un jours de grâce avant que
quoi que ce soit ne se referme.

**Livrable des plans précédents, déjà en place :** les tables `installments` et
`payments` sont au schéma depuis le plan 1/3 et **aucune fonction ne les
touche** — `decideAccess` lit l'ancre de grâce dans une table que rien ne
remplit. `subscriptions` a ses trois écrivains (saisie, avenant, activation
manuelle), `pricing.ts` calcule les montants, `access.ts` décide de l'accès.
Ce plan est du câblage d'argent sur des rails déjà posés.

---

## Ce qui reste, exactement

| Spec | État à l'ouverture de ce plan |
|---|---|
| §8.1 trois tranches à la signature | rien — la table est vide par construction |
| §8.2 flux de paiement | rien |
| §8.3 les quatre règles du webhook | rien |
| §8.4 machine à états | **une seule transition écrite** (§8.4 bis, manuelle) |
| §8.5 grâce de 21 jours | **la règle est écrite et testée** (`decideAccess`), mais rien ne pose jamais `past_due` ni ne marque une tranche |
| §8.6 cron quotidien | rien |
| §8.7 API PayDunya à vérifier | fait dans ce plan — voir D39 |
| §7.6 le prorata d'un avenant | **calculé, jamais facturé** — `totalFcfa` monte, rien ne le réclame |

---

## Ce que la documentation PayDunya a répondu

§8.7 listait six questions qui n'avaient pas pu être posées dans la session de
design. La documentation officielle a été consultée pour ce plan ; le domaine
`developers.paydunya.com` est bloqué par le proxy de cet environnement, les
réponses viennent donc de la documentation indexée. **Elles sont notées comme
vérifiées ou comme supposées, jamais confondues.**

| Question | Réponse | Statut |
|---|---|---|
| Création de facture | `POST {base}/checkout-invoice/create`, JSON, en-têtes `PAYDUNYA-MASTER-KEY`, `PAYDUNYA-PRIVATE-KEY`, `PAYDUNYA-TOKEN` | vérifié |
| Base d'URL | `https://app.paydunya.com/api/v1` en production, `.../sandbox-api/v1` en bac à sable | vérifié |
| Réponse | `{ response_code: "00", response_text: <URL de paiement>, token }` | vérifié |
| Webhook | `POST` `application/x-www-form-urlencoded`, tout sous l'index `data` | vérifié |
| Signature | `data[hash]` = **SHA-512 de la clé maîtresse**, la même à chaque appel | vérifié |
| Relecture d'une facture | `GET {base}/checkout-invoice/confirm/{token}`, mêmes en-têtes | vérifié |
| Valeurs de statut | `completed`, `pending`, `cancelled` (`failed` observé aussi) | vérifié pour les trois premières |
| Durée de validité d'une facture | non documentée publiquement | **supposée courte** — d'où D41 |
| Plafonds par moyen de paiement | non trouvés | **non résolu**, noté comme dette |
| Paiement partiel | non documenté | **tranché par nous** — D42 |

---

## Décisions tranchées pour ce plan

### D34 — Les tranches naissent AVEC le contrat, dans la même transaction

`recordSubscription` insère le contrat puis ses trois `installments`, sous la
même transaction sérialisable. Pas un `scheduler.runAfter`, pas une seconde
mutation : un contrat sans échéancier est un contrat que rien ne sait
encaisser, et il se présenterait à l'écran comme payable sans qu'aucun bouton
ne puisse rien ouvrir.

**Conséquence sur l'invariante de somme :** `Σ installments.amountFcfa` vaut
exactement `subscriptions.totalFcfa`, à la signature comme après un avenant
(D44). C'est cette égalité qui rend l'échéancier vérifiable d'un coup d'œil, et
les tests la prouvent sur le découpage.

### D35 — Le reste de division tombe sur la PREMIÈRE tranche

Spec §8.1. 1 250 000 FCFA font 416 667 + 416 666 + 416 667 ? Non :
**416 668 + 416 666 + 416 666**. Le reste va au premier versement, celui qui
arrive quand le budget de l'école est le plus frais, et le découpage se prouve
par une somme exacte plutôt que par un arrondi qui retomberait peut-être juste.

Le calcul est **pur** (`convex/billingRules.ts`) parce qu'il décide d'un
MONTANT, comme `pricing.ts` et pour la même raison : le dépôt n'a pas
`convex-test`, et une règle qui répartit de l'argent doit pouvoir être éprouvée
sans base de données.

### D36 — Les échéances se dérivent des DATES DU CONTRAT, jamais du calendrier

Spec §8.1 nomme octobre, janvier, avril. Les prendre au pied de la lettre
demanderait de l'arithmétique de calendrier et **casserait sur un contrat qui
ne commence pas en octobre** : une école qui signe en février verrait ses deux
premières échéances déjà dépassées, donc marquées impayées dès le lendemain,
donc coupée après vingt et un jours pour un contrat qu'elle vient de signer.

La règle retenue rend les mêmes dates pour une année scolaire normale sans
regarder aucun calendrier :

```
pas      = min(90 jours, durée du contrat / 3)
échéance n = startsAt + (n − 1) × pas
```

Un contrat du 1ᵉʳ octobre au 30 juin donne octobre, fin décembre, fin mars —
soit octobre, janvier, avril à quelques jours près. Un contrat de six mois
resserre le pas au tiers de sa durée. **Les trois échéances tombent toujours
dans la période**, ce qui n'est pas de l'élégance : une échéance postérieure à
`endsAt` ne serait jamais marquée impayée, et la tranche ne serait jamais
réclamée.

**La première échéance tombe à `startsAt`**, et c'est voulu : tant qu'aucune
tranche n'est encaissée le contrat reste « en attente de paiement », statut qui
n'ouvre **aucun** accès. L'école ne perd donc rien à cette échéance immédiate —
elle n'a encore rien gagné.

### D37 — `past_due` n'est posé QUE depuis `active`, et jamais depuis `pending_payment`

C'est la décision la plus dangereuse du plan, et elle se lit à l'envers :
`past_due` **ouvre** l'accès pendant vingt et un jours (§8.5). Le poser sur un
contrat qui n'a jamais rien encaissé donnerait trois semaines d'application
gratuite à une école qui n'a pas payé un franc — exactement ce que le paywall
existe pour empêcher.

Le cron ne fait donc basculer que des contrats **`active`** : ceux qui ont déjà
payé au moins une tranche et qui en oublient une suivante. Un contrat
`pending_payment` dont la première échéance passe reste `pending_payment` :
sa tranche est marquée `overdue` — c'est une information comptable exacte — mais
son statut ne bouge pas, parce qu'il n'y a rien à retirer à une école qui n'a
rien reçu.

### D38 — L'ancre de grâce se lit en UN document, par index, et l'invariante disparaît

§8.5 lègue une invariante à tenir : « si le plan 3 écrivait plus de douze
tranches pour un même abonnement, la plus ancienne échue pourrait sortir de la
fenêtre `.take(12)`, l'ancre remonterait `null`, et l'école serait coupée ».

**On ne la tient pas : on la supprime.** Un index
`installments.by_subscription_status_dueAt` rend la question exacte en un seul
document — la plus ancienne tranche `overdue` de ce contrat — au lieu d'en lire
douze puis de filtrer en mémoire. Le chemin le plus chaud du dépôt y gagne
(`decideAccess` passe ici à chaque lecture d'un élève d'une école en retard),
et surtout **il n'y a plus d'invariante à casser** : D44 peut ajouter des
tranches sans compter.

C'est la règle du dépôt appliquée à elle-même : une borne ne vaut que par
l'invariante qui la garantit. Quand on peut rendre la lecture exacte, on ne
garde pas la borne.

### D39 — Le webhook ne croit rien de ce qu'il reçoit : il RECONFIRME

La « signature » de PayDunya est le SHA-512 de la clé maîtresse : **la même
chaîne à chaque appel**, sur toutes les boutiques du marchand. Ce n'est pas une
signature de la charge utile — elle ne prouve rien du contenu — c'est un mot de
passe partagé. Une seule ligne de journal fuitée, et n'importe qui fabrique des
webhooks valides pour toujours.

Le flux tient donc en trois temps, et les deux premiers sont des refus :

1. **Comparer le hash en temps constant** contre le SHA-512 de notre propre clé
   maîtresse. C'est la règle 1 de §8.3 — vérifier avant toute chose — et elle
   coupe le bruit sans jamais toucher la base.
2. **Redemander la facture à PayDunya** (`checkout-invoice/confirm/{token}`),
   avec nos clés. Le statut ET le montant qui comptent viennent de cette
   réponse-là, **jamais du corps du POST**.
3. **Déléguer à une mutation interne** — le webhook est un `httpAction`, il n'a
   pas de `ctx.db` (règle 4 de §8.3), exactement comme `/link-response`.

La règle 2 de §8.3 — ne jamais croire le montant du payload — est alors tenue
deux fois : contre la réponse de PayDunya, puis contre `installments.amountFcfa`
relu en base.

### D40 — L'idempotence tient sur `payments.providerToken`, et la relecture-écriture est UNE transaction

Règle 3 de §8.3. Le jeton est l'identité du paiement chez le prestataire ;
`by_providerToken` le retrouve en une lecture. Si la ligne est déjà
`completed`, la mutation ne fait **rien** et le webhook répond 200 — PayDunya
rejoue, tous les agrégateurs rejouent, et deux crédits pour un paiement sont
une perte sèche.

La ligne de paiement peut manquer : une action n'est pas transactionnelle, et
l'insertion qui suit la création de la facture peut mourir entre les deux. La
mutation la **crée alors** à partir du `custom_data` de la facture confirmée,
plutôt que de jeter un paiement réel. Mais quand la ligne existe, c'est **elle**
qui dit quelle tranche solder, pas le `custom_data` : ce que nous avons écrit
prime toujours sur ce qui nous revient de l'extérieur.

### D41 — La facture s'ouvre au clic, jamais d'avance

Spec §8.2. La durée de validité d'une facture PayDunya n'est pas documentée
publiquement, et trois factures créées à la signature pour des échéances
espacées de trois mois ont toutes les chances d'être périmées le jour où on
les présente. On crée donc la facture **au moment où le directeur clique**, et
la ligne `payments` naît avec son jeton.

### D42 — Un paiement partiel n'acquitte RIEN, un trop-perçu acquitte

Non documenté chez PayDunya (§8.7), donc tranché ici :

- montant confirmé **< montant dû** : la tranche n'est pas soldée, la ligne de
  paiement est enregistrée `failed` avec sa charge utile, et le webhook répond
  200 — rejouer ne changerait rien, et l'écran montre le paiement refusé pour
  qu'un adulte agisse ;
- montant confirmé **≥ montant dû** : la tranche est soldée. Refuser un
  trop-perçu laisserait sans accès une école qui a payé **plus** que ce qu'elle
  devait, ce qui est absurde à expliquer.

### D43 — Le cron marque, il ne coupe pas

Il écrit `overdue` sur la tranche et `past_due` sur le contrat, **dans la même
transaction** : c'est mot pour mot l'invariante que §8.5 lègue à ce plan — un
statut sans ancre coupe l'école immédiatement au lieu de lui laisser ses
vingt et un jours.

Rien d'autre ne se referme. L'accès s'éteint tout seul vingt et un jours plus
tard, parce que `decideAccess` compare `now` à `ancre + 21 jours` à chaque
lecture. Aucun second cron ne « coupe », aucune fonction n'écrit `expired` —
l'échéance se déduit de `endsAt`, comme depuis le plan 1/3.

### D44 — L'avenant crée sa propre tranche, sinon il n'est jamais facturé

`amendSeats` augmente `totalFcfa` du prorata (§7.6) et **rien ne le réclamait** :
l'école recevait ses sièges sans qu'aucune échéance ne porte leur prix. C'est
un trou de facturation, et il se ferme ici — une tranche supplémentaire du
montant de l'avenant, exigible **trente jours** plus tard, bornée à la fin du
contrat.

L'avenant continue de ne patcher **que ses trois champs** sur la ligne
d'abonnement (§7.6) : il *insère* ailleurs, il ne patche pas plus. Et
l'invariante de somme de D34 est ce qui rend l'ajout obligatoire plutôt
qu'optionnel.

Un prorata qui s'arrondit à zéro — un siège ajouté l'avant-dernier jour —
n'insère rien : une tranche de zéro franc n'est pas une créance.

### D45 — Les clés PayDunya ne vivent qu'en variables d'environnement Convex

Trois clés et un mode, posés par `npx convex env set`, jamais dans le dépôt,
jamais dans un `.env` de cette branche. Une clé absente est un **refus avec une
phrase d'adulte**, jamais un silence : le directeur qui clique doit apprendre
que l'encaissement n'est pas configuré, pas regarder un bouton qui ne fait rien.

### D46 — Bac à sable par défaut, production sur `PAYDUNYA_MODE=live` et rien d'autre

L'inverse — production par défaut — ferait d'une faute de frappe dans une
variable d'environnement un prélèvement réel sur le compte d'une école.

### D47 — Un règlement reçu HORS LIGNE doit pouvoir être constaté

Cette décision n'était pas au périmètre en ouvrant le plan : elle vient de la
relecture, et elle corrige un mal que **ce plan lui-même introduit**.

Une école sénégalaise règle souvent par virement, par chèque ou en espèces. Sans
chemin pour le constater, sa tranche reste `pending`, le cron de D43 la marque
impayée la nuit venue, le contrat passe en `past_due`, et vingt et un jours plus
tard l'application se referme **sur des enfants dont l'école ne doit rien**. Le
cas n'est pas théorique : `recordSubscription` accepte d'enregistrer un contrat
déjà `active`, c'est-à-dire déjà payé, et son échéancier naît malgré tout
entièrement `pending`.

`billing.settleInstallmentOffline` ferme cela, aussi étroitement que possible :

- **réservée à l'`admin`, et elle NOMME son auteur** — déclarer qu'une tranche
  est réglée engage l'école autant qu'activer son contrat ;
- **aucun montant en argument** : la tranche est soldée pour ce qu'elle vaut,
  relu en base. « Constaté » veut dire « cette créance est éteinte », pas
  « voici une somme que je décide » ;
- **idempotente** par le même mécanisme que le webhook — le jeton vaut
  `manual:<id de tranche>` — et refusée sur une tranche déjà réglée ;
- **elle solde par le MÊME chemin que le webhook** (`creditInstallment`) : une
  tranche réglée hors ligne qui n'ouvrirait pas l'accès, ou qui ne sortirait pas
  l'école de l'impayé, serait un piège que rien ne signale ;
- **elle ne défait rien** : annuler un constat erroné pose la question du
  remboursement, qui appartient à la facturation (§10).

La trace vit dans `payments`, dont `provider` prend une seconde valeur,
`manual`, et qui gagne un `actorProfileId` optionnel — vide pour PayDunya, qui
n'a personne à nommer de notre côté.

---

## Tâches

- [ ] **1. Module pur** — `convex/billingRules.ts` : découpage, échéances,
      décision post-paiement, décision d'application d'un paiement, décision
      d'impayé. Testé.
- [ ] **2. Ancre exacte** — index `by_subscription_status_dueAt`, et les deux
      lectures bornées remplacées par une lecture d'un document.
- [ ] **3. Échéancier câblé au contrat** — `recordSubscription` et `amendSeats`.
- [ ] **4. `convex/billing.ts`** — lecture des tranches, enregistrement d'une
      facture ouverte, application idempotente d'un paiement.
- [ ] **5. PayDunya** — action de création de facture, reconfirmation, route
      `/paydunya-webhook`.
- [ ] **6. Cron** — tranches échues et bascule en `past_due`.
- [ ] **7. Écran** — l'échéancier dans la fiche école, avec son bouton de
      paiement, le constat d'un règlement hors ligne, et ses refus lisibles.

## Ce qu'il faut poser avant de déployer

Rien de tout cela ne vit dans le dépôt, et aucun `.env` n'est créé par cette
branche :

```
npx convex env set PAYDUNYA_MASTER_KEY  …
npx convex env set PAYDUNYA_PRIVATE_KEY …
npx convex env set PAYDUNYA_TOKEN       …
npx convex env set PAYDUNYA_MODE        test        # « live » en production
```

Puis, dans la console PayDunya, déclarer l'URL de notification :
`https://<déploiement>.convex.site/paydunya-webhook`.

Tant que les clés sont absentes, le bouton de paiement refuse avec une phrase
d'adulte et le webhook répond 503 : rien ne casse, rien n'encaisse.

## Contraintes reprises des plans 1/3 et 2/3

Elles valent toutes : contrôle d'accès côté serveur dans chaque fonction ; les
requêtes ne lèvent jamais, les mutations lèvent des `ConvexError` dont la donnée
est la phrase ; jamais `.collect()` ni `ctx.db.query().filter()` ; jamais
d'identifiant d'utilisateur en argument pour autoriser ; toute décision extraite
en fonction pure et testée ; **pnpm, jamais npm**.

## Ce que ce plan ne fait pas

- **La remise à zéro des comptes existants** (§11, étape 11) — sur feu vert
  explicite uniquement, et il n'a pas été donné.
- **La console directeur** : le paiement reste `admin`, comme l'import (D30).
- **La résiliation et le remboursement** (§10) : rien ne fait redescendre un
  statut, et le sort d'un montant déjà facturé appartient à la facturation.
- **Le module de facturation** : pas de facture numérotée, pas de PDF, pas
  d'avoir.
- **Le renouvellement automatique** d'une année sur l'autre.
- **Les plafonds de montant par moyen de paiement** : non documentés, non
  trouvés, notés comme dette dans le tableau ci-dessus.
