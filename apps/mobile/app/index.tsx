import { StudentHome } from "@/screens/student-home";

/**
 * La seule route atteignable pour l'instant.
 *
 * `SessionGate` (dans `_layout.tsx`) ne laisse arriver ici qu'un ÉLÈVE
 * authentifié dont l'école est à jour : cet écran n'a donc aucune garde à
 * refaire.
 */
export default function Index() {
  return <StudentHome />;
}
