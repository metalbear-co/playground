/**
 * Apply folder prefix if set and public_id has no path (no "/").
 * Use when assets are in a Cloudinary folder (e.g. "Metal Mart/samples/").
 */
export function resolveCloudinaryId(publicId: string): string {
  const prefix = process.env.NEXT_PUBLIC_CLOUDINARY_FOLDER_PREFIX;
  if (prefix && !publicId.includes("/")) {
    return prefix.replace(/\/$/, "") + "/" + publicId;
  }
  return publicId;
}
