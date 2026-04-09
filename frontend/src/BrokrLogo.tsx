import type { CSSProperties } from "react";

import { classNames } from "./utils";

import brokrSvgUrl from "./assets/logo/brokr.svg?url";

export type BrokrLogoSize = "sm" | "md" | "lg";

const SIZE_PX: Record<BrokrLogoSize, number> = {
  sm: 22,
  md: 28,
  lg: 80,
};

export type BrokrLogoProps = {
  size?: BrokrLogoSize | number;
  variant?: "gradient" | "mono";
  className?: string;
  title?: string;
  decorative?: boolean;
};

export function BrokrLogo({
  size = "md",
  variant = "gradient",
  className,
  title,
  decorative = true,
}: BrokrLogoProps) {
  const px = typeof size === "number" ? size : SIZE_PX[size];

  if (variant === "mono") {
    return (
      <span
        className={classNames("brokr-logo", "brokr-logo--mono", className)}
        style={
          {
            width: px,
            height: px,
            WebkitMaskImage: `url(${brokrSvgUrl})`,
            maskImage: `url(${brokrSvgUrl})`,
          } satisfies CSSProperties
        }
        role={decorative ? "presentation" : "img"}
        aria-hidden={decorative ? true : undefined}
        aria-label={decorative ? undefined : title}
      />
    );
  }

  return (
    <img
      className={classNames("brokr-logo", "brokr-logo--gradient", className)}
      src={brokrSvgUrl}
      width={px}
      height={px}
      alt={decorative ? "" : (title ?? "Brokr")}
      decoding="async"
      draggable={false}
    />
  );
}
