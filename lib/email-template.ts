import { emailBrandHtml } from "./email-brand";

/**
 * Generates a clean, professional HTML email for a topic report.
 * Designed for parents/guardians — not gamified.
 * Uses inline CSS for email client compatibility.
 */

export interface ReportEmailData {
  /** Le logo de marque, quand le déploiement en publie un. */
  logoUrl?: string;
  studentName: string;
  topicName: string;
  subjectName: string;
  score: number;
  strengths: string[];
  weaknesses: string[];
  frequentMistakes: string[];
  date: string;
}

export function generateReportEmailHtml(data: ReportEmailData): string {
  const {
    studentName,
    topicName,
    subjectName,
    score,
    strengths,
    weaknesses,
    frequentMistakes,
    date,
  } = data;

  const scorePercent = Math.round(score * 100);

  const scoreColor =
    scorePercent >= 80
      ? "#16a34a"
      : scorePercent >= 50
        ? "#d97706"
        : "#dc2626";

  const stars = scorePercent >= 80 ? 3 : scorePercent >= 50 ? 2 : 1;
  const starsDisplay = "★".repeat(stars) + "☆".repeat(3 - stars);

  const strengthsHtml =
    strengths.length > 0
      ? strengths
          .map(
            (s) =>
              `<li style="margin-bottom:6px;color:#15803d;">✓ ${escapeHtml(s)}</li>`,
          )
          .join("")
      : '<li style="color:#6b7280;">Aucun point fort identifié pour le moment.</li>';

  const weaknessesHtml =
    weaknesses.length > 0
      ? weaknesses
          .map(
            (w) =>
              `<li style="margin-bottom:6px;color:#d97706;">⚠ ${escapeHtml(w)}</li>`,
          )
          .join("")
      : '<li style="color:#6b7280;">Aucune difficulté identifiée.</li>';

  const mistakesHtml =
    frequentMistakes.length > 0
      ? frequentMistakes
          .map(
            (m) =>
              `<li style="margin-bottom:6px;color:#dc2626;">✗ ${escapeHtml(m)}</li>`,
          )
          .join("")
      : '<li style="color:#6b7280;">Aucune erreur fréquente.</li>';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Rapport - ${escapeHtml(studentName)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f3f4f6;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

          <!-- Header -->
          <tr>
            <td style="background-color:#0d9488;padding:24px 32px;">
              ${emailBrandHtml({ subtitle: "Rapport de progression", logoUrl: data.logoUrl })}
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">

              <!-- Student & Topic info -->
              <p style="margin:0 0 4px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Élève</p>
              <p style="margin:0 0 16px;color:#111827;font-size:18px;font-weight:600;">${escapeHtml(studentName)}</p>

              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td width="50%" style="padding-right:8px;">
                    <p style="margin:0 0 4px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Matière</p>
                    <p style="margin:0;color:#111827;font-size:16px;font-weight:500;">${escapeHtml(subjectName)}</p>
                  </td>
                  <td width="50%" style="padding-left:8px;">
                    <p style="margin:0 0 4px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Thématique</p>
                    <p style="margin:0;color:#111827;font-size:16px;font-weight:500;">${escapeHtml(topicName)}</p>
                  </td>
                </tr>
              </table>

              <!-- Score -->
              <div style="margin:24px 0;padding:20px;background-color:#f9fafb;border-radius:8px;text-align:center;">
                <p style="margin:0 0 4px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Score</p>
                <p style="margin:0;color:${scoreColor};font-size:36px;font-weight:700;">${scorePercent}%</p>
                <p style="margin:8px 0 0;color:#d97706;font-size:24px;letter-spacing:4px;">${starsDisplay}</p>
              </div>

              <!-- Strengths -->
              <div style="margin:24px 0;">
                <h2 style="margin:0 0 12px;color:#111827;font-size:16px;font-weight:600;border-bottom:2px solid #d1fae5;padding-bottom:8px;">Points forts</h2>
                <ul style="margin:0;padding:0 0 0 20px;list-style:none;">${strengthsHtml}</ul>
              </div>

              <!-- Weaknesses -->
              <div style="margin:24px 0;">
                <h2 style="margin:0 0 12px;color:#111827;font-size:16px;font-weight:600;border-bottom:2px solid #fef3c7;padding-bottom:8px;">Points à améliorer</h2>
                <ul style="margin:0;padding:0 0 0 20px;list-style:none;">${weaknessesHtml}</ul>
              </div>

              <!-- Frequent mistakes -->
              <div style="margin:24px 0;">
                <h2 style="margin:0 0 12px;color:#111827;font-size:16px;font-weight:600;border-bottom:2px solid #fee2e2;padding-bottom:8px;">Erreurs fréquentes</h2>
                <ul style="margin:0;padding:0 0 0 20px;list-style:none;">${mistakesHtml}</ul>
              </div>

              <!-- Date -->
              <p style="margin:24px 0 0;color:#9ca3af;font-size:13px;text-align:right;">Date du rapport : ${escapeHtml(date)}</p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">Généré par Jotna School — Plateforme éducative</p>
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
