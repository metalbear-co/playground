"use client";

import { CldImage } from "next-cloudinary";
import { resolveCloudinaryId } from "@/lib/cloudinary";

/**
 * Renders a product image. Uses CldImage for Cloudinary public IDs (optimized delivery),
 * or a regular img for full URLs (e.g. placeholders, external sources).
 *
 * Store Cloudinary public IDs in inventory (e.g. "Metal Mart/samples/mirrord-logo")
 * or full URLs for backwards compatibility.
 */
type ProductImageProps = {
  src: string;
  alt: string;
  className?: string;
  width?: number;
  height?: number;
  fill?: boolean;
  sizes?: string;
  priority?: boolean;
};

function isCloudinaryId(src: string): boolean {
  return !src.startsWith("http://") && !src.startsWith("https://");
}

export default function ProductImage({
  src,
  alt,
  className,
  width,
  height,
  fill,
  sizes,
  priority,
}: ProductImageProps) {
  const useCloudinary =
    typeof process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME === "string" &&
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME.length > 0 &&
    isCloudinaryId(src);

  if (useCloudinary) {
    return (
      <CldImage
        src={resolveCloudinaryId(src)}
        alt={alt}
        className={className}
        width={fill ? undefined : width ?? 400}
        height={fill ? undefined : height ?? 400}
        fill={fill}
        sizes={sizes}
        priority={priority}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={className} />
  );
}
