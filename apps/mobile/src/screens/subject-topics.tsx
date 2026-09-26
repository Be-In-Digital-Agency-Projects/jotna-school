import { useQuery } from "convex/react";
import { useCallback, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ATOM_SCHEME_VERSION } from "@convex/paliers/offline";
import { isBundlePlayable } from "@/offline/bundle-validity";
import { listBundles } from "@/offline/store";
import { palierState, type PalierState } from "@/progress/palier-state";
import { useServerReach } from "@/session/reach";
import { MIN_TOUCH_TARGET, colors, fontSize, radius, spacing } from "@/theme/tokens";
import { BigButton } from "@/ui/big-button";
import { OfflineNotice } from "@/ui/offline-notice";

/** Le nombre de paliers d'une thématique — `nextPalierIndex` est borné là. */
const PALIERS_PER_TOPIC = 10;

/**
 * LES THÉMATIQUES D'UNE MATIÈRE, ET LEURS DIX PALIERS — tâche 4.2.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI MONTRER LES DIX PLUTÔT QUE « CONTINUER ».
 *
 * L'écran de la phase 2 n'affichait qu'une flèche vers le prochain palier.
 * C'était assez pour essayer le moteur, et faux comme carte : un enfant ne
 * voit pas le chemin parcouru, ne sait pas combien il en reste, et n'a aucun
 * moyen de revenir sur un palier qu'il a aimé. Dix pastilles répondent aux
 * trois d'un coup d'œil, sans une phrase à lire.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE LE SERVEUR NE DIT PAS est traité dans `progress/palier-state.ts`, à
 * part et éprouvé : `nextPalierIndex` ne permet pas de retrouver le dernier
 * palier validé quand il vaut 10, et le piège d'à côté (`validatedPaliers`
 * compte des tentatives, pas des paliers) ouvrirait un palier que le serveur
 * refuse.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * UN PALIER FAIT RESTE OUVRABLE, et ce n'est pas un oubli : le serveur
 * l'autorise (`startPalierAttempt` ne vérifie que les paliers PRÉCÉDENTS), et
 * refaire un palier réussi est la manière dont un enfant révise. Seuls les
 * paliers encore fermés ne répondent pas au doigt — parce que le serveur les
 * refuserait, et qu'un bouton qui échoue toujours est une promesse fausse.
 */
export function SubjectTopics({
  subjectId,
  onLeave,
}: {
  subjectId: Id<"subjects">;
  onLeave: () => void;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const map = useQuery(api.students.getStudentSubjectMap, { subjectId });
  const reach = useServerReach();

  // CE QUI EST DÉJÀ SUR L'APPAREIL. On relit au retour au premier plan, donc
  // après « je prépare pour plus tard » et après une séance : ce sont les deux
  // seuls moments où un lot apparaît.
  const [ready, setReady] = useState<Set<string>>(new Set());
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void listBundles()
        .then((rows) => {
          if (!alive) return;
          const now = Date.now();
          setReady(
            new Set(
              rows
                .filter((b) => isBundlePlayable(b, now, ATOM_SCHEME_VERSION))
                .map((b) => `${b.topicId}:${b.palierIndex}`),
            ),
          );
        })
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, []),
  );

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg },
      ]}
    >
      <Text style={styles.title}>{map?.subject.name ?? "…"}</Text>
      {map != null && map.totalStarsApprox > 0 && (
        <Text style={styles.subtitle}>{map.totalStarsApprox} ⭐ en tout</Text>
      )}

      {map === undefined && reach === "offline" && (
        <OfflineNotice what="tes thématiques" />
      )}
      {map === undefined && reach !== "offline" && (
        <Text style={styles.muted}>Chargement…</Text>
      )}
      {map === null && (
        <Text style={styles.muted}>Rien à afficher pour le moment.</Text>
      )}

      {map?.topics.map((topic) => {
        const locked = topic.status === "locked";
        const completed = topic.status === "completed";
        return (
          <View key={topic._id} style={[styles.card, locked && styles.cardLocked]}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>{topic.name}</Text>
              <Text style={styles.cardStars}>
                {locked ? "🔒" : `${topic.starsApprox} ⭐`}
              </Text>
            </View>

            {locked ? (
              <Text style={styles.lockedText}>
                Finis la thématique d&apos;avant pour ouvrir celle-ci.
              </Text>
            ) : (
              <>
                <View style={styles.paliers}>
                  {Array.from({ length: PALIERS_PER_TOPIC }, (_, i) => i + 1).map(
                    (index) => {
                      const state = palierState(
                        index,
                        topic.nextPalierIndex,
                        completed,
                      );
                      const prepared = ready.has(`${topic._id}:${index}`);
                      return (
                        <PalierPill
                          key={index}
                          index={index}
                          state={state}
                          prepared={prepared}
                          topicName={topic.name}
                          onPress={() =>
                            router.push({
                              pathname: "/palier",
                              params: {
                                topicId: topic._id,
                                palier: String(index),
                              },
                            })
                          }
                        />
                      );
                    },
                  )}
                </View>
                <Text style={styles.cardFoot}>
                  {completed
                    ? "Thématique terminée 🎉 Tu peux refaire un palier quand tu veux."
                    : `Palier ${topic.nextPalierIndex} à faire.`}
                </Text>
              </>
            )}
          </View>
        );
      })}

      {map != null && (
        <BigButton
          label="Je prépare pour plus tard 🎒"
          onPress={() =>
            router.push({ pathname: "/prepare", params: { subjectId } })
          }
          tone="quiet"
        />
      )}

      <BigButton label="Retour" onPress={onLeave} tone="quiet" />
    </ScrollView>
  );
}

function PalierPill({
  index,
  state,
  prepared,
  topicName,
  onPress,
}: {
  index: number;
  state: PalierState;
  prepared: boolean;
  topicName: string;
  onPress: () => void;
}) {
  const openable = state !== "locked";
  const what =
    state === "done" ? "terminé" : state === "next" ? "à faire" : "fermé";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !openable }}
      accessibilityLabel={`${topicName}, palier ${index}, ${what}${
        prepared ? ", prêt sans réseau" : ""
      }`}
      disabled={!openable}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        state === "done" && styles.pillDone,
        state === "next" && styles.pillNext,
        state === "locked" && styles.pillLocked,
        pressed && openable && styles.pillPressed,
      ]}
    >
      <Text
        style={[
          styles.pillText,
          state === "next" && styles.pillTextNext,
          state === "locked" && styles.pillTextLocked,
        ]}
      >
        {state === "locked" ? "🔒" : index}
      </Text>
      {/* Le repère du hors-ligne est DISCRET par choix : il intéresse l'adulte
          qui a préparé la tablette, pas l'enfant qui choisit un palier. */}
      {prepared && <Text style={styles.pillSaved}>💾</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.backgroundTop },
  content: { paddingHorizontal: spacing.lg, gap: spacing.md },
  title: { fontSize: fontSize.display, fontWeight: "800", color: colors.text },
  subtitle: { fontSize: fontSize.label, color: colors.textMuted, marginTop: -spacing.sm },
  muted: { fontSize: fontSize.body, color: colors.textMuted },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardLocked: { opacity: 0.6 },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  cardTitle: { flex: 1, fontSize: fontSize.label, fontWeight: "700", color: colors.text },
  cardStars: { fontSize: fontSize.label, color: colors.text },
  cardFoot: { fontSize: fontSize.body, color: colors.textMuted },
  lockedText: { fontSize: fontSize.body, lineHeight: 22, color: colors.textMuted },
  paliers: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  pill: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.backgroundMiddle,
    alignItems: "center",
    justifyContent: "center",
  },
  pillDone: { backgroundColor: "#ffedd5", borderColor: colors.accentShadow },
  pillNext: { backgroundColor: colors.accent, borderColor: colors.accent },
  pillLocked: { backgroundColor: colors.backgroundMiddle, borderColor: colors.border },
  pillPressed: { transform: [{ scale: 0.96 }] },
  pillText: { fontSize: fontSize.label, fontWeight: "800", color: colors.text },
  pillTextNext: { color: colors.surface },
  pillTextLocked: { fontSize: fontSize.body },
  pillSaved: { fontSize: 11, marginTop: -2 },
});
