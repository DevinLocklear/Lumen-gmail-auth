"use strict";

/**
 * src/monitor/webhook.js
 * Sends Discord webhook embeds for monitor alerts.
 */

const { createLogger } = require("../logger");
const log = createLogger("monitor:webhook");

const HUMN_ICON = "https://i.imgur.com/ywgtHOK.png";
const SOCIAL_FIELD = {
  name: "\u200b",
  value: "[𝕏 @UseHUMN](https://x.com/UseHUMN) • [🌐 humnbot.com](https://www.humnbot.com)",
  inline: false,
};

const RETAILER_COLORS = {
  target: 0xcc0000,
  walmart: 0x0071ce,
  pokemoncenter: 0xffcc00,
  gamestop: 0xff6600,
  amazon: 0xff9900,
  general: 0xc45aff,
};

const RETAILER_ICONS = {
  target: "🎯",
  walmart: "🛒",
  pokemoncenter: "⚡",
  gamestop: "🎮",
  amazon: "📦",
};

function getRetailerKey(retailer) {
  return (retailer || "").toLowerCase().replace(/\s/g, "");
}

/**
 * Fire a restock alert embed to a Discord webhook
 */
async function sendRestockAlert({ webhookUrl, product, status, previousStatus, price, stockCount, cartLimit }) {
  const retailerKey = getRetailerKey(product.retailer);
  const color = RETAILER_COLORS[retailerKey] || 0xc45aff;
  const icon = RETAILER_ICONS[retailerKey] || "📦";

  const isNewProduct = previousStatus === "READY_FOR_LAUNCH" || previousStatus === "UNKNOWN";
  const isRestock = previousStatus === "OUT_OF_STOCK" && status === "IN_STOCK";
  const isEarlyAlert = status === "READY_FOR_LAUNCH";

  let title = `${icon} ${product.retailer} Restock Alert`;
  if (isEarlyAlert) title = `${icon} ${product.retailer} Early Alert — Coming Soon`;
  if (isNewProduct && status === "IN_STOCK") title = `${icon} ${product.retailer} — Now Live!`;

  const fields = [
    {
      name: "Product",
      value: product.product_url
        ? `[${product.product_name || "View Product"}](${product.product_url})`
        : product.product_name || "Unknown Product",
      inline: false,
    },
    {
      name: "Status",
      value: status === "IN_STOCK" ? "✅ In Stock" : status === "READY_FOR_LAUNCH" ? "🔜 Ready for Launch" : "❌ Out of Stock",
      inline: true,
    },
  ];

  if (price) fields.push({ name: "Price", value: `$${Number(price).toFixed(2)}`, inline: true });
  if (stockCount) fields.push({ name: "Stock", value: `${stockCount} units`, inline: true });
  if (cartLimit) fields.push({ name: "Cart Limit", value: `${cartLimit}`, inline: true });
  if (product.identifier_type !== "keyword") fields.push({ name: "ID", value: `\`${product.identifier}\``, inline: true });

  fields.push(SOCIAL_FIELD);

  const embed = {
    title,
    color,
    fields,
    thumbnail: { url: HUMN_ICON },
    footer: { text: `HUMN Monitor • v1.0`, icon_url: HUMN_ICON },
    timestamp: new Date().toISOString(),
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });

    if (!res.ok) {
      log.error("Webhook failed", { status: res.status, product: product.product_name });
    } else {
      log.info("Monitor alert sent", { product: product.product_name, status, retailer: product.retailer });
    }
  } catch (err) {
    log.error("Webhook error", err);
  }
}

module.exports = { sendRestockAlert };
