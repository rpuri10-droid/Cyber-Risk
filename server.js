const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = __dirname;
const port = Number(process.env.PORT || 3000);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function send(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function getSafePath(urlPath) {
  const normalized = path.normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, "");
  const resolved = path.join(rootDir, normalized === "" ? "index.html" : normalized);
  if (!resolved.startsWith(rootDir)) {
    return null;
  }
  return resolved;
}

const server = http.createServer((req, res) => {
  const requestPath = req.url.split("?")[0];
  const filePath = getSafePath(requestPath === "/" ? "/index.html" : requestPath);

  if (!filePath) {
    send(res, 400, "Bad request");
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      send(res, 404, "Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || "application/octet-stream";

    fs.readFile(filePath, (readError, content) => {
      if (readError) {
        send(res, 500, "Internal server error");
        return;
      }

      res.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
      });
      res.end(content);
    });
  });
});

server.listen(port, () => {
  console.log(`Cyber Risk Quantification Dashboard running at http://localhost:${port}`);
});