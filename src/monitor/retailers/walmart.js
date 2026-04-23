"use strict";

/**
 * src/monitor/retailers/walmart.js
 * Monitors Walmart for restocks using their internal API.
 * Uses walmart-US proxies.
 */

const { createLogger } = require("../../logger");
const { getProxy } = require("../proxy");

const log = createLogger("monitor:walmart");

const API_URL = "https://www.walmart.com/orchestra/home/graphql";

function getHeaders() {
  return {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Content-Type": "application/json",
    "Referer": "https://www.walmart.com/",
    "Origin": "https://www.walmart.com",
    "WM_QOS.CORRELATION_ID": Math.random().toString(36).slice(2),
    "WM_PAGE_URL": "https://www.walmart.com/",
  };
}

async function fetchWithProxy(url, body) {
  const proxy = getProxy("walmart");

  const options = {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  };

  if (proxy) {
    try {
      const { ProxyAgent } = require("undici");
      const proxyUrl = `http://${proxy.user}:${proxy.pass}@${proxy.host}:${proxy.port}`;
      options.dispatcher = new ProxyAgent(proxyUrl);
    } catch (e) {
      // proceed without proxy
    }
  }

  return fetch(url, options);
}

/**
 * Check Walmart product by item ID
 */
async function checkProduct(product) {
  try {
    if (product.identifier_type === "keyword") {
      return await searchByKeyword(product.identifier);
    }

    const itemId = product.identifier;

    // Walmart product page API
    const url = `https://www.walmart.com/ip/${itemId}`;
    const proxy = getProxy("walmart");

    const options = {
      headers: {
        ...getHeaders(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(20000),
    };

    if (proxy) {
      try {
        const { ProxyAgent } = require("undici");
        const proxyUrl = `http://${proxy.user}:${proxy.pass}@${proxy.host}:${proxy.port}`;
        options.dispatcher = new ProxyAgent(proxyUrl);
      } catch (e) {}
    }

    const res = await fetch(url, options);
    if (!res.ok) {
      log.warn("Walmart page non-OK", { status: res.status, itemId });
      return { status: "UNKNOWN" };
    }

    const html = await res.text();

    // Extract JSON-LD or __NEXT_DATA__ from the page
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
    if (!nextDataMatch) return { status: "UNKNOWN" };

    const nextData = JSON.parse(nextDataMatch[1]);
    const itemData = nextData?.props?.pageProps?.initialData?.data?.product;

    if (!itemData) return { status: "UNKNOWN" };

    const availability = itemData?.availabilityStatus;
    const price = itemData?.priceInfo?.currentPrice?.price;
    const productName = itemData?.name;
    const productUrl = `https://www.walmart.com/ip/${itemId}`;

    const inStock = availability === "IN_STOCK" || availability === "AVAILABLE";

    return {
      status: inStock ? "IN_STOCK" : "OUT_OF_STOCK",
      price,
      stockCount: null,
      productName,
      productUrl,
    };
  } catch (err) {
    if (err.name === "TimeoutError") {
      log.warn("Walmart request timed out", { product: product.identifier });
    } else {
      log.error("Walmart check failed", { product: product.identifier, error: err.message });
    }
    return { status: "UNKNOWN" };
  }
}

/**
 * Search Walmart by keyword
 */
async function searchByKeyword(keyword) {
  try {
    const url = `https://www.walmart.com/search?q=${encodeURIComponent(keyword)}&affinityOverride=default`;
    const proxy = getProxy("walmart");

    const options = {
      headers: {
        ...getHeaders(),
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(20000),
    };

    if (proxy) {
      try {
        const { ProxyAgent } = require("undici");
        const proxyUrl = `http://${proxy.user}:${proxy.pass}@${proxy.host}:${proxy.port}`;
        options.dispatcher = new ProxyAgent(proxyUrl);
      } catch (e) {}
    }

    const res = await fetch(url, options);
    if (!res.ok) return { status: "UNKNOWN" };

    const html = await res.text();
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
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
