import { useLocalSearchParams, useRouter } from "expo-router";

import type { Id } from "@convex/_generated/dataModel";
import { SubjectTopics } from "@/screens/subject-topics";

/** Les thématiques d'une matière, et les dix paliers de chacune (4.2). */
export default function SubjectRoute() {
  const router = useRouter();
  const { subjectId } = useLocalSearchParams<{ subjectId: string }>();

  return (
    <SubjectTopics
      subjectId={subjectId as Id<"subjects">}
      onLeave={() => router.back()}
    />
  );
}
