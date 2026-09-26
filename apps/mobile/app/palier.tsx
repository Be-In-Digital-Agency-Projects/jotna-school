import { useLocalSearchParams, useRouter } from "expo-router";

import type { Id } from "@convex/_generated/dataModel";
import { PalierSession } from "@/session/palier-session";

/**
 * La séance de palier. Deux paramètres suffisent : la thématique et le rang du
 * palier. La matière et la classe se déduisent du topic côté session.
 */
export default function PalierRoute() {
  const router = useRouter();
  const { topicId, palier } = useLocalSearchParams<{
    topicId: string;
    palier?: string;
  }>();

  const index = Number.parseInt(palier ?? "1", 10);

  return (
    <PalierSession
      // `key` force une séance NEUVE quand l'enfant change de palier : sans
      // elle, l'état d'amorçage de la précédente survivrait et la tentative
      // déjà créée serait réutilisée pour un autre palier.
      key={`${topicId}-${index}`}
      topicId={topicId as Id<"topics">}
      palierIndex={Number.isFinite(index) && index >= 1 ? index : 1}
      onLeave={() => router.back()}
    />
  );
}
