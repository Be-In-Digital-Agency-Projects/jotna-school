"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import OpenAI from "openai";
import {
  exerciseExtractionSchema,
  type ExtractionResponse,
} from "../lib/openai-schema";
import { evaluateBudget } from "./aiGateway/budget";
import { estimateCostUsd, getPurposeConfig } from "./aiGateway/registry";
import { monthKey } from "./aiGateway/spendShards";

/**
 * Fetch a PDF from Convex storage, send it to OpenAI GPT-4 with Structured
 * Outputs, and create draft exercises from the response.
 *
 * Runs in Node runtime (`"use node"`) because it relies on the global
 * `Buffer` API to base64-encode the PDF for the OpenAI Responses API.
 *
 * ## Pourquoi ce module ne passe pas par `aiGateway.generate`
 *
 * La passerelle ne sait faire qu'un appel `chat.completions` texte. Ici on
 * envoie un fichier en base64 via l'API Responses avec une sortie structurée :
 * une autre forme d'API. Tordre la passerelle pour l'y faire entrer coûterait
 * plus cher que ça ne rapporte.
 *
 * On ferme donc le trou en deux gestes explicites, aux deux endroits qui
 * comptent : **vérifier le budget avant** de dépenser, et **enregistrer la
 * dépense réelle après** — l'API Responses renvoie son compte de jetons, et le
 * tarif `gpt-4o` est désormais dans `registry.ts`. Même agrégat, même plafond
 * que le reste.
 *
 * Ce qui resterait à faire pour le router vraiment : donner à `generate` un
 * mode « fichier » (entrée `input_file` + `text.format.json_schema`), lui
 * laisser porter les réessais et le verrou d'accès, et contraindre
 * `resolveModel` aux modèles qui supportent les sorties structurées — sinon un
 * `modelOverrides` administrateur casserait l'extraction en silence. Tant que
 * ce n'est pas fait, les deux gestes ci-dessous doivent rester synchronisés à
 * la main avec `index.ts`.
 */
export const extract = internalAction({
  args: { uploadId: v.id("pdfUploads") },
  handler: async (ctx, { uploadId }) => {
    const upload = await ctx.runQuery(internal.pdfUploads.getUploadInternal, {
      uploadId,
    });
    if (!upload) {
      await ctx.runMutation(internal.pdfUploads.markError, {
        uploadId,
        error: "Upload introuvable.",
      });
      return;
    }

    const month = monthKey();
    const traceId = `tr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const cfg = getPurposeConfig("pdf_extract");

    // --- Geste 1 : vérifier le budget AVANT de dépenser. -------------------
    //
    // Portée « system » et usage non génératif au sens de `budget.ts` : seul
    // le palier `hard_reject` (>= 110 % du budget) arrête l'extraction. C'est
    // volontairement le même arbitrage que pour les autres postes — durcir ce
    // seuil pour l'import PDF (le plus cher, et différable) est une décision
    // produit, pas une décision de ce correctif.
    await ctx.runMutation(internal.aiGateway.db.ensureSettings, {});
    const settings = await ctx.runQuery(internal.aiGateway.db.getSettings, {});
    const spendUsd: number = await ctx.runQuery(
      internal.aiGateway.db.getMonthSpend,
      { month },
    );
    const budgetDecision = evaluateBudget("pdf_extract", "system", {
      spendUsd,
      budgetUsd: settings?.aiMonthlyBudgetUsd ?? 100,
      economyForced: settings?.economyMode ?? false,
    });
    if (!budgetDecision.allowed) {
      await ctx.runMutation(internal.aiGateway.db.recordUsage, {
        purpose: "pdf_extract",
        modelUsed: cfg.defaultModel,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        latencyMs: 0,
        status: "rejected_budget",
        traceId,
        metadata: { uploadId, tier: budgetDecision.tier },
        month,
        errorMessage: budgetDecision.reason,
      });
      await ctx.runMutation(internal.pdfUploads.markError, {
        uploadId,
        error:
          "Budget IA du mois atteint : l'extraction est suspendue. Ajustez le plafond dans Paramètres IA, puis relancez l'import.",
      });
      return;
    }

    const startedAt = Date.now();
    try {
      const fileUrl = await ctx.storage.getUrl(upload.storageId);
      if (!fileUrl) {
        throw new Error("Impossible de récupérer l'URL du fichier.");
      }

      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(
          `Erreur lors du téléchargement du fichier: ${response.status}`,
        );
      }

      const arrayBuffer = await response.arrayBuffer();
      const base64Content = Buffer.from(arrayBuffer).toString("base64");

      const openai = new OpenAI();

      const completion = await openai.responses.create({
        // Depuis le registre : le tarif et le modèle appelé ne peuvent pas
        // diverger.
        model: cfg.defaultModel,
        store: false,
        instructions: `Tu es un assistant pédagogique spécialisé dans la création d'exercices pour les élèves de CE2 à CM2 (8-11 ans).
Analyse le document PDF fourni et extrais tous les exercices que tu peux identifier.

RÈGLE CRITIQUE — DÉCOMPOSITION DES ITEMS NUMÉROTÉS :
Un "exercice" dans le PDF est souvent UNE CONSIGNE + PLUSIEURS ITEMS NUMÉROTÉS (1., 2., 3., ou a), b), c)).
Dans ce cas, tu DOIS créer UN exercice SÉPARÉ PAR ITEM — pas un seul exercice global, pas juste le premier item.

Exemple : si le PDF dit "Exercice 3 : Trouve le COD. 1. Le commerçant ferme sa boutique. 2. Nous écoutons la radio. 3. ..."
→ Génère 3+ exercices distincts, chacun contenant :
   - prompt : "Trouve le COD dans la phrase : 'Le commerçant ferme sa boutique.'"  (reprends le contexte de la consigne globale + l'item)
   - type : short-answer (par exemple)
   - acceptedAnswers : ["sa boutique", "la boutique", "boutique"]

Chaque item de liste numérotée doit devenir son propre exercice indépendant avec sa propre réponse, ses propres indices, et une consigne qui réintègre le contexte de l'énoncé global.

Si un exercice contient une liste d'items à traiter, NE RENVOIE PAS un seul exercice avec seulement le premier item. Décompose-le.


Pour chaque exercice, détermine le type d'INTERACTION le plus adapté à une application web interactive (PAS à un exercice papier):
- qcm: Question à choix multiples. Payload: {options: string[], correctIndex: number, explanation?: string}
- match: Association de paires gauche↔droite en cliquant. Payload: {pairs: [{left: string, right: string}]}
- order: Remise en ordre par drag-and-drop d'une séquence. Payload: {correctSequence: string[]}
- drag-drop: Glisser-déposer des éléments dans des zones cibles. Payload: {zones: string[], items: [{text: string, correctZone: string}]}
- short-answer: Réponse courte à taper au clavier. Payload: {acceptedAnswers: string[], tolerance?: string}
  IMPORTANT pour short-answer : acceptedAnswers doit contenir TOUTES les variantes linguistiquement valides.
  Pour la conjugaison : inclure TOUS les temps possibles si l'énoncé ne spécifie pas un temps précis.
  Exemple : "Hier, elle (dire) ___ la vérité." → acceptedAnswers: ["dit", "a dit", "disait"]
  (passé simple, passé composé ET imparfait sont tous corrects — sauf si l'énoncé force un temps).
  Pour les réponses numériques : inclure "10", "dix". Pour l'orthographe : inclure les variantes avec/sans accents, majuscules, etc.

RÈGLE IMPORTANTE — ADAPTATION DE LA CONSIGNE :
Le document PDF est prévu pour un exercice sur papier (recopier, souligner, classer dans un tableau, cocher, etc.).
Ton application est INTERACTIVE. Tu DOIS REFORMULER la consigne ("prompt") pour qu'elle corresponde exactement à l'interaction que tu as choisie.

Exemples d'adaptation OBLIGATOIRE :
- PDF "Classe les groupes dans le bon tableau" + type=match → "Associe chaque groupe à sa nature (temps, lieu, cause...)"
- PDF "Recopie la bonne réponse" + type=short-answer → "Écris la bonne réponse"
- PDF "Entoure les verbes conjugués" + type=qcm → "Clique sur le verbe conjugué dans la liste"
- PDF "Souligne les compléments circonstanciels" + type=match → "Relie chaque phrase à son complément"
- PDF "Range ces mots dans l'ordre alphabétique" + type=order → "Fais glisser les mots dans l'ordre alphabétique"
- PDF "Place chaque mot dans la bonne colonne" + type=drag-drop → "Glisse chaque mot dans la bonne zone"

Bannis ABSOLUMENT de la consigne les verbes liés au papier : recopie, souligne, entoure, coche, barre, trace, classe dans un tableau, écris dans la colonne, coller, découper.
Utilise à la place : associe, relie, clique, choisis, glisse, écris ta réponse, mets dans l'ordre.

Pour chaque exercice, fournis :
- prompt : une consigne CLAIRE, COURTE et ADAPTÉE au type d'interaction choisi (pas de référence au papier)
- payload : les données correspondant au type
- answerKey : la réponse correcte sous forme lisible
- hints : exactement 3 indices progressifs (du plus vague au plus précis)

Commence par identifier le thème global du document (ex: "Les fractions", "La conjugaison au présent", "Les compléments circonstanciels") et retourne-le dans le champ "suggestedTopic".

Si le document ne contient pas d'exercices identifiables, crée des exercices pertinents basés sur le contenu du document.`,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_file" as const,
                filename: upload.originalFilename,
                file_data: `data:${upload.mimeType};base64,${base64Content}`,
              },
              {
                type: "input_text" as const,
                text: `Analyse ce document PDF et extrais les exercices pour le niveau CE2-CM2. Nom du fichier: ${upload.originalFilename}`,
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            ...exerciseExtractionSchema,
          },
        },
      });

      // --- Geste 2 : enregistrer la dépense RÉELLE après. ------------------
      //
      // Avant toute validation locale : à partir d'ici la réponse est reçue,
      // donc facturée, quoi qu'on en fasse ensuite. Même raisonnement que dans
      // `aiGateway/index.ts` — un `JSON.parse` qui échoue n'annule pas la
      // facture d'OpenAI.
      //
      // Si `usage` manque — le SDK le déclare optionnel — écrire zéro rendrait
      // invisible au plafond la dépense la plus chère du dépôt. On BORNE au
      // lieu d'estimer :
      //
      //   - la sortie ne peut pas dépasser `maxOutputTokens`, c'est donc un
      //     vrai majorant (~0,16 $ à ce tarif) ;
      //   - l'entrée n'est pas estimée. La longueur d'un PDF en base64 n'est
      //     pas un nombre de jetons, et l'extrapoler donnerait des centaines de
      //     milliers de jetons fictifs qui feraient sauter le plafond à tort.
      //     Un faux positif couperait l'IA de tous les élèves ; c'est pire que
      //     de sous-compter un import rare.
      //
      // Le repli est donc un minorant, mais un minorant NON NUL et borné : la
      // dépense cesse d'être invisible sans jamais pouvoir couper à tort. La
      // passerelle, elle, peut estimer ses deux côtés (`approximateTokenCount`)
      // parce que son entrée est du texte.
      const inputTokens = completion.usage?.input_tokens ?? 0;
      const outputTokens = completion.usage?.output_tokens ?? cfg.maxOutputTokens;
      await ctx.runMutation(internal.aiGateway.db.recordUsage, {
        purpose: "pdf_extract",
        modelUsed: cfg.defaultModel,
        inputTokens,
        outputTokens,
        costUsd: estimateCostUsd("pdf_extract", inputTokens, outputTokens),
        latencyMs: Date.now() - startedAt,
        status: "ok",
        traceId,
        metadata: { uploadId },
        month,
      });

      const outputText = completion.output_text;
      const extraction: ExtractionResponse = JSON.parse(outputText);

      await ctx.runMutation(internal.pdfUploads.markExtracted, {
        uploadId,
        extractedRaw: extraction,
        extractedAt: Date.now(),
      });

      if (extraction.exercises.length > 0) {
        // Parse each payload (delivered as JSON string by OpenAI) before persisting.
        const parsedExercises = extraction.exercises.map((ex) => {
          let parsedPayload: unknown = {};
          try {
            parsedPayload = JSON.parse(ex.payload);
          } catch {
            parsedPayload = {};
          }
          return { ...ex, payload: parsedPayload };
        });

        await ctx.runMutation(internal.pdfUploads.createDraftExercises, {
          uploadId,
          exercises: parsedExercises,
          subjectId: upload.subjectId,
          suggestedTopicName: extraction.suggestedTopic,
        });
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Erreur inconnue";
      console.error("Extraction error:", message);
      // Coût zéro : soit l'appel a échoué avant toute réponse, soit la réponse
      // est arrivée et a DÉJÀ été comptée juste au-dessus par sa propre ligne
      // `ok`. Cette ligne-ci ne sert qu'à rendre l'échec visible dans les
      // incidents de l'écran admin.
      await ctx.runMutation(internal.aiGateway.db.recordUsage, {
        purpose: "pdf_extract",
        modelUsed: cfg.defaultModel,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        latencyMs: Date.now() - startedAt,
        status: "failed",
        traceId,
        metadata: { uploadId },
        month,
        errorMessage: message,
      });
      await ctx.runMutation(internal.pdfUploads.markError, {
        uploadId,
        error: message,
      });
    }
  },
});
