import { createAudioPlayer, type AudioPlayer } from "expo-audio";

/**
 * Les sons de l'application.
 *
 * LES FICHIERS SONT CEUX DU DÉPÔT, PAS DES COPIES. Ils vivent dans
 * `public/sounds/` — c'est le web qui les y a posés — et Metro les atteint
 * parce que la racine du dépôt est dans ses `watchFolders`. Dupliquer trois
 * MP3 dans `apps/mobile/assets/` marcherait aussi, et les deux copies auraient
 * divergé à la première retouche.
 *
 * ILS SONT DANS LE PAQUET, JAMAIS TÉLÉCHARGÉS. `require()` d'un asset le fait
 * empaqueter à la construction : un enfant en 3G n'attend pas un son, et un
 * enfant sans réseau l'entend quand même (ce qui comptera en phase 3).
 *
 * LES LECTEURS SONT CRÉÉS UNE FOIS, PARESSEUSEMENT. En créer un à chaque
 * bonne réponse laisserait fuir des objets natifs sur une séance de dix
 * exercices ; les créer tous au démarrage ferait payer le décodage à un
 * appareil d'entrée de gamme avant même que l'enfant ait choisi sa matière.
 *
 * RIEN NE LÈVE. Un son qui ne part pas n'est pas un problème que l'enfant doit
 * connaître.
 */
const SOURCES = {
  correct: require("../../../../public/sounds/correct.mp3"),
  badge: require("../../../../public/sounds/badge.mp3"),
  levelUp: require("../../../../public/sounds/level-up.mp3"),
} as const;

export type SoundName = keyof typeof SOURCES;

const players: Partial<Record<SoundName, AudioPlayer>> = {};

function playerFor(name: SoundName): AudioPlayer | null {
  const existing = players[name];
  if (existing !== undefined) return existing;
  try {
    const player = createAudioPlayer(SOURCES[name]);
    players[name] = player;
    return player;
  } catch {
    return null;
  }
}

/**
 * Joue un son SI l'élève les a activés.
 *
 * La préférence vit côté serveur (`students.getMySoundEnabled`), pour qu'elle
 * suive l'enfant d'un appareil à l'autre — une tablette partagée n'est pas la
 * sienne. L'appelant la passe ; ce module ne l'interroge pas lui-même, sinon
 * chaque son coûterait une requête.
 */
export function playSound(name: SoundName, enabled: boolean): void {
  if (!enabled) return;
  const player = playerFor(name);
  if (player === null) return;
  try {
    // Rembobiner AVANT de jouer : deux bonnes réponses coup sur coup doivent
    // produire deux sons, pas un seul suivi d'un silence.
    void player.seekTo(0).catch(() => {});
    player.play();
  } catch {
    // Silencieux, par dessein.
  }
}

/** À appeler quand on quitte la séance : libère les objets natifs. */
export function releaseSounds(): void {
  for (const name of Object.keys(players) as SoundName[]) {
    try {
      players[name]?.remove();
    } catch {
      // idem
    }
    delete players[name];
  }
}
