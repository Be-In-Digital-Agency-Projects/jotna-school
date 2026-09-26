# Catégorie Enfants / *Designed for Families* — audit

Décision **D9** du plan mobile. Chaque ligne a été vérifiée dans le code ou
dans le manifeste généré, pas cochée de mémoire. Les trois trouvailles sont
en bas, et deux d'entre elles n'apparaissent qu'en générant le projet natif.

---

## Ce qui est en règle

| Exigence | État | Vérification |
|---|---|---|
| Aucune publicité | ✅ | aucun SDK publicitaire dans `apps/mobile/package.json` |
| Aucun analytics tiers | ✅ | `grep` sur `analytics\|posthog\|mixpanel\|sentry\|gtag\|firebase` : **zéro occurrence** dans tout le dépôt |
| Aucun identifiant de suivi | ✅ | conséquence du point précédent ; `App Tracking Transparency` jamais déclenché |
| Barrière parentale devant les liens sortants | ✅ **sans objet** | `grep` sur `openURL\|Linking\.\|WebBrowser` dans `apps/mobile` : **aucun lien sortant**. Il n'y a rien à barrer |
| Aucun achat dans l'application | ✅ | décision **D7** : modèle B2B, aucun paiement, aucun prix, aucun lien vers un paiement |
| Aucune communication entre utilisateurs | ✅ | pas de messagerie, pas de commentaire, pas de profil public |
| Politique de confidentialité accessible sans compte | ✅ | `/legal/confidentialite`, route publique hors des groupes gardés |
| Consentement parental au traitement IA | ✅ | tâche **6.4** — l'école déclare, le parent peut refuser, et son refus l'emporte |
| Contenu adapté à l'âge | ✅ | exercices du programme sénégalais CI→CM2, générés puis relus |
| Cibles tactiles ≥ 48 dp, mouvement réduit respecté | ✅ | tâche **5.4** |

---

## Les trois trouvailles

### 1. `SYSTEM_ALERT_WINDOW` partait en production — **corrigé**

Le manifeste principal généré par `expo prebuild` demandait
`android.permission.SYSTEM_ALERT_WINDOW`, c'est-à-dire **« dessiner par-dessus
les autres applications »**. Sur une application pour enfants, cette permission
est un refus annoncé : c'est celle des surcouches publicitaires et des
rançongiciels. Rien dans le code ne s'en sert — elle vient du gabarit Expo.

Deux permissions de stockage externe (`READ_EXTERNAL_STORAGE`,
`WRITE_EXTERNAL_STORAGE`, plafonnées au SDK 32) étaient dans le même cas :
l'application n'écrit que dans sa base SQLite privée, qui n'en demande aucune.

`android.blockedPermissions` les marque désormais `tools:node="remove"` dans le
manifeste principal. Le manifeste de la variante *debug* garde
`SYSTEM_ALERT_WINDOW` pour le menu de développement, ce qui est exactement le
partage voulu.

> **Ce qui est vérifié, et ce qui ne l'est pas.** La directive de retrait est
> bien émise — relu dans le manifeste généré. La fusion finale des manifestes
> se fait par Gradle, qui demande le SDK Android : elle n'a donc pas pu être
> observée ici. À confirmer sur le premier APK produit,
> `aapt dump permissions <apk>`.

Restent, et elles sont justes : `INTERNET` et `VIBRATE` (retours haptiques).

### 2. `android.edgeToEdgeEnabled` était une entrée morte — **corrigé**

Signalée par `expo prebuild` : Android 16 rend le bord-à-bord obligatoire et le
plugin refuse désormais de le personnaliser. L'entrée est retirée. Les écrans
gèrent déjà les encoches par `useSafeAreaInsets`, et la barre d'onglets calcule
la sienne depuis la tâche 5.4.

### 3. Cinq liens légaux morts sur le site public — **partiellement corrigé**

`components/landing/footer.tsx` annonce six pages légales. **Aucune n'existait.**
Un relecteur de boutique qui clique « Politique de confidentialité » depuis le
site tombait sur un 404 — et c'est la première chose qu'il vérifie.

`/legal/confidentialite` existe désormais. **Les cinq autres sont toujours
mortes** : `mentions`, `cgu`, `cookies`, `mineurs`, `accessibilite`. Elles
demandent des informations d'entreprise (forme juridique, adresse, NINEA) et
une relecture juridique. Elles ne s'inventent pas, et je ne les ai pas
inventées.

`/legal/mineurs` est la plus proche du sujet de cette page : c'est elle qu'un
parent cherchera après avoir lu la politique.

---

## Ce qui reste à faire avant de soumettre

1. **Écrire les cinq pages légales manquantes** — elles demandent des données
   d'entreprise que le dépôt ne contient pas.
2. **Faire relire la politique de confidentialité par un conseil**, au regard
   de la Loi 2008-12 et des exigences d'Apple et de Google. Le document décrit
   fidèlement le logiciel ; il ne prétend pas être un avis juridique.
3. **Confirmer les permissions sur le premier APK réel** (`aapt dump
   permissions`), point 1 ci-dessus.
4. **Décider pour la suppression de compte** : aujourd'hui elle ne s'exerce que
   par courriel, ce qui est défendable tant que l'application élève ne crée pas
   de compte. Une application parent avec inscription rendrait le chemin
   obligatoire.
5. **Exécuter le protocole de terrain** — `2026-09-26-protocole-terrain-mobile.md`.
   Aucun écran n'a jamais été rendu sur un appareil.
