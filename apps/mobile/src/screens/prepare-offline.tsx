import { useConvex, useQuery } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { VISIBLE_CLASSES, type VisibleClassName } from "@convex/curriculum";
import { isUnmeteredNow } from "@/offline/network";
import { useServerReach } from "@/session/reach";
import { preparePalier, type PrepareOutcome } from "@/offline/prepare";
import {
  MAX_BUNDLE_BYTES,
  getWifiOnly,
  listBundles,
  setWifiOnly,
  type BundleSummary,
} from "@/offline/store";
import { MIN_TOUCH_TARGET, colors, fontSize, radius, spacing } from "@/theme/tokens";
import { BigButton } from "@/ui/big-button";
import { OfflineNotice } from "@/ui/offline-notice";

/**
 * « JE PRÉPARE POUR PLUS TARD » — l'écran du téléchargement délibéré (3.12).
 *
 * L'ENFANT NE DEMANDE PAS « TÉLÉCHARGER », IL DEMANDE « EST-CE QUE JE POURRAI
 * JOUER TOUT À L'HEURE ». L'écran répond donc à cette question-là : une ligne
 * par thématique, et un seul mot qui compte — prêt, ou pas prêt. Le nombre de
 * mégaoctets est écrit une fois, en bas, pour l'adulte qui viendra regarder ;
 * il n'est pas ce que l'enfant vient chercher.
 *
 * ON NE PRÉPARE QUE LE PROCHAIN PALIER DE CHAQUE THÉMATIQUE, et la raison
 * n'est pas un choix d'écran : le serveur refuse d'ouvrir un palier dont le
 * précédent n'est pas validé. Le détail est dans `offline/prepare.ts`.
 */
export function PrepareOffline({
  subjectId,
  onLeave,
}: {
  subjectId: Id<"subjects">;
  onLeave: () => void;
}) {
  const insets = useSafeAreaInsets();
  const client = useConvex();
  const map = useQuery(api.students.getStudentSubjectMap, { subjectId });
  const reach = useServerReach();

  const [bundles, setBundles] = useState<BundleSummary[]>([]);
  const [wifiOnly, setWifiOnlyState] = useState(true);
  const [busyTopic, setBusyTopic] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, PrepareOutcome>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void listBundles()
      .then(setBundles)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    void getWifiOnly()
      .then(setWifiOnlyState)
      .catch(() => {});
  }, [refresh]);

  const toggleWifi = useCallback((value: boolean) => {
    setWifiOnlyState(value);
    setNotice(null);
    void setWifiOnly(value).catch(() => {});
  }, []);

  /**
   * PRÉPARE EN SÉRIE, ET S'ARRÊTE À LA PREMIÈRE FERMETURE D'ACCÈS.
   *
   * Un `locked` ou un `failed` n'arrête RIEN : la thématique suivante n'a
   * aucune raison d'échouer parce que celle-ci a buté. Un `closed`, si :
   * l'accès de l'école est fermé, donc les quatre suivantes échoueront
   * pareil, et chacune aura coûté une action `getBucket` pour rien.
   */
  const prepare = useCallback(
    async (targets: { topicId: Id<"topics">; name: string; class: VisibleClassName; palierIndex: number }[]) => {
      if (targets.length === 0) return;
      // SANS SERVEUR, PRÉPARER N'A AUCUN SENS — et les trois appels
      // (`getBucket`, `startPalierAttempt`, `getOfflineBundle`) pendraient
      // jusqu'à ce que l'enfant abandonne, fileur tournant.
      if (reach === "offline") {
        setNotice(
          "Il n'y a pas de réseau 📡 On ne peut pas préparer maintenant — reviens quand la connexion sera là.",
        );
        return;
      }
      if (wifiOnly && !(await isUnmeteredNow())) {
        setNotice(
          "Tu n'es pas en Wi-Fi 📶 Attends d'en trouver un, ou demande à un adulte avant d'utiliser le forfait.",
        );
        return;
      }
      setNotice(null);
      for (const target of targets) {
        setBusyTopic(target.topicId as string);
        const outcome = await preparePalier(client, subjectId, {
          topicId: target.topicId,
          topicName: target.name,
          class: target.class,
          palierIndex: target.palierIndex,
        });
        setOutcomes((prev) => ({ ...prev, [target.topicId as string]: outcome }));
        refresh();
        if (outcome === "closed") break;
      }
      setBusyTopic(null);
    },
    [client, subjectId, wifiOnly, refresh, reach],
  );

  const now = Date.now();
  const readyKeys = new Set(
    bundles
      .filter((b) => b.accessValidUntil > now)
      .map((b) => `${b.topicId}:${b.palierIndex}`),
  );
  const usedBytes = bundles.reduce((acc, b) => acc + b.bytes, 0);

  // Une thématique verrouillée ne se prépare pas : le serveur la refuserait,
  // et lui proposer un bouton qui échoue toujours serait une promesse fausse.
  const targets = (map?.topics ?? [])
    .filter((t) => t.status !== "locked")
    .map((t) => ({
      topicId: t._id,
      name: t.name,
      class: visibleClassOf(t.class),
      palierIndex: t.nextPalierIndex,
    }))
    .filter(
      (t): t is { topicId: Id<"topics">; name: string; class: VisibleClassName; palierIndex: number } =>
        t.class !== null,
    );

  const missing = targets.filter(
    (t) => !readyKeys.has(`${t.topicId}:${t.palierIndex}`),
  );

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg },
      ]}
    >
      <Text style={styles.title}>Je prépare pour plus tard 🎒</Text>
      <Text style={styles.sub}>
        Prends tes exercices maintenant, pendant qu&apos;il y a du réseau. Tu
        pourras jouer même sans connexion.
      </Text>

      {notice !== null && (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      )}

      {map === undefined && reach === "offline" && (
        <OfflineNotice what="ce qu'il y a à préparer" />
      )}
      {map === undefined && reach !== "offline" && (
        <Text style={styles.muted}>Chargement…</Text>
      )}
      {map === null && (
        <Text style={styles.muted}>Rien à préparer pour le moment.</Text>
      )}

      {targets.map((t) => {
        const ready = readyKeys.has(`${t.topicId}:${t.palierIndex}`);
        const busy = busyTopic === (t.topicId as string);
        const outcome = outcomes[t.topicId as string];
        return (
          <View key={t.topicId} style={styles.row}>
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle}>{t.name}</Text>
              <Text style={styles.rowSub}>
                {busy
                  ? "On prépare…"
                  : ready
                    ? `Palier ${t.palierIndex} — prêt à jouer sans réseau ✅`
                    : outcomeLabel(outcome, t.palierIndex)}
              </Text>
            </View>
            {busy ? (
              <ActivityIndicator color={colors.accent} />
            ) : (
              <Text style={styles.rowMark}>{ready ? "✅" : "⬜️"}</Text>
            )}
          </View>
        );
      })}

      {missing.length > 0 && (
        <BigButton
          label={
            missing.length === targets.length
              ? "Tout préparer"
              : `Préparer les ${missing.length} qui manquent`
          }
          busy={busyTopic !== null}
          onPress={() => {
            void prepare(missing);
          }}
        />
      )}
      {targets.length > 0 && missing.length === 0 && (
        <View style={styles.allReady}>
          <Text style={styles.allReadyText}>
            Tout est prêt 🎉 Tu peux partir sans réseau.
          </Text>
        </View>
      )}

      <View style={styles.settingRow}>
        <View style={styles.rowMain}>
          <Text style={styles.rowTitle}>Seulement en Wi-Fi</Text>
          <Text style={styles.rowSub}>
            Pour ne pas utiliser le forfait de la maison.
          </Text>
        </View>
        <Switch
          value={wifiOnly}
          onValueChange={toggleWifi}
          accessibilityLabel="Préparer seulement en Wi-Fi"
          trackColor={{ true: colors.accent, false: colors.border }}
        />
      </View>

      <Text style={styles.storage}>
        {formatMb(usedBytes)} utilisés sur {formatMb(MAX_BUNDLE_BYTES)}. Les
        plus anciens s&apos;effacent tout seuls — jamais ceux dont les réponses
        n&apos;ont pas encore été envoyées.
      </Text>

      <BigButton label="Retour" onPress={onLeave} tone="quiet" />
    </ScrollView>
  );
}

/** La classe du topic, si c'est une classe que le client a le droit d'ouvrir. */
function visibleClassOf(klass: string | null): VisibleClassName | null {
  return (VISIBLE_CLASSES as readonly string[]).includes(klass ?? "")
    ? (klass as VisibleClassName)
    : null;
}

/**
 * Les trois échecs ne se disent pas pareil, et aucun ne dit « erreur ».
 * `locked` est une information utile (il reste un palier à finir), `closed`
 * regarde l'adulte, `failed` demande seulement de réessayer.
 */
function outcomeLabel(outcome: PrepareOutcome | undefined, palierIndex: number): string {
  switch (outcome) {
    case "locked":
      return "Finis d'abord le palier d'avant 🔒";
    case "closed":
      return "Ton espace n'est pas ouvert — parle-en à ta maîtresse 🌱";
    case "failed":
      return "Ça n'a pas marché, tu peux réessayer 🔧";
    default:
      return `Palier ${palierIndex} — pas encore prêt`;
  }
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.backgroundTop },
  content: { paddingHorizontal: spacing.lg, gap: spacing.md },
  title: { fontSize: fontSize.display, fontWeight: "800", color: colors.text },
  sub: { fontSize: fontSize.body, lineHeight: 22, color: colors.textMuted },
  muted: { fontSize: fontSize.body, color: colors.textMuted },
  notice: {
    backgroundColor: "#fffbeb",
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  noticeText: { fontSize: fontSize.body, lineHeight: 22, color: colors.text },
  row: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { fontSize: fontSize.label, fontWeight: "700", color: colors.text },
  rowSub: { fontSize: fontSize.body, color: colors.textMuted },
  rowMark: { fontSize: 22 },
  allReady: {
    backgroundColor: "#f7fee7",
    borderRadius: radius.md,
    padding: spacing.md,
  },
  allReadyText: { fontSize: fontSize.label, color: colors.text },
  settingRow: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  storage: { fontSize: fontSize.body, lineHeight: 22, color: colors.textMuted },
});
