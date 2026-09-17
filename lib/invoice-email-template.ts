export interface InvoiceEmailData {
  issuer: { name: string; ninea: string; address: string; email: string };
  number: string;
  issuedAt: string;
  school: {
    name: string;
    city: string | null;
    contactName: string;
    ninea: string | null;
  };
  lineLabel: string;
  amount: string;
  contractTotal: string;
}

/**
 * La facture qu'une école reçoit quand sa tranche est réglée.
 *
 * ELLE PORTE LES DEUX IDENTITÉS FISCALES, celle de l'émetteur et celle de
 * l'école. C'est ce qui distingue une facture d'un accusé de réception : sans la
 * raison sociale et le NINEA de l'émetteur, l'école ne peut pas la
 * comptabiliser ; sans le sien, la pièce ne la désigne pas. Le NINEA de l'école
 * peut manquer — `schools.ninea` est optionnel — et la mention le dit alors
 * explicitement, plutôt que de laisser une ligne vide dont personne ne sait si
 * elle est un oubli de saisie ou un oubli de gabarit.
 *
 * AUCUNE LIGNE DE TVA, ET C'EST UN CHOIX EXPLICITE, pas un oubli. Le dépôt ne
 * modélise aucune taxe : ni `pricing`, ni `billingRules`, ni le schéma n'en
 * portent la moindre trace, et les montants des tranches somment exactement au
 * total du contrat. Inventer ici une décomposition HT/TVA/TTC produirait des
 * chiffres que rien dans le système ne justifie. Si le régime de l'émetteur
 * l'exige, c'est le calcul des montants qu'il faut reprendre — dans `pricing` —
 * avant de l'écrire sur un document.
 *
 * LE MONTANT DU CONTRAT EST RAPPELÉ à côté de celui de la tranche : une école
 * qui règle la deuxième de trois tranches doit pouvoir vérifier d'un coup d'œil
 * qu'on ne lui demande pas deux fois le tout.
 */
export function generateInvoiceEmailHtml(data: InvoiceEmailData): string {
  const ninea = data.school.ninea
    ? escapeHtml(data.school.ninea)
    : "non renseigné";

  return `<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:24px;background:#f6f7fb;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2430">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">

      <table style="width:100%;border-collapse:collapse;margin:0 0 32px">
        <tr>
          <td style="vertical-align:top;font-size:13px;line-height:1.6">
            <strong style="font-size:15px">${escapeHtml(data.issuer.name)}</strong><br>
            ${escapeHtml(data.issuer.address)}<br>
            NINEA ${escapeHtml(data.issuer.ninea)}<br>
            ${escapeHtml(data.issuer.email)}
          </td>
          <td style="vertical-align:top;text-align:right">
            <div style="font-size:20px;font-weight:700">Facture</div>
            <div style="font-size:15px;font-weight:600;letter-spacing:1px">${escapeHtml(data.number)}</div>
            <div style="font-size:13px;color:#5b6172">Émise le ${escapeHtml(data.issuedAt)}</div>
          </td>
        </tr>
      </table>

      <div style="border-top:1px solid #eceef4;padding:20px 0;font-size:13px;line-height:1.6">
        <div style="text-transform:uppercase;letter-spacing:1px;font-size:11px;color:#5b6172;margin-bottom:6px">
          Facturé à
        </div>
        <strong style="font-size:15px">${escapeHtml(data.school.name)}</strong><br>
        ${data.school.city ? `${escapeHtml(data.school.city)}<br>` : ""}
        ${escapeHtml(data.school.contactName)}<br>
        NINEA ${ninea}
      </div>

      <table style="width:100%;border-collapse:collapse;margin:20px 0 0">
        <tr>
          <td style="padding:12px 0;border-top:1px solid #eceef4;border-bottom:1px solid #eceef4;font-size:13px;line-height:1.6">
            ${escapeHtml(data.lineLabel)}
          </td>
          <td style="padding:12px 0;border-top:1px solid #eceef4;border-bottom:1px solid #eceef4;text-align:right;font-size:15px;font-weight:600;white-space:nowrap">
            ${escapeHtml(data.amount)}
          </td>
        </tr>
        <tr>
          <td style="padding:16px 0;font-size:15px;font-weight:700">Total réglé</td>
          <td style="padding:16px 0;text-align:right;font-size:20px;font-weight:700;white-space:nowrap">
            ${escapeHtml(data.amount)}
          </td>
        </tr>
      </table>

      <div style="border-radius:8px;background:#f0fdf4;border:1px solid #bbf7d0;padding:14px 16px;font-size:13px;line-height:1.6;color:#14532d">
        <strong>Paiement reçu.</strong> Cette tranche est soldée, et l&rsquo;accès
        de vos élèves est ouvert pour la période facturée. Montant total du
        contrat : ${escapeHtml(data.contractTotal)}.
      </div>

      <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#5b6172">
        Pour toute question sur cette facture, répondez à ce message : il arrive
        directement à ${escapeHtml(data.issuer.email)}.
      </p>
    </div>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
