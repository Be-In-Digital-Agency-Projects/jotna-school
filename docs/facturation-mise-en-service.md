# Facturation — les quatre variables à poser avant d'émettre

Le code de la facturation est dans le dépôt. **Les quatre variables qui suivent
n'y sont pas, et ne peuvent pas y être** : elles portent l'identité fiscale de
celui qui émet les factures, et elle diffère d'un déploiement à l'autre — une
préproduction ne facture pas sous la même raison sociale qu'une production.

Tant qu'elles ne sont pas posées, **les factures sont émises mais ne partent
pas**. Ce n'est pas une panne, c'est un refus volontaire : voir la section 3.

---

## 1. Ce qui déclenche une facture

Une facture est émise **dès qu'une tranche passe à `paid`**, dans la même
transaction. Les deux chemins qui soldent une tranche facturent donc :

| Chemin | Quand |
|---|---|
| `billing.applyPayment` | le prestataire confirme un paiement en ligne (webhook) |
| `billing.settleInstallmentOffline` | un administrateur constate un virement, des espèces, un chèque |

Il n'existe pas de troisième chemin, et c'est ce qui garantit qu'aucun
encaissement ne reste sans pièce comptable.

**Un contrat de trois tranches produit trois factures**, une par règlement — pas
une facture unique à la signature. C'est ce que l'école attend : elle
comptabilise ce qu'elle a versé, quand elle l'a versé.

## 2. Les quatre variables

```bash
npx convex env set INVOICE_ISSUER_NAME       # SANS valeur : saisie interactive
npx convex env set INVOICE_ISSUER_NINEA
npx convex env set INVOICE_ISSUER_ADDRESS
npx convex env set INVOICE_ISSUER_EMAIL
```

| Variable | Ce qu'elle porte | Où ça s'affiche |
|---|---|---|
| `INVOICE_ISSUER_NAME` | la raison sociale exacte, telle qu'au registre du commerce | en-tête de la facture, et nom de l'expéditeur du courriel |
| `INVOICE_ISSUER_NINEA` | l'identifiant fiscal sénégalais de l'émetteur | en-tête, sous l'adresse |
| `INVOICE_ISSUER_ADDRESS` | l'adresse du siège, sur une ligne | en-tête |
| `INVOICE_ISSUER_EMAIL` | l'adresse de facturation | en-tête, et **adresse de réponse** du courriel |

**Écrire les commandes sans valeur sur la ligne** : la CLI la demande alors en
interactif. Ce ne sont pas des secrets, mais l'habitude est bonne à garder — et
une raison sociale mal recopiée dans un historique de shell se retrouve
difficilement.

**Par déploiement.** Ces commandes visent le déploiement de développement ;
ajoutez `--prod` pour la production, qui a ses propres variables. `npx convex env
list` montre ce qui est posé.

**`INVOICE_ISSUER_EMAIL` reçoit les réponses.** Le courriel invite l'école à
répondre pour toute question sur sa facture, et la réponse arrive à cette
adresse. Mettre une boîte que personne ne relève transformerait cette phrase en
mensonge.

## 3. Pourquoi rien ne part sans elles

Une facture porte la raison sociale et le NINEA de celui qui l'émet. Sans ces
mentions, le document n'est pas une facture : c'est un courriel qui en a l'air,
et l'école ne pourra ni le comptabiliser ni le produire à un contrôle.

Lui envoyer quand même serait **pire que ne rien envoyer** : elle croirait tenir
une pièce valable.

Alors quand les variables manquent :

- la facture est **émise** — son numéro appartient à une suite qui doit rester
  sans trou, et le sauter pour le réutiliser plus tard serait un trou ;
- l'envoi est refusé, et le motif s'écrit sur la ligne de la facture, avec le nom
  des variables manquantes ;
- le motif s'écrit aussi dans les journaux du déploiement, préfixé `[facture]`.

**Rien n'est perdu.** Une fois les variables posées, la facture peut être
renvoyée :

```bash
npx convex run billingInvoice:sendInvoice '{"invoiceId":"<identifiant>"}'
```

L'identifiant se lit sur l'écran **Factures** de l'espace direction, ou par
`npx convex data invoices`.

## 4. La clé d'envoi, et l'expéditeur

L'envoi passe par Resend, comme les autres courriels du dépôt :

```bash
npx convex env set RESEND_API_KEY
```

**L'expéditeur est encore `onboarding@resend.dev`**, le domaine de test de
Resend, partout dans le dépôt. Pour de vraies factures c'est insuffisant : elles
finiront en indésirables, et l'adresse d'expédition ne correspondra pas à la
raison sociale affichée sur le document. Il faut un domaine vérifié chez Resend,
puis remplacer cette adresse dans `convex/billingInvoice.ts`.

C'est le seul point de cette mise en service qui demande une modification de
code plutôt qu'une variable.

## 5. Vérifier

```bash
npx convex env list | grep INVOICE_ISSUER
```

Les quatre doivent apparaître. Ensuite, sur une tranche réglée :

```bash
npx convex data invoices
```

Une facture partie porte un `sentAt` et **aucun** `failureReason`. Une facture
en attente porte l'inverse.

L'écran **Factures** de l'espace direction dit la même chose en clair. Le
directeur d'une école y voit ses factures, leur numéro, leur montant et leur
état d'envoi — mais **pas** le motif d'un échec : quand une facture ne part pas,
la cause est chez nous, l'école n'y peut rien, et lire le nom de nos variables
d'environnement ne l'aiderait pas. L'administration de la plateforme, elle, voit
le motif.

## 6. Ce qui n'est pas fait

**Aucune TVA.** Le dépôt ne modélise aucune taxe : ni `pricing`, ni
`billingRules`, ni le schéma n'en portent la moindre trace, et les montants des
tranches somment exactement au total du contrat. La facture affiche donc un
montant unique, sans décomposition. Si le régime de l'émetteur exige une ligne
de TVA, **c'est le calcul des montants qu'il faut reprendre**, dans
`convex/pricing.ts`, avant de l'écrire sur un document — pas le gabarit du
courriel.

**Pas de pièce jointe PDF.** La facture est le corps du courriel. Un comptable
qui veut un fichier imprime la page. Un PDF demanderait un moteur de rendu dans
une action Node, et ce n'est pas fait.

**Pas d'avoir, pas d'annulation.** Une facture émise ne se défait pas, et rien
n'émet d'avoir. Annuler un règlement constaté à tort reste une question ouverte,
avec celle du remboursement.

**Pas de renvoi depuis un écran.** Le renvoi passe par la ligne de commande de
la section 3.
