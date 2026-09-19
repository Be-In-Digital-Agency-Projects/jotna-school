import { Email } from "@convex-dev/auth/providers/Email";
import { generatePasswordResetEmailHtml } from "../lib/password-reset-email-template";

export const ResendOTPPasswordReset = Email({
  id: "resend-otp-password-reset",
  apiKey: process.env.RESEND_API_KEY,
  maxAge: 60 * 15,
  async generateVerificationToken() {
    const buf = new Uint8Array(4);
    crypto.getRandomValues(buf);
    const num =
      ((buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3]) >>> 0;
    return (num % 1_000_000).toString().padStart(6, "0");
  },
  async sendVerificationRequest({ identifier: email, provider, token }) {
    if (!provider.apiKey) {
      throw new Error("RESEND_API_KEY n'est pas configuré.");
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        from: "Jotna School <noreply@jotnaschool.app>",
        to: [email],
        subject: "Jotna School — Réinitialisation de votre mot de passe",
        html: generatePasswordResetEmailHtml({
          code: token,
          logoUrl: process.env.EMAIL_LOGO_URL,
        }),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Échec d'envoi du code de réinitialisation: ${res.status} ${body}`);
    }
  },
});
