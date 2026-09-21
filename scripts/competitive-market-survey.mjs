#!/usr/bin/env node
import fs from "node:fs";
import { chromium } from "playwright";

const config = JSON.parse(fs.readFileSync("competitive-market.json", "utf8"));
const clean = s => String(s || "").replace(/\s+/g, " ").trim();
const money = s => Number(String(s).replace(/,/g, ""));
const sleep = ms => new Promise(r => setTimeout(r, ms));

function prices(text) {
  const out = [];
  const patterns = [
    /\$\s?([0-9,]+)\s*(?:-|–|to)\s*\$?\s?([0-9,]+)/gi,
    /\$\s?([0-9,]+)\s*(?:starting at|starts at)/gi,
    /\$\s?([0-9,]+)\s*(?:average|avg)/gi
  ];
  for (const re of patterns) for (const m of text.matchAll(re)) {
    const nums = m.slice(1).filter(Boolean).map(money);
    if (nums.some(n => n > 25 && n < 25000))
      out.push({raw:m[0], low:nums[0], high:nums[1] ?? nums[0], index:m.index ?? 0});
  }
  return out;
}

function service(context) {
  const s = context.toLowerCase();
  if (s.includes("driveway")) return "driveway";
  if (s.includes("sidewalk")) return "sidewalk";
  if (s.includes("walkway")) return "walkway";
  if (s.includes("patio")) return "patio";
  if (s.includes("commercial")) return "commercial";
  if (s.includes("house exterior") || s.includes("house wash")) return "house exterior";
  if (s.includes("concrete") || s.includes("flatwork")) return "flatwork";
  if (s.includes("pressure washing") || s.includes("power washing")) return "general pressure washing";
  return "unclassified";
}

const browser = await chromium.launch({headless:true});
const sources = [];
const marketplaceTargets = [
  ...(config.marketplaces?.craigslist || []).map(url => ({name:"Craigslist",url,type:"marketplace_craigslist"})),
  ...(config.marketplaces?.facebook_public_urls || []).map(url => ({name:"Facebook Marketplace (public URL)",url,type:"marketplace_facebook_public"}))
];
try {
  const targets = [...config.competitors, ...(config.additional_urls || []).map(url => ({name:url,url,type:"additional"})), ...marketplaceTargets];
  for (const source of targets) {
    const page = await browser.newPage({viewport:{width:1440,height:1000}, userAgent:"PEEK-PRESSURE-MarketSurvey/1.0"});
    const row = {name:source.name,url:source.url,type:source.type,ok:false,status:null,title:"",prices:[],listings:[],notes:[]};
    try {
      const response = await page.goto(source.url,{waitUntil:"domcontentloaded",timeout:30000});
      await page.waitForTimeout(1000);
      row.status = response?.status() ?? null;
      row.ok = Boolean(response?.ok());
      row.title = clean(await page.title());
      const text = clean(await page.locator("body").innerText()).slice(0,70000);\n      if (source.type.startsWith("marketplace_")) {\n        row.listings = [...new Set(text.split(/(?=pressure washing|power washing|driveway cleaning|concrete cleaning)/ig).filter(x => /pressure washing|power washing|driveway cleaning|concrete cleaning/i.test(x)).map(x => clean(x).slice(0,900)))].slice(0,50);\n      }
      for (const p of prices(text)) {
        const context = clean(text.slice(Math.max(0,p.index-220),Math.min(text.length,p.index+260)));
        row.prices.push({service:service(context),raw:p.raw,low:p.low,high:p.high,context:context.slice(0,480)});
      }
      if (!row.prices.length) row.notes.push("No public numeric price found; this site may require a quote.");
    } catch (e) {
      row.error = String(e);
    } finally {
      await page.close();
    }
    sources.push(row);
    await sleep(800);
  }
} finally {
  await browser.close();
}

const observations = sources.flatMap(r => r.prices.map(p => ({source:r.name,type:r.type,url:r.url,...p})));
const grouped = {};
for (const o of observations) (grouped[o.service] ||= []).push(o);
const median = a => a.length ? a.slice().sort((x,y)=>x-y)[Math.floor(a.length/2)] : null;
const summary = Object.entries(grouped).map(([service,items]) => {
  const lows=items.map(x=>x.low).filter(Number.isFinite);
  const highs=items.map(x=>x.high).filter(Number.isFinite);
  return {
    service,
    observations:items.length,
    observed_low_min:lows.length?Math.min(...lows):null,
    observed_low_median:median(lows),
    observed_high_median:median(highs),
    observed_high_max:highs.length?Math.max(...highs):null,
    sources:[...new Set(items.map(x=>x.source))]
  };
}).sort((a,b)=>b.observations-a.observations);

const report = {
  generated_at:new Date().toISOString(),
  market:config.market,
  methodology:"Public-web crawl only. Numeric prices are captured with surrounding text and classified by nearby service terms. No private forms, CAPTCHA bypasses, or Lucy/OpenAI APIs are used.",
  sources,
  observations,
  market_summary:summary,
  guardrails:[
    "Research only; no automatic pricing changes.",
    "Do not copy competitor pricing directly into PEEK PRESSURE.",
    "Aggregator and pricing-guide sources are labeled separately from local operators.",
    "Missing public prices are meaningful because many operators require quotes.",\n    "Marketplace pages are collected only when publicly accessible; no login or access-control bypass is attempted.",
    "Lucy pricing is not modified by this workflow."
  ]
};

fs.writeFileSync("competitive-market-survey.json",JSON.stringify(report,null,2));

let md = "# PEEK PRESSURE — Bay Area Market Pricing Survey\n\n";
md += "Generated: " + report.generated_at + "\n\n";
md += "Public-web research only. This agent crawls configured pages, extracts public prices, classifies them by service, and reports observed ranges. It does not call Lucy/OpenAI or change pricing.\n\n";
md += "## Market observations\n";
for (const row of summary) {
  md += "- **" + row.service + "** — " + row.observations + " observation(s); low starts $" + (row.observed_low_min ?? "n/a") + ", median low $" + (row.observed_low_median ?? "n/a") + ", median high $" + (row.observed_high_median ?? "n/a") + ", highest $" + (row.observed_high_max ?? "n/a") + ".\n";
}
md += "\n## Marketplace findings\n";\nfor (const r of sources.filter(x=>x.type.startsWith("marketplace_"))) {\n  md += "### " + r.name + "\n- URL: " + r.url + "\n- HTTP: " + (r.status ?? "error") + "\n";\n  for (const item of r.listings.slice(0,20)) md += "- " + item + "\n";\n  if (!r.listings.length) md += "- No public listing text captured. The marketplace may require login or block automated access.\n";\n}\nmd += "\n## Sources\n";
for (const r of sources) {
  md += "### " + r.name + "\n- URL: " + r.url + "\n- Type: " + r.type + "\n- HTTP: " + (r.status ?? "error") + "\n";
  if (r.error) md += "- Error: " + r.error + "\n";
  for (const p of r.prices.slice(0,20)) md += "- **" + p.service + "** — " + p.raw + " — " + p.context + "\n";
  for (const n of r.notes) md += "- Note: " + n + "\n";
}
md += "\n## Guardrails\n" + report.guardrails.map(x=>"- "+x).join("\n") + "\n";
fs.writeFileSync("competitive-market-survey.md",md);
console.log(md);
