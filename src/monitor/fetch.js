"use strict";

/**
 * src/monitor/fetch.js
 * Proxy-aware HTTP fetch using axios with tunnel proxy support.
 */

const axios = require("axios");
const http = require("http");
const https = require("https");
const { URL } = require("url");

/**
 * Make an HTTP/HTTPS request, optionally through an HTTP proxy.
 */
async function proxyFetch(targetUrl, options = {}, proxy = null) {
  const timeout = options.timeout || 20000;

  const config = {
    url: targetUrl,
    method: options.method || "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "application/json, text/html, */*",
      "Accept-Language": "en-US,en;q=0.9",
      ...(options.headers || {}),
    },
    timeout,
    validateStatus: () => true, // Don't throw on any status code
    responseType: "text",
    decompress: true,
  };

  if (options.body) {
    config.data = options.body;
  }

  // Add proxy if provided
  if (proxy) {
    config.proxy = {
      host: proxy.host,
      port: proxy.port,
      auth: proxy.user && proxy.pass ? {
        username: proxy.user,
        password: proxy.pass,
      } : undefined,
      protocol: "http",
    };
  }

  const res = await axios(config);
  return {
    status: res.status,
    headers: res.headers,
    body: typeof res.data === "string" ? res.data : JSON.stringify(res.data),
  };
}

module.exports = { proxyFetch };
