import type { ComponentProps } from "react";
import { Img } from "remotion";

/**
 * An image the render waits for, so no frame is captured before it has loaded. A picture that
 * cannot be fetched is left out of the frame instead of failing the whole video.
 */
export const Picture: React.FC<
  Omit<ComponentProps<"img">, "src"> & { src?: string }
> = ({ src, ...rest }) => {
  if (!src) return null;
  return <Img {...rest} src={src} maxRetries={2} onError={() => undefined} />;
};
