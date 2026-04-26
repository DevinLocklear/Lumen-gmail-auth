"use strict";

/**
 * src/monitor/discovery.js
 * Auto-discovers new Pokemon TCG products on Target every 5 minutes.
 * Adds any new TCINs to monitor_products automatically.
 */

const { createLogger } = require("../logger");
const { supabase } = require("../config");
const { proxyFetch } = require("./fetch");
const { getProxy } = require("./proxy");

const log = createLogger("monitor:discovery");

const DISCOVERY_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Default webhook URL for auto-discovered products
// Falls back to MONITOR_DEFAULT_WEBHOOK env var
function getDefaultWebhook() {
  return process.env.MONITOR_DEFAULT_WEBHOOK || "https://discord.com/api/webhooks/1497929956523773992/YLx-UIDBUWH1NNrjbBoBOGhJR-mnedths577q5S4P-w6YrNxDwoghMhdl_JyVMfnKuTz";
}

// Target search queries for Pokemon TCG
// Target category IDs for Pokemon TCG
// Cat: Trading Cards > Pokemon
const TARGET_CATEGORY_IDS = [
  "5xt1a",   // Trading Cards
  "4xtck",   // Pokemon category
];

const TARGET_QUERIES = [
  "Pokemon Trading Card Game",
  "Pokemon TCG elite trainer box",
  "Pokemon TCG booster bundle",
];

const TARGET_HEADERS = {
  "Accept": "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.target.com/",
  "Host": "redsky.target.com",
  "sec-ch-ua": '"Chromium";v="122"',
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-site",
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/**
 * Search Target for Pokemon TCG products and return TCINs
 */
async function searchTarget(keyword) {
  try {
    // Use Target's sitemap index — no auth needed, lists all products
    // Sitemap for trading cards category
    const sitemapUrls = [
      "https://www.target.com/sitemap_products_1.xml.gz",
    ];

    // Use Target's browse API via their public endpoint
    const url = `https://api.target.com/promotions/v3/promotions?key=ff457966e64d5e877fdbad070f276d18ecec4a01&category=5xt1a&per_page=24&page=1`;

    const webshareProxy = {
      host: process.env.PROXY_HOST || "p.webshare.io",
      port: parseInt(process.env.PROXY_PORT || "80"),
      user: process.env.PROXY_USER || "xnqyxvyg-GB-1",
      pass: process.env.PROXY_PASS || "j2prfly8xpvf",
    };

    // Try Target's category page directly
    const categoryUrl = `https://www.target.com/c/trading-card-games/-/N-5xt1a?lnk=snav_ta_tradingcards`;
    const headers = {
      "User-Agent": UA,
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://www.target.com/",
      "Host": "www.target.com",
    };

    let result = await proxyFetch(categoryUrl, { headers, timeout: 15000 }, webshareProxy);
    if (!result || result.status !== 200) {
      result = await proxyFetch(categoryUrl, { headers, timeout: 15000 }, null);
    }

    if (!result || result.status !== 200) {
      log.warn("Target category page non-OK", { keyword, status: result?.status });
      return [];
    }

    // Extract TCINs from page HTML
    const html = result.body;
    const tcinRegex = /"tcin":"(\d{7,12})"/g;
    const nameRegex = /"title":"([^"]{10,150})"/g;
    const tcins = new Set();
    const products = [];
    let match;

    while ((match = tcinRegex.exec(html)) !== null) {
      const tcin = match[1];
      if (!tcins.has(tcin)) {
        tcins.add(tcin);
        products.push({ tcin, name: null, url: `https://www.target.com/p/A-${tcin}` });
      }
    }

    // Try to match names — extract all titles from nearby context
    const titles = [];
    while ((match = nameRegex.exec(html)) !== null) {
      titles.push(match[1]);
    }

    // Assign names to products in order
    products.forEach((p, i) => {
      if (titles[i]) p.name = titles[i].replace(/\\u[\dA-F]{4}/gi, "?");
    });

    // Filter to only Pokemon TCG products by name
    const filtered = products.filter(p =>
      !p.name || p.name.toLowerCase().includes("pokemon") ||
      p.name.toLowerCase().includes("tcg") ||
      p.name.toLowerCase().includes("trading card")
    );

    log.info("Target search found products", { keyword, count: filtered.length, total: products.length });
    return filtered;
  } catch (err) {
    log.warn("Target search failed", { keyword, error: err.message });
    return [];
  }
}

/**
 * Get all currently monitored TCINs from the database
 */
async function getMonitoredTcins() {
  const { data } = await supabase
    .from("monitor_products")
    .select("identifier")
    .eq("retailer", "target")
    .eq("active", true);

  return new Set((data || []).map(p => p.identifier));
}

/**
 * Add a new product to the monitor
 */
async function addProduct(tcin, name, webhookUrl) {
  const { error } = await supabase
    .from("monitor_products")
    .upsert({
      retailer: "target",
      identifier: tcin,
      identifier_type: "tcin",
      product_name: name || null,
      webhook_url: webhookUrl,
      active: true,
      last_status: null,
    }, { onConflict: "retailer,identifier" });

  if (error) {
    log.error("Failed to add discovered product", { tcin, error: error.message });
    return false;
  }

  log.info("New product discovered and added", { tcin, name });
  return true;
}

/**
 * Run one discovery cycle
 */
async function discoveryCycle() {
  const webhookUrl = getDefaultWebhook();
  if (!webhookUrl) {
    log.warn("No MONITOR_DEFAULT_WEBHOOK set — skipping discovery");
    return;
  }

  log.info("Discovery cycle started");

  // Get existing monitored TCINs
  const monitoredTcins = await getMonitoredTcins();

  // Search Target with all queries
  const found = new Map(); // tcin -> product info

  for (const query of TARGET_QUERIES) {
    const products = await searchTarget(query);
    for (const p of products) {
      if (p.tcin && !found.has(p.tcin)) {
        found.set(p.tcin, p);
      }
    }
    // Small delay between searches
    await sleep(2000);
  }

  log.info("Discovery search complete", { found: found.size, monitored: monitoredTcins.size });

  // Add any new products
  let added = 0;
  for (const [tcin, product] of found) {
    if (!monitoredTcins.has(tcin)) {
      const success = await addProduct(tcin, product.name, webhookUrl);
      if (success) added++;
      await sleep(200);
    }
  }

  if (added > 0) {
    log.info(`Discovery added ${added} new products to monitor`);
  } else {
    log.info("Discovery complete — no new products found");
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let discoveryTimer = null;

/**
 * Start the discovery loop
 */
function startDiscovery() {
  log.info("HUMN Discovery starting — scanning Target every 5 minutes");

  // Initial scan after 30 seconds
  setTimeout(discoveryCycle, 30000);

  // Then every 5 minutes
  discoveryTimer = setInterval(discoveryCycle, DISCOVERY_INTERVAL);
}

/**
 * Stop discovery
 */
function stopDiscovery() {
  if (discoveryTimer) {
    clearInterval(discoveryTimer);
    discoveryTimer = null;
  }
}

module.exports = { startDiscovery, stopDiscovery, discoveryCycle };
