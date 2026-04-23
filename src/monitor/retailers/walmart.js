"use strict";

/**
 * src/monitor/retailers/walmart.js
 * Monitors Walmart for restocks.
 */

const { createLogger } = require("../../logger");
const { getProxy } = require("../proxy");
const { proxyFetch } = require("../fetch");

const log = createLogger("monitor:walmart");

function getHeaders() {
  return {
    "Accept": "text/html,application/xhtml+xml,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.walmart.com/",
    "Host": "www.walmart.com",
  };
}

async function checkProduct(product) {
  try {
    if (product.identifier_type === "keyword") {
      return await searchByKeyword(product.identifier);
    }

    const itemId = product.identifier;
    const url = `https://www.walmart.com/ip/${itemId}`;
    const proxy = getProxy("walmart");

    const result = await proxyFetch(url, { headers: getHeaders(), timeout: 20000 }, proxy);

    if (result.status !== 200) {
      log.warn("Walmart page non-OK", { status: result.status, itemId });
      return { status: "UNKNOWN" };
    }

    const nextDataMatch = result.body.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
    if (!nextDataMatch) return { status: "UNKNOWN" };

    const nextData = JSON.parse(nextDataMatch[1]);
    const itemData = nextData?.props?.pageProps?.initialData?.data?.product;
    if (!itemData) return { status: "UNKNOWN" };

    const availability = itemData?.availabilityStatus;
    const inStock = availability === "IN_STOCK" || availability === "AVAILABLE";

    return {
      status: inStock ? "IN_STOCK" : "OUT_OF_STOCK",
      price: itemData?.priceInfo?.currentPrice?.price,
      productName: itemData?.name,
      productUrl: `https://www.walmart.com/ip/${itemId}`,
    };
  } catch (err) {
    log.error("Walmart check failed", { product: product.identifier, error: err.message });
    return { status: "UNKNOWN" };
  }
}

async function searchByKeyword(keyword) {
  try {
    const url = `https://www.walmart.com/search?q=${encodeURIComponent(keyword)}`;
    const proxy = getProxy("walmart");

    const result = await proxyFetch(url, { headers: getHeaders(), timeout: 20000 }, proxy);
    if (result.status !== 200) return { status: "UNKNOWN" };

    const nextDataMatch = result.body.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
    if (!nextDataMatch) return { status: "UNKNOWN" };

    const nextData = JSON.parse(nextDataMatch[1]);
    const items = nextData?.props?.pageProps?.initialData?.searchResult?.itemStacks?.[0]?.items || [];
    if (!items.length) return { status: "UNKNOWN" };

    const first = items[0];
    const inStock = first?.availabilityStatus === "IN_STOCK" || first?.availabilityStatus === "AVAILABLE";

    return {
      status: inStock ? "IN_STOCK" : "OUT_OF_STOCK",
      price: first?.priceInfo?.currentPrice?.price,
      productName: first?.name,
      productUrl: `https://www.walmart.com${first?.canonicalUrl || ""}`,
      resolvedIdentifier: first?.usItemId,
    };
  } catch (err) {
    log.error("Walmart search failed", { keyword, error: err.message });
    return { status: "UNKNOWN" };
  }
}

module.exports = { checkProduct };
