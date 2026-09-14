"use client";

import { use, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
// Le barème est un module PUR, sans import ni accès à la base : l'écran peut
// donc montrer le montant AVANT validation sans un aller-retour par serveur.
// Ce total n'engage rien — `recordSubscription` recalcule le sien, et c'est
// pourquoi le prix n'est pas un argument de la mutation.
import { PRICING_SCALE, quoteSubscription } from "@/convex/pricing";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowLeftRight,
  History,
  Loader2,
  Plus,
  Receipt,
  School,
  Users,
  UserMinus,
  UserPlus,
  GraduationCap,
  AlertTriangle,
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

/**
 * Les deux listes de candidats rendent `{ items, truncated }`, pas un tableau.
 *
 * Elles balaient `profiles` sur une tranche bornée, faute d'index par rôle
 * (voir `convex/schools.ts`), et `truncated` dit que le balayage a buté sur sa
 * borne. L'écran doit le RELAYER : sans lui, « Aucun profil disponible » se lit
 * comme « ce profil n'existe pas » alors qu'il veut dire « je n'ai pas tout lu ».
 */
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
 * Les trois statuts qu'une PERSONNE pose.
 *
 * `past_due` viendra du suivi des tranches, `expired` se déduit de la date de
 * fin à chaque lecture, et « résilié » dit la FIN d'un contrat existant que
 * rien ne sait encore prononcer — `recordSubscription` n'insère que des lignes
 * neuves. Les trois sont refusés par la mutation, et le formulaire n'a pas à
 * proposer ce qui sera refusé : c'est pourquoi aucun encart n'annonce leur
 * refus, à la différence d'« actif » daté du futur ou du plafond de sièges,
 * que le menu peut encore produire.
 *
 * « Résilié » était pire qu'inutile au menu : la ligne n'ouvrait aucun accès,
 * mais devenait le contrat COURANT de l'école à sa date de début — la
 * sélection du paywall ne compare que les `startsAt` — et coupait les élèves
 * qu'un contrat actif couvrait encore.
 *
 * `Exclude` sur le type du schéma, et non une liste recopiée : les trois
 * exclus sont nommés une fois, et le menu ne peut pas proposer une valeur que
 * le schéma ignore.
 */
type AdminStatus = Exclude<
  SubscriptionStatus,
  "past_due" | "expired" | "cancelled"
>;

const ADMIN_STATUSES: AdminStatus[] = ["draft", "pending_payment", "active"];

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

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

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
  // Initialiseurs PARESSEUX : `Date.now()` est impur, et l'appeler dans le
  // corps du rendu ferait glisser la valeur à chaque re-rendu. Passé en
  // fonction, il n'est évalué qu'au premier montage — ce que les dates par
  // défaut demandent, justement : elles sont un point de départ, que
  // l'administrateur corrige ensuite sans qu'un rendu les lui reprenne.
  //
  // `today` sert aussi de point de comparaison : au format « AAAA-MM-JJ »,
  // l'ordre alphabétique EST l'ordre chronologique, et comparer deux chaînes
  // évite de rappeler l'horloge au milieu d'un rendu.
  const [today] = useState(() => toDayInput(Date.now()));
  const [startsAt, setStartsAt] = useState(today);
  const [endsAt, setEndsAt] = useState(() =>
    toDayInput(Date.now() + DAYS_IN_YEAR * DAY_MS),
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
      setError(messageOf(err, "Erreur lors de l'enregistrement du contrat"));
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
              <p className="mt-1 text-sm text-gray-500">
                {seatState !== null && `${seatsContractLabel(seatState)} · `}
                {formatFcfa(contract.totalFcfa)} pour l&apos;année
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
            valeur d&apos;affichage : c&apos;est le total qui fait foi.
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
        </div>
      )}

      {activeBeforeStart && (
        <div className="mb-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            L&apos;enregistrement sera REFUSÉ : un contrat ne se déclare pas
            actif avant d&apos;avoir commencé. Le paywall ne juge que la date de
            fin — marqué actif dès aujourd&apos;hui, ce contrat ouvrirait
            l&apos;accès pour une année qui n&apos;a pas commencé. Enregistrez-le
            en brouillon ou en attente de paiement, puis à nouveau en actif le
            jour de son entrée en vigueur.
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
        Un renouvellement s&apos;enregistre comme un contrat NEUF : le contrat
        ci-dessus n&apos;est jamais modifié, et l&apos;historique reste lisible.
        Sa période doit commencer à la fin du précédent, ou après — une école
        n&apos;a qu&apos;un contrat en vigueur à la fois, faute de quoi ni son
        accès ni son nombre de sièges ne seraient décidables. Tant que le
        nouveau n&apos;a pas commencé, c&apos;est l&apos;ancien qui décide de
        l&apos;accès des élèves.
      </p>
    </section>
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
// Personnel — étape 2 du parcours : sans une ligne ici, personne ne peut être
// affecté à une classe de cette école.
// ---------------------------------------------------------------------------

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
      setError(messageOf(err, "Erreur lors du rattachement"));
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
      setError(messageOf(err, "Erreur lors du retrait"));
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
      setError(messageOf(err, "Erreur lors de la création de la classe"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section>
      <div className="mb-4 flex items-center gap-2">
        <GraduationCap className="h-5 w-5 text-gray-400" />
        <h2 className="text-lg font-semibold text-gray-900">Classes</h2>
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

  const [studentId, setStudentId] = useState("");
  const [isEnrolling, setIsEnrolling] = useState(false);
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
      setError(messageOf(err, "Erreur lors de l'affectation"));
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
      setError(messageOf(err, "Erreur lors de l'inscription"));
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
      setError(messageOf(err, "Erreur lors de la libération"));
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
      setError(messageOf(err, "Erreur lors du changement de classe"));
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
            {schoolClass.studentCount} élève
            {schoolClass.studentCount !== 1 ? "s" : ""} inscrit
            {schoolClass.studentCount !== 1 ? "s" : ""} ·{" "}
            {schoolClass.teacherName ?? "aucun professeur affecté"}
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
