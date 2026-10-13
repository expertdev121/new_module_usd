"use client";

/**
 * Logo image for the circular identity avatar, auto-scaled so the FULL image
 * (not just its visible content) always sits entirely inside the circle —
 * no clipping, for any aspect ratio.
 *
 * Why this is needed: `object-contain` only fits an image into the square
 * bounding box of its frame. A circle is inscribed *inside* that square, so a
 * square-filling image's corners (and a wide image's left/right edges, which
 * reach the box's full width) fall outside the circle and get clipped by the
 * `overflow-hidden rounded-full` mask. The fix is purely geometric: once we
 * know the image's real aspect ratio (from onLoad), shrink it by whatever
 * factor makes its bounding-box diagonal fit inside the circle's diameter.
 * Round/square icon-only logos barely shrink; wide icon+wordmark logos shrink
 * a bit more — but either way, nothing gets cut off.
 */
import { useEffect, useRef, useState } from "react";

function computeFitScale(w: number, h: number): number {
  // Dimensions object-contain would render into a 1x1 box (longer side = 1).
  const longSide = Math.max(w, h);
  const fitW = w / longSide;
  const fitH = h / longSide;
  const diag = Math.sqrt(fitW * fitW + fitH * fitH);
  // diag <= 1 means every corner of the image's bounding box is within the
  // circle inscribed in the 1x1 frame. Shrink further if it isn't, plus a
  // small safety margin so edges never touch the mask exactly.
  const fitScale = diag > 1 ? 1 / diag : 1;
  return fitScale * 0.96;
}

export function FitLogo({ src, alt = "" }: { src: string; alt?: string }) {
  const [scale, setScale] = useState(1);
  const imgRef = useRef<HTMLImageElement>(null);

  function handleLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
    if (!w || !h) return;
    setScale(computeFitScale(w, h));
  }

  // This page is server-rendered, so the <img> tag (and its src) exists in the
  // HTML before React hydrates. If the image is already in the browser cache
  // it can finish loading — and fire its native "load" event — before React
  // attaches the onLoad listener, so handleLoad above never runs and the logo
  // is left unscaled (clipped again). Catch that race on mount by checking
  // `complete`/`naturalWidth` directly once the ref is attached.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth && img.naturalHeight) {
      setScale(computeFitScale(img.naturalWidth, img.naturalHeight));
    }
  }, []);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imgRef}
      src={src}
      alt={alt}
      onLoad={handleLoad}
      className="h-full w-full object-contain p-1"
      style={{ transform: `scale(${scale})` }}
    />
  );
}
