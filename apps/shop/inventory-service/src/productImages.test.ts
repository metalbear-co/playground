import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProductImages, parseImageUrls } from "./productImages.js";

test("parseImageUrls drops empty strings", () => {
  assert.deepEqual(parseImageUrls(["", "Metal Mart/samples/mirrord-hoodie-front"]), [
    "Metal Mart/samples/mirrord-hoodie-front",
  ]);
});

test("parseImageUrls parses JSON string arrays", () => {
  assert.deepEqual(parseImageUrls('["a.jpg", "b.jpg"]'), ["a.jpg", "b.jpg"]);
});

test("normalizeProductImages falls back to image_url", () => {
  const normalized = normalizeProductImages({
    image_url: "legacy.png",
    image_urls: ["", "  "],
  });
  assert.deepEqual(normalized.image_urls, ["legacy.png"]);
  assert.equal(normalized.image_url, "legacy.png");
});

test("normalizeProductImages keeps valid image_urls", () => {
  const normalized = normalizeProductImages({
    image_url: null,
    image_urls: ["front_id", "back_id"],
  });
  assert.deepEqual(normalized.image_urls, ["front_id", "back_id"]);
});
