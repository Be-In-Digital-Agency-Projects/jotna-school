import { useQuery } from "convex/react";

import { api } from "@convex/_generated/api";
import { OfflineHome } from "@/screens/offline-home";
import { StudentHome } from "@/screens/student-home";
import { useServerReach } from "@/session/reach";

/**
 * Le premier onglet — « Apprendre ».
 *
 * `SessionGate` (dans `app/_layout.tsx`) ne laisse arriver ici qu'un ÉLÈVE
 * authentifié dont l'école est à jour, ou — sans socket — dont le dernier
 * verdict connu ouvre encore. Cet écran n'a donc aucune garde à refaire.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA CONDITION DE BASCULE EST EN DEUX PARTIES, ET LA SECONDE COMPTE AUTANT.
 *
 * On ne montre l'accueil hors-ligne que si l'on ne peut PAS joindre le serveur
 * **et** que l'on n'a rien à montrer. Se contenter de « hors ligne » ferait
 * disparaître l'accueil ordinaire — matières, niveau, série — dès la première
 * coupure de trois secondes, alors que le client Convex garde ses résultats en
 * mémoire et qu'ils sont parfaitement affichables. Une coupure ne doit pas
 * effacer ce qui est déjà à l'écran.
 *
 * `api.subjects.list` sert de témoin parce que c'est la requête SANS laquelle
 * l'accueil ordinaire n'a rien à proposer : le niveau et la série sont des
 * ornements, les matières sont le chemin.
 */
export default function Index() {
  const reach = useServerReach();
  const subjects = useQuery(api.subjects.list, {});

  if (reach === "offline" && subjects === undefined) return <OfflineHome />;
  return <StudentHome />;
}
