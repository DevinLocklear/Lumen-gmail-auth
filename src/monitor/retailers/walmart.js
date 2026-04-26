"use strict";

/**
 * src/monitor/retailers/walmart.js
 * Monitors Walmart using their product API.
 */

const { createLogger } = require("../../logger");
const { proxyFetch } = require("../fetch");

const log = createLogger("monitor:walmart");

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
];

function getProxy() {
  return {
    host: process.env.PROXY_HOST || "p.webshare.io",
    port: parseInt(process.env.PROXY_PORT || "80"),
    user: process.env.PROXY_USER || "xnqyxvyg-GB-1",
    pass: process.env.PROXY_PASS || "j2prfly8xpvf",
  };
}

function ua() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function fetchWithFallback(url, headers, timeout = 15000) {
  let result = await proxyFetch(url, { headers, timeout }, getProxy());
  if (result && result.status === 200) return result;
  result = await proxyFetch(url, { headers, timeout }, null);
  return result;
}

async function checkProduct(product) {
  try {
    if (product.identifier_type === "keyword") {
      return await searchByKeyword(product.identifier);
    }
    return await checkByItemId(product.identifier);
  } catch (err) {
    log.error("Walmart check failed", { product: product.identifier, error: err.message });
    return { status: "UNKNOWN" };
  }
}

async function checkByItemId(itemId) {
  // Use Walmart's product API endpoint
  const url = `https://www.walmart.com/api/2/digitalstoreV2/home/en/WALMART/product/inventory?id=${itemId}`;

  const headers = {
    "User-Agent": ua(),
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": `https://www.walmart.com/ip/${itemId}`,
    "Host": "www.walmart.com",
  };

  let result = await fetchWithFallback(url, headers);

  // If that fails, try the item page with different headers
  if (!result || result.status !== 200) {
    result = await fetchProductPage(itemId);
  }

  if (!result || result.status !== 200) {
    log.warn("Walmart API non-OK", { status: result?.status, itemId });
    return { status: "UNKNOWN" };
  }

  try {
    const data = JSON.parse(result.body);
    return parseWalmartResponse(data, itemId);
  } catch (err) {
    log.error("Walmart parse failed", { itemId, error: err.message });
    return { status: "UNKNOWN" };
  }
}

async function fetchProductPage(itemId) {
  const url = `https://www.walmart.com/ip/${itemId}`;

  const headers = {
    "User-Agent": ua(),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
  };

  const result = await fetchWithFallback(url, headers);
  if (!result || result.status !== 200) return null;

  // Try to extract JSON from page
  const html = result.body;

  // Try __NEXT_DATA__
  const nextMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (nextMatch) {
    try {
      const data = JSON.parse(nextMatch[1]);
      const product = data?.props?.pageProps?.initialData?.data?.product;
      if (product) return { status: 200, body: JSON.stringify({ product }) };
    } catch (e) {}
  }

  // Try extracting JSON from window.__WML_REDUX_INITIAL_STATE__
  const reduxMatch = html.match(/window\.__WML_REDUX_INITIAL_STATE__\s*=\s*(\{.+?\});\s*<\/script>/s);
  if (reduxMatch) {
    return { status: 200, body: reduxMatch[1] };
  }

  // Try extracting any availability signal from raw HTML
  if (html.includes('"availabilityStatus":"IN_STOCK"') || html.includes('"availability":"IN_STOCK"')) {
    const priceMatch = html.match(/"currentPrice":\{"price":([\d.]+)/);
    const nameMatch = html.match(/"productName":"([^"]{5,200})"/);
    const imageMatch = html.match(/"thumbnailUrl":"([^"]+)"/);
    return {
      status: 200,
      body: JSON.stringify({
        rawSignal: true,
        inStock: true,
        price: priceMatch ? parseFloat(priceMatch[1]) : null,
        name: nameMatch ? nameMatch[1] : null,
        image: imageMatch ? imageMatch[1] : null,
      })
    };
  }

  if (html.includes('"availabilityStatus":"OUT_OF_STOCK"') || html.includes('"availability":"OUT_OF_STOCK"')) {
    return { status: 200, body: JSON.stringify({ rawSignal: true, inStock: false }) };
  }

  log.warn("Walmart page: no usable data found", { itemId });
  return null;
}

function parseWalmartResponse(data, itemId) {
  // Handle raw signal from HTML scrape
  if (data?.rawSignal) {
    return {
      status: data.inStock ? "IN_STOCK" : "OUT_OF_STOCK",
      price: data.price,
      productName: data.name,
      productUrl: `https://www.walmart.com/ip/${itemId}`,
      imageUrl: data.image,
    };
  }

  const product = data?.product || data?.props?.pageProps?.initialData?.data?.product;
  if (!product) return { status: "UNKNOWN" };

  const offerInfo = product?.offers?.[0];
  const availabilityStatus = product?.availabilityStatus || offerInfo?.availabilityStatus || "";
  const price = offerInfo?.priceInfo?.currentPrice?.price || product?.priceInfo?.currentPrice?.price || null;
  const productName = product?.name || null;
  const productUrl = `https://www.walmart.com/ip/${itemId}`;
  const imageUrl = product?.imageInfo?.thumbnailUrl || product?.images?.[0]?.url || null;
  const offerId = offerInfo?.offerId || null;
  const seller = offerInfo?.sellerInfo?.sellerDisplayName || "Walmart.com";
  const stockCount = offerInfo?.fulfillment?.availableQuantity || null;
  const cartLimit = offerInfo?.fulfillment?.maxItemsPerOrder || null;

  // Filter 3rd party sellers
  const sellerLower = seller.toLowerCase();
  if (sellerLower !== "walmart.com" && sellerLower !== "walmart") {
    log.info("Skipping 3rd party seller", { itemId, seller });
    return { status: "UNKNOWN" };
  }

  const isQueue = availabilityStatus === "IN_QUEUE" ||
    availabilityStatus.includes("QUEUE");

  const inStock = availabilityStatus === "IN_STOCK" ||
    availabilityStatus === "AVAILABLE" ||
    offerInfo?.availabilityStatus === "IN_STOCK";

  let status = "OUT_OF_STOCK";
  if (isQueue) status = "QUEUE";
  else if (inStock) status = "IN_STOCK";

  log.info("Walmart product checked", { itemId, status, price, seller, productName: productName?.slice(0, 50) });

  return { status, price, productName, productUrl, imageUrl, offerId, seller, stockCount, cartLimit };
}

async function searchByKeyword(keyword) {
  try {
    const url = `https://www.walmart.com/search?q=${encodeURIComponent(keyword)}&cat_id=4096`;
    const headers = {
      "User-Agent": ua(),
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://www.walmart.com/",
      "Host": "www.walmart.com",
    };

    const result = await fetchWithFallback(url, headers);
    if (!result || result.status !== 200) return { status: "UNKNOWN" };

    const nextDataMatch = result.body.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!nextDataMatch) return { status: "UNKNOWN" };

    const nextData = JSON.parse(nextDataMatch[1]);
    const items = nextData?.props?.pageProps?.initialData?.searchResult?.itemStacks?.[0]?.items || [];
    if (!items.length) return { status: "UNKNOWN" };

    const first = items[0];
    const itemId = first?.usItemId || first?.itemId;
    if (!itemId) return { status: "UNKNOWN" };

    return await checkByItemId(itemId);
  } catch (err) {
    log.error("Walmart search failed", { keyword, error: err.message });
    return { status: "UNKNOWN" };
  }
}

module.exports = { checkProduct };
