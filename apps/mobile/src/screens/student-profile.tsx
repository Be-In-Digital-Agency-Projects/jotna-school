import { useMutation, useQuery } from "convex/react";
import { useCallback, useState } from "react";
import {
  Image,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@convex/_generated/api";
import { levelPercent } from "@/progress/level";
import { useChangeStudent } from "@/session/change-student";
import { useServerReach } from "@/session/reach";
import {
  GLYPH_MAX_SCALE,
  MIN_TOUCH_TARGET,
  colors,
  fontSize,
  radius,
  spacing,
} from "@/theme/tokens";
import { BigButton } from "@/ui/big-button";
import { OfflineNotice } from "@/ui/offline-notice";
import { ProgressBar } from "@/ui/progress-bar";

/**
 * LE PROFIL — tâche 4.4.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * L'AVATAR EST DES INITIALES, ET C'EST LE WEB QUI LE DÉCIDE.
 *
 * `profiles.avatar` existe au schéma et reste vide chez presque tout le monde :
 * aucun écran élève ne permet d'en choisir un, et l'import scolaire n'en pose
 * pas. Le web affiche donc les initiales, et une image seulement si le champ
 * porte quelque chose. On fait pareil — inventer un choix d'avatar ici
 * donnerait à l'enfant une fonction que la moitié de l'application ignore.
 *
 * L'IMAGE PEUT ÉCHOUER SANS QUE RIEN NE LE DISE : une URL distante sur un
 * téléphone sans réseau rend un carré vide. `onError` remet les initiales, qui
 * n'ont jamais besoin du réseau.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE SON EST UN RÉGLAGE DE SERVEUR, pas d'appareil, et c'est voulu : une
 * tablette d'école n'appartient à personne, et l'enfant qui avait coupé le son
 * doit le retrouver coupé sur la tablette du voisin. C'est aussi pourquoi
 * l'interrupteur est OPTIMISTE — on bascule l'affichage tout de suite, la
 * mutation suit. Attendre le serveur pour bouger un interrupteur donne
 * l'impression qu'il est cassé.
 *
 * « CHANGER D'ÉLÈVE » VIT ICI (D10), et plus sous les matières : c'est un
 * geste d'adulte, et l'accueil est l'écran que le doigt d'un enfant parcourt
 * le plus.
 */
export function StudentProfile() {
  const insets = useSafeAreaInsets();
  const stats = useQuery(api.students.getMyStats, {});
  const setSoundEnabled = useMutation(api.streak.setSoundEnabled);
  const { changeStudent, busy } = useChangeStudent();
  const reach = useServerReach();

  const [avatarFailed, setAvatarFailed] = useState(false);
  /** L'état optimiste de l'interrupteur, tant que le serveur n'a pas répondu. */
  const [soundOverride, setSoundOverride] = useState<boolean | null>(null);

  const soundOn = soundOverride ?? stats?.soundEnabled ?? false;

  const toggleSound = useCallback(
    (next: boolean) => {
      setSoundOverride(next);
      void setSoundEnabled({ enabled: next }).catch(() => {
        // Le serveur a refusé — on remet l'interrupteur là où il était plutôt
        // que de laisser l'enfant croire que son choix est enregistré.
        setSoundOverride(null);
      });
    },
    [setSoundEnabled],
  );

  if (stats === undefined) {
    // HORS LIGNE, ON NE FILE PAS SANS FIN. Le profil n'a pas de version
    // locale : niveau, étoiles et badges se comptent côté serveur. Mais
    // « changer d'élève » doit rester atteignable — sur une tablette
    // partagée, c'est le geste qui débloque tout le monde, et il fonctionne
    // sans réseau (voir `change-student.ts`).
    if (reach === "offline") {
      return (
        <View style={styles.center}>
          <OfflineNotice what="ton profil" />
          <View style={styles.spacer} />
          <BigButton
            label="Changer d'élève"
            onPress={changeStudent}
            busy={busy}
            tone="quiet"
          />
        </View>
      );
    }
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Chargement…</Text>
      </View>
    );
  }

  if (stats === null) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>
          On n&apos;arrive pas à lire ton profil. Réessaie plus tard.
        </Text>
      </View>
    );
  }

  const showAvatar = stats.student.avatar != null && !avatarFailed;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg },
      ]}
    >
      <View style={styles.head}>
        <View style={styles.avatar}>
          {showAvatar ? (
            <Image
              source={{ uri: stats.student.avatar }}
              style={styles.avatarImage}
              onError={() => setAvatarFailed(true)}
              accessibilityLabel={`Photo de ${stats.student.name}`}
            />
          ) : (
            <Text
              style={styles.avatarText}
              maxFontSizeMultiplier={GLYPH_MAX_SCALE}
            >
              {initials(stats.student.name)}
            </Text>
          )}
        </View>
        <View style={styles.headMain}>
          <Text style={styles.name}>{stats.student.name}</Text>
          <Text style={styles.level}>Niveau {stats.level}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <ProgressBar
          percent={levelPercent(stats.exosToNextLevel)}
          label={`Progression vers le niveau ${stats.level + 1}`}
        />
        <Text style={styles.cardFoot}>
          Encore {stats.exosToNextLevel} exercice
          {stats.exosToNextLevel > 1 ? "s" : ""} pour le niveau {stats.level + 1}.
        </Text>
      </View>

      <View style={styles.stats}>
        <Stat icon="⭐" value={String(stats.totalStars)} label="étoiles" />
        <Stat icon="🏅" value={String(stats.badgeCount)} label="badges" />
        <Stat
          icon="✅"
          value={String(stats.totalCorrectExercises)}
          label="bonnes réponses"
        />
        <Stat
          icon="📚"
          value={String(stats.completedTopics)}
          label={stats.completedTopics > 1 ? "thèmes finis" : "thème fini"}
        />
        <Stat icon="⏱️" value={formatDuration(stats.totalTimeMs)} label="de travail" />
        {stats.streaksEnabled && (
          <Stat
            icon="🔥"
            value={String(stats.longestStreak)}
            label="record de série"
          />
        )}
      </View>

      {stats.favoriteSubject !== null && (
        <View style={styles.favorite}>
          <Text style={styles.favoriteText}>
            Ta matière préférée : {stats.favoriteSubject} 💛
          </Text>
        </View>
      )}

      <View style={styles.settingRow}>
        <View style={styles.settingMain}>
          <Text style={styles.settingTitle}>Les sons</Text>
          <Text style={styles.settingSub}>
            Les petits bruits quand tu réponds juste.
          </Text>
        </View>
        <Switch
          value={soundOn}
          onValueChange={toggleSound}
          accessibilityLabel="Les sons"
          trackColor={{ true: colors.accent, false: colors.border }}
        />
      </View>

      <View style={styles.spacer} />
      <BigButton
        label="Changer d'élève"
        onPress={changeStudent}
        busy={busy}
        tone="quiet"
      />
      <Text style={styles.changeHint}>
        Pour qu&apos;un autre enfant puisse jouer sur cette tablette. Tes
        réponses partent avant de fermer.
      </Text>
    </ScrollView>
  );
}

function Stat({
  icon,
  value,
  label,
}: {
  icon: string;
  value: string;
  label: string;
}) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${value} ${label}`}>
      <Text style={styles.statIcon}>{icon}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** Mêmes seuils que `formatDuration` du profil web. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 min";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.backgroundTop },
  content: { paddingHorizontal: spacing.lg, gap: spacing.md },
  center: {
    flex: 1,
    alignSelf: "stretch",
    justifyContent: "center",
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.backgroundTop,
  },
  muted: { fontSize: fontSize.label, color: colors.textMuted, textAlign: "center" },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: radius.pill,
    borderWidth: 3,
    borderColor: colors.accentShadow,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: { width: "100%", height: "100%" },
  avatarText: { fontSize: 32, fontWeight: "800", color: colors.surface },
  headMain: { flex: 1, gap: 2 },
  name: { fontSize: fontSize.title, fontWeight: "800", color: colors.text },
  level: { fontSize: fontSize.label, color: colors.textMuted },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardFoot: { fontSize: fontSize.body, color: colors.textMuted },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  stat: {
    flexGrow: 1,
    flexBasis: "30%",
    alignItems: "center",
    gap: 2,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  statIcon: { fontSize: 24 },
  statValue: { fontSize: fontSize.label, fontWeight: "800", color: colors.text },
  statLabel: { fontSize: fontSize.body, color: colors.textMuted, textAlign: "center" },
  favorite: {
    backgroundColor: "#fffbeb",
    borderRadius: radius.md,
    padding: spacing.md,
  },
  favoriteText: { fontSize: fontSize.label, color: colors.text },
  settingRow: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  settingMain: { flex: 1, gap: 2 },
  settingTitle: { fontSize: fontSize.label, fontWeight: "700", color: colors.text },
  settingSub: { fontSize: fontSize.body, color: colors.textMuted },
  spacer: { height: spacing.sm },
  changeHint: { fontSize: fontSize.body, lineHeight: 22, color: colors.textMuted },
});
