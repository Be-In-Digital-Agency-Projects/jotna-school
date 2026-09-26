import { describe, it, expect } from "vitest";
import {
  IMPORT_ROWS_LIMIT,
  buildLoginCode,
  buildParentCode,
  loginCredentials,
  normalizeCode,
  printableCode,
  parseImportPaste,
  PARSE_ERROR_MESSAGES,
} from "../importCodes";

/** Tirage déterministe : la borne basse, pour que les codes soient prévisibles. */
const lowest = (min: number) => min;

describe("buildLoginCode", () => {
  it("colle le niveau et le libellé, puis quatre chiffres", () => {
    expect(buildLoginCode("CM1", "A", () => 4821)).toBe("CM1A-4821");
  });

  it("ne produit jamais de zéro en tête", () => {
    // `0821` se lit `821` sur un billet, et l'élève tape faux. La borne basse
    // du tirage est donc 1000, pas 0.
    expect(buildLoginCode("CI", "B", lowest)).toBe("CIB-1000");
  });

  it("nettoie un libellé que le directeur a saisi comme il voulait", () => {
    expect(buildLoginCode("CE2", " bleue ", () => 5000)).toBe("CE2BLEUE-5000");
    expect(buildLoginCode("CM2", "A-1", () => 5000)).toBe("CM2A1-5000");
  });
});

describe("buildParentCode", () => {
  it("préfixe et six caractères", () => {
    expect(buildParentCode(lowest)).toBe("PIO-333333");
  });

  it("n'emploie AUCUN caractère que la photocopie confond", () => {
    // C'est la raison d'être de l'alphabet : `0/O`, `1/I/L`, `5/S`, `2/Z`.
    const ambiguous = new Set(["0", "O", "1", "I", "L", "5", "S", "2", "Z"]);
    const seen = new Set<string>();
    for (let i = 0; i < 26; i++) {
      seen.add(buildParentCode(() => i).slice(4, 5));
    }
    for (const c of seen) {
      expect(ambiguous.has(c)).toBe(false);
    }
  });
});

describe("normalizeCode", () => {
  it("met en minuscules — c'est ce qui permet de se connecter", () => {
    // `Password.authorize` passe par `profile()` À LA CONNEXION AUSSI, et
    // `convex/auth.ts` y fait `.toLowerCase()`. Un compte créé avec les
    // majuscules serait introuvable au moment d'entrer.
    expect(normalizeCode("CM1A-4821")).toBe("cm1a-4821");
  });

  it("absorbe les espaces qu'un enfant ou un tableur ajoute", () => {
    expect(normalizeCode("  CM1A-4821 ")).toBe("cm1a-4821");
    expect(normalizeCode("CM1A - 4821")).toBe("cm1a-4821");
  });

  it("est idempotente", () => {
    const once = normalizeCode("PIO-7C4K2M");
    expect(normalizeCode(once)).toBe(once);
  });
});

describe("parseImportPaste", () => {
  it("lit le format annoncé", () => {
    const r = parseImportPaste("Awa Diop, CM1\nMoussa Fall, CE2");
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { line: 1, name: "Awa Diop", class: "CM1", label: "" },
      { line: 2, name: "Moussa Fall", class: "CE2", label: "" },
    ]);
  });

  it("accepte le point-virgule et la tabulation", () => {
    // Un tableur en produit sans prévenir, et le directeur n'a pas à le savoir.
    const r = parseImportPaste("Awa Diop; CM1\nMoussa Fall\tCE2");
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => x.class)).toEqual(["CM1", "CE2"]);
  });

  it("prend la classe au DERNIER champ, pas au second", () => {
    // « Diop, Awa, CM1 » est une façon naturelle d'écrire un nom.
    const r = parseImportPaste("Diop, Awa, CM1");
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toEqual({
      line: 1,
      name: "Diop Awa",
      class: "CM1",
      label: "",
    });
  });

  it("lit le libellé de classe, collé ou séparé", () => {
    // Une école qui a un CM1 A et un CM1 B ne peut pas être servie par le seul
    // niveau — et ce sont justement les grandes écoles qui importent en masse.
    const r = parseImportPaste("Awa Diop, CM1 A\nMoussa Fall, CE2B");
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => [x.class, x.label])).toEqual([
      ["CM1", "A"],
      ["CE2", "B"],
    ]);
  });

  it("laisse le libellé vide quand le directeur n'en donne pas", () => {
    // C'est l'appelant qui résout contre les classes de l'école, et qui refuse
    // si le niveau en compte plusieurs : lui seul voit la base.
    const r = parseImportPaste("Awa Diop, CM1");
    expect(r.rows[0].label).toBe("");
  });

  it("accepte un libellé numérique — « CP7 » est le CP numéro 7", () => {
    // Des écoles numérotent leurs classes. Le refuser obligerait le directeur
    // à réécrire sa liste ; l'accepter ne risque rien, puisque l'appelant
    // refuse de toute façon si l'école n'a pas cette classe-là.
    const r = parseImportPaste("Moussa Fall, CP7");
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ class: "CP", label: "7" });
  });

  it("refuse un niveau tronqué plutôt que de deviner", () => {
    // « CM » ne désigne ni CM1 ni CM2 : deviner mettrait l'enfant dans la
    // mauvaise classe, ce qu'aucun message ne rattraperait.
    const r = parseImportPaste("Awa Diop, CM");
    expect(r.rows).toEqual([]);
    expect(r.errors[0].reason).toBe("unknown_class");
  });

  it("IGNORE les lignes vides au lieu de les refuser", () => {
    // Un collage se termine presque toujours par un saut de ligne.
    const r = parseImportPaste("\nAwa Diop, CM1\n\n\nMoussa Fall, CE2\n\n");
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(2);
  });

  it("numérote ses refus sur le collage d'origine", () => {
    // Un import de 400 élèves qui échoue sans dire OÙ est un import qu'on
    // recommence à l'aveugle. La ligne vide ne décale pas le compte.
    const r = parseImportPaste("Awa Diop, CM1\n\nMoussa Fall, 6EME");
    expect(r.rows).toHaveLength(1);
    expect(r.errors).toEqual([
      { line: 3, raw: "Moussa Fall, 6EME", reason: "unknown_class" },
    ]);
  });

  it("nomme chacun des quatre motifs", () => {
    const r = parseImportPaste(
      ["Awa Diop", ", CM1", `${"x".repeat(81)}, CM1`, "Moussa, SIXIEME"].join(
        "\n",
      ),
    );
    expect(r.rows).toEqual([]);
    expect(r.errors.map((e) => e.reason)).toEqual([
      "missing_class",
      "missing_name",
      "name_too_long",
      "unknown_class",
    ]);
  });

  it("ne s'arrête pas à la première erreur", () => {
    // Le directeur voit tout ce qui cloche d'un coup et recolle UNE fois.
    const r = parseImportPaste("Bad1\nAwa Diop, CM1\nBad2");
    expect(r.rows).toHaveLength(1);
    expect(r.errors).toHaveLength(2);
  });

  it("signale un collage trop long sans perdre ce qu'il a lu", () => {
    const paste = Array.from(
      { length: IMPORT_ROWS_LIMIT + 5 },
      (_, i) => `Eleve ${i}, CM1`,
    ).join("\n");
    const r = parseImportPaste(paste);
    expect(r.toolong).toBe(true);
    expect(r.rows).toHaveLength(IMPORT_ROWS_LIMIT);
  });

  it("chaque motif a sa phrase, et TypeScript l'exigera du prochain", () => {
    for (const reason of [
      "missing_class",
      "unknown_class",
      "missing_name",
      "name_too_long",
    ] as const) {
      expect(PARSE_ERROR_MESSAGES[reason]).toBeTruthy();
    }
  });
});

describe("loginCredentials", () => {
  // LE PIÈGE QUE CES TESTS GARDENT : identifiant en minuscules, secret en
  // MAJUSCULES. Un écran qui enverrait la même chaîne aux deux champs
  // marcherait pour l'enfant qui tape en majuscules et laisserait l'autre
  // dehors, sans que rien n'explique pourquoi.
  it("sépare l'identifiant du secret : minuscules contre majuscules", () => {
    expect(loginCredentials("CM1A-4821")).toEqual({
      email: "cm1a-4821",
      password: "CM1A-4821",
    });
  });

  it("l'enfant qui tape tout en minuscules entre quand même", () => {
    expect(loginCredentials("cm1a-4821")).toEqual({
      email: "cm1a-4821",
      password: "CM1A-4821",
    });
  });

  it("reproduit exactement ce que la création du compte a posé", () => {
    // `studentImportRun.ts` fait `{ id: normalizeCode(c), secret: c }` où `c`
    // sort de `buildLoginCode`. La paire rendue ici doit être la même.
    const printable = buildLoginCode("CM2", "B", () => 3907);
    expect(loginCredentials(printable)).toEqual({
      email: normalizeCode(printable),
      password: printable,
    });
  });

  it("absorbe les espaces d'une saisie hésitante", () => {
    expect(loginCredentials("  CM1A - 4821 ")).toEqual({
      email: "cm1a-4821",
      password: "CM1A-4821",
    });
  });
});

describe("printableCode", () => {
  it("rend la forme du billet", () => {
    expect(printableCode(" cm1a-4821 ")).toBe("CM1A-4821");
  });

  it("est l'inverse de casse de normalizeCode", () => {
    const raw = "CiB-1000";
    expect(normalizeCode(printableCode(raw))).toBe(normalizeCode(raw));
  });
});
