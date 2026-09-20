"use client";

import { use, useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
// Le barème est un module PUR, sans import ni accès à la base : l'écran peut
// donc montrer le montant AVANT validation sans un aller-retour par serveur —
// celui d'un contrat neuf comme celui d'un avenant, proratisé. Ces totaux
// n'engagent rien : `recordSubscription` et `amendSeats` recalculent chacun le
// leur, et c'est pourquoi le prix n'est l'argument d'aucune des deux.
import {
  PRICING_SCALE,
  quoteSeatAmendment,
  quoteSubscription,
} from "@/convex/pricing";
// Le texte d'un refus de `convex/schools.ts`, lu là où il voyage vraiment :
// le champ `data` de la ConvexError, jamais `message`. Voir le module.
import { refusalMessage } from "@/lib/refusalMessage";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowLeftRight,
  CalendarClock,
  History,
  Loader2,
  Plus,
  Receipt,
  School,
  TrendingUp,
  Users,
  UserMinus,
  UserPlus,
  GraduationCap,
  KeyRound,
  Upload,
  AlertTriangle,
  Unlock,
  CreditCard,
  ExternalLink,
  BookOpenText,
} from "lucide-react";

/** Les types viennent des fonctions Convex : aucune forme n'est recopiée. */
type StaffRow = FunctionReturnType<typeof api.schools.listStaff>[number];
type ClassRow = FunctionReturnType<typeof api.schools.listClasses>[number];
type ClassStudentRow = FunctionReturnType<
  typeof api.schools.listClassStudents
>[number];

/** Une ligne du journal d'une inscription — noms déjà résolus par le serveur. */
type MembershipEventRow = FunctionReturnType<
  typeof api.schools.listMembershipEvents
>[number];

/** Un avenant du contrat courant — auteur déjà résolu par le serveur. */
type SeatAmendmentRow = FunctionReturnType<
  typeof api.schools.listSeatAmendments
>[number];

/**
 * Les deux listes de candidats rendent `{ items, truncated }`, pas un tableau.
 *
 * Elles balaient `profiles` sur une tranche bornée, faute d'index par rôle
 * (voir `convex/schools.ts`), et `truncated` dit que le balayage a buté sur sa
 * borne. L'écran doit le RELAYER : sans lui, « Aucun profil disponible » se lit
 * comme « ce profil n'existe pas » alors qu'il veut dire « je n'ai pas tout lu ».
 */
type BillingScheduleView = NonNullable<
  FunctionReturnType<typeof api.billing.getSchedule>
>;
type ScheduleRow = BillingScheduleView["installments"][number];
type PaymentRow = BillingScheduleView["payments"][number];
type CandidateList = FunctionReturnType<typeof api.schools.listStaffCandidates>;
type EnrollableList = FunctionReturnType<
  typeof api.schools.listEnrollableStudents
>;

type EnrollmentOutlook = FunctionReturnType<
  typeof api.schools.getEnrollmentOutlook
>;
type OutlookReason = NonNullable<NonNullable<EnrollmentOutlook>["reason"]>;

/**
 * L'état des sièges du contrat — `null` quand l'école n'a aucun abonnement,
 * donc aucun plafond. La forme vient du serveur : rien n'est recopié ici.
 */
type SeatState = NonNullable<NonNullable<EnrollmentOutlook>["seats"]>;

/** Le contrat courant, tel que le paywall le retient. */
type ContractSummary = NonNullable<NonNullable<EnrollmentOutlook>["contract"]>;

/**
 * Le contrat qu'un avenant ferait grossir, DÉSIGNÉ PAR LE SERVEUR.
 *
 * Distinct de `ContractSummary` parce que ce n'est pas toujours le même
 * document : quand le contrat du paywall est échu et qu'un contrat à venir est
 * déjà signé, la fiche montre le premier et l'avenant porte sur le second.
 * L'écran ne refait jamais ce choix — il l'affiche.
 */
type AmendableContract = NonNullable<
  NonNullable<EnrollmentOutlook>["amendable"]
>;

type ClassLevel = Doc<"schoolClasses">["class"];
type StaffRole = Doc<"schoolStaff">["staffRole"];
type SubscriptionStatus = Doc<"subscriptions">["status"];

/**
 * Les SIX statuts, dits en français — `Record` complet et non `Partial` : un
 * septième statut au schéma ne compilera pas tant qu'il n'aura pas sa phrase,
 * et mieux vaut un écran qui refuse de se construire qu'une fiche d'école qui
 * affiche « past_due » à un administrateur.
 */
const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatus, string> = {
  draft: "Brouillon",
  pending_payment: "En attente de paiement",
  active: "Actif",
  past_due: "Impayé",
  expired: "Échu",
  cancelled: "Résilié",
};

/**
 * Les DEUX statuts qu'une personne pose — et ce qui est arrivé aux quatre
 * autres.
 *
 * `past_due` vient du suivi des tranches — le cron quotidien, et lui seul —,
 * `expired` se déduit de la date de fin à chaque lecture, et « résilié » dit la
 * FIN d'un contrat existant que rien ne sait encore prononcer. La table a cinq
 * écrivains — l'insertion de `recordSubscription`, l'avenant de sièges
 * d'`amendSeats` qui ne touche ni le statut ni les dates, `activateSubscription`
 * et `billing.applyPayment` qui n'écrivent qu'« actif », et
 * `billing.markOverdueInstallments` qui n'écrit qu'« impayé » depuis « actif » —
 * donc aucune ligne ne peut devenir résiliée, et aucune personne ne pose
 * « impayé ». Les quatre sont refusés par la mutation, et le formulaire n'a pas à
 * proposer ce qui sera refusé : c'est pourquoi aucun encart n'annonce leur
 * refus, à la différence d'« actif » daté du futur ou du plafond de sièges,
 * que le menu peut encore produire.
 *
 * « Résilié » était pire qu'inutile au menu : la ligne n'ouvrait aucun accès,
 * mais devenait le contrat COURANT de l'école à sa date de début — la
 * sélection du paywall ne compare que les `startsAt` — et coupait les élèves
 * qu'un contrat actif couvrait encore.
 *
 * « BROUILLON » a disparu du menu pour une raison voisine et pire encore : il
 * n'ouvre aucun accès, et rien ne peut le faire avancer — l'activation ne part
 * que d'« en attente de paiement », un brouillon n'attestant d'aucun accord.
 * Immobile, il occuperait pourtant sa période, et le vrai contrat de ces dates
 * serait ensuite refusé pour chevauchement : l'école n'aurait plus jamais
 * d'accès sur cette année-là. Les deux statuts qui restent peuvent tous deux
 * avancer — « en attente de paiement » s'active, « actif » est déjà en
 * vigueur.
 *
 * `Exclude` sur le type du schéma, et non une liste recopiée : les quatre
 * exclus sont nommés une fois, et le menu ne peut pas proposer une valeur que
 * le schéma ignore.
 */
type AdminStatus = Exclude<
  SubscriptionStatus,
  "draft" | "past_due" | "expired" | "cancelled"
>;

const ADMIN_STATUSES: AdminStatus[] = ["pending_payment", "active"];

/** Niveaux et rôles en dur, mais TYPÉS par le schéma : une valeur inventée ne compile pas. */
const CLASS_LEVELS: ClassLevel[] = ["CI", "CP", "CE1", "CE2", "CM1", "CM2"];
const STAFF_ROLES: StaffRole[] = ["professeur", "directeur"];

const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  professeur: "Professeur",
  directeur: "Directeur",
};

/**
 * Les trois actes journalisés, dits par leur EFFET sur l'enfant.
 *
 * `Record` complet et non `Partial` : le type vient du serveur, donc un
 * quatrième acte journalisé un jour ne compilera pas tant qu'il n'aura pas
 * sa phrase ici — mieux vaut un écran qui refuse de se construire qu'un
 * registre d'audit qui affiche « transferred » à un directeur d'école.
 */
const EVENT_LABEL: Record<MembershipEventRow["kind"], string> = {
  enrolled: "Inscrit — accès ouvert",
  released: "Siège libéré — accès coupé",
  transferred: "Changement de classe — accès inchangé",
};

/**
 * Un acte daté à la MINUTE, et non au jour.
 *
 * Le reste de l'écran n'affiche pas de date ; celle-ci est la pièce d'un
 * registre d'audit, où « qui a libéré ce siège avant la réinscription » se
 * joue parfois à quelques minutes. Même forme que les autres écrans
 * d'administration (`admin/pdf-uploads`).
 */
function formatEventMoment(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Pourquoi l'inscription n'ouvrira pas l'accès, en clair.
 *
 * `Partial` et non `Record` complet : `decideAccess` connaît quatre refus de
 * plus (`not_authenticated`, `not_student`, `no_school`, `seat_released`) que
 * `getEnrollmentOutlook` ne peut pas produire — son entrée les exclut par
 * construction. Les libeller serait écrire une copie que personne ne lira. Le
 * repli couvre ceux-là et tout refus ajouté plus tard : la phrase reste vraie
 * même quand elle cesse d'être précise.
 */
const OUTLOOK_REASON: Partial<Record<OutlookReason, string>> = {
  no_subscription: "cette école n'a aucun abonnement",
  pending_payment: "l'abonnement de cette école attend son paiement",
  past_due: "l'abonnement de cette école a un impayé hors délai de grâce",
  expired: "l'abonnement de cette école est arrivé à échéance",
  cancelled: "l'abonnement de cette école est résilié",
};

const OUTLOOK_REASON_FALLBACK = "l'abonnement de cette école ne le couvre pas";

/**
 * Dit qu'une liste est TRONQUÉE, au lieu de laisser conclure à l'absence.
 *
 * Un balayage rend les documents les plus ANCIENS : les comptes qu'on vient
 * d'ouvrir pour les rattacher sont précisément ceux qui manquent. Sans cette
 * ligne, l'écran dit « aucun profil » là où la vérité est « aucun profil dans
 * ce que j'ai lu ».
 */
function PartialListNotice({ subject }: { subject: string }) {
  return (
    <p className="mt-1.5 flex gap-1.5 text-xs text-amber-700">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        Liste partielle : tous les profils n&apos;ont pas pu être parcourus.{" "}
        {subject} récemment créé peut manquer ici sans être absent de la
        plateforme.
      </span>
    </p>
  );
}

/** « 1 siège », « 40 sièges » — l'écran compte comme le serveur. */
function plural(n: number, singular: string, many: string): string {
  return `${n} ${n === 1 ? singular : many}`;
}

/**
 * Les sièges occupés, dits sans mentir.
 *
 * `atLeast` signale que le décompte du serveur a buté sur sa borne : il y a AU
 * MOINS ce nombre d'inscriptions actives, et afficher le chiffre nu serait
 * faux. C'est l'état d'une école dont le contrat est passé sous son effectif
 * déjà inscrit — le total exact n'est alors pas lu, et un chiffre inventé
 * vaudrait moins qu'un minimum vrai.
 */
function seatsUsedLabel(seats: SeatState): string {
  const counted = plural(seats.used, "siège occupé", "sièges occupés");
  return seats.atLeast ? `au moins ${counted}` : counted;
}

function seatsContractLabel(seats: SeatState): string {
  return plural(seats.purchased, "siège au contrat", "sièges au contrat");
}

// ---------------------------------------------------------------------------
// Le contrat — montants, dates, et le devis montré AVANT validation.
// ---------------------------------------------------------------------------

/** « 1 140 000 FCFA » — un montant se lit par tranches de trois chiffres. */
function formatFcfa(amount: number): string {
  return `${new Intl.NumberFormat("fr-FR").format(amount)} FCFA`;
}

/**
 * Une date de contrat — le jour suffit, une période n'a pas d'heure.
 *
 * Lue en UTC, comme elle a été écrite (`fromDayInput`) : une période saisie au
 * jour est un jour, pas un instant. Sans ce fuseau, un contrat commencé le
 * 1er septembre s'afficherait « 31 août » à l'ouest de Greenwich, et
 * l'administrateur ne reconnaîtrait pas la date qu'il vient de taper. Les
 * horodatages du journal, eux, restent en heure locale : ce sont des moments
 * (`formatEventMoment`), pas des dates.
 */
function formatDay(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("fr-FR", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Le jour d'un horodatage, au format que `<input type="date">` attend.
 *
 * UTC des deux côtés : `<input type="date">` rend « AAAA-MM-JJ », que
 * `Date.parse` lit comme minuit UTC. Passer par le fuseau local ferait
 * glisser la date d'un jour pour la moitié du globe, sur un champ où
 * l'utilisateur a tapé une date et rien d'autre.
 */
function toDayInput(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/** L'horodatage d'un « AAAA-MM-JJ », ou `null` si le champ est vide ou faux. */
function fromDayInput(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

const DAYS_IN_YEAR = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * L'occupation des sièges, AVANT que l'administrateur remplisse quoi que ce
 * soit.
 *
 * Le plafond se refuse à l'inscription (`enrollStudent`), mais un refus qui
 * n'arrive qu'après coup fait travailler pour rien : l'administrateur choisit
 * un élève, prévient peut-être sa famille, puis se fait dire non. L'état du
 * contrat se lit donc en haut de l'école, à côté de son identité, avant le
 * personnel et les classes.
 *
 * Rien tant que le verdict est inconnu, rien non plus sans abonnement : une
 * école sans contrat n'a pas de sièges à occuper, et c'est
 * `EnrollmentOutlookNotice` qui dit déjà ce que l'absence d'abonnement coûte à
 * l'élève.
 */
function SeatUsageNotice({
  outlook,
}: {
  outlook: EnrollmentOutlook | undefined;
}) {
  if (outlook === undefined || outlook === null) return null;

  const seats = outlook.seats;
  if (seats === null) return null;

  // Au-delà du contrat : le cas d'une école dont les sièges ont été réduits
  // sous son effectif. Il se distingue du simple « complet » parce qu'il ne se
  // règle pas en libérant UN siège, et parce qu'il faut dire tout de suite que
  // les enfants déjà inscrits, eux, ne perdent rien.
  if (seats.used > seats.purchased) {
    return (
      <div className="mb-6 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 shadow-sm">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
        <div className="text-sm text-red-800">
          <p className="font-semibold">
            Contrat dépassé : {seatsUsedLabel(seats)} pour{" "}
            {seatsContractLabel(seats)}.
          </p>
          <p className="mt-1">
            Les élèves déjà inscrits gardent leur accès — aucun enfant ne perd
            l&apos;application parce qu&apos;un autre a été inscrit. En
            revanche, aucune inscription nouvelle ne sera acceptée : libérez des
            sièges, ou augmentez le nombre de sièges de l&apos;abonnement.
          </p>
        </div>
      </div>
    );
  }

  if (seats.full) {
    return (
      <div className="mb-6 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div className="text-sm text-amber-800">
          <p className="font-semibold">
            École au complet : {seatsUsedLabel(seats)} pour{" "}
            {seatsContractLabel(seats)}.
          </p>
          <p className="mt-1">
            Aucune inscription nouvelle ne sera acceptée. Libérez le siège
            d&apos;un élève déjà inscrit, ou augmentez le nombre de sièges de
            l&apos;abonnement.
          </p>
        </div>
      </div>
    );
  }

  // Le solde n'est exact que si le décompte l'est : « au plus » sinon, pour la
  // même raison que `seatsUsedLabel`.
  const free = plural(
    seats.purchased - seats.used,
    "siège encore libre",
    "sièges encore libres",
  );

  return (
    <div className="mb-6 flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <Users className="h-5 w-5 shrink-0 text-gray-400" />
      <p className="text-sm text-gray-600">
        <span className="font-medium text-gray-900">
          {seatsUsedLabel(seats)}
        </span>{" "}
        pour {seatsContractLabel(seats)} — {seats.atLeast ? "au plus " : ""}
        {free}.
      </p>
    </div>
  );
}

/** Le statut d'un contrat se voit avant de se lire : couleur d'abord. */
const STATUS_BADGE: Record<SubscriptionStatus, string> = {
  draft: "bg-gray-100 text-gray-700",
  pending_payment: "bg-amber-100 text-amber-800",
  active: "bg-emerald-100 text-emerald-800",
  past_due: "bg-red-100 text-red-800",
  expired: "bg-gray-100 text-gray-600",
  cancelled: "bg-red-100 text-red-800",
};

/**
 * Le contrat de l'école : ce qu'il couvre aujourd'hui, et comment en poser un.
 *
 * Placé tout en haut, sous l'occupation des sièges et AVANT le personnel : le
 * contrat est ce qui décide si les élèves de cette école ont l'application.
 * Sans lui, tout le reste de l'écran organise des inscriptions qui ouvriront un
 * paywall.
 *
 * Le total est visible AVANT validation — un administrateur qui enregistre un
 * contrat doit voir le montant qu'il engage. Il est calculé par le même module
 * pur que le serveur (`convex/pricing.ts`), ce qui est la seule façon que
 * l'écran ne puisse pas annoncer un prix que la mutation contredira. C'est un
 * aperçu, pas un engagement : le prix n'est pas un argument de
 * `recordSubscription`, qui refait le calcul pour son propre compte.
 */
function SubscriptionSection({
  schoolId,
  outlook,
}: {
  schoolId: Doc<"schools">["_id"];
  outlook: EnrollmentOutlook | undefined;
}) {
  const recordSubscription = useMutation(api.schools.recordSubscription);

  const [seats, setSeats] = useState("");
  // UN SEUL appel à l'horloge pour toute la section, en initialiseur
  // PARESSEUX : `Date.now()` est impur, et l'appeler dans le corps du rendu
  // ferait glisser la valeur à chaque re-rendu. Passé en fonction, il n'est
  // évalué qu'au premier montage — ce que les dates par défaut demandent,
  // justement : elles sont un point de départ, que l'administrateur corrige
  // ensuite sans qu'un rendu les lui reprenne. Cet instant sert aussi de base
  // au prorata de l'avenant, qui doit rester STABLE tant qu'on saisit : un
  // montant qui bouge tout seul sous le curseur ne s'engage pas.
  //
  // `today` sert de point de comparaison : au format « AAAA-MM-JJ », l'ordre
  // alphabétique EST l'ordre chronologique, et comparer deux chaînes évite de
  // rappeler l'horloge au milieu d'un rendu.
  const [now] = useState(() => Date.now());
  const today = toDayInput(now);
  const [startsAt, setStartsAt] = useState(today);
  const [endsAt, setEndsAt] = useState(() =>
    toDayInput(now + DAYS_IN_YEAR * DAY_MS),
  );
  // « En attente de paiement » par défaut, et non « actif » : un contrat vient
  // d'être convenu, il n'est pas encaissé. Le défaut le moins coûteux est
  // celui qui n'ouvre pas un accès qu'on n'a pas vendu.
  const [status, setStatus] = useState<AdminStatus>("pending_payment");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolved = outlook === undefined ? null : outlook;
  const contract: ContractSummary | null = resolved?.contract ?? null;
  const seatState = resolved?.seats ?? null;
  // Le contrat que la mutation amendera, désigné par le serveur : l'écran ne
  // le choisit pas, il le reçoit. Voir `SeatAmendmentForm`.
  const amendable: AmendableContract | null = resolved?.amendable ?? null;

  // Un entier strictement positif, ou rien : les mêmes conditions que la
  // mutation, pour que l'aperçu se taise exactement là où elle refuserait.
  const asked = Number(seats);
  const askedSeats = Number.isInteger(asked) && asked > 0 ? asked : null;
  const quote = askedSeats === null ? null : quoteSubscription(askedSeats);

  // Les refus que le serveur opposera, annoncés ici plutôt que subis après
  // coup — même raison que `SeatsFullNotice` pour l'inscription. Le verrou
  // reste côté mutation ; ceci n'est que la politesse de le dire avant.
  const wouldOverflow =
    seatState !== null && quote !== null && seatState.used > quote.seatsBilled;

  // Un contrat ne se déclare pas en vigueur avant d'avoir commencé : le
  // paywall ne juge que la date de FIN, et « actif » daté de demain ouvrirait
  // l'accès aujourd'hui.
  const activeBeforeStart = status === "active" && startsAt > today;

  const handleRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    const start = fromDayInput(startsAt);
    const end = fromDayInput(endsAt);
    if (askedSeats === null) {
      setError("Le nombre de sièges doit être un entier strictement positif");
      return;
    }
    if (start === null || end === null) {
      setError("Renseignez le début et la fin du contrat");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await recordSubscription({
        schoolId,
        seatsPurchased: askedSeats,
        startsAt: start,
        endsAt: end,
        status,
      });
      setSeats("");
    } catch (err) {
      setError(refusalMessage(err, "Erreur lors de l'enregistrement du contrat"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center gap-2">
        <Receipt className="h-5 w-5 text-gray-400" />
        <h2 className="text-lg font-semibold text-gray-900">Contrat</h2>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {outlook === undefined ? (
        <div className="mb-4 flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement du contrat...
        </div>
      ) : contract === null ? (
        <div className="mb-4 rounded-xl border-2 border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
          Aucun contrat enregistré. Les élèves inscrits dans cette école voient
          le paywall : leur accès n&apos;ouvrira qu&apos;avec un contrat actif
          couvrant la date du jour.
        </div>
      ) : (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium text-gray-900">
                Du {formatDay(contract.startsAt)} au{" "}
                {formatDay(contract.endsAt)}
              </p>
              {/* « pour l'année » serait inexact dès le premier avenant : le
                  total mêle alors des sièges payés sur toute la période et
                  d'autres au prorata de ce qu'il en reste. Et la période
                  elle-même se saisit — rien n'oblige une année. */}
              <p className="mt-1 text-sm text-gray-500">
                {seatState !== null && `${seatsContractLabel(seatState)} · `}
                {formatFcfa(contract.totalFcfa)} au total sur la période
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_BADGE[contract.status]}`}
            >
              {SUBSCRIPTION_STATUS_LABEL[contract.status]}
            </span>
          </div>

          <p className="mt-2 text-xs text-gray-400">
            Soit {formatFcfa(contract.pricePerSeatFcfa)} par siège en moyenne —
            valeur d&apos;affichage : c&apos;est le total qui fait foi. Un
            avenant en fait une moyenne MIXTE : les sièges ajoutés en cours de
            période n&apos;ont été facturés que pour ce qu&apos;il en restait.
          </p>

          {resolved !== null && (
            <p
              className={`mt-3 text-xs ${
                resolved.opensAccess ? "text-emerald-700" : "text-amber-800"
              }`}
            >
              {resolved.opensAccess
                ? "Aujourd'hui, ce contrat ouvre l'accès des élèves inscrits."
                : `Aujourd'hui, ce contrat n'ouvre pas l'accès : ${
                    resolved.reason
                      ? (OUTLOOK_REASON[resolved.reason] ??
                        OUTLOOK_REASON_FALLBACK)
                      : OUTLOOK_REASON_FALLBACK
                  }.`}
            </p>
          )}

          {/* Le SERVEUR dit si ce contrat peut être activé — même fonction que
              la mutation, même instant, même document. L'écran ne refait pas ce
              calcul : l'horloge du navigateur est figée au montage et ferait
              apparaître le bouton un jour trop tôt, ou manquer un jour de
              trop. */}
          {contract.canActivate && (
            <ContractActivation schoolId={schoolId} contract={contract} />
          )}
        </div>
      )}

      {/* Le journal suit la FICHE ci-dessus, et il est placé contre elle : ce
          sont les avenants du contrat que le paywall retient, pas ceux du
          contrat visé par le formulaire quand les deux diffèrent. */}
      {contract !== null && <SeatAmendmentHistory schoolId={schoolId} />}

      {/* L'avenant s'offre dès que le SERVEUR a un contrat à amender : celui
          en vigueur, ou à défaut le prochain à commencer. L'écran ne refait
          pas ce choix — il le reçoit, avec les sièges, le total et les dates
          du contrat visé, pour que le montant affiché soit celui que la
          mutation facturera. Rien à amender, rien à proposer : l'école n'a
          alors ni contrat en cours ni contrat signé pour la suite, et c'est un
          contrat NEUF qu'il lui faut — le formulaire du dessous est là pour
          ça, et `recordSubscription` l'acceptera, puisque plus rien ne
          chevauche. */}
      {amendable !== null && (
        <SeatAmendmentForm schoolId={schoolId} contract={amendable} now={now} />
      )}

      {activeBeforeStart && (
        <div className="mb-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            L&apos;enregistrement sera REFUSÉ : un contrat ne se déclare pas
            actif avant d&apos;avoir commencé. Le paywall ne juge que la date de
            fin — marqué actif dès aujourd&apos;hui, ce contrat ouvrirait
            l&apos;accès pour une année qui n&apos;a pas commencé.
            Enregistrez-le en attente de paiement : sa période est retenue dès
            maintenant, et le {formatDay(fromDayInput(startsAt) ?? now)} le
            bouton « Activer ce contrat » apparaîtra sur cette fiche. C&apos;est
            lui qui ouvrira l&apos;accès, le jour où le contrat commence et pas
            avant.
          </span>
        </div>
      )}

      {wouldOverflow && seatState !== null && quote !== null && (
        <div className="mb-3 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            L&apos;enregistrement sera REFUSÉ : cette école compte{" "}
            {seatsUsedLabel(seatState)}, soit plus que les{" "}
            {plural(quote.seatsBilled, "siège", "sièges")} de ce contrat.
            Libérez d&apos;abord le siège des élèves en trop, ou enregistrez le
            contrat au nombre de sièges réel.
          </span>
        </div>
      )}

      <form
        onSubmit={handleRecord}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
      >
        <div className="w-32">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Sièges
          </label>
          <input
            type="number"
            min={1}
            step={1}
            value={seats}
            onChange={(e) => setSeats(e.target.value)}
            required
            placeholder="ex: 120"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Début
          </label>
          <input
            type="date"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            required
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Fin
          </label>
          <input
            type="date"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            required
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Statut
          </label>
          <select
            value={status}
            onChange={(e) => {
              const next = ADMIN_STATUSES.find((item) => item === e.target.value);
              if (next) setStatus(next);
            }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          >
            {ADMIN_STATUSES.map((item) => (
              <option key={item} value={item}>
                {SUBSCRIPTION_STATUS_LABEL[item]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={isSubmitting || quote === null}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Enregistrer le contrat
        </button>

        <div className="w-full border-t border-gray-100 pt-3">
          {quote === null ? (
            <p className="text-xs text-gray-500">
              Le montant s&apos;affichera ici : le tarif est dégressif par
              tranches, et chaque tranche ne facture que ses propres sièges.
            </p>
          ) : (
            <div className="text-sm text-gray-700">
              <p>
                <span className="font-semibold text-gray-900">
                  {formatFcfa(quote.totalFcfa)}
                </span>{" "}
                pour l&apos;année, soit{" "}
                {formatFcfa(quote.pricePerSeatFcfa)} par siège en moyenne.
              </p>
              {quote.seatsBilled !== askedSeats && (
                <p className="mt-1 text-xs text-amber-800">
                  Plancher de facturation :{" "}
                  {plural(PRICING_SCALE.seatFloor, "siège", "sièges")} au
                  minimum. Ce contrat sera enregistré à {quote.seatsBilled}{" "}
                  sièges — et l&apos;école en recevra {quote.seatsBilled}.
                </p>
              )}
              <p className="mt-1 text-xs text-gray-400">
                Montant calculé, non facturé : cet écran n&apos;encaisse rien et
                ne produit aucune tranche.
              </p>
            </div>
          )}
        </div>
      </form>

      <p className="mt-2 text-xs text-gray-400">
        Un renouvellement s&apos;enregistre comme un contrat NEUF, dont la
        période doit commencer à la fin du précédent, ou après — une école
        n&apos;a qu&apos;un contrat en vigueur à la fois, faute de quoi ni son
        accès ni son nombre de sièges ne seraient décidables. Tant que le
        nouveau n&apos;a pas commencé, c&apos;est l&apos;ancien qui décide de
        l&apos;accès des élèves ; le jour où il commence, il faut
        l&apos;ACTIVER, et le bouton apparaît alors sur cette fiche. Pour
        agrandir l&apos;école, c&apos;est
        l&apos;avenant ci-dessus : il ajoute des sièges au contrat en vigueur —
        ou, si aucun ne court, au prochain à commencer — sans jamais en
        déplacer les dates, et chaque ajout reste lisible dans son journal.
      </p>
    </section>
  );
}

/**
 * ACTIVER le contrat — le geste qui ouvre l'accès de toute l'école.
 *
 * NE S'AFFICHE QUE SUR DÉCISION DU SERVEUR (`contract.canActivate`), jamais
 * sur une comparaison de dates faite ici : `getEnrollmentOutlook` exécute la
 * règle même qu'exécutera la mutation, sur le même document et le même
 * instant. Un bouton calculé sur l'horloge du navigateur — figée au montage de
 * l'écran — apparaîtrait un jour trop tôt ou manquerait un jour de trop, sur
 * le seul geste qui ouvre l'accès d'une école.
 *
 * DIT CE QU'IL FAIT, ET QU'IL EST SANS RETOUR. Ce n'est pas une formalité
 * administrative : au clic, tous les élèves inscrits de cette école obtiennent
 * l'application, jusqu'à la fin du contrat. Et rien ne DÉSACTIVE un contrat —
 * aucune mutation ne fait redescendre un statut. Couper une école est une
 * décision commerciale, avec la question du montant déjà facturé, et elle
 * appartient à la facturation. Un administrateur doit le savoir avant de
 * cliquer, pas après.
 *
 * PAS DE VOLET DE CONFIRMATION EN DEUX TEMPS, à la différence de la libération
 * d'un siège : celle-ci se déclenche depuis une ligne d'élève compacte, où
 * l'avertissement n'a pas la place de tenir, d'où le volet qui l'ouvre. Ici
 * l'avertissement EST le bloc, et le bouton se trouve dessous — la conséquence
 * se lit juste au-dessus du clic, ce que le volet de la libération cherche
 * précisément à obtenir.
 *
 * Aucun aperçu à calculer ici, à la différence de l'avenant : l'activation
 * n'engage pas un franc de plus. Le contrat est déjà signé, son total est déjà
 * celui qu'il est ; ce bouton ne fait qu'ouvrir ce qui a été vendu.
 */
function ContractActivation({
  schoolId,
  contract,
}: {
  schoolId: Doc<"schools">["_id"];
  contract: ContractSummary;
}) {
  const activateSubscription = useMutation(api.schools.activateSubscription);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pas d'état « activé » à conserver : le verdict est réactif, donc la carte
  // repasse d'elle-même en « Actif » et ce bloc disparaît. Une bannière de
  // succès survivrait à l'acte qu'elle annonce.
  const handleActivate = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      await activateSubscription({ schoolId });
    } catch (err) {
      setError(refusalMessage(err, "Erreur lors de l'activation du contrat"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-2 text-xs text-amber-900">
        <Unlock className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Ce contrat a commencé et attend d&apos;être activé : les élèves
          inscrits n&apos;ont pas encore l&apos;accès. L&apos;activer{" "}
          <strong>
            ouvre immédiatement l&apos;application à TOUS les élèves inscrits de
            cette école
          </strong>
          , jusqu&apos;au {formatDay(contract.endsAt)}.
          <strong className="mt-1 block">
            Le geste est SANS RETOUR : rien ne sait désactiver un contrat.
            N&apos;activez qu&apos;une fois l&apos;accord confirmé.
          </strong>
        </span>
      </div>

      <button
        type="button"
        onClick={handleActivate}
        disabled={isSubmitting}
        className="mt-3 inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
      >
        {isSubmitting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Unlock className="h-4 w-4" />
        )}
        Activer ce contrat
      </button>
    </div>
  );
}

/**
 * L'AVENANT — ajouter des sièges au contrat VISÉ, montant visible AVANT
 * validation.
 *
 * Un administrateur doit voir ce qu&apos;il engage : le montant est proratisé
 * sur la période qui reste à courir, et il n&apos;y a aucune raison de le lui
 * apprendre après coup. Il est calculé par le même module PUR que le serveur
 * (`convex/pricing.ts`), la seule façon que l&apos;écran ne puisse pas
 * annoncer un prix que la mutation contredira. C&apos;est un aperçu, pas un
 * engagement : le prix n&apos;est pas un argument d&apos;`amendSeats`, qui
 * refait le calcul pour son propre compte, sur sa propre horloge — l&apos;écart
 * de quelques minutes entre les deux ne déplace pas un franc à cette échelle.
 *
 * LE CONTRAT VIENT DU SERVEUR, et c&apos;est tout l&apos;enjeu. Ce formulaire
 * ne choisit rien : il montre le contrat que `getEnrollmentOutlook` désigne
 * comme amendable, celui-là même que `schools.amendSeats` amendera. Ce
 * n&apos;est PAS toujours le contrat de la fiche au-dessus — quand celui du
 * paywall est échu et qu&apos;un contrat à venir est déjà signé, la fiche
 * montre l&apos;échu, qui explique le paywall des élèves, pendant que
 * l&apos;avenant porte sur le suivant. Calculer l&apos;aperçu sur les chiffres
 * de la fiche ferait valider un montant qui n&apos;est pas celui de la
 * facture : un aperçu trompeur, pire que le message trompeur qu&apos;il
 * remplace.
 *
 * LES SIÈGES VIENNENT DU CONTRAT VISÉ (`contract.seatsPurchased`) et non de
 * `SeatState.purchased`, qui compte ceux du contrat du PAYWALL : les deux
 * coïncident tant qu&apos;un contrat court, et divergent précisément dans le
 * cas que ce formulaire existe désormais pour servir.
 *
 * Ne s&apos;affiche que si le serveur a désigné un contrat — voir l&apos;appel.
 */
function SeatAmendmentForm({
  schoolId,
  contract,
  now,
}: {
  schoolId: Doc<"schools">["_id"];
  contract: AmendableContract;
  now: number;
}) {
  const amendSeats = useMutation(api.schools.amendSeats);

  const [target, setTarget] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Les mêmes conditions que la mutation, pour que l'aperçu se taise
  // exactement là où elle refuserait.
  const asked = Number(target);
  const askedSeats = Number.isInteger(asked) && asked > 0 ? asked : null;

  // Les MÊMES entrées que la mutation, champ pour champ : les sièges, le total
  // et les dates du contrat VISÉ, et rien qui vienne d'ailleurs.
  const amendment =
    askedSeats === null
      ? null
      : quoteSeatAmendment({
          currentSeats: contract.seatsPurchased,
          currentTotalFcfa: contract.totalFcfa,
          newSeats: askedSeats,
          now,
          startsAt: contract.startsAt,
          endsAt: contract.endsAt,
        });

  const adds = amendment !== null && amendment.seatsAdded > 0;

  const handleAmend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (askedSeats === null) {
      setError("Le nombre de sièges doit être un entier strictement positif");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    setDone(null);
    try {
      const result = await amendSeats({
        schoolId,
        seatsPurchased: askedSeats,
      });
      setDone(
        `${plural(result.seatsAdded, "siège ajouté", "sièges ajoutés")} — ` +
          `${formatFcfa(result.amountFcfa)} au prorata, soit ` +
          `${formatFcfa(result.totalFcfa)} au total sur la période.`,
      );
      setTarget("");
    } catch (err) {
      setError(refusalMessage(err, "Erreur lors de l'avenant"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleAmend}
      className="mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
    >
      <div className="mb-1 flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-gray-400" />
        <h3 className="text-sm font-semibold text-gray-900">
          Agrandir ce contrat
        </h3>
      </div>
      <p className="mb-3 text-xs text-gray-500">
        L&apos;école recrute ? Ajoutez des sièges au contrat lui-même — ses
        dates ne bougent pas, et vous ne payez que la période qui reste à
        courir. Un second contrat sur la même période rendrait l&apos;accès des
        élèves indécidable : c&apos;est pourquoi il n&apos;y en a qu&apos;un.
      </p>

      {/* Le contrat visé n'a pas commencé : l'avenant l'agrandit quand même —
          c'est lui qui décidera — mais il n'ouvre AUCUNE place aujourd'hui,
          puisque le plafond d'inscription lit le contrat du paywall. Ne pas le
          dire laisserait attendre des sièges le jour même. */}
      {!contract.hasStarted && (
        <div className="mb-3 flex gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Ce contrat n&apos;a pas encore commencé : il court du{" "}
            {formatDay(contract.startsAt)} au {formatDay(contract.endsAt)}, et
            c&apos;est LUI que l&apos;avenant agrandira. Aucune place ne se
            libère dès maintenant : le plafond d&apos;inscription lit le contrat
            qui décide de l&apos;accès aujourd&apos;hui, donc le précédent tant
            que celui-ci n&apos;a pas démarré. La période étant tout entière
            devant, ces sièges se facturent au PLEIN tarif, sans prorata.
            <strong className="mt-1 block">
              Et ils n&apos;ouvriront pas d&apos;eux-mêmes le{" "}
              {formatDay(contract.startsAt)}
              {contract.status === "pending_payment"
                ? " : ce contrat devra être ACTIVÉ ce jour-là, par le bouton qui apparaîtra alors sur cette fiche. Sans ce geste, il reste une réservation sans accès."
                : " : ce contrat n'est pas « en attente de paiement », et l'activation ne part que de ce statut. En l'état, rien ne pourra lui ouvrir l'accès."}
            </strong>
          </span>
        </div>
      )}

      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {done && (
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {done}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44">
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Nouveau total de sièges
          </label>
          <input
            type="number"
            min={contract.seatsPurchased + 1}
            step={1}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            required
            placeholder={`plus de ${contract.seatsPurchased}`}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={isSubmitting || !adds}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
        >
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Ajouter les sièges
        </button>
      </div>

      <div className="mt-3 border-t border-gray-100 pt-3">
        {amendment === null ? (
          <p className="text-xs text-gray-500">
            Ce contrat ouvre{" "}
            {plural(contract.seatsPurchased, "siège", "sièges")}. Saisissez le
            nouveau TOTAL visé — pas le nombre à ajouter — et le montant au
            prorata s&apos;affichera ici.
          </p>
        ) : !adds ? (
          // Le refus que le serveur opposera, annoncé ici plutôt que subi
          // après coup — même raison que `SeatsFullNotice` pour l'inscription.
          <p className="flex gap-2 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              L&apos;avenant sera REFUSÉ : ce contrat ouvre déjà{" "}
              {plural(contract.seatsPurchased, "siège", "sièges")}, et un
              avenant ne fait qu&apos;en AJOUTER. Réduire en cours de période
              pose la question du remboursement, qui appartient à la
              facturation : libérez le siège des élèves concernés, ou
              enregistrez un contrat au nombre voulu à la fin de celui-ci.
            </span>
          </p>
        ) : (
          <div className="text-sm text-gray-700">
            <p>
              <span className="font-semibold text-gray-900">
                {formatFcfa(amendment.amountFcfa)}
              </span>{" "}
              pour {plural(amendment.seatsAdded, "siège ajouté", "sièges ajoutés")}{" "}
              — {contract.seatsPurchased} → {amendment.seatsBilled} sièges.
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Prorata : {Math.round(amendment.remainingShare * 100)} % de la
              période reste à courir, jusqu&apos;au{" "}
              {formatDay(contract.endsAt)}. Sur une période entière, ces sièges
              coûteraient {formatFcfa(amendment.fullTermDeltaFcfa)}.
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Le contrat passera à{" "}
              <span className="font-medium text-gray-700">
                {formatFcfa(amendment.totalFcfa)}
              </span>{" "}
              au total sur la période.
            </p>
            {amendment.seatsBilled !== askedSeats && (
              <p className="mt-1 text-xs text-amber-800">
                Plancher de facturation :{" "}
                {plural(PRICING_SCALE.seatFloor, "siège", "sièges")} au minimum.
                Ce contrat ouvrira {amendment.seatsBilled} sièges.
              </p>
            )}
            <p className="mt-1 text-xs text-gray-400">
              Montant calculé, non facturé : cet écran n&apos;encaisse rien et
              ne produit aucune tranche. Les dates et le statut du contrat ne
              changent pas.
            </p>
          </div>
        )}
      </div>
    </form>
  );
}

/**
 * Le journal des avenants du contrat que la FICHE affiche.
 *
 * Un avenant MODIFIE la ligne du contrat : `seatsPurchased` et `totalFcfa` y
 * sont écrasés. Sans ce journal, plus rien ne dirait ce qui avait été signé,
 * ni qui a engagé l&apos;école pour ce montant — c&apos;est la même raison qui
 * fait exister le journal d&apos;inscription d&apos;un élève.
 *
 * Le contrat retenu est celui du paywall (`listSeatAmendments`), donc celui de
 * l&apos;encart juste au-dessus, et non celui du formulaire d&apos;avenant
 * quand les deux diffèrent : c&apos;est pourquoi il se place ici, contre la
 * fiche. Un journal qui sauterait d&apos;un contrat à l&apos;autre sous un
 * encart qui n&apos;en nomme qu&apos;un se lirait de travers. Les avenants
 * d&apos;un contrat à venir ne se perdent pas — ils s&apos;affichent dès
 * qu&apos;il commence — et le formulaire montre déjà, lui, les sièges et le
 * total du contrat qu&apos;il vise.
 *
 * Rien à afficher, rien d&apos;affiché : une école sans avenant ne porte pas
 * un encart vide. Les noms sont déjà résolus par le serveur.
 */
function SeatAmendmentHistory({
  schoolId,
}: {
  schoolId: Doc<"schools">["_id"];
}) {
  const amendments = useQuery(api.schools.listSeatAmendments, { schoolId });
  if (amendments === undefined || amendments.length === 0) return null;

  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <History className="h-4 w-4 text-gray-400" />
        <h3 className="text-sm font-semibold text-gray-900">
          Avenants de ce contrat
        </h3>
      </div>
      <ul className="space-y-1.5">
        {amendments.map((row: SeatAmendmentRow) => (
          <li key={row._id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
            <span className="font-medium text-gray-900">
              {row.seatsBefore} → {row.seatsAfter} sièges
            </span>
            <span className="text-gray-700">
              + {formatFcfa(row.amountFcfa)}
            </span>
            <span className="text-gray-400">
              {formatEventMoment(row.at)} · {row.actorName}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-gray-400">
        Les dates du contrat n&apos;ont pas bougé : un avenant n&apos;ajoute que
        des sièges, et le montant au prorata de ce qu&apos;il restait à courir.
      </p>
    </div>
  );
}

/**
 * Le refus à venir, là où l'inscription se décide.
 *
 * L'encart du haut donne les chiffres pour toute l'école ; celui-ci se tient
 * contre le formulaire, parce qu'une école peut avoir dix classes et que
 * l'administrateur qui en a déroulé la page ne voit plus le haut. Il dit ce
 * que le serveur répondra, dans les mêmes termes que son message de refus.
 */
function SeatsFullNotice({ seats }: { seats: SeatState }) {
  return (
    <div className="mb-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        L&apos;inscription sera REFUSÉE : cette école a atteint son plafond de
        sièges, {seatsUsedLabel(seats)} pour {seatsContractLabel(seats)}.
        Libérez le siège d&apos;un élève déjà inscrit, ou augmentez le nombre de
        sièges de l&apos;abonnement.
      </span>
    </div>
  );
}

/**
 * Ce que l'inscription ouvre — ou n'ouvre pas — dans cette école.
 *
 * L'inscription est NÉCESSAIRE à l'accès, jamais suffisante : `decideAccess`
 * juge ensuite l'abonnement de l'école. Le verdict affiché ici est exactement
 * celui que le paywall rendra, puisque `getEnrollmentOutlook` appelle cette
 * fonction-là — l'écran ne peut donc pas promettre ce que le paywall refusera.
 *
 * Rien tant que le verdict est inconnu : le silence vaut mieux qu'une promesse
 * par défaut.
 */
function EnrollmentOutlookNotice({
  outlook,
  seatsFull,
}: {
  outlook: EnrollmentOutlook | undefined;
  seatsFull: boolean;
}) {
  if (outlook === undefined || outlook === null) return null;

  if (outlook.opensAccess) {
    // Une école pleine n'inscrira personne : promettre l'accès qui suivrait
    // l'inscription serait promettre ce qui n'aura pas lieu, l'écart même que
    // cet encart existe pour fermer. `SeatsFullNotice`, au-dessus du
    // formulaire, dit alors ce qui se passera vraiment. Le REFUS, lui, reste
    // affiché dans les deux cas : un abonnement impayé et un plafond atteint
    // sont deux problèmes distincts, et l'administrateur doit les connaître
    // tous les deux.
    if (seatsFull) return null;
    return (
      <p className="mt-2 text-xs text-emerald-700">
        L&apos;abonnement de cette école couvre l&apos;élève : son accès à
        l&apos;application s&apos;ouvre dès l&apos;inscription.
      </p>
    );
  }

  const why = outlook.reason
    ? (OUTLOOK_REASON[outlook.reason] ?? OUTLOOK_REASON_FALLBACK)
    : OUTLOOK_REASON_FALLBACK;

  return (
    <p className="mt-2 flex gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        L&apos;inscription n&apos;ouvrira PAS l&apos;accès : {why}.
        L&apos;élève sera bien rattaché à cette école, mais il verra le paywall
        tant que l&apos;abonnement n&apos;est pas en règle. Ne prévenez pas
        encore la famille.
      </span>
    </p>
  );
}

export default function SchoolDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  // `getSchool` prend une chaîne et la valide côté serveur (`normalizeId`) :
  // le segment d'URL n'est pas un identifiant tant qu'il n'a pas été vérifié.
  const school = useQuery(api.schools.getSchool, { schoolId: id });

  if (school === undefined) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <span className="ml-3 text-gray-500">Chargement de l&apos;école...</span>
      </div>
    );
  }

  if (school === null) {
    return (
      <div className="py-20 text-center">
        <h2 className="text-xl font-semibold text-gray-900">École introuvable</h2>
        <Link
          href="/admin/ecoles"
          className="mt-4 inline-flex items-center gap-2 text-indigo-600 hover:text-indigo-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour aux écoles
        </Link>
      </div>
    );
  }

  return <SchoolDetail school={school} />;
}

function SchoolDetail({ school }: { school: Doc<"schools"> }) {
  const staff = useQuery(api.schools.listStaff, { schoolId: school._id });
  const candidates = useQuery(api.schools.listStaffCandidates, {
    schoolId: school._id,
  });
  const classes = useQuery(api.schools.listClasses, { schoolId: school._id });
  const enrollable = useQuery(api.schools.listEnrollableStudents);
  // Le verdict porte sur l'ÉCOLE, pas sur la classe : une seule souscription
  // ici, descendue aux cartes, plutôt qu'une par carte affichée.
  const outlook = useQuery(api.schools.getEnrollmentOutlook, {
    schoolId: school._id,
  });

  return (
    <div>
      <Link
        href="/admin/ecoles"
        className="mb-6 inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Retour aux écoles
      </Link>

      <div className="mb-8 flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
          <School className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{school.name}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {[school.city, school.contactName, school.contactEmail, school.contactPhone]
              .filter((part) => part)
              .join(" · ")}
          </p>
        </div>
      </div>

      <SeatUsageNotice outlook={outlook} />

      <SubscriptionSection schoolId={school._id} outlook={outlook} />

      <BillingSection schoolId={school._id} />

      <ModulesSection schoolId={school._id} />

      <StaffSection
        schoolId={school._id}
        staff={staff}
        candidates={candidates}
      />

      <ClassesSection
        schoolId={school._id}
        classes={classes}
        teachers={(staff ?? []).filter((row) => row.staffRole === "professeur")}
        enrollable={enrollable}
        outlook={outlook}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ENCAISSEMENT — l'échéancier du contrat, et le bouton qui ouvre une facture.
//
// SOUS LE CONTRAT, ET PAS AILLEURS : ce qu'une école doit se lit contre ce
// qu'elle a signé. Les deux portent sur le MÊME contrat — `billing.getSchedule`
// passe par `currentSchoolSubscription`, la même sélection que le paywall, le
// plafond de sièges et la fiche du dessus.
// ---------------------------------------------------------------------------

/** Les quatre états d'une tranche, dits en français. */
const INSTALLMENT_STATUS_LABEL: Record<ScheduleRow["status"], string> = {
  pending: "À payer",
  paid: "Réglée",
  overdue: "En retard",
  failed: "Échec",
};

const INSTALLMENT_STATUS_STYLE: Record<ScheduleRow["status"], string> = {
  pending: "bg-gray-100 text-gray-700",
  paid: "bg-green-100 text-green-800",
  overdue: "bg-red-100 text-red-800",
  failed: "bg-amber-100 text-amber-800",
};

/**
 * D'où vient l'argent — `Record` complet, pas `Partial` : un prestataire ajouté
 * au schéma ne compilera pas tant qu'il n'aura pas son nom ici, et mieux vaut un
 * écran qui refuse de se construire qu'une ligne de paiement anonyme.
 *
 * L'historique garde le prestataire de chaque versement : une école qui a payé
 * chez PayDunya avant la bascule continue de le lire, et c'est ce qui permet de
 * rapprocher une ligne d'un relevé.
 */
const PAYMENT_PROVIDER_LABEL: Record<PaymentRow["provider"], string> = {
  paydunya: "PayDunya",
  bictorys: "Bictorys",
  manual: "constaté",
};

/** Les quatre états d'un paiement, dits en français. */
const PAYMENT_STATUS_LABEL: Record<PaymentRow["status"], string> = {
  initiated: "Facture ouverte",
  completed: "Encaissé",
  failed: "Échoué",
  cancelled: "Annulé",
};

/**
 * L'échéancier, et le paiement d'une tranche.
 *
 * LE MONTANT N'EST PAS UN ARGUMENT. Le bouton n'envoie que l'identifiant de la
 * tranche : le serveur relit le montant dû et l'envoie lui-même à PayDunya. Une
 * facture dont le prix viendrait du navigateur serait une facture que n'importe
 * qui pourrait ramener à cent francs — c'est la même règle que pour le prix
 * d'un contrat, et elle pèse plus lourd ici, la somme partant chez un tiers.
 *
 * L'URL S'AFFICHE, ELLE NE S'OUVRE PAS TOUTE SEULE. Une fenêtre ouverte depuis
 * une réponse asynchrone est bloquée par la plupart des navigateurs, et le
 * directeur croirait que le bouton ne marche pas. Un lien qu'il clique lui-même
 * s'ouvre toujours — et il voit le montant avant de quitter la page.
 *
 * ELLE NE DIT JAMAIS « c'est payé » d'elle-même : l'accès s'ouvre par le
 * webhook, pas par le retour du navigateur. La liste est réactive, donc la
 * tranche passe à « Réglée » quand PayDunya nous l'a confirmé, et pas avant.
 */
function BillingSection({ schoolId }: { schoolId: Doc<"schools">["_id"] }) {
  const schedule = useQuery(api.billing.getSchedule, { schoolId });
  // Une seule fonction, quel que soit le prestataire : c'est le déploiement qui
  // choisit (`billing.openPayment`), pas l'écran. Basculer de PayDunya à
  // Bictorys ne touche donc pas une ligne d'interface.
  const openInvoice = useAction(api.billing.openPayment);
  const settleOffline = useMutation(api.billing.settleInstallmentOffline);

  const [pendingId, setPendingId] = useState<Id<"installments"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<{
    installmentId: Id<"installments">;
    url: string;
  } | null>(null);
  // La tranche dont le règlement hors ligne attend confirmation. Constater est
  // SANS RETOUR — rien ne défait un règlement déclaré à tort — donc le geste ne
  // tient pas en un seul clic.
  const [confirmingId, setConfirmingId] = useState<Id<"installments"> | null>(
    null,
  );

  // `undefined` = en cours de chargement, `null` = aucun contrat à facturer.
  // Le second cas n'a rien à dire : la section du dessus annonce déjà qu'il n'y
  // a pas de contrat, et un second encart vide ne ferait que répéter.
  if (schedule === undefined || schedule === null) return null;

  const handlePay = async (installmentId: Id<"installments">) => {
    setPendingId(installmentId);
    setError(null);
    setInvoice(null);
    try {
      const { paymentUrl } = await openInvoice({ installmentId });
      setInvoice({ installmentId, url: paymentUrl });
    } catch (err) {
      setError(
        refusalMessage(err, "Erreur lors de l'ouverture de la facture"),
      );
    } finally {
      setPendingId(null);
    }
  };

  const handleSettle = async (installmentId: Id<"installments">) => {
    setPendingId(installmentId);
    setError(null);
    try {
      await settleOffline({ installmentId });
      setConfirmingId(null);
    } catch (err) {
      setError(refusalMessage(err, "Erreur lors du constat de règlement"));
    } finally {
      setPendingId(null);
    }
  };

  const unscheduled = schedule.totalFcfa - schedule.scheduledFcfa;

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <CreditCard className="h-5 w-5 text-gray-400" />
        <h2 className="text-lg font-semibold text-gray-900">Échéancier</h2>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span className="text-gray-700">
          Contrat : <strong>{formatFcfa(schedule.totalFcfa)}</strong>
        </span>
        <span className="text-gray-700">
          Réglé : <strong>{formatFcfa(schedule.paidFcfa)}</strong>
        </span>
        <span className="text-gray-700">
          Reste dû :{" "}
          <strong>
            {formatFcfa(schedule.scheduledFcfa - schedule.paidFcfa)}
          </strong>
        </span>
      </div>

      {/* La somme des tranches DOIT égaler le total du contrat. L'écart est
          affiché plutôt que corrigé en silence : il ne peut venir que d'une
          ligne écrite hors des deux chemins qui en créent, et le réparer sans
          le dire ferait disparaître la seule trace du défaut. */}
      {unscheduled !== 0 && (
        <div className="mb-4 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            L&apos;échéancier ne couvre pas le contrat :{" "}
            {formatFcfa(Math.abs(unscheduled))}{" "}
            {unscheduled > 0 ? "manquent" : "en trop"}. Signalez-le avant
            d&apos;encaisser quoi que ce soit.
          </span>
        </div>
      )}

      {schedule.installments.length === 0 ? (
        <p className="text-sm text-gray-500">
          Ce contrat n&apos;a pas d&apos;échéancier : il a été enregistré avant
          la mise en service de l&apos;encaissement. Les tranches d&apos;un
          contrat sont créées avec lui.
        </p>
      ) : (
        <ul className="space-y-2">
          {schedule.installments.map((row: ScheduleRow) => (
            <li
              key={row.installmentId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">
                  Tranche {row.index} · {formatFcfa(row.amountFcfa)}
                </p>
                <p className="text-xs text-gray-500">
                  {row.status === "paid" && row.paidAt
                    ? `Réglée le ${formatDay(row.paidAt)}`
                    : `Exigible le ${formatDay(row.dueAt)}`}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${INSTALLMENT_STATUS_STYLE[row.status]}`}
                >
                  {INSTALLMENT_STATUS_LABEL[row.status]}
                </span>

                {row.status !== "paid" && (
                  <button
                    type="button"
                    onClick={() => handlePay(row.installmentId)}
                    disabled={pendingId !== null}
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                  >
                    {pendingId === row.installmentId ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CreditCard className="h-3.5 w-3.5" />
                    )}
                    Payer
                  </button>
                )}

                {row.status !== "paid" &&
                  (confirmingId === row.installmentId ? (
                    <span className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleSettle(row.installmentId)}
                        disabled={pendingId !== null}
                        className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                      >
                        Confirmer le règlement
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingId(null)}
                        className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
                      >
                        Annuler
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingId(row.installmentId)}
                      disabled={pendingId !== null}
                      className="text-xs text-gray-500 underline decoration-dotted hover:text-gray-700 disabled:opacity-50 transition-colors"
                    >
                      Déjà réglée hors ligne
                    </button>
                  ))}
              </div>

              {confirmingId === row.installmentId && (
                <p className="w-full text-xs text-gray-500">
                  Ne confirmez que si le virement, le chèque ou les espèces sont
                  bien arrivés : la tranche sera tenue pour réglée, l&apos;accès
                  des élèves peut s&apos;en trouver ouvert, et rien ne défait ce
                  constat.
                </p>
              )}

              {invoice && invoice.installmentId === row.installmentId && (
                <a
                  href={invoice.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex w-full items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 transition-colors"
                >
                  <ExternalLink className="h-4 w-4" />
                  Ouvrir la page de paiement — {formatFcfa(row.amountFcfa)}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      {schedule.truncated && <PartialListNotice subject="tranches" />}

      {schedule.payments.length > 0 && (
        <div className="mt-4 border-t border-gray-100 pt-3">
          <div className="mb-2 flex items-center gap-2">
            <Receipt className="h-4 w-4 text-gray-400" />
            <h3 className="text-sm font-semibold text-gray-900">
              Paiements enregistrés
            </h3>
          </div>
          <ul className="space-y-1.5">
            {schedule.payments.map((row: PaymentRow) => (
              <li
                key={row.paymentId}
                className="flex flex-wrap items-baseline gap-x-2 text-xs"
              >
                <span className="font-medium text-gray-900">
                  {formatFcfa(row.amountFcfa)}
                </span>
                <span className="text-gray-700">
                  {PAYMENT_STATUS_LABEL[row.status]}
                </span>
                <span className="text-gray-500">
                  {PAYMENT_PROVIDER_LABEL[row.provider]}
                </span>
                <span className="text-gray-400">
                  {formatEventMoment(row.completedAt ?? row.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-3 text-xs text-gray-400">
        L&apos;accès des élèves s&apos;ouvre quand le prestataire nous confirme
        le règlement, pas au retour du navigateur : une facture réglée dont
        l&apos;onglet est fermé est encaissée quand même. Une tranche oubliée
        laisse vingt et un jours avant que l&apos;accès ne se referme.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Personnel — étape 2 du parcours : sans une ligne ici, personne ne peut être
// affecté à une classe de cette école.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// LES MODULES OPTIONNELS — ce que l'école enseigne EN PLUS du tronc commun.
//
// POURQUOI L'INTERRUPTEUR EST ICI. Le module « Arabe & Coran » est un
// enseignement religieux : toutes les écoles n'en veulent pas, et celles qui
// le donnent ne le donnent pas toutes dans cette application. Il est donc
// ÉTEINT par défaut, et personne d'autre que l'école ne l'allume — ni un
// professeur, ni un parent, ni un réglage global du produit.
//
// LE GARDE EST CÔTÉ SERVEUR (`modules.setForSchool`) : un `admin`, ou le
// `directeur` rattaché à CETTE école. Cet écran est celui de l'administrateur ;
// le jour où un espace directeur existera, il appellera la même mutation, sans
// qu'on ait à rouvrir la règle.
//
// ÉTEINDRE N'EFFACE RIEN. Les progressions des enfants restent en base et
// reviennent si l'école rallume — c'est écrit dans la mutation, et c'est ce qui
// permet de suspendre un module sans détruire un trimestre de travail.
// ---------------------------------------------------------------------------

function ModulesSection({ schoolId }: { schoolId: Doc<"schools">["_id"] }) {
  const modules = useQuery(api.modules.listForSchool, { schoolId });
  const setForSchool = useMutation(api.modules.setForSchool);

  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (moduleKey: "arabe_coran", enabled: boolean) => {
    setPending(moduleKey);
    setError(null);
    try {
      await setForSchool({ schoolId, moduleKey, enabled });
    } catch (err) {
      setError(
        refusalMessage(err, "Impossible de modifier ce module pour le moment"),
      );
    } finally {
      setPending(null);
    }
  };

  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center gap-2">
        <BookOpenText className="h-5 w-5 text-gray-400" />
        <h2 className="text-lg font-semibold text-gray-900">
          Modules optionnels
        </h2>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {modules === undefined ? (
        <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500 shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement...
        </div>
      ) : (
        <ul className="space-y-3">
          {modules.map((module_) => (
            <li
              key={module_.key}
              className="flex flex-wrap items-start gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
            >
              <span className="text-2xl" aria-hidden>
                {module_.emoji}
              </span>
              <div className="min-w-56 flex-1">
                <p className="font-medium text-gray-900">{module_.title}</p>
                <p className="mt-1 text-sm text-gray-500">{module_.summary}</p>
                <p className="mt-2 text-xs text-gray-400">
                  {module_.enabled
                    ? "Visible par tous les élèves inscrits dans cette école."
                    : "Éteint : aucun élève de cette école ne le voit."}
                  {module_.updatedAt !== null &&
                    ` Dernier changement le ${formatDay(module_.updatedAt)}.`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => toggle(module_.key, !module_.enabled)}
                disabled={pending === module_.key}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                  module_.enabled
                    ? "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                    : "bg-indigo-600 text-white hover:bg-indigo-700"
                }`}
              >
                {pending === module_.key && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {module_.enabled ? "Désactiver" : "Activer pour cette école"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StaffSection({
  schoolId,
  staff,
  candidates,
}: {
  schoolId: Doc<"schools">["_id"];
  staff: StaffRow[] | undefined;
  candidates: CandidateList | undefined;
}) {
  const addStaff = useMutation(api.schools.addStaff);
  const removeStaff = useMutation(api.schools.removeStaff);

  const [profileId, setProfileId] = useState("");
  const [staffRole, setStaffRole] = useState<StaffRole>("professeur");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pickable = (candidates?.items ?? []).filter(
    (candidate) => candidate.role === staffRole,
  );

  // « Aucun profil disponible » n'est vrai que si le balayage a tout vu.
  const placeholder =
    candidates === undefined
      ? "Chargement..."
      : pickable.length > 0
        ? "Choisir un profil"
        : candidates.truncated
          ? "Aucun profil dans la partie parcourue"
          : "Aucun profil disponible";

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    // L'identifiant typé vient de la liste, jamais de la valeur du menu.
    const picked = pickable.find((candidate) => candidate._id === profileId);
    if (!picked) {
      setError("Choisissez un profil dans la liste");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await addStaff({ schoolId, profileId: picked._id, staffRole });
      setProfileId("");
    } catch (err) {
      setError(refusalMessage(err, "Erreur lors du rattachement"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemove = async (row: StaffRow) => {
    setError(null);
    try {
      await removeStaff({ staffId: row._id });
      setRemoveConfirm(null);
    } catch (err) {
      setError(refusalMessage(err, "Erreur lors du retrait"));
      setRemoveConfirm(null);
    }
  };

  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center gap-2">
        <Users className="h-5 w-5 text-gray-400" />
        <h2 className="text-lg font-semibold text-gray-900">Personnel</h2>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <form
        onSubmit={handleAdd}
        className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
      >
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Rôle
          </label>
          <select
            value={staffRole}
            onChange={(e) => {
              const next = STAFF_ROLES.find((role) => role === e.target.value);
              if (next) {
                setStaffRole(next);
                setProfileId("");
              }
            }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          >
            {STAFF_ROLES.map((role) => (
              <option key={role} value={role}>
                {STAFF_ROLE_LABEL[role]}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-56 flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Profil
          </label>
          <select
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          >
            <option value="">{placeholder}</option>
            {pickable.map((candidate) => (
              <option key={candidate._id} value={candidate._id}>
                {candidate.name}
              </option>
            ))}
          </select>
          {candidates?.truncated && (
            <PartialListNotice subject="Un professeur ou un directeur" />
          )}
        </div>
        <button
          type="submit"
          disabled={isSubmitting || profileId === ""}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <UserPlus className="h-4 w-4" />
          )}
          Rattacher
        </button>
      </form>

      {staff === undefined ? (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement du personnel...
        </div>
      ) : staff.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
          Aucun membre du personnel. Rattachez un professeur pour pouvoir lui
          confier une classe.
        </div>
      ) : (
        <div className="space-y-2">
          {staff.map((row) => (
            <div
              key={row._id}
              className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="font-medium text-gray-900">{row.name}</h3>
                  <p className="text-sm text-gray-500">
                    {STAFF_ROLE_LABEL[row.staffRole]}
                  </p>
                </div>
                {removeConfirm === row._id ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleRemove(row)}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors"
                    >
                      Confirmer
                    </button>
                    <button
                      onClick={() => setRemoveConfirm(null)}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      Annuler
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setRemoveConfirm(row._id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <UserMinus className="h-3.5 w-3.5" />
                    Retirer
                  </button>
                )}
              </div>
              {removeConfirm === row._id && (
                <p className="mt-3 flex gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Retirer {row.name} le détache aussi des classes de cette
                    école qu&apos;il occupe. Il ne verra plus les élèves de ces
                    classes dans son espace. Les élèves, eux, restent inscrits
                    et gardent leur accès.
                  </span>
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Classes, affectation et inscriptions — étapes 3 à 5.
// ---------------------------------------------------------------------------

function ClassesSection({
  schoolId,
  classes,
  teachers,
  enrollable,
  outlook,
}: {
  schoolId: Doc<"schools">["_id"];
  classes: ClassRow[] | undefined;
  teachers: StaffRow[];
  enrollable: EnrollableList | undefined;
  outlook: EnrollmentOutlook | undefined;
}) {
  const createClass = useMutation(api.schools.createClass);

  const [level, setLevel] = useState<ClassLevel>("CM1");
  const [label, setLabel] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      await createClass({ schoolId, class: level, label });
      setLabel("");
    } catch (err) {
      setError(refusalMessage(err, "Erreur lors de la création de la classe"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section>
      <div className="mb-4 flex items-center gap-2">
        <GraduationCap className="h-5 w-5 text-gray-400" />
        <h2 className="text-lg font-semibold text-gray-900">Classes</h2>
        <Link
          href={`/admin/ecoles/${schoolId}/import`}
          className="ml-auto inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <Upload className="h-4 w-4" />
          Importer des élèves
        </Link>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <form
        onSubmit={handleCreate}
        className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
      >
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Niveau
          </label>
          <select
            value={level}
            onChange={(e) => {
              const next = CLASS_LEVELS.find((item) => item === e.target.value);
              if (next) setLevel(next);
            }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          >
            {CLASS_LEVELS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-40 flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Section
          </label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
            placeholder="ex: A"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Créer la classe
        </button>
      </form>

      {classes === undefined ? (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement des classes...
        </div>
      ) : classes.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
          Aucune classe dans cette école.
        </div>
      ) : (
        <div className="space-y-4">
          {classes.map((schoolClass) => (
            <ClassCard
              key={schoolClass._id}
              schoolClass={schoolClass}
              // Les destinations possibles d'un changement de classe, et
              // rien d'autre : `listClasses` ne rend que les classes de CETTE
              // école, le cadrage par école est donc structurel — l'écran ne
              // peut pas proposer un transfert que `transferStudent`
              // refuserait comme changement d'école. La classe courante en
              // est retirée : on ne transfère pas là où l'on est déjà.
              otherClasses={classes.filter(
                (other) => other._id !== schoolClass._id,
              )}
              teachers={teachers}
              enrollable={enrollable}
              outlook={outlook}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ClassCard({
  schoolClass,
  otherClasses,
  teachers,
  enrollable,
  outlook,
}: {
  schoolClass: ClassRow;
  otherClasses: ClassRow[];
  teachers: StaffRow[];
  enrollable: EnrollableList | undefined;
  outlook: EnrollmentOutlook | undefined;
}) {
  const students = useQuery(api.schools.listClassStudents, {
    schoolClassId: schoolClass._id,
  });
  const assignTeacher = useMutation(api.schools.assignTeacher);
  const enrollStudent = useMutation(api.schools.enrollStudent);
  const releaseStudent = useMutation(api.schools.releaseStudent);
  const transferStudent = useMutation(api.schools.transferStudent);
  const resetLoginCode = useAction(
    api.studentCredentials.resetStudentLoginCode,
  );

  const [studentId, setStudentId] = useState("");
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [resettingFor, setResettingFor] = useState<string | null>(null);
  const [newCode, setNewCode] = useState<{
    name: string;
    code: string;
  } | null>(null);
  const [releaseConfirm, setReleaseConfirm] = useState<string | null>(null);
  const [transferFor, setTransferFor] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [transferTarget, setTransferTarget] = useState("");
  const [isTransferring, setIsTransferring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Le plafond porte sur l'ÉCOLE, pas sur la classe : une classe à deux élèves
  // dans une école pleine n'inscrit plus personne. `seats` à null vaut « aucun
  // abonnement, donc aucun plafond » — le cas courant.
  const seats = outlook?.seats ?? null;
  const seatsFull = seats !== null && seats.full;

  // Le menu du professeur est piloté par la donnée serveur, sans état local :
  // pas de copie à resynchroniser après l'écriture.
  //
  // La valeur vide est l'option « Aucun professeur », et c'est le SEUL chemin
  // qui désaffecte. Une valeur non vide qui ne se résout pas est un échec de
  // résolution, pas une désaffectation : on refuse, comme `handleAdd` et
  // `handleEnroll`, plutôt que d'écrire un retrait que personne n'a demandé.
  const handleAssign = async (value: string) => {
    setError(null);

    let teacherId: StaffRow["profileId"] | undefined;
    if (value !== "") {
      const picked = teachers.find((row) => row.profileId === value);
      if (!picked) {
        setError("Choisissez un professeur dans la liste");
        return;
      }
      teacherId = picked.profileId;
    }

    try {
      await assignTeacher({ schoolClassId: schoolClass._id, teacherId });
    } catch (err) {
      setError(refusalMessage(err, "Erreur lors de l'affectation"));
    }
  };

  const handleEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    const picked = (enrollable?.items ?? []).find(
      (row) => row._id === studentId,
    );
    if (!picked) {
      setError("Choisissez un élève dans la liste");
      return;
    }
    setIsEnrolling(true);
    setError(null);
    try {
      await enrollStudent({
        studentId: picked._id,
        schoolClassId: schoolClass._id,
      });
      setStudentId("");
    } catch (err) {
      setError(refusalMessage(err, "Erreur lors de l'inscription"));
    } finally {
      setIsEnrolling(false);
    }
  };

  // « Aucun élève sans inscription » n'est vrai que si le balayage a tout vu.
  const studentPlaceholder =
    enrollable === undefined
      ? "Chargement..."
      : enrollable.items.length > 0
        ? "Choisir un élève"
        : enrollable.truncated
          ? "Aucun élève sans inscription dans la partie parcourue"
          : "Aucun élève sans inscription";

  const handleRelease = async (row: ClassStudentRow) => {
    setError(null);
    try {
      await releaseStudent({ membershipId: row.membershipId });
      setReleaseConfirm(null);
    } catch (err) {
      setError(refusalMessage(err, "Erreur lors de la libération"));
      setReleaseConfirm(null);
    }
  };

  // Les volets d'une ligne d'élève s'excluent : ouvrir l'un ferme les autres.
  // Les deux volets d'action disent le contraire l'un de l'autre — « il perdra
  // son accès » et « il ne perd pas son accès » — et les afficher ensemble sur
  // le même enfant serait la pire des confusions possibles juste avant un clic
  // de confirmation. L'historique s'y range par la même porte : il n'énonce
  // aucune conséquence, mais il est long, et le déplier sous une demande de
  // confirmation éloignerait l'avertissement du bouton qu'il qualifie.
  const openRelease = (row: ClassStudentRow) => {
    setError(null);
    setTransferFor(null);
    setHistoryFor(null);
    setReleaseConfirm(row.membershipId);
  };

  const openTransfer = (row: ClassStudentRow) => {
    setError(null);
    setReleaseConfirm(null);
    setHistoryFor(null);
    setTransferTarget("");
    setTransferFor(row.membershipId);
  };

  /**
   * Redonne un code à un élève, et le montre UNE fois.
   *
   * Le code n'est lisible qu'à cet instant : le secret est haché à
   * l'enregistrement, donc ni un administrateur ni cet écran ne pourront le
   * relire. D'où le panneau qui reste ouvert jusqu'à ce qu'on le ferme, au lieu
   * d'un message qui s'efface.
   */
  const handleResetCode = async (row: { studentId: string; name: string }) => {
    setError(null);
    setResettingFor(row.studentId);
    try {
      const result = await resetLoginCode({
        studentId: row.studentId as Id<"profiles">,
      });
      setNewCode({ name: result.studentName, code: result.loginCode });
    } catch (err) {
      setError(refusalMessage(err, "Le code n'a pas pu être réinitialisé."));
    } finally {
      setResettingFor(null);
    }
  };

  const openHistory = (row: ClassStudentRow) => {
    setError(null);
    setReleaseConfirm(null);
    setTransferFor(null);
    setHistoryFor(row.membershipId);
  };

  // L'identifiant typé vient de la liste, jamais de la valeur du menu — même
  // motif que `handleAssign` et `handleEnroll`. Une valeur qui ne se résout
  // pas est un échec de résolution : on refuse plutôt que d'écrire un
  // déplacement que personne n'a désigné.
  const handleTransfer = async (row: ClassStudentRow) => {
    const picked = otherClasses.find((item) => item._id === transferTarget);
    if (!picked) {
      setError("Choisissez une classe dans la liste");
      return;
    }
    setIsTransferring(true);
    setError(null);
    try {
      await transferStudent({
        membershipId: row.membershipId,
        targetSchoolClassId: picked._id,
      });
      // La ligne quitte cette carte d'elle-même : `listClassStudents` est
      // réactive des deux côtés, la classe de départ comme celle d'arrivée.
      setTransferFor(null);
      setTransferTarget("");
    } catch (err) {
      setError(refusalMessage(err, "Erreur lors du changement de classe"));
    } finally {
      setIsTransferring(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="font-semibold text-gray-900">
            {schoolClass.class} {schoolClass.label}
          </h3>
          <p className="text-sm text-gray-500">
            {/* Dérivé de la liste que cette carte affiche déjà : `listClasses`
                ne relit plus les inscriptions pour n'en tirer qu'un nombre. */}
            {students === undefined
              ? "Chargement des inscrits…"
              : `${students.length} élève${students.length !== 1 ? "s" : ""} inscrit${students.length !== 1 ? "s" : ""}`}{" "}
            · {schoolClass.teacherName ?? "aucun professeur affecté"}
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Professeur
          </label>
          <select
            value={schoolClass.teacherId ?? ""}
            onChange={(e) => handleAssign(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
          >
            <option value="">Aucun professeur</option>
            {teachers.map((row) => (
              <option key={row.profileId} value={row.profileId}>
                {row.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* IL RESTE JUSQU'À CE QU'ON LE FERME, et ce n'est pas une négligence
          d'ergonomie : le secret est haché à l'enregistrement, donc ce code
          n'est lisible qu'ici et qu'une fois. Un message qui s'efface tout
          seul enfermerait l'élève dehors. */}
      {newCode && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            Nouveau code de {newCode.name}
          </p>
          <p className="mt-1 font-mono text-xl tracking-wider text-gray-900">
            {newCode.code}
          </p>
          <p className="mt-2 text-xs text-amber-800">
            Notez-le maintenant : il ne sera plus jamais affiché. Il sert à la
            fois d&apos;identifiant et de mot de passe. L&apos;ancien code ne
            fonctionne plus, et les sessions ouvertes ont été fermées.
          </p>
          <button
            type="button"
            onClick={() => setNewCode(null)}
            className="mt-3 rounded-lg border border-amber-300 px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
          >
            J&apos;ai noté ce code
          </button>
        </div>
      )}

      <div className="mt-5 border-t border-gray-100 pt-4">
        {seats !== null && seatsFull && <SeatsFullNotice seats={seats} />}
        <form onSubmit={handleEnroll} className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Inscrire un élève
            </label>
            <select
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            >
              <option value="">{studentPlaceholder}</option>
              {(enrollable?.items ?? []).map((row) => (
                <option key={row._id} value={row._id}>
                  {row.name}
                  {row.class ? ` (${row.class})` : ""}
                </option>
              ))}
            </select>
            {enrollable?.truncated && <PartialListNotice subject="Un élève" />}
          </div>
          <button
            type="submit"
            disabled={isEnrolling || studentId === "" || seatsFull}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {isEnrolling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
            Inscrire
          </button>
        </form>
        <p className="mt-2 text-xs text-gray-500">
          Inscrire un élève le rattache à cette école et le place sous son
          abonnement, lorsqu&apos;elle en a un. Son niveau passe à{" "}
          {schoolClass.class}. Un élève ne peut être inscrit que dans une seule
          classe à la fois.
        </p>
        <EnrollmentOutlookNotice outlook={outlook} seatsFull={seatsFull} />
      </div>

      <div className="mt-5 border-t border-gray-100 pt-4">
        {students === undefined ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Chargement des élèves...
          </div>
        ) : students.length === 0 ? (
          <p className="text-sm text-gray-500">
            Aucun élève inscrit dans cette classe.
          </p>
        ) : (
          <div className="space-y-2">
            {students.map((row) => (
              <div key={row.membershipId} className="rounded-lg bg-gray-50 p-3">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm font-medium text-gray-900">
                    {row.name}
                  </span>
                  {releaseConfirm === row.membershipId ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleRelease(row)}
                        className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors"
                      >
                        Confirmer la libération
                      </button>
                      <button
                        onClick={() => setReleaseConfirm(null)}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        Annuler
                      </button>
                    </div>
                  ) : transferFor === row.membershipId ? (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <select
                        value={transferTarget}
                        onChange={(e) => setTransferTarget(e.target.value)}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                      >
                        <option value="">Choisir une classe</option>
                        {otherClasses.map((item) => (
                          <option key={item._id} value={item._id}>
                            {item.class} {item.label}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleTransfer(row)}
                        disabled={isTransferring || transferTarget === ""}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                      >
                        {isTransferring ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ArrowLeftRight className="h-3.5 w-3.5" />
                        )}
                        Confirmer le changement
                      </button>
                      <button
                        onClick={() => setTransferFor(null)}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        Annuler
                      </button>
                    </div>
                  ) : historyFor === row.membershipId ? (
                    <button
                      onClick={() => setHistoryFor(null)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      <History className="h-3.5 w-3.5" />
                      Masquer l&apos;historique
                    </button>
                  ) : (
                    // `flex-wrap` : trois actions sur une ligne d'élève ne
                    // tiennent plus à côté du nom sur un écran étroit.
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {/* L'historique se demande, il ne se charge jamais tout
                          seul : une classe de soixante élèves ouvrirait
                          soixante souscriptions temps réel pour un panneau
                          qu'on ouvre sur un enfant. */}
                      <button
                        onClick={() => openHistory(row)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
                      >
                        <History className="h-3.5 w-3.5" />
                        Historique
                      </button>
                      {/* Sans autre classe dans l'école, l'action n'a aucune
                          destination : le bouton disparaît au lieu de se
                          proposer pour ouvrir un menu vide. */}
                      {otherClasses.length > 0 && (
                        <button
                          onClick={() => openTransfer(row)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
                        >
                          <ArrowLeftRight className="h-3.5 w-3.5" />
                          Changer de classe
                        </button>
                      )}
                      {/* Un élève importé n'a pas de boîte mail : « mot de
                          passe oublié » ne peut pas lui servir, c'est l'adulte
                          de son école qui lui redonne un code (spec §6.2). */}
                      <button
                        onClick={() => handleResetCode(row)}
                        disabled={resettingFor === row.studentId}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 transition-colors"
                      >
                        {resettingFor === row.studentId ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <KeyRound className="h-3.5 w-3.5" />
                        )}
                        Nouveau code
                      </button>
                      <button
                        onClick={() => openRelease(row)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <UserMinus className="h-3.5 w-3.5" />
                        Libérer le siège
                      </button>
                    </div>
                  )}
                </div>
                {releaseConfirm === row.membershipId && (
                  <p className="mt-3 flex gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      {row.name} perdra l&apos;accès à l&apos;application dès
                      maintenant : plus de matières, plus d&apos;exercices, plus
                      de progression. Son travail déjà fait est conservé, et
                      l&apos;accès revient si vous l&apos;inscrivez de nouveau
                      dans une classe.
                    </span>
                  </p>
                )}
                {transferFor === row.membershipId && (
                  <p className="mt-3 flex gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
                    <ArrowLeftRight className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      {row.name} NE PERD PAS son accès : son inscription est
                      modifiée, jamais libérée — à aucun moment il ne verra le
                      message de fermeture de son espace, et sa progression le
                      suit. Son niveau passera à celui de la classe choisie.
                      C&apos;est ce qui distingue ce changement du couple
                      « libérer le siège puis réinscrire », qui coupe
                      l&apos;accès entre les deux. Il reste dans cette école :
                      pour une autre école, il faut bien libérer, puis
                      réinscrire.
                    </span>
                  </p>
                )}
                {historyFor === row.membershipId && (
                  <MembershipHistory membershipId={row.membershipId} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * « en CM1 A », « de CM1 A vers CM1 B » — le contexte de classe d'un acte.
 *
 * Les deux dernières branches ne servent qu'aux lignes ABÎMÉES : le serveur
 * rend `null` pour une classe qu'il ne retrouve pas, et une trace à demi
 * lisible vaut mieux qu'une trace muette. Un transfert normal porte toujours
 * ses deux classes, une inscription seulement celle d'arrivée, une libération
 * aucune.
 */
function classContext(event: MembershipEventRow): string | null {
  if (event.fromClassName && event.toClassName) {
    return `de ${event.fromClassName} vers ${event.toClassName}`;
  }
  if (event.toClassName) return `en ${event.toClassName}`;
  if (event.fromClassName) return `depuis ${event.fromClassName}`;
  return null;
}

/**
 * Le journal d'UNE inscription — qui a agi sur l'accès de cet enfant, et quand.
 *
 * COMPOSANT À PART, et c'est là tout l'enjeu : `useQuery` s'abonne tant que le
 * composant est monté. Écrit dans `ClassCard`, l'appel s'exécuterait pour
 * CHAQUE ligne d'élève de CHAQUE classe — des dizaines de souscriptions temps
 * réel par école, pour un panneau que l'administrateur ouvre sur un enfant à
 * la fois. Monté seulement quand le volet est ouvert, il n'en ouvre qu'une, et
 * la referme en se démontant.
 *
 * Il ne reçoit que l'identifiant de l'inscription : les noms — l'auteur, les
 * classes — sont déjà résolus par `listMembershipEvents`, cet écran ne
 * rattrape rien côté client.
 */
function MembershipHistory({
  membershipId,
}: {
  membershipId: ClassStudentRow["membershipId"];
}) {
  const events = useQuery(api.schools.listMembershipEvents, { membershipId });

  if (events === undefined) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Chargement de l&apos;historique...
      </div>
    );
  }

  // Le journal ne remonte pas avant sa mise en place : une inscription plus
  // ancienne n'a rien à montrer, et l'écran doit le DIRE. « Aucun acte » tout
  // court se lirait comme « personne n'a rien fait à cet enfant », ce qui est
  // exactement l'inverse de ce qu'un registre d'audit doit laisser croire.
  if (events.length === 0) {
    return (
      <p className="mt-3 rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-500">
        Aucun acte enregistré pour cette inscription. Le journal n&apos;a pas
        été reconstitué pour les inscriptions antérieures à sa mise en
        place&nbsp;: une absence ici ne veut pas dire qu&apos;il ne s&apos;est
        rien passé.
      </p>
    );
  }

  return (
    <ul className="mt-3 space-y-2 rounded-lg border border-gray-200 bg-white p-3">
      {events.map((event) => {
        const context = classContext(event);
        return (
          <li
            key={event._id}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm"
          >
            <span className="font-medium text-gray-900">
              {EVENT_LABEL[event.kind]}
            </span>
            {context && <span className="text-gray-600">{context}</span>}
            <span className="text-gray-500">par {event.actorName}</span>
            <span className="text-gray-400">·</span>
            <span className="text-gray-500">{formatEventMoment(event.at)}</span>
          </li>
        );
      })}
    </ul>
  );
}
