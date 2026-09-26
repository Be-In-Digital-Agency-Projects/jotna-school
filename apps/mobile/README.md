# Jotna School — application élève (iOS & Android)

L'espace **élève**, et lui seul. Le parent, le professeur, le directeur et
l'administrateur restent sur le web.

Plan de référence :
[`docs/superpowers/plans/2026-09-25-application-mobile-eleve.md`](../../docs/superpowers/plans/2026-09-25-application-mobile-eleve.md).

## Démarrer

```bash
pnpm install                      # depuis la RACINE du dépôt
cd apps/mobile
echo "EXPO_PUBLIC_CONVEX_URL=https://<votre-déploiement>.convex.cloud" > .env.local
pnpm start
```

### La variable d'environnement

Une seule, et elle porte **la même valeur que `NEXT_PUBLIC_CONVEX_URL`** côté
web : c'est le même déploiement Convex, pas un second (décision D2).

| | web | mobile |
|---|---|---|
| nom | `NEXT_PUBLIC_CONVEX_URL` | `EXPO_PUBLIC_CONVEX_URL` |

Le préfixe diffère parce que chaque outil n'injecte que le sien dans le paquet
construit. Il n'y a pas de `.env.example` versionné : la racine ignore `.env*`,
et ce tableau dit tout ce qu'il y a à savoir.

Sans cette variable, l'application démarre quand même et affiche un écran qui
dit ce qui manque — elle ne se contente pas d'un écran blanc.

## Vérifier sans appareil

Les deux commandes que la CI passe, et qui tournent partout :

```bash
pnpm --filter @jotna/mobile typecheck      # types, alias Convex compris
EXPO_PUBLIC_CONVEX_URL=https://placeholder.convex.cloud \
  pnpm --filter @jotna/mobile bundle:check # Metro + Hermes, résolution réelle
```

`bundle:check` est le garde qui compte. Le typecheck ne dit rien de la
résolution à l'exécution ; c'est ce paquet-là qui prouve que Metro traverse le
workspace pnpm et trouve `convex/` à la racine. Les deux pannes de résolution
rencontrées en phase 0 ont été prises par lui, aucune par le typecheck.

## Ce qu'il faut savoir avant de toucher à la configuration

**`metro.config.js`** — ne pas y ajouter `disableHierarchicalLookup: true`.
C'est la recommandation courante pour les monorepos npm et yarn ; **sous pnpm
elle casse la résolution**, parce que les dépendances d'un paquet vivent à côté
de lui dans `node_modules/.pnpm/` et que seule la remontée hiérarchique les
atteint. Le fichier porte le détail et la panne observée.

**`@expo/metro-runtime`** est une dépendance **explicite** de cette
application, bien qu'aucun écran ne l'importe : `expo-router/entry` le fait, et
ni `expo` ni `expo-router` ne le déclarent. pnpm a révélé ce fantôme que npm
aurait masqué par aplatissement. Ne pas le retirer.

**Versions** — elles suivent `expo-template-default@57`, le jeu canonique du
SDK, et **pas** les dernières du registre npm, qui sont en avance sur le SDK
(`react-native` 0.86.3 contre 0.87.1 au registre, `gesture-handler` 2.32 contre
3.3). Pour ajouter un paquet natif, `npx expo install <paquet>` plutôt que
`pnpm add`, afin qu'il aligne la version sur le SDK.

**TypeScript** — cette application a le sien (`~6.0.3`, celui du template),
distinct du `^5` de la racine. pnpm les isole. Déroger à la chaîne d'outils
épinglée par le SDK est le meilleur moyen d'obtenir des erreurs de types
illisibles.

## Structure

```
app/                  routes expo-router
  _layout.tsx         ConvexAuthProvider + stockage sécurisé du jeton
  index.tsx           écran témoin (disparaît en phase 1)
src/
  auth/               adaptateur TokenStorage -> expo-secure-store
  convex/             client Convex
  theme/              jetons de style (décision D22 : StyleSheet, pas NativeWind)
```

## Construire

`eas.json` porte trois profils :

- `development` — client de développement, APK, distribution interne ;
- `preview` — **APK de distribution interne**, celui qu'une école pilote
  installe sans passer par le Play Store (décision D8) ;
- `production` — Android App Bundle.
