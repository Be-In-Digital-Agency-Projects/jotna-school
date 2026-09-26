# Protocole de terrain — application mobile élève

**Ce document existe parce que je ne peux pas l'exécuter.** Les tâches 5.3 et
5.5 du plan demandent un Android 2 Go **réel** et une tablette partagée ; je
n'ai ni l'un ni l'autre, et un émulateur ne répond pas à la question qu'elles
posent. Plutôt que de les cocher sur une supposition, voici ce qu'il faut
faire, avec les commandes exactes, les seuils, et ce qu'il faut conclure de
chaque résultat.

Tout ce qui est **mesurable sans appareil** a été mesuré et figure ci-dessous
comme point de départ. Le reste attend quelqu'un qui tient le téléphone.

---

## 0. Ce qui est déjà mesuré, ici, sans appareil

| Grandeur | Valeur | Comment elle a été obtenue |
|---|---|---|
| Bytecode Hermes (Android) | **3,45 Mo** | `pnpm --filter @jotna/mobile bundle:check`, taille du `.hbc` |
| Assets embarqués | **1,2 Mo**, 30 fichiers | dont 3 sons (`assets:check` le vérifie à chaque CI) |
| Export complet | **4,5 Mo** | ce que l'APK portera, hors runtime Expo |
| Plafond des lots hors-ligne | **8 Mo** | `MAX_BUNDLE_BYTES`, `src/offline/store.ts` |
| Bail d'un lot | **14 jours** | `OFFLINE_LEASE_MS`, `convex/paliers/index.ts` |

Ces chiffres bornent l'attente : un APK de l'ordre de 25 à 35 Mo une fois le
runtime Expo inclus, plus au plus 8 Mo de données locales. Ce sont des ordres
de grandeur à **confirmer sur l'APK réel**, pas des mesures d'installation.

### VOIR l'application sans appareil — ce que ça vaut, ce que ça ne vaut pas

`pnpm --filter @jotna/mobile preview:web` exporte l'application pour le
navigateur (`react-native-web`), et l'on peut enfin **regarder un écran**.

```bash
pnpm --filter @jotna/mobile preview:web
cd apps/mobile/.expo/web-preview && python3 -m http.server 3120
# puis ouvrir http://127.0.0.1:3120/ dans une fenêtre de 430 × 932
```

Il faut poser `EXPO_PUBLIC_CONVEX_URL` : sans elle, l'écran « Configuration
incomplète » s'affiche à la place de l'application. Avec une URL qui ne
répond pas, la socket échoue et **seul le pavé de code est atteignable** —
tout le reste est derrière l'authentification. Pour aller plus loin, il faut
une URL Convex vivante et un code d'élève de test.

**CE QUE CET APERÇU NE PROUVE PAS, et il faut le dire avant de s'en servir :**

- **ce n'est pas le rendu d'un téléphone.** `react-native-web` traduit les
  `StyleSheet` en CSS ; les ombres, les polices, les zones sûres, le clavier
  et le défilement ne se comportent pas pareil. Un écran juste ici peut être
  faux sur l'appareil, et l'inverse ;
- **aucune mesure de performance n'en sort.** Il tourne sur le processeur de
  l'hôte, comme un émulateur — c'est précisément ce que §1 refuse ;
- **le natif n'est pas exercé** : ni `expo-secure-store` réel, ni SQLite de
  l'appareil, ni haptique, ni audio natif.

Il sert à **regarder une mise en page et lire des libellés**, ce qui était
jusqu'ici impossible. Il ne remplace aucune section de ce document.

#### Voir TOUS les écrans : `JOTNA_PREVIEW=1`

Sans dorsale, `SessionGate` ne laisse voir que le pavé de code. Sous
`JOTNA_PREVIEW=1`, `metro.config.js` substitue `convex/react` et
`@convex-dev/auth/react` par deux modules de `apps/mobile/preview/` qui
rendent des données FIGÉES. Les écrans, eux, sont les vrais.

```bash
EXPO_PUBLIC_CONVEX_URL="https://placeholder.convex.cloud" JOTNA_PREVIEW=1 \
  pnpm --filter @jotna/mobile preview:web
```

Accueil, grille des paliers, coffre à badges, profil et « je prépare pour plus
tard » s'affichent alors. Le drapeau est à POSER, jamais à retirer : un
`expo export --platform android` ordinaire ne voit rien de tout ceci, et
`preview/` n'entre dans aucun paquet livré.

**Les données sont typées `FunctionReturnType<typeof api.X>`**, donc le
compilateur refuse un champ manquant ou mal nommé. Ce n'est pas du luxe : le
premier jeu d'épreuve portait `nextPalierIndex: 0` pour une thématique neuve
et des emojis dans `badge.icon`. Les deux sont impossibles — le serveur
numérote les paliers de 1 à 10, et `badgeIcon` attend un nom d'icône Lucide —
et l'aperçu montrait « Palier 0 à faire » et sept trophées identiques. **Une
donnée d'aperçu fausse accuse le code à tort**, et c'est la seule façon dont
cet outil peut nuire. Vérifier au serveur avant de crier au défaut.

*(La ligne `config.resolver.assetExts.push("wasm")` de `metro.config.js` n'existe
que pour cet export : `expo-sqlite` importe un `.wasm` dans sa variante web.
Le paquet Android est identique avec et sans — vérifié, même taille, mêmes
assets.)*

---

## 1. L'appareil de référence

**Ne pas mesurer sur un émulateur.** Un émulateur tourne sur le processeur et
la mémoire de la machine hôte : il dira que tout va bien. Ce qui fait souffrir
un Android d'entrée de gamme — mémoire vive partagée avec le GPU, stockage eMMC
lent, thermique — n'y existe pas.

Cible : **Android 10 ou plus récent, 2 Go de RAM, stockage eMMC**. Un appareil
de ce type se trouve d'occasion pour l'équivalent de 30 000 à 50 000 FCFA ;
c'est le coût d'entrée de cette phase, et il est à décider (§5, point 3 du
plan).

Préparer l'appareil :

```bash
adb devices                      # l'appareil doit répondre
adb shell settings put global window_animation_scale 1
adb shell settings put global transition_animation_scale 1
adb shell settings put global animator_duration_scale 1
```

Installer l'APK de distribution interne (profil déjà présent dans `eas.json`) :

```bash
eas build --platform android --profile preview
adb install -r <chemin-de-l-apk>
```

---

## 2. Tâche 5.3 — budget de démarrage et de mémoire

### 2.1 Démarrage à froid

```bash
adb shell am force-stop com.jotna.school
adb shell am start-activity -W -n com.jotna.school/.MainActivity
```

Relever **`TotalTime`**, cinq fois, et garder la **médiane** (pas la moyenne :
un pic thermique fausserait tout).

| Résultat | Conclusion |
|---|---|
| ≤ 2 500 ms | Bon. |
| 2 500 à 4 000 ms | Acceptable, mais l'écran de lancement doit tenir tout ce temps sans page blanche (tâche 6.1). |
| > 4 000 ms | **À traiter avant publication.** Un enfant de huit ans quitte avant. |

### 2.2 Mémoire

Après avoir joué un palier complet, puis rouvert le coffre et le profil :

```bash
adb shell dumpsys meminfo com.jotna.school | head -30
```

Relever **`TOTAL PSS`**.

| Résultat | Conclusion |
|---|---|
| ≤ 180 Mo | Bon pour 2 Go. |
| 180 à 250 Mo | Surveiller : Android tuera l'application en arrière-plan plus vite. |
| > 250 Mo | **Chercher la fuite.** Premier suspect : `releaseSounds` (`src/feedback/sounds.ts`) — les lecteurs audio sont des objets natifs ; le second, les lots gardés en mémoire par le client Convex. |

### 2.3 Le poids réel d'un lot

C'est le chiffre que je n'ai pas pu produire : il dépend du contenu réel des
exercices générés.

1. Ouvrir une matière → **« Je prépare pour plus tard »** → **Tout préparer**.
2. Lire la ligne du bas : *« X,X Mo utilisés sur 8,0 Mo »*. L'application
   mesure elle-même, en octets (`LENGTH(CAST(… AS BLOB))`).
3. Diviser par le nombre de thématiques préparées → **poids moyen d'un lot**.

| Résultat | Conclusion |
|---|---|
| ≤ 100 Ko par lot | Le plafond de 8 Mo laisse 80 paliers : largement de quoi. |
| 100 à 400 Ko | Confortable encore, ~20 à 80 paliers. |
| > 400 Ko | **Revoir le plafond**, ou ce que `getOfflineBundle` embarque. |

Vérifier aussi la taille de la base :

```bash
adb shell run-as com.jotna.school ls -l databases/ files/
```

### 2.4 Fluidité des exercices

Jouer un palier entier et observer le glissé-déposé et le ruban de confettis.

```bash
adb shell dumpsys gfxinfo com.jotna.school framestats
```

Toute image au-delà de 16 ms est une saccade visible. Les confettis sont en
`useNativeDriver`, donc ils devraient tenir même quand le fil JavaScript
charge l'exercice suivant — **c'est précisément ce qu'il faut vérifier**, car
c'est l'hypothèse sur laquelle `src/ui/confetti.tsx` est écrit.

---

## 3. Tâche 5.5 — la tablette partagée

Le scénario à reproduire est celui d'une classe : trente élèves, quelques
tablettes, et pas toujours de réseau au moment où l'on change d'enfant.

### 3.1 Bascule ordinaire, avec réseau

1. Enfant A entre son code, joue un palier, le termine.
2. **Changer d'élève** (onglet *Moi*).
3. Enfant B entre son code.

**Attendu :** les réponses de A partent AVANT la déconnexion (`catchUpAll` dans
`src/session/change-student.ts`), le préfixe de classe est conservé, B ne voit
rien de A — ni étoiles, ni badges, ni palier en cours.

**À vérifier côté serveur :** les tentatives de A portent bien son `studentId`,
et aucune ne porte celui de B.

### 3.2 Bascule SANS réseau — le cas qui compte

1. Enfant A joue un palier préparé, **en mode avion**.
2. **Changer d'élève**, toujours en mode avion.
3. Enfant B entre son code → **doit échouer proprement** avec « il n'y a pas de
   réseau », **jamais** avec « ce code ne marche pas ».
4. Rétablir le réseau, B entre son code, joue.
5. Rebrancher A plus tard.

**Attendu :** le travail de A n'est PAS détruit à l'étape 2 — `purgeSyncedWork`
ne supprime que ce qui est confirmé — et il repart le jour où A se reconnecte
sur cette tablette. Le serveur refuse de toute façon de l'attribuer à B
(`attempt.userId`).

**C'est le point le plus important de tout ce document.** Si le travail de A
disparaît ici, la décision D18 est violée et il faut s'arrêter.

### 3.3 Démarrage à froid sans réseau

1. Préparer des paliers avec réseau, fermer l'application.
2. Mode avion, **forcer l'arrêt**, rouvrir.

**Attendu :** après quelques secondes (le délai de grâce de
`src/session/reach.ts`), l'**accueil hors-ligne** apparaît avec la liste de ce
qui est préparé — et non « Un instant… » sans fin.

C'est le défaut que la tâche 5.1 a corrigé ; **c'est aussi la seule vérification
de ce document qui ne peut pas être remplacée par du raisonnement**, parce
qu'elle dépend de ce que `expo-secure-store` rend au démarrage à froid.

3. Laisser passer **plus de 14 jours** d'horloge appareil (ou modifier la date)
   → l'accueil hors-ligne doit se refermer sur « Pas de connexion »
   (`verdictStillOpens`, borne de fraîcheur).

### 3.4 Trois enfants de suite, sans réseau

Répéter 3.2 avec A, B, C. Vérifier à la fin, réseau rétabli, que **les trois**
ont leurs réponses, chacune sur son profil. C'est le test que la classe fera
sans le savoir dès le premier jour.

---

## 4. Tâche 5.4 — ce qui reste à voir sur écran

Le code a été traité (cibles tactiles ≥ 48 dp vérifiées une à une, mouvement
réduit respecté par les confettis, plafond d'agrandissement sur les seuls
glyphes enfermés dans une boîte fixe). Ce qui ne se vérifie qu'à l'œil :

```bash
adb shell settings put system font_scale 2.0    # remettre à 1.0 après
```

Parcourir **chaque écran** : accueil, thématiques, palier (les cinq types),
coffre, profil, pavé de code. Chercher du texte coupé, des boutons superposés,
une barre d'onglets écrasée.

Puis, dans les réglages Android : **Accessibilité → Supprimer les animations**,
et vérifier qu'une bonne réponse ne lance plus de confettis.

Enfin, avec **TalkBack** actif, traverser un palier entier au doigt : chaque
élément interactif doit s'annoncer, et l'ordre de lecture suivre l'écran.

---

## 5. Ce qu'il faut faire des résultats

Reporter chaque mesure dans le plan, tâche par tâche, **avec la date et le
modèle d'appareil**. Un chiffre sans appareil nommé ne vaut rien : « 2 100 ms »
sur un Pixel 8 et sur un Tecno Spark ne disent pas la même chose.

Si une mesure dépasse son seuil, elle devient une entrée du plan avant la
phase 6 — pas un « à voir plus tard ». La publication sur les boutiques est le
moment où ces défauts cessent d'être réparables en silence.
