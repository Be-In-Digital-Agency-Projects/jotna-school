export interface ActivationEmailData {
  recipientName: string;
  schoolName: string;
  roleLabel: string;
  loginId: string;
  activationCode: string;
  activationUrl: string;
}

/**
 * L'e-mail qu'une personne reçoit quand son école lui crée un compte.
 *
 * IL PORTE LE CODE EN CLAIR, ET C'EST ASSUMÉ. C'est un secret à usage unique,
 * valable quatorze jours, qui n'autorise qu'une chose : poser le premier mot de
 * passe. Le cacher derrière un lien seul priverait du canal de secours — une
 * personne qui lit ses messages sur un téléphone où le lien s'ouvre mal peut
 * encore recopier huit caractères.
 *
 * IL DIT QUI A CRÉÉ LE COMPTE. « Votre école X vous a créé un compte » est ce
 * qui distingue ce message d'un hameçonnage : le destinataire n'a rien demandé,
 * et sans le nom de son école il aurait raison de s'en méfier.
 */
export function generateActivationEmailHtml(data: ActivationEmailData): string {
  return `<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:24px;background:#f6f7fb;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2430">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">
      <h1 style="margin:0 0 16px;font-size:20px">Bonjour ${escapeHtml(data.recipientName)},</h1>

      <p style="margin:0 0 16px;line-height:1.6">
        <strong>${escapeHtml(data.schoolName)}</strong> vous a créé un compte
        ${escapeHtml(data.roleLabel)} sur Jotna School. Il ne vous reste qu'à
        choisir votre mot de passe.
      </p>

      <table style="width:100%;border-collapse:collapse;margin:0 0 24px">
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #eceef4;font-size:14px;color:#5b6172">Votre identifiant</td>
          <td style="padding:12px 0;border-bottom:1px solid #eceef4;font-size:16px;font-weight:600;text-align:right">${escapeHtml(data.loginId)}</td>
        </tr>
        <tr>
          <td style="padding:12px 0;font-size:14px;color:#5b6172">Votre code d'activation</td>
          <td style="padding:12px 0;font-size:20px;font-weight:700;letter-spacing:2px;text-align:right">${escapeHtml(data.activationCode)}</td>
        </tr>
      </table>

      <a href="${escapeHtml(data.activationUrl)}"
         style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:8px;font-weight:600">
        Activer mon compte
      </a>

      <p style="margin:24px 0 0;line-height:1.6;font-size:14px;color:#5b6172">
        Ce code est valable quatorze jours et ne sert qu'une fois. Si le bouton
        ne fonctionne pas, ouvrez la page d'activation et recopiez le code
        ci-dessus. Si vous ne vous attendiez pas à ce message, prévenez votre
        école : c'est elle qui a créé ce compte.
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
