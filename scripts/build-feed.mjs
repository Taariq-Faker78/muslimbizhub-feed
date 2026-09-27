/**
 * Builds the app's content feed from the live website.
 *
 * muslimbizhub.co.za is hand-built static HTML with no CMS or API behind it, so the site itself
 * is the source of truth: this reads the taxonomy straight off the pages that publish it and
 * writes the JSON the app fetches. Run it whenever the site changes, upload the result, and the
 * app picks the change up on its next launch — see docs/content-feed.md.
 *
 *   node scripts/build-feed.mjs                     → writes content.json here
 *   node scripts/build-feed.mjs --out <path>        → writes it somewhere else
 *   node scripts/build-feed.mjs --bundle            → also refreshes src/data/bundled.json
 *
 * It refuses to write a feed that looks wrong — a site redesign that moves the markup should
 * stop this script, not quietly publish an empty directory to everyone's phone.
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const Site = 'https://muslimbizhub.co.za';

/**
 * The host answers anything that looks like a bot with a "domain temporarily unavailable" page,
 * so identify the script the same way the app identifies itself.
 */
const UserAgent = 'MuslimBizHub-App/1.0';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function getPage(path) {
  const response = await fetch(`${Site}${path}`, { headers: { 'User-Agent': UserAgent } });
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);

  const html = await response.text();
  if (html.includes('This domain is temporarily unavailable')) {
    throw new Error(`${path} returned the host's holding page — the request was filtered.`);
  }
  return html;
}

const Entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

function decode(html) {
  return html
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&([a-z]+|#\d+);/gi, (match, name) => Entities[name] ?? match)
    .replace(/\s+/g, ' ')
    .trim();
}

/** The site prints sector names but not their slugs; the app's slugs are the names, slugified. */
function slugify(name) {
  return decode(name)
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function number(text) {
  const parsed = Number(String(text ?? '').replace(/[^\d]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseSectors(html) {
  const blocks = html.split('<div class="md-sector"').slice(1);

  return blocks
    .map((block) => {
      const title = block.match(/<h3 class="md-sector-title">([\s\S]*?)<span>([\s\S]*?)<\/span>/);
      if (!title) return null;

      // Cards are cut out one at a time first. A category with no listings has no count span,
      // and a single pattern spanning the whole card would swallow the card after it.
      const categories = [...block.matchAll(/<a class="md-cat-card"([\s\S]*?)<\/a>/g)]
        .map(([, card]) => {
          const slug = card.match(/href="directory\/([a-z0-9-]+)\/index\.html"/);
          const name = card.match(/md-cat-name">([\s\S]*?)<\/span>/);
          if (!slug || !name) return null;

          const blurb = card.match(/md-cat-blurb">([\s\S]*?)<\/span>/);
          const catCount = card.match(/md-cat-count">([\s\S]*?)<\/span>/);

          return {
            slug: slug[1],
            name: decode(name[1]),
            blurb: blurb ? decode(blurb[1]) : '',
            count: catCount ? number(catCount[1]) : 0,
          };
        })
        .filter(Boolean);

      if (categories.length === 0) return null;
      const name = decode(title[1]);

      return { slug: slugify(name), name, listings: number(title[2]), categories };
    })
    .filter(Boolean);
}

function parseRegions(html) {
  return [
    ...html.matchAll(
      /<a class="md-province-card" href="events\/([a-z0-9-]+)\/index\.html">[\s\S]*?<h3>([\s\S]*?)<\/h3>/g
    ),
  ].map(([, slug, name]) => ({ slug, name: decode(name) }));
}

function parseMarket(html) {
  return [
    ...html.matchAll(
      /<a class="md-shopcat-card" href="[^"]*\/shop\/category\/([a-z0-9-]+)\/index\.html">[\s\S]*?<h3>([\s\S]*?)<\/h3>/g
    ),
  ].map(([, slug, name]) => ({ slug, name: decode(name) }));
}

/**
 * The header figures. The app counts the categories and regions itself, so only a stat it
 * cannot work out — the number of local areas — carries a value from here.
 */
function parseStats(html) {
  const stats = [
    { label: 'business categories', derive: 'categories' },
    { label: 'regions', derive: 'regions' },
  ];

  const areas = html.match(/([\d,]+)<\/strong><span>\s*local areas/);
  if (areas) stats.push({ value: String(number(areas[1])), label: 'local areas' });

  return stats;
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');
const outPath = resolve(
  projectRoot,
  outFlag !== -1 ? args[outFlag + 1] : 'content.json'
);

const [home, shop] = await Promise.all([getPage('/'), getPage('/shop/')]);

const sectors = parseSectors(home);
const regions = parseRegions(home);
const market = parseMarket(shop);
const categories = sectors.reduce((total, sector) => total + sector.categories.length, 0);

// A site redesign would quietly produce an empty feed, so insist the numbers look like a directory.
check(sectors.length >= 5, `Only found ${sectors.length} sectors — the homepage markup has moved.`);
check(categories >= 40, `Only found ${categories} categories — the homepage markup has moved.`);
check(regions.length >= 9, `Only found ${regions.length} regions — the homepage markup has moved.`);
check(market.length >= 5, `Only found ${market.length} market categories — /shop/ markup has moved.`);
check(
  sectors.every((sector) => sector.slug && sector.name),
  'A sector came out without a slug or name.'
);

// The site prints its own category total, so the surest check is that this agrees with it.
const claimed = home.match(/([\d,]+)<\/strong><span>\s*business categories/);
check(claimed, 'The homepage no longer states a category total to check against.');
check(
  number(claimed[1]) === categories,
  `Found ${categories} categories but the site says it has ${number(claimed[1])} — some were missed.`
);

// Every link the app builds comes off a slug, so a duplicate would point two cards at one page.
const slugs = sectors.flatMap((sector) => sector.categories.map((c) => c.slug));
check(new Set(slugs).size === slugs.length, 'The same category slug appeared twice.');

const feed = {
  version: 1,
  updatedAt: new Date().toISOString(),
  stats: parseStats(home),
  sectors,
  market,
  regions,
};

const json = JSON.stringify(feed, null, 2) + '\n';
writeFileSync(outPath, json);

if (args.includes('--bundle')) {
  // The bundled copy is the app's offline fallback, so it carries no date of its own.
  const bundled = { ...feed, updatedAt: null };
  writeFileSync(resolve(projectRoot, 'src/data/bundled.json'), JSON.stringify(bundled, null, 2) + '\n');
}

console.log(
  `${sectors.length} sectors, ${categories} categories, ${market.length} market categories, ` +
    `${regions.length} regions → ${outPath}`
);
