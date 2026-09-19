/**
 * Le reçu qu'une école reçoit quand une tranche est soldée.
 *
 * UN REÇU, PAS UNE FACTURE FISCALE. Il constate un versement déjà encaissé ;
 * il ne réclame rien et ne porte aucune TVA. Le NINEA y figure quand l'école
 * en a un, parce que sa comptabilité en a besoin pour rattacher la pièce.
 *
 * CSS EN LIGNE, comme les deux autres gabarits du dépôt : les clients de
 * messagerie jettent les feuilles de style externes.
 */

export interface InvoiceEmailData {
  schoolName: string;
  contactName: string;
  ninea?: string;
  installmentIndex: number;
  amountFcfa: number;
  paidAt: number;
  /** Les sièges que le contrat a achetés — ce que la tranche facture. */
  seatsPurchased: number;
  /** Les élèves inscrits aujourd'hui — ce que l'école utilise vraiment. */
  activeStudents: number;
  /** Le moyen par lequel l'argent est entré, déjà dit en français. */
  methodLabel: string;
  /** La référence du versement — celle du prestataire, ou celle du constat. */
  reference: string;
}

/** « 416668 » devient « 416 668 ». Espace insécable : un montant ne se coupe pas. */
function formatFcfa(amount: number): string {
  return String(Math.round(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** « 1 siège », « 30 sièges ». Zéro prend le pluriel, comme en français. */
function plural(count: number, one: string, many: string): string {
  return `${formatFcfa(count)} ${count === 1 ? one : many}`;
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  const mois = [
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
  return `${d.getUTCDate()} ${mois[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function generateInvoiceEmailHtml(data: InvoiceEmailData): string {
  const rows: Array<[string, string]> = [
    ["École", data.schoolName],
    ...(data.ninea ? ([["NINEA", data.ninea]] as Array<[string, string]>) : []),
    ["Tranche", `n° ${data.installmentIndex}`],
    ["Élèves couverts", plural(data.seatsPurchased, "siège", "sièges")],
    [
      "Élèves inscrits",
      plural(data.activeStudents, "élève", "élèves"),
    ],
    ["Montant réglé", `${formatFcfa(data.amountFcfa)} FCFA`],
    ["Date du règlement", formatDate(data.paidAt)],
    ["Moyen de paiement", data.methodLabel],
    ["Référence", data.reference],
  ];

  const rowsHtml = rows
    .map(
      ([label, value], i) =>
        `<tr>
          <td style="padding:10px 0;color:#6b7280;font-size:14px;${i > 0 ? "border-top:1px solid #e5e7eb;" : ""}">${escapeHtml(label)}</td>
          <td style="padding:10px 0;color:#111827;font-size:14px;font-weight:500;text-align:right;${i > 0 ? "border-top:1px solid #e5e7eb;" : ""}">${escapeHtml(value)}</td>
        </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:24px 12px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;">
    <tr>
      <td style="padding:32px 28px 8px;">
        <p style="margin:0 0 4px;color:#0d9488;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">Jotna School</p>
        <h1 style="margin:0 0 16px;color:#111827;font-size:22px;">Reçu de paiement</h1>
        <p style="margin:0 0 4px;color:#374151;font-size:15px;line-height:1.5;">Bonjour ${escapeHtml(data.contactName)},</p>
        <p style="margin:0;color:#374151;font-size:15px;line-height:1.5;">Votre versement est arrivé. La tranche ci-dessous est soldée, et l'accès de vos élèves reste ouvert.</p>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 28px 4px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowsHtml}</table>
      </td>
    </tr>
    <tr>
      <td style="padding:16px 28px 32px;">
        <p style="margin:0 0 8px;color:#6b7280;font-size:13px;line-height:1.5;">Ce message tient lieu de reçu. Gardez-le pour votre comptabilité.</p>
        <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.5;">Une question sur ce paiement ? Répondez à ce message.</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
