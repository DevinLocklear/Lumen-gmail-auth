"use strict";

/**
 * src/monitor/proxy.js
 * Loads and rotates proxy lists per retailer.
 * Format: host:port:user:password (one per line)
 */

const fs = require("fs");
const path = require("path");
const { createLogger } = require("../logger");

const log = createLogger("proxy");

const PROXY_FILES = {
  pokemoncenter: path.join(__dirname, "../../proxies-pokemoncenter.txt"),
  walmart: path.join(__dirname, "../../proxies-walmart.txt"),
  target: path.join(__dirname, "../../proxies-general.txt"),
  gamestop: path.join(__dirname, "../../proxies-general.txt"),
  amazon: path.join(__dirname, "../../proxies-general.txt"),
  general: path.join(__dirname, "../../proxies-general.txt"),
};

// Load and parse proxy lists
const proxyLists = {};
const proxyIndexes = {};

function loadProxies() {
  for (const [retailer, filePath] of Object.entries(PROXY_FILES)) {
    try {
      if (!fs.existsSync(filePath)) {
        log.warn(`Proxy file not found for ${retailer}`, { filePath });
        proxyLists[retailer] = [];
        continue;
      }

      const lines = fs.readFileSync(filePath, "utf8")
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean);

      proxyLists[retailer] = lines.map(line => {
        const [host, port, user, pass] = line.split(":");
        return { host, port: parseInt(port), user, pass, raw: line };
      });

      proxyIndexes[retailer] = 0;
      log.info(`Loaded ${proxyLists[retailer].length} proxies for ${retailer}`);
    } catch (err) {
      log.error(`Failed to load proxy file for ${retailer}`, err);
      proxyLists[retailer] = [];
    }
  }
}

/**
 * Get next proxy for a retailer (round-robin rotation)
 */
function getProxy(retailer = "general") {
  const list = proxyLists[retailer] || proxyLists.general || [];
  if (!list.length) return null;

  const idx = proxyIndexes[retailer] || 0;
  const proxy = list[idx % list.length];
  proxyIndexes[retailer] = (idx + 1) % list.length;

  return proxy;
}

/**
 * Get proxy as URL string for axios
 * Returns: http://user:pass@host:port
 */
function getProxyUrl(retailer = "general") {
  const proxy = getProxy(retailer);
  if (!proxy) return null;
  return `http://${proxy.user}:${proxy.pass}@${proxy.host}:${proxy.port}`;
}

/**
 * Get proxy config object for axios
 */
function getProxyConfig(retailer = "general") {
  const proxy = getProxy(retailer);
  if (!proxy) return {};
  return {
    proxy: {
      host: proxy.host,
      port: proxy.port,
      auth: { username: proxy.user, password: proxy.pass },
      protocol: "http",
    }
  };
}

// Load on startup
loadProxies();

module.exports = { getProxy, getProxyUrl, getProxyConfig, loadProxies };
