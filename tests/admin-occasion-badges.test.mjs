import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const helperStart = html.indexOf("function normalizeAdminOccasions(value){");
const helperEnd = html.indexOf("const renderAdminProductList=()=>{", helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, "Admin occasion helpers must exist before the product renderer");
const helperSource = html.slice(helperStart, helperEnd);
const context = {
  esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }
};
vm.createContext(context);
vm.runInContext(helperSource, context);

test("normalizes comma-separated strings and arrays without mutating inputs", () => {
  const input = [" Festive ", "Traditional, Wedding", "festive", "", null];
  const before = structuredClone(input);
  assert.deepEqual(Array.from(context.normalizeAdminOccasions(" Festive, Traditional , ,Wedding ")), ["Festive", "Traditional", "Wedding"]);
  assert.deepEqual(Array.from(context.normalizeAdminOccasions(input)), ["Festive", "Traditional", "Wedding"]);
  assert.deepEqual(input, before);
});

test("returns no markup for missing, null, empty, or whitespace-only values", () => {
  for (const value of [undefined, null, "", " ,  , ", [], [null, "  ", ""]]) {
    assert.equal(context.renderAdminOccasionBadges(value), "");
  }
});

test("deduplicates case-insensitively while preserving first spelling", () => {
  assert.equal(context.renderAdminOccasionBadges("Festive, FESTIVE, Traditional"),
    '<div class="occ-badge-wrap" aria-label="Occasions"><span class="occ-badge-item">Festive</span><span class="occ-badge-item">Traditional</span></div>');
});

test("escapes HTML special characters and prevents executable markup", () => {
  const markup = context.renderAdminOccasionBadges("<img src=x onerror=\"alert(1)\"> & \"quoted\" 'single'");
  assert.ok(markup.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
  assert.ok(markup.includes("&amp; &quot;quoted&quot; &#39;single&#39;"));
  assert.equal(markup.includes("<img"), false);
  assert.equal(markup.includes("onerror=\""), false);
});

test("renders up to five occasions in original order", () => {
  const markup = context.renderAdminOccasionBadges("Festive, Wedding, Traditional, Daily Wear, Party Wear");
  assert.equal((markup.match(/class="occ-badge-wrap"/g) || []).length, 1);
  assert.equal((markup.match(/class="occ-badge-item"/g) || []).length, 5);
  assert.ok(markup.indexOf(">Festive<") < markup.indexOf(">Wedding<"));
  assert.ok(markup.indexOf(">Wedding<") < markup.indexOf(">Traditional<"));
  assert.ok(markup.indexOf(">Traditional<") < markup.indexOf(">Daily Wear<"));
  assert.ok(markup.indexOf(">Daily Wear<") < markup.indexOf(">Party Wear<"));
});

test("retains long label text safely for CSS truncation", () => {
  const label = "A very long custom occasion label that exceeds the badge maximum";
  const markup = context.renderAdminOccasionBadges(label);
  assert.ok(markup.includes(label));
});

test("places badges after metadata and before the existing status row", () => {
  const renderer = html.slice(html.indexOf("const renderAdminProductList=()=>{"), html.indexOf("const pagination=$(\"#adminProductPagination\")"));
  assert.match(renderer, /<small class="admin-product-meta">[\s\S]*?<\/small>'\+renderAdminOccasionBadges\(p\.occasions\)\+'<div class="admin-product-status">/);
  assert.match(renderer, /class="admin-product-thumb"/);
  assert.match(renderer, /class="danger edit"/);
  assert.match(renderer, /class="admin-product-status"/);
  assert.match(renderer, /cleanProductName\(p\.name\)/);
});

test("uses only the two required isolated badge selectors and exact required declarations", () => {
  const style = html.match(/<style id="admin-luxury-occasion-badges">([\s\S]*?)<\/style>/)?.[1];
  assert.ok(style, "isolated badge stylesheet exists");
  assert.deepEqual(Array.from(style.matchAll(/(^|})\s*([^{}]+)\s*\{/g), match => match[2].trim()), [".occ-badge-wrap", ".occ-badge-item"]);
  for (const declaration of [
    "display: flex;", "flex-wrap: nowrap;", "gap: 2px;", "min-width: 0;", "max-width: 100%;", "overflow: hidden;", "margin: 4px 0 6px 0;",
    "flex: 0 1 auto;", "max-width: 100%;", "text-overflow: ellipsis;", "white-space: nowrap;",
    "border: 1px solid #C5A67C;", "border-radius: 999px;", "background: #FAF5EC;",
    "color: #1C1917;", "font-size: 9px;", "line-height: 1.2;",
    "letter-spacing: 0.01em;", "text-transform: uppercase;", "padding: 1px 3px;"
  ]) assert.ok(style.includes(declaration), "required CSS declaration: " + declaration);
  assert.doesNotMatch(style, /!important|position\\s*:/i);
});
