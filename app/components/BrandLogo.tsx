import Link from "next/link";

type Variant = "full" | "mark" | "emblem";
type Surface = "dark" | "light";

const SOURCES: Record<Variant, Record<Surface, string>> = {
  full: { dark: "/brand/bdm-logo.svg", light: "/brand/bdm-logo.svg" },
  mark: { dark: "/brand/bdm-mark.svg", light: "/brand/bdm-mark-light.svg" },
  emblem: { dark: "/brand/bdm-emblem.svg", light: "/brand/bdm-emblem.svg" }
};

/** Intrinsic width / height of each asset, used to keep the layout stable. */
const RATIO: Record<Variant, number> = {
  full: 560 / 240,
  mark: 88 / 72,
  emblem: 1
};

/**
 * The single source of truth for the BDM lockup.
 *
 * `full` is the emblem + metallic wordmark + PERSONAL AI label, `emblem` is
 * the detailed round mark, and `mark` is the compact monogram for small
 * sizes. All three are original vector assets served from /public/brand.
 */
export default function BrandLogo({
  variant = "full",
  surface = "dark",
  size = variant === "full" ? 48 : 40,
  href,
  className,
  decorative = false,
  label = "BDM Personal AI"
}: {
  variant?: Variant;
  surface?: Surface;
  size?: number;
  href?: string;
  className?: string;
  decorative?: boolean;
  label?: string;
}) {
  const width = Math.round(size * RATIO[variant]);

  const image = (
    // eslint-disable-next-line @next/next/no-img-element -- local, unoptimised brand vector
    <img
      src={SOURCES[variant][surface]}
      alt={decorative ? "" : label}
      width={width}
      height={size}
      className={className}
      style={{ display: "block", height: size, width: width }}
      decoding="async"
    />
  );

  if (!href) return image;

  return (
    <Link href={href} className="brand-link" aria-label={`${label} home`}>
      {image}
    </Link>
  );
}
