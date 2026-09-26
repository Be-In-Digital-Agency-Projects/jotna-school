import { StudentHome } from "@/screens/student-home";

/**
 * Le premier onglet — « Apprendre ».
 *
 * `SessionGate` (dans `app/_layout.tsx`) ne laisse arriver ici qu'un ÉLÈVE
 * authentifié dont l'école est à jour : cet écran n'a donc aucune garde à
 * refaire, ni lui ni les deux autres onglets.
 */
export default function Index() {
  return <StudentHome />;
}
