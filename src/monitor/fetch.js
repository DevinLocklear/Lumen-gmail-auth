"use strict";

/**
 * src/monitor/fetch.js
 * Proxy-aware HTTP fetch using Node's native modules.
 * Uses tunnel approach for HTTPS through HTTP proxy.
 */

const http = require("http");
const https = require("https");
const tls = require("tls");
const { URL } = require("url");

/**
 * Make an HTTP/HTTPS request, optionally through an HTTP proxy.
 */
function proxyFetch(targetUrl, options = {}, proxy = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(targetUrl);
    const isHttps = url.protocol === "https:";
    const targetPort = parseInt(url.port) || (isHttps ? 443 : 80);
    const timeout = options.timeout || 20000;
    const method = options.method || "GET";

    const reqHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "application/json, text/html, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Connection": "close",
      ...(options.headers || {}),
    };

    if (options.body) {
      reqHeaders["Content-Length"] = Buffer.byteLength(options.body).toString();
    }

    // No proxy — direct request
    if (!proxy) {
      return directRequest(url, targetPort, isHttps, method, reqHeaders, options.body, timeout, resolve, reject);
    }

    // With proxy — CONNECT tunnel
    const proxyAuth = proxy.user && proxy.pass
      ? "Basic " + Buffer.from(proxy.user + ":" + proxy.pass).toString("base64")
      : null;

    // Step 1: Open TCP connection to proxy
    const proxySocket = http.request({
      hostname: proxy.host,
      port: proxy.port,
      method: "CONNECT",
      path: url.hostname + ":" + targetPort,
      headers: Object.assign(
        { "Host": url.hostname + ":" + targetPort },
        proxyAuth ? { "Proxy-Authorization": proxyAuth } : {}
      ),
    });

    const timer = setTimeout(() => {
      proxySocket.destroy();
      reject(new Error("Proxy connect timed out"));
    }, timeout);

    proxySocket.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proxySocket.on("connect", (res, socket) => {
      clearTimeout(timer);

      if (res.statusCode !== 200) {
        socket.destroy();
        return reject(new Error("Proxy CONNECT failed: " + res.statusCode));
      }

      // Step 2: TLS over the tunnel
      const tlsSocket = tls.connect({
        socket: socket,
        servername: url.hostname,
        rejectUnauthorized: false,
      });

      const tlsTimer = setTimeout(() => {
        tlsSocket.destroy();
        reject(new Error("Request timed out"));
      }, timeout);

      tlsSocket.on("error", (err) => {
        clearTimeout(tlsTimer);
        reject(err);
      });

      tlsSocket.on("secureConnect", () => {
        // Step 3: Send HTTP request over TLS socket
        const path = (url.pathname || "/") + (url.search || "");
        const requestLine = method + " " + path + " HTTP/1.1\r\n";
        const hostHeader = "Host: " + url.hostname + "\r\n";
        const headerStr = Object.entries(reqHeaders)
          .map(([k, v]) => k + ": " + v)
          .join("\r\n");

        const fullRequest = requestLine + hostHeader + headerStr + "\r\n\r\n" +
          (options.body || "");

        tlsSocket.write(fullRequest);

        // Step 4: Read response
        let buffer = "";
        let headersDone = false;
        let statusCode = 0;
        let body = "";
        let contentLength = -1;
        let chunked = false;

        tlsSocket.on("data", (chunk) => {
          buffer += chunk.toString("binary");

          if (!headersDone) {
            const idx = buffer.indexOf("\r\n\r\n");
            if (idx !== -1) {
              headersDone = true;
              const headerPart = buffer.slice(0, idx);
              body = buffer.slice(idx + 4);

              const statusMatch = headerPart.match(/HTTP\/[\d.]+ (\d+)/);
              statusCode = statusMatch ? parseInt(statusMatch[1]) : 0;

              const clMatch = headerPart.match(/content-length:\s*(\d+)/i);
              if (clMatch) contentLength = parseInt(clMatch[1]);

              const teMatch = headerPart.match(/transfer-encoding:\s*chunked/i);
              if (teMatch) chunked = true;
            }
          } else {
            body += chunk.toString("binary");
          }
        });

        tlsSocket.on("end", () => {
          clearTimeout(tlsTimer);
          try {
            const decoded = Buffer.from(body, "binary").toString("utf8");
            resolve({ status: statusCode, headers: {}, body: decoded });
          } catch (e) {
            resolve({ status: statusCode, headers: {}, body });
          }
        });

        tlsSocket.on("close", () => {
          clearTimeout(tlsTimer);
          if (statusCode > 0) {
            try {
              const decoded = Buffer.from(body, "binary").toString("utf8");
              resolve({ status: statusCode, headers: {}, body: decoded });
            } catch (e) {
              resolve({ status: statusCode, headers: {}, body });
            }
          }
        });
      });
    });

    proxySocket.end();
  });
}

function directRequest(url, targetPort, isHttps, method, headers, body, timeout, resolve, reject) {
  const options = {
    hostname: url.hostname,
    port: targetPort,
    path: (url.pathname || "/") + (url.search || ""),
    method,
    headers,
    timeout,
    rejectUnauthorized: false,
  };

  const req = (isHttps ? https : http).request(options, (res) => {
    let data = "";
    res.on("data", chunk => data += chunk);
    res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
  });

  req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });
  req.on("error", reject);
  if (body) req.write(body);
  req.end();
}

module.exports = { proxyFetch };
