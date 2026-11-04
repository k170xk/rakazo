import { useMemo } from "react";

/**
 * Evolve recolours unDraw illustrations through its own proxy. A Bot's computer has no such proxy,
 * so pictures are used exactly as given.
 */
export function getBrandedSvgUrl(
  imageUrl: string | undefined,
  _brandColor: string,
): string | undefined {
  return imageUrl || undefined;
}

export function useBrandedSvg(
  imageUrl: string | undefined,
  brandColor: string,
): string | undefined {
  return useMemo(
    () => getBrandedSvgUrl(imageUrl, brandColor),
    [imageUrl, brandColor],
  );
}
