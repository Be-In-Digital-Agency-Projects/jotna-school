import * as Haptics from "expo-haptics";

/**
 * Les vibrations de retour.
 *
 * ELLES NE LÈVENT JAMAIS ET N'ATTENDENT RIEN. Un appareil sans moteur
 * haptique, une permission refusée, un émulateur : tout cela échoue
 * silencieusement, et aucun de ces cas ne doit interrompre un enfant en train
 * de répondre. On n'attend pas non plus la promesse — une vibration en retard
 * n'a aucun intérêt, et l'attendre retarderait l'affichage du verdict.
 *
 * TROIS INTENSITÉS, PAS PLUS. Le succès claque, l'erreur est douce — on ne
 * PUNIT pas un enfant qui se trompe, la vibration d'erreur est plus légère que
 * celle du succès, pas l'inverse — et le tap est à peine perceptible.
 */
export function tapFeedback(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function correctFeedback(): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
    () => {},
  );
}

export function wrongFeedback(): void {
  // `Warning` et non `Error` : se tromper fait partie du travail, et la
  // secousse d'erreur d'iOS est franchement désagréable.
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
    () => {},
  );
}
