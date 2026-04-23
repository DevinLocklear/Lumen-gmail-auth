"use strict";

/**
 * src/monitor/retailers/target.js
 * Monitors Target for restocks and early (pre-launch) products.
 */

const { createLogger } = require("../../logger");
const { proxyFetch } = require("../fetch");

const log = createLogger("monitor:target");

function getHeaders() {
  return {
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.target.com/",
    "Origin": "https://www.target.com",
    "Host": "redsky.target.com",
  };
}

async function checkProduct(product) {
  try {
    if (product.identifier_type === "keyword") {
      return await searchByKeyword(product.identifier);
    }

    const tcin = product.identifier;

    // Current working Target API endpoint
    const params = new URLSearchParams({
      key: "9f36aeafbe60771e321a7cc95a78140772ab3e96",
      tcins: tcin,
      store_id: "911",
      zip: "55413",
      state: "MN",
      latitude: "44.9934",
      longitude: "-93.2774",
      scheduled_delivery_store_id: "911",
      required_store_id: "911",
      visitor_id: "01800CC62F6C0201AF2C0E6116E9A0EF",
      channel: "WEB",
      page: `/p/A-${tcin}`,
      pricing_store_id: "911",
    });

    const url = `https://redsky.target.com/redsky_aggregations/v1/web/pdp_client_v1?${params}`;

    const result = await proxyFetch(url, {
      headers: getHeaders(),
      timeout: 20000,
    }, null);

    if (result.status !== 200) {
      log.warn("Target API non-OK", { status: result.status, tcin });

      // Try backup endpoint
      return await checkProductBackup(tcin);
    }

    const data = JSON.parse(result.body);
    const pd = data?.data?.product;
    if (!pd) return await checkProductBackup(tcin);

    const availability = pd?.children?.[0]?.availability || pd?.availability;
    const price = pd?.price?.current_retail || pd?.children?.[0]?.price?.current_retail;
    const productName = pd?.item?.product_description?.title;
    const productUrl = `https://www.target.com/p/A-${tcin}`;

    let status = "OUT_OF_STOCK";
    let stockCount = null;

    if (availability?.availability_status === "IN_STOCK") {
      status = "IN_STOCK";
      stockCount = availability?.available_to_promise_quantity || null;
    } else if (availability?.availability_status === "READY_FOR_LAUNCH" || availability?.state === "READY_FOR_LAUNCH") {
      status = "READY_FOR_LAUNCH";
    }

    return { status, price, stockCount, productName, productUrl };
  } catch (err) {
    log.error("Target check failed", { product: product.identifier, error: err.message });
    return { status: "UNKNOWN" };
  }
}

/**
 * Backup endpoint using Target's inventory API
 */
async function checkProductBackup(tcin) {
  try {
    const url = `https://redsky.target.com/v3/pdp/tcin/${tcin}?excludes=taxonomy,price,promotion,bulk_ship,rating_and_review_reviews,rating_and_review_statistics,question_answer_statistics&key=9f36aeafbe60771e321a7cc95a78140772ab3e96`;

    const result = await proxyFetch(url, {
      headers: {
        "Accept": "application/json",
        "Referer": "https://www.target.com/",
        "Host": "redsky.target.com",
      },
      timeout: 20000,
    }, null);

    if (result.status !== 200) return { status: "UNKNOWN" };

    const data = JSON.parse(result.body);
    const product = data?.data?.product;
    if (!product) return { status: "UNKNOWN" };

    const avail = product?.availability?.availability_status;
    const inStock = avail === "IN_STOCK";
    const isLaunch = avail === "READY_FOR_LAUNCH";

    return {
      status: inStock ? "IN_STOCK" : isLaunch ? "READY_FOR_LAUNCH" : "OUT_OF_STOCK",
      price: product?.price?.current_retail,
      productName: product?.item?.product_description?.title,
      productUrl: `https://www.target.com/p/A-${tcin}`,
    };
  } catch (err) {
    log.error("Target backup check failed", { tcin, error: err.message });
    return { status: "UNKNOWN" };
  }
}

/**
 * Search Target by keyword
 */
async function searchByKeyword(keyword) {
  try {
    const params = new URLSearchParams({
      key: "9f36aeafbe60771e321a7cc95a78140772ab3e96",
      keyword,
      channel: "WEB",
      count: "5",
      default_purchasability_filter: "false",
      offset: "0",
      visitor_id: "01800CC62F6C0201AF2C0E6116E9A0EF",
      zip: "55413",
    });

    const url = `https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v2?${params}`;

    const result = await proxyFetch(url, {
      headers: {
        "Accept": "application/json",
        "Referer": "https://www.target.com/",
        "Host": "redsky.target.com",
      },
      timeout: 20000,
    }, null);

    if (result.status !== 200) return { status: "UNKNOWN" };

    const data = JSON.parse(result.body);
    const items = data?.data?.search?.products || [];
    if (!items.length) return { status: "UNKNOWN" };

    const first = items[0];
    const tcin = first?.tcin;
    const avail = first?.availability_status || first?.fulfillment?.shipping_options?.availability_status;

    return {
      status: avail === "IN_STOCK" ? "IN_STOCK" : avail === "READY_FOR_LAUNCH" ? "READY_FOR_LAUNCH" : "OUT_OF_STOCK",
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
