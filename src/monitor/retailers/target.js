"use strict";

/**
 * src/monitor/retailers/target.js
 * Monitors Target for restocks and early (pre-launch) products.
 * Uses residential proxies via wealthproxies.
 */

const { createLogger } = require("../../logger");
const { getProxy } = require("../proxy");

const log = createLogger("monitor:target");

// Target's internal product API
const REDSKY_URL = "https://redsky.target.com/redsky_aggregations/v1/web/pdp_client_v1";
const INVENTORY_URL = "https://redsky.target.com/redsky_aggregations/v1/web/product_summary_with_fulfillment_v1";
const SEARCH_URL = "https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v2";

const VISITOR_ID = "0GbNtQj7gW3p3dHMAAAADQ"; // Generic visitor ID for API calls

function getHeaders() {
  return {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.target.com/",
    "Origin": "https://www.target.com",
  };
}

async function fetchWithProxy(url, retailer = "target") {
  const proxy = getProxy(retailer);

  const options = {
    headers: getHeaders(),
    signal: AbortSignal.timeout(20000),
  };

  // Use proxy if available — Node fetch doesn't natively support proxy
  // We use the proxy URL in the request via a custom dispatcher
  if (proxy) {
    const proxyUrl = `http://${proxy.user}:${proxy.pass}@${proxy.host}:${proxy.port}`;
    options.headers["X-Proxy-URL"] = proxyUrl; // For logging only
    // Actual proxy routing handled by ProxyAgent if undici is available
    try {
      const { ProxyAgent } = require("undici");
      options.dispatcher = new ProxyAgent(proxyUrl);
    } catch (e) {
      // undici not available, proceed without proxy
    }
  }

  const res = await fetch(url, options);
  return res;
}

/**
 * Check a Target product by TCIN
 * Returns: { status, price, stockCount, cartLimit, productName, productUrl }
 */
async function checkProduct(product) {
  try {
    const tcin = product.identifier;

    if (product.identifier_type === "keyword") {
      return await searchByKeyword(product.identifier);
    }

    const params = new URLSearchParams({
      key: "9f36aeafbe60771e321a7cc95a78140772ab3e96",
      tcins: tcin,
      store_id: "3991",
      zip: "90210",
      state: "CA",
      latitude: "34.0901",
      longitude: "-118.4065",
      visitor_id: VISITOR_ID,
      channel: "WEB",
      page: `/p/A-${tcin}`,
    });

    const url = `${INVENTORY_URL}?${params}`;
    const res = await fetchWithProxy(url, "target");

    if (!res.ok) {
      log.warn("Target API non-OK", { status: res.status, tcin });
      return { status: "UNKNOWN" };
    }

    const data = await res.json();
    const product_data = data?.data?.product_summaries?.[0];

    if (!product_data) return { status: "UNKNOWN" };

    const fulfillment = product_data?.fulfillment;
    const availability = product_data?.availability;
    const price = product_data?.price?.current_retail;
    const productName = product_data?.item?.product_description?.title;
    const productUrl = `https://www.target.com/p/A-${tcin}`;

    // Determine status
    let status = "OUT_OF_STOCK";
    let stockCount = null;
    let cartLimit = null;

    if (availability?.state === "IN_STOCK" || fulfillment?.shipping_options?.availability_status === "IN_STOCK") {
      status = "IN_STOCK";
      stockCount = availability?.available_to_promise_quantity || null;
    } else if (availability?.state === "READY_FOR_LAUNCH") {
      status = "READY_FOR_LAUNCH";
    }

    // Cart limit
    const purchaseLimit = product_data?.item?.enrichment?.buy_url ? null : product_data?.fulfillment?.shipping_options?.loyalty_limit;
    cartLimit = purchaseLimit || null;

    return { status, price, stockCount, cartLimit, productName, productUrl };
  } catch (err) {
    if (err.name === "TimeoutError") {
      log.warn("Target request timed out", { product: product.identifier });
    } else {
      log.error("Target check failed", { product: product.identifier, error: err.message });
    }
    return { status: "UNKNOWN" };
  }
}

/**
 * Search Target by keyword — finds TCIN for unreleased products
 */
async function searchByKeyword(keyword) {
  try {
    const params = new URLSearchParams({
      key: "9f36aeafbe60771e321a7cc95a78140772ab3e96",
      keyword,
      channel: "WEB",
      count: "5",
      default_purchasability_filter: "false",
      include_sponsored: "true",
      offset: "0",
      page: `/s/${encodeURIComponent(keyword)}`,
      platform: "desktop",
      useragent: "Mozilla/5.0",
      visitor_id: VISITOR_ID,
      zip: "90210",
    });

    const url = `${SEARCH_URL}?${params}`;
    const res = await fetchWithProxy(url, "target");

    if (!res.ok) return { status: "UNKNOWN" };

    const data = await res.json();
    const items = data?.data?.search?.products || [];

    if (!items.length) return { status: "UNKNOWN" };

    const first = items[0];
    const tcin = first?.tcin;
    const availability = first?.fulfillment?.shipping_options?.availability_status;
    const inStock = availability === "IN_STOCK";
    const isLaunch = availability === "READY_FOR_LAUNCH";

    return {
      status: inStock ? "IN_STOCK" : isLaunch ? "READY_FOR_LAUNCH" : "OUT_OF_STOCK",
      price: first?.price?.current_retail,
      productName: first?.item?.product_description?.title,
      productUrl: `https://www.target.com/p/A-${tcin}`,
      resolvedIdentifier: tcin,
    };
  } catch (err) {
    log.error("Target search failed", { keyword, error: err.message });
    return { status: "UNKNOWN" };
  }
}

module.exports = { checkProduct };
