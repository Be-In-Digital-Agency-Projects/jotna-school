import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Dimensions, Easing, StyleSheet, View } from "react-native";

import { colors } from "@/theme/tokens";

const PIECE_COLORS = [colors.accent, "#0ea5e9", "#16a34a", "#eab308", "#e11d48"];

/**
 * Les confettis d'une bonne réponse — en `Animated` de React Native, SANS
 * bibliothèque.
 *
 * POURQUOI PAS `react-native-confetti-cannon`. Vingt carrés qui tombent, c'est
 * soixante lignes ; une dépendance de plus, c'est une montée de version à
 * honorer chaque année sur un chantier qui en a déjà assez (D24, raison 3).
 * `Animated` fait partie de React Native : il ne peut pas se désynchroniser du
 * SDK.
 *
 * `useNativeDriver` PARTOUT. L'animation part sur le fil natif et continue même
 * si le fil JavaScript est occupé — ce qui arrive exactement au moment où on
 * l'affiche, puisque la réponse suivante se charge en même temps. Sur un
 * Android d'entrée de gamme, c'est la différence entre une fête et un à-coup.
 *
 * VINGT PIÈCES, PAS DEUX CENTS. C'est ce qu'un appareil à 2 Go tient sans
 * saccade, et un enfant ne les compte pas.
 *
 * LE MOUVEMENT RÉDUIT EST RESPECTÉ. Un enfant qui a demandé moins d'animations
 * — ou dont l'adulte l'a fait pour lui — ne reçoit rien du tout. Ce n'est pas
 * une préférence esthétique : c'est une gêne réelle pour certains.
 */
const PIECES = 20;

export function Confetti({ fireKey }: { fireKey: number }) {
  const [reduceMotion, setReduceMotion] = useState(true);
  const { width, height } = Dimensions.get("window");

  // On part du principe qu'il FAUT réduire, puis on assouplit si le système
  // dit le contraire : au pire on n'anime pas, jamais l'inverse.
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        if (alive) setReduceMotion(on);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (on) => setReduceMotion(on),
    );
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  const progress = useRef(new Animated.Value(0)).current;
  const seeds = useRef(
    Array.from({ length: PIECES }, () => ({
      x: Math.random(),
      delay: Math.random() * 250,
      spin: Math.random() > 0.5 ? 1 : -1,
      color: PIECE_COLORS[Math.floor(Math.random() * PIECE_COLORS.length)],
      size: 8 + Math.random() * 8,
    })),
  ).current;

  useEffect(() => {
    if (fireKey === 0 || reduceMotion) return;
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 1600,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
  }, [fireKey, reduceMotion, progress]);

  if (fireKey === 0 || reduceMotion) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {seeds.map((seed, i) => {
        const fall = progress.interpolate({
          inputRange: [0, 1],
          outputRange: [-40, height * 0.9],
        });
        const drift = progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, (seed.x - 0.5) * 120],
        });
        const spin = progress.interpolate({
          inputRange: [0, 1],
          outputRange: ["0deg", `${seed.spin * 540}deg`],
        });
        const fade = progress.interpolate({
          inputRange: [0, 0.7, 1],
          outputRange: [1, 1, 0],
        });
        return (
          <Animated.View
            key={i}
            style={[
              styles.piece,
              {
                left: seed.x * width,
                width: seed.size,
                height: seed.size,
                backgroundColor: seed.color,
                opacity: fade,
                transform: [
                  { translateY: fall },
                  { translateX: drift },
                  { rotate: spin },
                ],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  piece: { position: "absolute", top: 0, borderRadius: 2 },
});
