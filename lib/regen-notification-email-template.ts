import { emailBrandHtml } from "./email-brand";

export interface RegenNotificationEmailData {
  /** Le logo de marque, quand le déploiement en publie un. */
  logoUrl?: string;
  studentName: string;
  topicName: string;
  subjectName: string;
}

export function generateRegenNotificationEmailHtml(
  data: RegenNotificationEmailData,
): string {
  const { studentName, topicName, subjectName } = data;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Coup de pouce nécessaire</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f3f4f6;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

          <tr>
            <td style="background-color:#0d9488;padding:24px 32px;">
              ${emailBrandHtml({ subtitle: "Un petit coup de pouce serait le bienvenu", logoUrl: data.logoUrl })}
            </td>
          </tr>

          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 16px;color:#111827;font-size:16px;line-height:1.5;">
                Bonjour,
              </p>
              <p style="margin:0 0 16px;color:#111827;font-size:16px;line-height:1.5;">
                Ce n'est rien de grave, mais <strong>${escapeHtml(studentName)}</strong> rencontre quelques difficultés en <strong>${escapeHtml(subjectName)}</strong> sur le thème <strong>« ${escapeHtml(topicName)} »</strong>.
              </p>
              <p style="margin:0 0 16px;color:#111827;font-size:16px;line-height:1.5;">
                Après plusieurs tentatives, votre enfant n'a pas encore réussi à valider ce palier. Un petit encouragement de votre part peut faire toute la différence !
              </p>

              <div style="margin:24px 0;padding:20px;background-color:#f0fdfa;border:1px solid #99f6e4;border-radius:8px;">
                <p style="margin:0 0 12px;color:#0f766e;font-size:14px;font-weight:600;">Voici quelques idées :</p>
                <ul style="margin:0;padding:0 0 0 20px;color:#374151;font-size:14px;line-height:1.8;">
                  <li>Discutez avec votre enfant de ce qu'il trouve difficile</li>
                  <li>Regardez ensemble les exercices pour comprendre les erreurs</li>
                  <li>Encouragez-le : la persévérance est la clé de la réussite</li>
                  <li>Contactez son enseignant si besoin d'un accompagnement supplémentaire</li>
                </ul>
              </div>

              <p style="margin:0 0 0;color:#6b7280;font-size:13px;line-height:1.5;">
                Votre enfant a été encouragé à faire une pause et à revenir plus tard. Les exercices resteront disponibles.
              </p>
            </td>
          </tr>

          <tr>
            <td style="background-color:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">Jotna School — Plateforme éducative inspirée du programme officiel sénégalais</p>
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
