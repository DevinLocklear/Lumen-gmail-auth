"use strict";

/**
 * analytics/compute.js
 * Pure data aggregation functions. No Supabase, no Discord, no side effects.
 * All inputs are arrays of checkout_event rows.
 */

function normalizeRetailerName(retailer) {
  const value = String(retailer || "").trim().toLowerCase();
  if (value === "pokemoncenter" || value === "pokemon center") return "Pokemon Center";
  if (value === "target") return "Target";
  if (value === "walmart") return "Walmart";
  return retailer || "Unknown Retailer";
}

function normalizeProductKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sumOrderTotals(events = []) {
  return events.reduce((sum, e) => sum + Number(e.order_total || 0), 0);
}

function averageOrderValue(events = []) {
  if (!events.length) return 0;
  return sumOrderTotals(events) / events.length;
}

function buildRetailerBreakdown(events = []) {
  const counts = {};
  for (const e of events) {
    const r = normalizeRetailerName(e.retailer);
    counts[r] = (counts[r] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function buildTopProducts(events = []) {
  const productStats = {};
  for (const e of events) {
    const key = normalizeProductKey(e.product_name);
    if (!key) continue;
    if (!productStats[key]) {
      productStats[key] = {
        product_name: e.product_name || "Unknown Product",
        retailer: normalizeRetailerName(e.retailer),
        count: 0,
        spend: 0,
        quantity: 0,
      };
    }
    productStats[key].count += 1;
    productStats[key].spend += Number(e.order_total || 0);
    productStats[key].quantity += Number(e.quantity || 1);
  }
  return Object.values(productStats).sort((a, b) =>
    b.count !== a.count ? b.count - a.count : b.spend - a.spend
  );
}

function buildDailyTrend(events = []) {
  const daily = {};
  for (const e of events) {
    const key = new Date(e.created_at).toLocaleDateString();
    if (!daily[key]) daily[key] = { count: 0, spend: 0 };
    daily[key].count += 1;
    daily[key].spend += Number(e.order_total || 0);
  }
  return Object.entries(daily).sort((a, b) => new Date(a[0]) - new Date(b[0]));
}

function buildWeekdayBreakdown(events = []) {
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const counts = Object.fromEntries(names.map((n) => [n, 0]));
  for (const e of events) {
    counts[names[new Date(e.created_at).getDay()]] += 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

/**
 * Compute 30-day rank and spend for a single user within a group.
 * Input: array of { discord_user_id, order_total } rows.
 */
function computeUserRankAndSpend(events = [], discordUserId) {
  const userTotals = {};
  for (const e of events) {
    const id = e.discord_user_id;
    userTotals[id] = (userTotals[id] || 0) + Number(e.order_total || 0);
  }
  const sorted = Object.entries(userTotals).sort((a, b) => b[1] - a[1]);
  let rank = null;
  let spend = 0;
  sorted.forEach(([id, total], index) => {
    if (id === discordUserId) { rank = index + 1; spend = total; }
  });
  return { rank, spend };
}

module.exports = {
  normalizeRetailerName,
  normalizeProductKey,
  sumOrderTotals,
  averageOrderValue,
  buildRetailerBreakdown,
  buildTopProducts,
  buildDailyTrend,
  buildWeekdayBreakdown,
  computeUserRankAndSpend,
};
