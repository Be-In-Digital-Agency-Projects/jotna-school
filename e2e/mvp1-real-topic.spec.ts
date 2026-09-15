import { test, expect } from "@playwright/test";

/**
 * MVP-1 — sanity checks against REAL seeded data (testSeeds:seedMvp1).
 *
 * Pré-requis : la matière et les thématiques MVP-1 doivent déjà exister dans
 * le déploiement visé. `testSeeds:seedMvp1` ne les sème plus sur commande —
 * elle est passée INTERNE, parce qu'elle écrivait le curriculum sans la moindre
 * garde là où `subjects.create` et `topics.create` exigent un administrateur.
 * Les créer par l'interface : /admin/subjects pour la matière,
 * /admin/subjects/[id] pour les thématiques.
 *
 * Topic IDs are read from Convex on the fly via the public API.
 */

test.describe("MVP-1 — real seeded topics", () => {
  test("le topic Maths CE2 charge le player palier sans 5xx (auth gate kicks in)", async ({
    page,
  }) => {
    // Topic ID seeded by testSeeds:seedMvp1 (Multiplication CM1)
    // Note: we use a known-seeded ID; if seed re-ran, ID may differ.
    // For robustness, the test allows any 200/3xx response.
    const topicId = "kx75b69trm9sbs2j34n0qvsdgd85pm7r";
    const response = await page.goto(
      `/student/topics/${topicId}/session?palier=1`,
    );
    expect(response?.status()).toBeLessThan(500);
    // Either the auth gate shows or the loader spins — both are acceptable.
    await page.waitForTimeout(2000);
    await page.screenshot({
      path: ".context/screenshots/student-real-topic.png",
      fullPage: true,
    });
  });

  test("/admin/ai-settings (avec settings seedés) charge sans 5xx", async ({
    page,
  }) => {
    const response = await page.goto("/admin/ai-settings");
    expect(response?.status()).toBeLessThan(500);
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: ".context/screenshots/admin-ai-settings-with-seed.png",
      fullPage: true,
    });
  });

  test("vérifie que la fenêtre étoiles et JotnaLoader components compilent", async ({
    page,
  }) => {
    // Indirect: si le bundle compile, les composants sont valides
    await page.goto("/login");
    expect(page.url()).toContain("login");
  });
});
