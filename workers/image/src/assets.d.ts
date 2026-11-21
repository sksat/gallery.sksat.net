/** A bundled JPEG: wrangler's Data module rule (wrangler.jsonc) gives its bytes. */
declare module "*.jpg" {
  const bytes: ArrayBuffer;
  export default bytes;
}
