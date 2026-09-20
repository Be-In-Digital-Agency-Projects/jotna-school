# Module « Arabe & Coran » — mise en service

Ce module apprend à un enfant à lire l'arabe : l'alphabet d'abord (écouter,
reconnaître, prononcer, écrire au doigt), puis les voyelles, l'assemblage, les
premiers mots et six sourates courtes. Il est **éteint pour toutes les écoles**
tant que personne ne l'allume, et il **fonctionne sans aucune configuration** —
seule la voix demande une clé.

---

## 1. L'allumer pour une école

Fiche de l'école (`/admin/ecoles/<id>`) → section **Modules optionnels** →
« Activer pour cette école ».

Qui a le droit : un `admin`, ou le `directeur` rattaché à cette école en
personnel actif (`schoolStaff`). Un professeur ne peut pas — allumer un
enseignement religieux pour toute une école n'est pas une décision
d'enseignant. La garde est côté serveur (`convex/modules.ts`), l'écran ne fait
que l'exposer.

Ce que voient les élèves de l'école, une fois allumé :

- une carte « Arabe & Coran » sur leur accueil ;
- un onglet « Arabe » dans la barre de navigation ;
- le parcours sur `/student/arabe`.

**Éteindre n'efface rien.** Les progressions restent en base et reviennent si
l'école rallume. Aucun autre élève n'est touché : le réglage est par école.

---

## 2. La voix (ElevenLabs) — optionnelle, mais c'est elle qui enseigne

Sans clé, le module marche : l'enfant lit la translittération, fait les
exercices de reconnaissance et écrit au doigt. Il ne peut simplement ni
**entendre** la lettre ni **se faire écouter**, ce qui est la moitié du module.

```bash
npx convex env set ELEVENLABS_API_KEY  <clé>
npx convex env set ELEVENLABS_VOICE_ID <identifiant de voix>
```

Optionnelles, avec leurs valeurs par défaut :

| Variable | Défaut | À quoi elle sert |
| --- | --- | --- |
| `ELEVENLABS_MODEL_ID` | `eleven_multilingual_v2` | Le modèle de synthèse. Il doit lire l'arabe **vocalisé** : un modèle qui ignore les voyelles brèves prononcerait بَ et بِ de la même façon, et le niveau 2 du parcours n'aurait plus d'objet. |
| `ELEVENLABS_STT_MODEL_ID` | `scribe_v1` | Le modèle de transcription qui écoute l'enfant. |
| `ELEVENLABS_STT_LANGUAGE` | `ara` | Code ISO-639-3. `ar` fonctionne aussi. |
| `ELEVENLABS_SPEED` | — | Vitesse de diction, entre `0.7` et `1.2`. Une valeur hors de cet intervalle est ignorée. Ralentir aide les débutants. |

**`ELEVENLABS_VOICE_ID` n'a pas de valeur par défaut, et c'est voulu.** Choisir
la voix est une décision pédagogique : on veut une diction douce, posée,
articulée — pas une voix de présentateur. Elle dépend du compte qui la possède.
Écoutez plusieurs voix arabes dans la bibliothèque ElevenLabs, faites-en écouter
une à un enseignant, puis posez son identifiant. Une voix choisie sans que
personne ne l'ait entendue finira dans les oreilles de six cents enfants.

### Ce que ça coûte, et pourquoi c'est borné

- **La synthèse est mise en cache** (`arabicAudioClips` + stockage Convex). Le
  texte du module est fini — 28 noms de lettres, 84 syllabes, une trentaine de
  mots, 28 versets : chaque son n'est payé qu'une fois, pour toutes les écoles
  et tous les enfants. La dépense s'éteint d'elle-même une fois le cache chaud.
  Changer de voix ou de modèle crée de nouveaux clips (la clé de cache les
  porte) ; les anciens restent, inatteignables.
- **La transcription se paie à chaque « je répète »** — elle ne peut pas être
  mise en cache, l'audio étant différent à chaque fois. D'où un plafond de
  **80 transcriptions par enfant et par jour** (`STT_DAILY_LIMIT`,
  `convex/arabic/db.ts`). Au-delà, l'enfant lit un message bienveillant et
  continue sa leçon sans micro. Le compteur est dans `arabicVoiceUsage`, une
  ligne par (élève, jour), en UTC.
- **Cette dépense n'entre pas dans le budget IA mensuel** d'OpenAI
  (`aiGateway/budget.ts`). C'est délibéré : réviser l'alphabet en classe ne doit
  pas pouvoir fermer la génération d'exercices de mathématiques.

### La voix de l'enfant n'est conservée nulle part

Les octets arrivent en argument de l'action, partent en transcription, et
disparaissent avec elle : ni stockage, ni table, ni journal. **La transcription
elle-même n'est pas écrite** — elle est rendue à l'écran pour que l'enfant voie
ce qui a été entendu, et s'efface avec la page. Ce qui reste en base est ce
qu'un cahier garderait : la date, l'exercice, et si c'était juste.

L'enregistrement est borné à 8 secondes et 2 Mo, et le micro est relâché à
l'arrêt, à l'erreur et au démontage du composant.

> **Depuis Claude Code sur le web, `api.elevenlabs.io` est bloqué par le proxy
> de sortie**, comme `bictorys.com` et `developers.paydunya.com`. Le chemin
> voix n'a donc **jamais été exécuté contre l'API réelle** : il est écrit
> d'après leur documentation. Première mise en service = premier vrai test.
> Vérifiez d'abord une écoute (le clip doit apparaître dans
> `arabicAudioClips`), puis une répétition.

---

## 3. Le texte coranique — à faire relire avant toute mise en classe

`convex/arabic/quran.ts` porte six sourates (Al-Ikhlāṣ, Al-Kawthar, Al-ʿAṣr,
Al-Falaq, An-Nās, Al-Fātiḥa). **Ce texte a été saisi à la main et n'a pas été
copié depuis une édition faisant autorité.** Une voyelle déplacée n'est pas une
coquille : c'est un mot faux enseigné à un enfant.

Deux points à trancher par l'école :

1. **La relecture.** Faire relire les six sourates par un maître d'arabe ou un
   imam, sourate par sourate, et noter la relecture dans ce dossier. Le test
   `convex/__tests__/arabic.test.ts` vérifie le **nombre de versets** de chaque
   sourate — il attrape un verset perdu au copier-coller, jamais une voyelle
   fausse.
2. **La riwāya.** Le texte est en **Ḥafṣ**, la lecture des mushafs du Caire et
   de Médine. **Le Sénégal lit majoritairement en Warsh**, où l'orthographe et
   certaines voyelles diffèrent. Une école qui enseigne Warsh ne doit pas servir
   ces textes tels quels. Le champ `riwaya` existe pour rendre la différence
   visible ; une table Warsh peut être ajoutée à côté sans toucher au reste du
   module.

---

## 4. Où vit le code

| Fichier | Ce qu'il porte |
| --- | --- |
| `convex/arabic/alphabet.ts` | Les 28 lettres : quatre formes, points, confusions, syllabes, conseils de prononciation. |
| `convex/arabic/quran.ts` | Les six sourates (voir §3). |
| `convex/arabic/curriculum.ts` | Les 5 niveaux et 24 leçons, et ce que chaque leçon fait faire. |
| `convex/arabic/matching.ts` | Normalisation de l'arabe et jugement d'une prononciation. |
| `convex/arabic/progressRules.ts` | Déverrouillage des leçons, note, étoiles. |
| `convex/arabic/lessons.ts` | Parcours et progression de l'élève (requêtes et mutations). |
| `convex/arabic/voice.ts` | Synthèse et transcription (actions, `"use node"`). |
| `convex/arabic/db.ts` | Ce que les actions ne peuvent pas faire elles-mêmes (cache, quota, écriture des tentatives). |
| `convex/modules.ts`, `convex/moduleCatalog.ts` | L'allumage par école. |
| `lib/arabic/tracing.ts` | La note du tracé au doigt. |
| `lib/arabic/session.ts` | L'enchaînement des exercices d'une leçon. |
| `components/arabic/*` | Écoute, micro, carré d'écriture, exercices. |
| `app/(student)/student/arabe/*` | Parcours, alphabet, séance. |

**Le contenu est du code, pas des lignes en base** : rien à ensemencer, rien à
migrer, et une faute de frappe se voit en revue. Seules la progression, le cache
audio et les compteurs vivent en base.

---

## 5. Ce que le module ne fait pas

- **Il ne juge pas une récitation.** Le tajwīd (allongements, nasalisations,
  points d'articulation) demande une oreille humaine ; une comparaison de texte
  n'en dit rien. Le module fait **lire**, il n'évalue pas une récitation.
- **Il ne note pas le tracé de façon opposable.** La note du carré d'écriture
  est calculée sur l'appareil (seul le navigateur a la police) : c'est une aide
  à l'apprentissage, pas une preuve. Les tentatives le disent
  (`arabicAttempts.source = "device"`).
- **Il n'a pas encore d'écran enseignant.** Les progressions sont en base
  (`arabicLessonProgress`, `arabicAttempts`, indexées par élève) mais aucun
  écran professeur ne les montre. C'est la suite naturelle du chantier.
- **Il ne traduit pas le Coran verset par verset.** Traduire est un acte
  d'exégèse ; on donne le nom de la sourate et son sens, rien de plus.
