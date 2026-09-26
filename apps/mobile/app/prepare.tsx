import { useLocalSearchParams, useRouter } from "expo-router";

import type { Id } from "@convex/_generated/dataModel";
import { PrepareOffline } from "@/screens/prepare-offline";

/** « Je prépare pour plus tard », pour une matière. */
export default function PrepareRoute() {
  const router = useRouter();
  const { subjectId } = useLocalSearchParams<{ subjectId: string }>();

  return (
    <PrepareOffline
      subjectId={subjectId as Id<"subjects">}
      onLeave={() => router.back()}
    />
  );
}
