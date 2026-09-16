<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

<!-- afrotools-start -->
# Afro.tools — specs d'API africaines

`.mcp.json` déclare le serveur MCP [Afro.tools](https://afro.tools) : un registre
de specs structurées pour les API africaines (Bictorys, PayDunya, Wave…), utile
quand on touche à `convex/billingBictorys.ts` ou `convex/billingPaydunya.ts`.

**Il ne fonctionne PAS depuis Claude Code sur le web** : l'environnement distant
bloque `mcp.afro.tools` au niveau du proxy de sortie, comme il bloque
`bictorys.com` et `developers.paydunya.com`. En session locale, il se charge au
démarrage.

Ce qui en vient reste de la DOCUMENTATION TIERCE, pas une vérité sur notre code :
leur registre donnait Bictorys pour « planned », et leur propre suivi de bugs
signale que la doc Bictorys décrit une signature HMAC que Bictorys n'envoie pas.
Vérifier avant d'agir.
<!-- afrotools-end -->
