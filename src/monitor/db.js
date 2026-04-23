"use strict";

/**
 * src/monitor/db.js
 * Supabase queries for the monitor_products table.
 * 
 * Table schema (run in Supabase SQL editor):
 * 
 * create table monitor_products (
 *   id uuid default gen_random_uuid() primary key,
 *   retailer text not null,
 *   identifier text not null,       -- TCIN, SKU, ASIN, or keyword
 *   identifier_type text not null,  -- 'tcin' | 'sku' | 'asin' | 'keyword'
 *   product_name text,
 *   product_url text,
 *   last_status text,               -- 'IN_STOCK' | 'OUT_OF_STOCK' | 'READY_FOR_LAUNCH' | 'UNKNOWN'
 *   last_price numeric,
 *   last_stock_count integer,
 *   last_checked_at timestamptz,
 *   webhook_url text,               -- which webhook to fire to
 *   active boolean default true,
 *   created_at timestamptz default now()
 * );
 */

const { supabase } = require("../config");
const { createLogger } = require("../logger");

const log = createLogger("monitor:db");

async function getAllActiveProducts() {
  const { data, error } = await supabase
    .from("monitor_products")
    .select("*")
    .eq("active", true)
    .order("retailer");

  if (error) log.error("Failed to load monitor products", error);
  return data || [];
}

async function upsertProduct(product) {
  const { data, error } = await supabase
    .from("monitor_products")
    .upsert(product, { onConflict: "retailer,identifier" })
    .select()
    .single();

  if (error) log.error("Failed to upsert product", error);
  return { data, error };
}

async function updateProductStatus({ id, status, price, stockCount, productName, productUrl }) {
  const { error } = await supabase
    .from("monitor_products")
    .update({
      last_status: status,
      last_price: price || null,
      last_stock_count: stockCount || null,
      last_checked_at: new Date().toISOString(),
      ...(productName && { product_name: productName }),
      ...(productUrl && { product_url: productUrl }),
    })
    .eq("id", id);

  if (error) log.error("Failed to update product status", error);
  return { error };
}

async function deleteProduct(id) {
  const { error } = await supabase
    .from("monitor_products")
    .update({ active: false })
    .eq("id", id);

  if (error) log.error("Failed to deactivate product", error);
  return { error };
}

async function getProductById(id) {
  const { data, error } = await supabase
    .from("monitor_products")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) log.error("Failed to get product", error);
  return { data, error };
}

module.exports = {
  getAllActiveProducts,
  upsertProduct,
  updateProductStatus,
  deleteProduct,
  getProductById,
};
