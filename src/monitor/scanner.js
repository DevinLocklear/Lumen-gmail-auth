"use strict";

/**
 * src/monitor/scanner.js
 * TCIN Scanner — scans sequential TCINs above the highest known Pokemon product
 * to find new products before they're publicly visible (READY_FOR_LAUNCH).
 * Runs every hour.
 */

const { createLogger } = require("../logger");
const { supabase } = require("../config");
const { proxyFetch } = require("./fetch");

const log = createLogger("monitor:scanner");

const SCAN_INTERVAL = 60 * 60 * 1000; // 1 hour
const SCAN_RANGE = 500; // Scan 500 TCINs above highest known
const POKEMON_KEYWORDS = [
  "pokemon", "pok\u00e9mon", "pikachu", "tcg", "trading card"
];

function getProxy() {
  if (!process.env.PROXY_HOST) return null;
  return {
    host: process.env.PROXY_HOST,
    port: parseInt(process.env.PROXY_PORT || "80"),
    user: process.env.PROXY_USER,
    pass: process.env.PROXY_PASS,
  };
}

function getDefaultWebhook() {
  return process.env.MONITOR_DEFAULT_WEBHOOK;
}

/**
 * Get the highest TCIN currently in the database
 */
async function getHighestTcin() {
  const { data } = await supabase
    .from("monitor_products")
    .select("identifier")
    .eq("retailer", "target")
    .order("identifier", { ascending: false })
    .limit(1);

  if (!data?.length) return 95000000; // Default starting point
  return parseInt(data[0].identifier) || 95000000;
}

/**
 * Check a single TCIN against Target's API
 */
async function checkTcin(tcin) {
  const url = `https://redsky.target.com/v3/pdp/tcin/${tcin}?excludes=taxonomy,promotion,bulk_ship,rating_and_review_reviews,rating_and_review_statistics,question_answer_statistics&key=ff457966e64d5e877fdbad070f276d18ecec4a01`;

  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Referer": "https://www.target.com/",
    "Host": "redsky.target.com",
  };

  try {
    const result = await proxyFetch(url, { headers, timeout: 8000 }, null);

    if (result.status === 404 || result.status === 410) return null; // Doesn't exist
    if (result.status !== 200) return null;

    const data = JSON.parse(result.body);
    const product = data?.data?.product;
    if (!product) return null;

    const title = product?.item?.product_description?.title || "";
    const brand = product?.item?.primary_brand?.name || "";
    const combined = (title + " " + brand).toLowerCase();

    // Only care about Pokemon TCG products
    const isPokemon = POKEMON_KEYWORDS.some(kw => combined.includes(kw));
    if (!isPokemon) return null;

    const avail = product?.availability?.availability_status || "UNKNOWN";

    return {
      tcin: tcin.toString(),
      name: title,
      status: avail,
      price: product?.price?.current_retail || null,
      url: `https://www.target.com/p/A-${tcin}`,
    };
  } catch (err) {
    return null;
  }
}

/**
 * Add a newly discovered product to the monitor
 */
async function addDiscoveredProduct(product, webhookUrl) {
  const { error } = await supabase
    .from("monitor_products")
    .upsert({
      retailer: "target",
      identifier: product.tcin,
      identifier_type: "tcin",
      product_name: product.name,
      product_url: product.url,
      webhook_url: webhookUrl,
      active: true,
      last_status: product.status === "IN_STOCK" ? "IN_STOCK" : null,
    }, { onConflict: "retailer,identifier" });

  if (!error) {
    log.info("New Pokemon product discovered via TCIN scan!", {
      tcin: product.tcin,
      name: product.name,
      status: product.status,
    });
  }

  return !error;
}

/**
 * Send early alert for newly discovered product
 */
async function sendEarlyAlert(product, webhookUrl) {
  const { sendRestockAlert } = require("./webhook");
  await sendRestockAlert({
    webhookUrl,
    product: {
      retailer: "target",
      identifier: product.tcin,
      product_name: product.name,
      product_url: product.url,
    },
    status: product.status,
    previousStatus: null,
    price: product.price,
  });
}

/**
 * Run one scan cycle
 */
async function scanCycle() {
  const webhookUrl = getDefaultWebhook();
  if (!webhookUrl) {
    log.warn("No MONITOR_DEFAULT_WEBHOOK set — skipping scan");
    return;
  }

  const highestTcin = await getHighestTcin();
  const startTcin = highestTcin + 1;
  const endTcin = startTcin + SCAN_RANGE;

  log.info("TCIN scan started", { from: startTcin, to: endTcin, range: SCAN_RANGE });

  let found = 0;

  // Scan in batches of 10 in parallel
  for (let tcin = startTcin; tcin < endTcin; tcin += 10) {
    const batch = [];
    for (let i = 0; i < 10 && tcin + i < endTcin; i++) {
      batch.push(tcin + i);
    }

    const results = await Promise.all(batch.map(t => checkTcin(t)));

    for (const result of results) {
      if (result) {
        found++;
        await addDiscoveredProduct(result, webhookUrl);
        if (result.status === "IN_STOCK" || result.status === "READY_FOR_LAUNCH") {
          await sendEarlyAlert(result, webhookUrl);
        }
      }
    }

    // Small delay between batches
    await new Promise(r => setTimeout(r, 200));
  }

  log.info("TCIN scan complete", { scanned: SCAN_RANGE, found });
}

let scanTimer = null;

function startScanner() {
  log.info("HUMN TCIN Scanner starting — scanning hourly for new Pokemon products");
  setTimeout(scanCycle, 60000); // First scan after 1 minute
  scanTimer = setInterval(scanCycle, SCAN_INTERVAL);
}

function stopScanner() {
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
}

module.exports = { startScanner, stopScanner, scanCycle };
