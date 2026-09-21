#!/usr/bin/env node
import fs from "node:fs/promises";

const css = await fs.readFile("style.css", "utf8");
const selectors = [...css.matchAll(/([^{}]+)\{/g)]
  .map(m => m[1].trim())
  .filter(s => !s.startsWith("@") && s.length > 0);

const counts = new Map();
for (const selector of selectors) counts.set(selector, (counts.get(selector) || 0) + 1);

const duplicateSelectors = [...counts.entries()].filter(([, count]) => count > 1);
const importantCount = (css.match(/!important/g) || []).length;
const mediaQueryCount = (css.match(/@media/g) || []).length;

const baseline = {
  duplicateSelectors: 1085,
  importantCount: 768,
  mediaQueryCount: 73
};

const failures = [];
if (selectors.length < 1000) failures.push("style.css unexpectedly shrank; inspect before merging.");
if (duplicateSelectors.length > baseline.duplicateSelectors) failures.push("Duplicate selector count increased.");
if (importantCount > baseline.importantCount) failures.push("!important count increased.");
if (mediaQueryCount > baseline.mediaQueryCount) failures.push("@media count increased.");

console.log(JSON.stringify({
  status: failures.length ? "FAIL" : "PASS",
  rules: selectors.length,
  duplicateSelectorKinds: duplicateSelectors.length,
  importantCount,
  mediaQueryCount,
  baseline,
  failures
}, null, 2));

if (failures.length) process.exit(1);
