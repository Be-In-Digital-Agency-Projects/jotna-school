/**
 * L'ÉTAT D'UN PALIER DANS LA GRILLE DES DIX — tâche 4.2.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE LE SERVEUR NE DIT PAS.
 *
 * `getStudentSubjectMap` rend `nextPalierIndex = min(10, maxValidé + 1)`, et
 * jamais `maxValidé` lui-même. On le retrouve par soustraction, SAUF au
 * plafond : `nextPalierIndex === 10` se lit aussi bien « le 10 reste à faire »
 * que « les dix sont faits », et les deux dessinent une grille différente.
 *
 * Le `status` de la thématique tranche : `completed` vient de
 * `studentTopicProgress.completedAt`, une autre source que le compte des
 * tentatives, et il dit que la thématique est bouclée.
 *
 * `validatedPaliers` ne peut PAS servir de disambiguateur, et c'est le piège
 * de cette fonction : il compte des TENTATIVES validées, pas des paliers
 * distincts. Un enfant qui refait deux fois le palier 3 le fait passer à 2
 * sans qu'un seul palier de plus soit acquis — le lire comme « deux paliers
 * faits » ouvrirait un palier que le serveur refuse.
 */

export type PalierState = "done" | "next" | "locked";

export function palierState(
  index: number,
  nextPalierIndex: number,
  topicCompleted: boolean,
): PalierState {
  if (topicCompleted) return "done";
  if (index < nextPalierIndex) return "done";
  if (index === nextPalierIndex) return "next";
  return "locked";
}
