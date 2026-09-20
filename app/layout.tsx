import type { Metadata } from "next";
import { Poppins, Geist_Mono, Fredoka, Amiri } from "next/font/google";
import "./globals.css";
import ConvexClientProvider from "@/components/ConvexClientProvider";

const poppins = Poppins({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// D16 — display font for kid surfaces (h1/h2 in /student/*).
// Variable axis = weight; only Latin subset (~40kb gzip).
const fredoka = Fredoka({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// Module « Arabe & Coran » — la police du texte arabe et du Coran.
//
// AMIRI, ET PAS UNE POLICE SYSTÈME. L'arabe des polices d'interface place mal
// les voyelles brèves et écrase les points quand la lettre est attachée : sur
// un écran de téléphone, un enfant ne distingue plus بَ de بِ, qui est
// exactement ce que le niveau 2 lui demande de distinguer. Amiri est un naskh
// de tradition typographique, dessiné pour le texte vocalisé.
//
// `subsets: ["arabic"]` seulement : le latin de cette page vient de Poppins,
// et embarquer le latin d'Amiri doublerait le téléchargement pour rien.
//
// La variable `--font-arabic` est lue à deux endroits : la classe
// `.font-arabic` (app/globals.css) et le carré d'écriture, qui doit dessiner
// son modèle DANS LA MÊME POLICE que la lettre affichée, sans quoi la note du
// tracé jugerait contre un dessin que l'enfant n'a jamais vu
// (components/arabic/tracing-canvas.tsx).
const amiri = Amiri({
  variable: "--font-arabic",
  subsets: ["arabic"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "Jotna School - Apprends en t'amusant",
  description:
    "Plateforme educative gamifiee pour apprendre les matieres scolaires avec des exercices interactifs, des badges et un suivi parental.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      className={`${poppins.variable} ${geistMono.variable} ${fredoka.variable} ${amiri.variable} h-full antialiased`}
      style={{ colorScheme: "light" }}
    >
      <body className="min-h-full flex flex-col bg-white text-gray-900">
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
