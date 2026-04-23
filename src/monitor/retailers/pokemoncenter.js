"use strict";

/**
 * src/monitor/retailers/pokemoncenter.js
 * Monitors Pokemon Center for stock changes.
 */

const { createLogger } = require("../../logger");
const { getProxy } = require("../proxy");
const { proxyFetch } = require("../fetch");

const log = createLogger("monitor:pokemoncenter");

function getHeaders() {
  return {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.pokemoncenter.com/",
    "Host": "www.pokemoncenter.com",
  };
}

async function checkProduct(product) {
  try {
    const proxy = getProxy("pokemoncenter");

    if (product.identifier_type === "keyword") {
      return await searchByKeyword(product.identifier, proxy);
    }

    const sku = product.identifier;
    const url = `https://www.pokemoncenter.com/api/products/${sku}`;

    const result = await proxyFetch(url, { headers: getHeaders(), timeout: 15000 }, proxy);

    if (result.status !== 200) return { status: "UNKNOWN" };

    const data = JSON.parse(result.body);
    const inStock = data?.availability?.isAvailable || data?.inStock || false;

    return {
      status: inStock ? "IN_STOCK" : "OUT_OF_STOCK",
      price: data?.prices?.sale || data?.prices?.regular || null,
      stockCount: data?.availability?.stockLevel || null,
      productName: data?.name || product.product_name,
      productUrl: `https://www.pokemoncenter.com/en-us/product/${sku}`,
    };
  } catch (err) {
    log.error("Pokemon Center check failed", { product: product.identifier, error: err.message });
    return { status: "UNKNOWN" };
  }
}

async function searchByKeyword(keyword, proxy) {
  try {
    const url = `https://www.pokemoncenter.com/api/search?query=${encodeURIComponent(keyword)}&page=1&pageSize=5`;
    const result = await proxyFetch(url, { headers: getHeaders(), timeout: 15000 }, proxy);

    if (result.status !== 200) return { status: "UNKNOWN" };

    const data = JSON.parse(result.body);
    const products = data?.results || data?.products || [];
    if (!products.length) return { status: "UNKNOWN" };

    const first = products[0];
    const inStock = first?.availability?.isAvailable || first?.inStock || false;

    return {
      status: inStock ? "IN_STOCK" : "OUT_OF_STOCK",
      price: first?.prices?.sale || first?.prices?.regular || null,
      productName: first?.name,
      productUrl: `https://www.pokemoncenter.com/en-us/product/${first?.slug || first?.id}`,
      resolvedIdentifier: first?.id || first?.slug,
    };
  } catch (err) {
    log.error("Pokemon Center search failed", { keyword, error: err.message });
    return { status: "UNKNOWN" };
  }
}

module.exports = { checkProduct };
