import { emailBrandHtml } from "./email-brand";

export interface PasswordResetEmailData {
  /** Le logo de marque, quand le déploiement en publie un. */
  logoUrl?: string;
  code: string;
}

export function generatePasswordResetEmailHtml(
  data: PasswordResetEmailData,
): string {
  const { code } = data;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Réinitialisation de votre mot de passe</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f3f4f6;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

          <tr>
            <td style="background-color:#0d9488;padding:24px 32px;">
              ${emailBrandHtml({ subtitle: "Réinitialisation de mot de passe", logoUrl: data.logoUrl })}
            </td>
          </tr>

          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 16px;color:#111827;font-size:16px;line-height:1.5;">
                Bonjour,
              </p>
              <p style="margin:0 0 16px;color:#111827;font-size:16px;line-height:1.5;">
                Vous avez demandé à réinitialiser votre mot de passe. Utilisez le code ci-dessous pour confirmer votre identité.
              </p>

              <div style="margin:32px 0;padding:24px;background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;text-align:center;">
                <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Votre code</p>
                <p style="margin:0;color:#0d9488;font-size:32px;font-weight:700;letter-spacing:6px;font-family:'Courier New',monospace;">${escapeHtml(code)}</p>
              </div>

              <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.5;">
                Ce code est valable pendant 15 minutes.
              </p>
              <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.5;">
                Si vous n'avez pas demandé cette réinitialisation, vous pouvez ignorer cet email — votre mot de passe restera inchangé.
              </p>
            </td>
          </tr>

          <tr>
            <td style="background-color:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">Jotna School — Plateforme éducative</p>
            </td>
          </tr>

        </table>
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
    .replace(/"/g, "&quot;");
}
