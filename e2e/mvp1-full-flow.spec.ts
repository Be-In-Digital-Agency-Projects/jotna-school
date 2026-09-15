import { test, expect } from "@playwright/test";

/**
 * MVP-1 — Full flow E2E with REAL auth (registration + login + palier player).
 *
 * Tests register → login → navigate to palier → trigger AI generation → screenshot.
 *
 * Coût IA : ~$0.05 par run (1 génération palier_base via OpenAI).
 *
 * Pré-requis : la matière et les thématiques MVP-1 doivent déjà exister dans
 * le déploiement visé. `testSeeds:seedMvp1` ne les sème plus sur commande —
 * elle est passée INTERNE, parce qu'elle écrivait le curriculum sans la moindre
 * garde là où `subjects.create` et `topics.create` exigent un administrateur.
 * Les créer par l'interface : /admin/subjects pour la matière,
 * /admin/subjects/[id] pour les thématiques.
 */

test.describe("MVP-1 — Full E2E with auth", () => {
  test("registers + logs in + navigates to palier (1ère gen IA)", async ({
    page,
  }) => {
    test.setTimeout(180_000); // includes login + OpenAI generation (up to 90s)

    // Unique email per run
    const ts = Date.now();
    const email = `e2e-test-${ts}@jotna.test`;
    const password = "TestPass123!";

    // 1. Register as student
    await page.goto("/register");
    await expect(
      page.getByRole("heading", { name: /Créer un compte/i }),
    ).toBeVisible();

    // Labels not associated via for/id, use type selectors
    await page.locator('input[type="text"]').fill(`E2E Student ${ts}`);
    await page.locator('input[type="email"]').fill(email);
    const passwordFields = page.locator('input[type="password"]');
    await passwordFields.nth(0).fill(password);
    await passwordFields.nth(1).fill(password);
    await page.locator("select").selectOption("student");

    await page.screenshot({
      path: ".context/screenshots/01-register-form.png",
      fullPage: true,
    });

    // Submit
    await page.getByRole("button", { name: /Créer un compte|S'inscrire|Register/i }).first().click();

    // 2. Wait for redirect (could be /login or /post-auth or /student/...)
    await page.waitForURL(/\/(login|post-auth|student|parent|teacher|home)/, {
      timeout: 30_000,
    });
    await page.screenshot({
      path: ".context/screenshots/02-after-register.png",
      fullPage: true,
    });

    // 3. If redirected to /login, log in explicitly
    if (page.url().includes("/login")) {
      await page.locator('input[type="email"]').fill(email);
      await page.locator('input[type="password"]').first().fill(password);
      await page.getByRole("button", { name: /Se connecter/i }).first().click();
      // Wait for navigation AWAY from /login (more specific than before)
      await page.waitForFunction(() => !location.pathname.includes("/login"), {
        timeout: 30_000,
      });
    }
    // Wait for any landing redirect (post-auth → /student/home etc) to settle
    // and Convex auth cookie to fully propagate
    await page.waitForTimeout(5000);
    await page.screenshot({
      path: ".context/screenshots/02b-after-login.png",
      fullPage: true,
    });

    // 4. Navigate via natural user flow: dashboard → Mathématiques → topic
    await page.goto("/student/home");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3000);
    await page.screenshot({
      path: ".context/screenshots/03a-dashboard.png",
      fullPage: true,
    });

    // Click Mathématiques card to view its topics
    await page.getByRole("link", { name: /Mathématiques/i }).first().click();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3000);
    await page.screenshot({
      path: ".context/screenshots/03b-subject-maths.png",
      fullPage: true,
    });

    // Click "Commencer" on Fractions topic — preserves SPA auth context
    await page.getByText(/Commencer/i).first().click();
    await page.waitForLoadState("domcontentloaded");

    // Diagnostic: capture URL + cookies + localStorage + sessionStorage
    const urlAfterClick = page.url();
    console.log("URL after click:", urlAfterClick);
    const ls = await page.evaluate(() => Object.keys(localStorage));
    const ss = await page.evaluate(() => Object.keys(sessionStorage));
    const cookies = await page.context().cookies();
    console.log("localStorage:", ls);
    console.log("sessionStorage:", ss);
    console.log("Cookies:", cookies.map(c => `${c.name}=${c.domain}${c.path}`));

    await page.waitForTimeout(15_000); // longer wait for Convex auth + palier load

    await page.screenshot({
      path: ".context/screenshots/04-palier-rendered.png",
      fullPage: true,
    });

    const finalUrl = page.url();
    const bodyText = (await page.textContent("body"))?.slice(0, 500) ?? "";
    console.log("Final URL:", finalUrl);
    console.log("Body sample:", bodyText);

    expect(finalUrl).toMatch(/\/student\/topics\/.*\/session/);
  });
});
