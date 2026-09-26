import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { badgeIcon } from "@/theme/badge-icon";
import { getRarityLabel, rarityStyle, type RarityTier } from "@/theme/rarity";
import { MIN_TOUCH_TARGET, colors, fontSize, radius, spacing } from "@/theme/tokens";
import { BigButton } from "@/ui/big-button";

type Tab = "all" | "earned" | "locked";

interface BadgeRow {
  _id: string;
  name: string;
  description: string;
  icon: string;
  rarity: RarityTier;
  criteriaText: string;
}

/**
 * LE COFFRE À BADGES — tâche 4.3.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LES BADGES VERROUILLÉS SONT MONTRÉS, PAS CACHÉS, et c'est tout le principe
 * d'un coffre. Un enfant qui ne voit que ce qu'il a déjà n'a rien à viser ;
 * `criteriaText` lui dit comment obtenir chacun de ceux qui manquent. C'est la
 * même décision que le web, et elle est plus importante ici : sur un
 * téléphone, il n'y a pas de page voisine où aller chercher la liste.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA FÊTE DIFFÉRÉE (D19) EST LA VRAIE RAISON D'ÊTRE DE CET ÉCRAN SUR MOBILE.
 *
 * Un badge décerné pendant une séance SANS RÉSEAU n'est pas décerné du tout :
 * il l'est par le serveur, à la synchronisation, longtemps après que l'enfant
 * a fermé l'application. Personne ne l'a fêté. `getMyStats().unseenBadges`
 * garde la liste de ceux qu'on ne lui a jamais montrés — c'est le serveur qui
 * s'en souvient, pas l'appareil, donc un enfant qui change de tablette
 * retrouve sa fête.
 *
 * ON NE MARQUE « VU » QU'AU GESTE DE L'ENFANT, jamais à l'affichage. Marquer
 * au rendu ferait disparaître la fête d'un coffre ouvert par erreur pendant
 * qu'il regardait ailleurs — et elle ne revient pas.
 */
export function BadgeChest() {
  const insets = useSafeAreaInsets();
  const all = useQuery(api.badges.list, {});
  const earned = useQuery(api.badges.listMyEarned, {});
  const stats = useQuery(api.students.getMyStats, {});
  const markSeen = useMutation(api.badges.markBadgesSeen);

  const [tab, setTab] = useState<Tab>("all");
  const [detail, setDetail] = useState<{
    badge: BadgeRow;
    earnedAt: number | null;
  } | null>(null);
  const [celebrationDone, setCelebrationDone] = useState(false);

  const earnedAtById = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of earned ?? []) map.set(row.badgeId as string, row.earnedAt);
    return map;
  }, [earned]);

  const badges = (all ?? []) as unknown as BadgeRow[];
  const earnedCount = earnedAtById.size;

  const unseen = celebrationDone ? [] : (stats?.unseenBadges ?? []);

  const visible = badges.filter((b) => {
    const isEarned = earnedAtById.has(b._id);
    if (tab === "earned") return isEarned;
    if (tab === "locked") return !isEarned;
    return true;
  });

  const loading = all === undefined || earned === undefined;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg },
      ]}
    >
      <Text style={styles.title}>Mon coffre 🎁</Text>
      <Text style={styles.sub}>
        {loading
          ? "Chargement…"
          : `${earnedCount} badge${earnedCount > 1 ? "s" : ""} sur ${badges.length}`}
      </Text>

      {unseen.length > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${unseen.length} nouveau badge, appuie pour ouvrir`}
          onPress={() => {
            // L'ORDRE COMPTE : on ferme la fête TOUT DE SUITE côté écran, et
            // l'on marque ensuite. Attendre le serveur laisserait la carte
            // sous le doigt d'un enfant qui appuie trois fois.
            setCelebrationDone(true);
            void markSeen({
              badgeIds: unseen.map((b) => b.badgeId as Id<"badges">),
            }).catch(() => {
              // Un marquage qui échoue n'est pas grave : la fête revient au
              // prochain coffre, ce qui est mieux que de la perdre.
            });
          }}
          style={styles.celebration}
        >
          <Text style={styles.celebrationTitle}>
            🎉 {unseen.length} nouveau{unseen.length > 1 ? "x" : ""} badge
            {unseen.length > 1 ? "s" : ""} !
          </Text>
          <View style={styles.celebrationRow}>
            {unseen.slice(0, 6).map((row) => (
              <Text key={row.badgeId as string} style={styles.celebrationIcon}>
                {badgeIcon(row.badge?.icon)}
              </Text>
            ))}
          </View>
          <Text style={styles.celebrationBody}>
            {unseen.map((row) => row.badge?.name).filter(Boolean).join(", ")}
          </Text>
          <Text style={styles.celebrationHint}>Appuie pour les ranger 👆</Text>
        </Pressable>
      )}

      <View style={styles.tabs} accessibilityRole="tablist">
        <TabPill
          label="Tous"
          count={badges.length}
          active={tab === "all"}
          onPress={() => setTab("all")}
        />
        <TabPill
          label="Obtenus"
          count={earnedCount}
          active={tab === "earned"}
          onPress={() => setTab("earned")}
        />
        <TabPill
          label="À gagner"
          count={badges.length - earnedCount}
          active={tab === "locked"}
          onPress={() => setTab("locked")}
        />
      </View>

      {!loading && visible.length === 0 && (
        <Text style={styles.muted}>
          {tab === "earned"
            ? "Pas encore de badge — le premier n'est pas loin 💪"
            : "Rien à afficher ici."}
        </Text>
      )}

      <View style={styles.grid}>
        {visible.map((badge) => {
          const earnedAt = earnedAtById.get(badge._id) ?? null;
          return (
            <BadgeTile
              key={badge._id}
              badge={badge}
              earnedAt={earnedAt}
              onPress={() => setDetail({ badge, earnedAt })}
            />
          );
        })}
      </View>

      <Modal
        visible={detail !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setDetail(null)}
      >
        {/* La pression sur le fond ferme, comme partout ailleurs sur un
            téléphone. Le bouton reste, parce qu'un enfant ne connaît pas
            forcément ce geste. */}
        <Pressable
          style={styles.backdrop}
          accessibilityLabel="Fermer"
          onPress={() => setDetail(null)}
        >
          <Pressable style={styles.sheet} onPress={() => {}}>
            {detail !== null && (
              <>
                <Text style={styles.sheetIcon}>
                  {detail.earnedAt !== null ? badgeIcon(detail.badge.icon) : "🔒"}
                </Text>
                <Text style={styles.sheetTitle}>{detail.badge.name}</Text>
                <RarityChip tier={detail.badge.rarity} />
                <Text style={styles.sheetBody}>{detail.badge.description}</Text>
                <Text style={styles.sheetCriteria}>
                  {detail.earnedAt !== null
                    ? `Gagné le ${formatDay(detail.earnedAt)} 🎉`
                    : detail.badge.criteriaText}
                </Text>
                <BigButton label="Fermer" onPress={() => setDetail(null)} />
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

function BadgeTile({
  badge,
  earnedAt,
  onPress,
}: {
  badge: BadgeRow;
  earnedAt: number | null;
  onPress: () => void;
}) {
  const style = rarityStyle(badge.rarity);
  const locked = earnedAt === null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${badge.name}, ${getRarityLabel(badge.rarity)}, ${
        locked ? "à gagner" : "obtenu"
      }`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        { borderColor: locked ? colors.border : style.border },
        locked && styles.tileLocked,
        pressed && styles.tilePressed,
      ]}
    >
      <Text style={styles.tileIcon}>
        {locked ? "🔒" : badgeIcon(badge.icon)}
      </Text>
      <Text style={styles.tileName} numberOfLines={2}>
        {badge.name}
      </Text>
    </Pressable>
  );
}

function RarityChip({ tier }: { tier: RarityTier }) {
  const style = rarityStyle(tier);
  return (
    <View style={[styles.chip, { backgroundColor: style.chipBackground }]}>
      <Text style={[styles.chipText, { color: style.chipText }]}>
        {getRarityLabel(tier)}
      </Text>
    </View>
  );
}

function TabPill({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label}, ${count}`}
      onPress={onPress}
      style={[styles.tab, active && styles.tabActive]}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>
        {label} {count}
      </Text>
    </Pressable>
  );
}

/**
 * La date, en toutes lettres et en français.
 *
 * `toLocaleDateString("fr-FR", …)` dépend d'ICU, que Hermes n'embarque pas
 * toujours en entier : sur certains Android il rendrait « 9/23/2026 » à un
 * enfant francophone. On formate à la main — douze mots, aucune surprise.
 */
const MONTHS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

function formatDay(ts: number): string {
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.backgroundTop },
  content: { paddingHorizontal: spacing.lg, gap: spacing.md },
  title: { fontSize: fontSize.display, fontWeight: "800", color: colors.text },
  sub: { fontSize: fontSize.label, color: colors.textMuted, marginTop: -spacing.sm },
  muted: { fontSize: fontSize.body, color: colors.textMuted },
  celebration: {
    backgroundColor: "#fef3c7",
    borderWidth: 2,
    borderColor: colors.accent,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  celebrationTitle: {
    fontSize: fontSize.title,
    fontWeight: "800",
    color: colors.text,
  },
  celebrationRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  celebrationIcon: { fontSize: 36 },
  celebrationBody: { fontSize: fontSize.body, lineHeight: 22, color: colors.text },
  celebrationHint: { fontSize: fontSize.body, color: colors.textMuted },
  tabs: { flexDirection: "row", gap: spacing.sm },
  tab: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tabActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  tabText: { fontSize: fontSize.body, fontWeight: "700", color: colors.text },
  tabTextActive: { color: colors.surface },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tile: {
    width: 104,
    minHeight: 112,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    padding: spacing.sm,
    borderWidth: 2,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  tileLocked: { backgroundColor: colors.backgroundMiddle },
  tilePressed: { transform: [{ scale: 0.97 }] },
  tileIcon: { fontSize: 34 },
  tileName: {
    fontSize: fontSize.body,
    fontWeight: "600",
    color: colors.text,
    textAlign: "center",
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(28,25,23,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  sheet: {
    alignSelf: "stretch",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  sheetIcon: { fontSize: 64 },
  sheetTitle: {
    fontSize: fontSize.title,
    fontWeight: "800",
    color: colors.text,
    textAlign: "center",
  },
  sheetBody: {
    fontSize: fontSize.body,
    lineHeight: 22,
    color: colors.text,
    textAlign: "center",
  },
  sheetCriteria: {
    fontSize: fontSize.body,
    lineHeight: 22,
    color: colors.textMuted,
    textAlign: "center",
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  chipText: { fontSize: fontSize.body, fontWeight: "700" },
});
