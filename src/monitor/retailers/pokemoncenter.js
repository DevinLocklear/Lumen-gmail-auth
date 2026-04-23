"use strict";

/**
 * src/monitor/retailers/pokemoncenter.js
 * Monitors Pokemon Center for stock changes.
 * No proxy needed — lighter anti-bot protection.
 */

const { createLogger } = require("../../logger");
const { getProxyConfig } = require("../proxy");

const log = createLogger("monitor:pokemoncenter");

const BASE_URL = "https://www.pokemoncenter.com";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.pokemoncenter.com/",
  "Origin": "https://www.pokemoncenter.com",
};

/**
 * Check stock for a Pokemon Center SKU
 * Returns: { status, price, stockCount, productName, productUrl }
 */
async function checkProduct(product) {
  try {
    const sku = product.identifier;

    // Pokemon Center product API
    const url = `${BASE_URL}/api/products/${sku}`;

    const res = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      // Try search endpoint as fallback for keywords
      if (product.identifier_type === "keyword") {
        return await searchByKeyword(product.identifier);
      }
      log.warn("PC API returned non-OK", { status: res.status, sku });
      return { status: "UNKNOWN" };
    }

    const data = await res.json();

    const inStock = data?.availability?.isAvailable || data?.inStock || false;
    const price = data?.prices?.sale || data?.prices?.regular || null;
    const stockCount = data?.availability?.stockLevel || null;
    const productName = data?.name || product.product_name;
    const productUrl = `${BASE_URL}/en-us/product/${sku}`;

    return {
      status: inStock ? "IN_STOCK" : "OUT_OF_STOCK",
      price,
      stockCount,
      productName,
      productUrl,
    };
  } catch (err) {
    if (err.name === "TimeoutError") {
      log.warn("Pokemon Center request timed out", { product: product.identifier });
    } else {
      log.error("Pokemon Center check failed", { product: product.identifier, error: err.message });
    }
    return { status: "UNKNOWN" };
  }
}

/**
 * Search Pokemon Center by keyword
 */
async function searchByKeyword(keyword) {
  try {
    const url = `${BASE_URL}/api/search?query=${encodeURIComponent(keyword)}&page=1&pageSize=5&inStockOnly=false`;

    const res = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return { status: "UNKNOWN" };

    const data = await res.json();
    const products = data?.results || data?.products || [];

    if (!products.length) return { status: "UNKNOWN" };

    // Return first matching result
    const first = products[0];
    const inStock = first?.availability?.isAvailable || first?.inStock || false;

    return {
      status: inStock ? "IN_STOCK" : "OUT_OF_STOCK",
      price: first?.prices?.sale || first?.prices?.regular || null,
      productName: first?.name,
      productUrl: `${BASE_URL}/en-us/product/${first?.slug || first?.id}`,
      resolvedIdentifier: first?.id || first?.slug,
    };
  } catch (err) {
    log.error("Pokemon Center search failed", { keyword, error: err.message });
    return { status: "UNKNOWN" };
  }
}

module.exports = { checkProduct };
