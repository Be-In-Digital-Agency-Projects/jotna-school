import Image from "next/image";
import Link from "next/link";

import { cn } from "@/lib/utils";

type BrandSize = "sm" | "md" | "lg";

type BrandProps = {
  className?: string;
  href?: string;
  size?: BrandSize;
  /** When true, render only the logo image without a Link wrapper. */
  asImage?: boolean;
  priority?: boolean;
};

/**
 * LES DIMENSIONS SUIVENT LE FICHIER, qui n'est plus carré : 1024 x 656, soit
 * un rapport de 1,561. Les déclarer carrées faisait réserver à Next/Image une
 * boîte qui ne correspondait pas à l'image, d'où un saut de mise en page au
 * chargement.
 *
 * LES `scale-125` / `scale-150` ONT DISPARU, et ce n'est pas une simplification
 * gratuite : ils compensaient les larges marges vides de l'ancien fichier, qui
 * ne laissait au dessin qu'environ la moitié de sa hauteur. Le nouveau est
 * détouré au plus près, donc `h-16` donne vraiment seize unités de dessin.
 * Garder l'agrandissement aurait affiché un logo deux fois trop grand.
 */
const SIZES: Record<BrandSize, { w: number; h: number; className: string }> = {
  sm: { w: 250, h: 160, className: "h-10 w-auto" },
  md: { w: 400, h: 256, className: "h-14 w-auto" },
  lg: { w: 599, h: 384, className: "h-20 w-auto" },
};

export function Brand({
  className,
  href = "/",
  size = "sm",
  asImage = false,
  priority = false,
}: BrandProps) {
  const dims = SIZES[size];
  const image = (
    <Image
      src="/jotna-logo.png"
      alt="Jotna School"
      width={dims.w}
      height={dims.h}
      priority={priority}
      className={cn("select-none", dims.className, className)}
    />
  );

  if (asImage) return image;

  return (
    <Link
      href={href}
      aria-label="Jotna School, retour à l'accueil"
      className="inline-flex items-center"
    >
      {image}
    </Link>
  );
}
