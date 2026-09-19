import { emailBrandHtml } from "./email-brand";

export interface LinkRequestEmailData {
  /** Le logo de marque, quand le déploiement en publie un. */
  logoUrl?: string;
  parentName: string;
  studentName: string;
  acceptUrl: string;
  rejectUrl: string;
}

export function generateLinkRequestEmailHtml(
  data: LinkRequestEmailData,
): string {
  const { parentName, studentName, acceptUrl, rejectUrl } = data;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Demande de liaison parentale</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f3f4f6;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

          <tr>
            <td style="background-color:#0d9488;padding:24px 32px;">
              ${emailBrandHtml({ subtitle: "Demande de liaison parentale", logoUrl: data.logoUrl })}
            </td>
          </tr>

          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 16px;color:#111827;font-size:16px;line-height:1.5;">
                Bonjour <strong>${escapeHtml(studentName)}</strong>,
              </p>
              <p style="margin:0 0 16px;color:#111827;font-size:16px;line-height:1.5;">
                <strong>${escapeHtml(parentName)}</strong> souhaite se lier a ton compte en tant que parent sur Jotna School.
              </p>

              <div style="margin:24px 0;padding:20px;background-color:#f0fdfa;border:1px solid #99f6e4;border-radius:8px;">
                <p style="margin:0 0 8px;color:#0f766e;font-size:14px;font-weight:600;">Qu'est-ce que cela signifie ?</p>
                <ul style="margin:0;padding:0 0 0 20px;color:#374151;font-size:14px;line-height:1.6;">
                  <li>Ton parent pourra suivre ta progression dans les exercices</li>
                  <li>Il recevra des rapports sur tes resultats</li>
                  <li>Il pourra t'encourager et t'aider dans ton apprentissage</li>
                </ul>
              </div>

              <p style="margin:0 0 24px;color:#111827;font-size:16px;line-height:1.5;">
                Si tu reconnais cette personne comme ton parent ou tuteur, clique sur <strong>Accepter</strong>. Sinon, tu peux refuser.
              </p>

              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td align="center" style="padding-right:8px;" width="50%">
                    <a href="${escapeHtml(acceptUrl)}" style="display:block;padding:14px 24px;background-color:#0d9488;color:#ffffff;text-decoration:none;border-radius:8px;font-size:16px;font-weight:600;text-align:center;">
                      Accepter
                    </a>
                  </td>
                  <td align="center" style="padding-left:8px;" width="50%">
                    <a href="${escapeHtml(rejectUrl)}" style="display:block;padding:14px 24px;background-color:#ef4444;color:#ffffff;text-decoration:none;border-radius:8px;font-size:16px;font-weight:600;text-align:center;">
                      Refuser
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:24px 0 0;color:#6b7280;font-size:13px;line-height:1.5;">
                Ce lien est valable pendant 48 heures. Si tu n'as pas demande cette liaison, tu peux ignorer cet email.
              </p>
            </td>
          </tr>

          <tr>
            <td style="background-color:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">Jotna School — Plateforme educative</p>
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
