const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 5173);
const LM_STUDIO_BASE = (process.env.LM_STUDIO_BASE || "http://127.0.0.1:1234/v1").replace(/\/+$/, "");
const ROOT = process.cwd();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function send(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function mapFilePath(urlPath) {
  let p = decodeURIComponent(urlPath.split("?")[0]);
  if (p === "/") p = "/index.html";
  const abs = path.resolve(ROOT, `.${p}`);
  if (!abs.startsWith(ROOT)) return null;
  return abs;
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function proxyApi(req, res, pathname, search) {
  const target = `${LM_STUDIO_BASE}${pathname.replace(/^\/api\/v1/, "")}${search || ""}`;

  try {
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      const key = k.toLowerCase();
      if (key === "host" || key === "connection" || key === "content-length") continue;
      headers[k] = v;
    }

    const method = req.method || "GET";
    const hasBody = !["GET", "HEAD"].includes(method.toUpperCase());
    const body = hasBody ? await readRequestBody(req) : undefined;

    const upstream = await fetch(target, {
      method,
      headers,
      body,
      duplex: hasBody ? "half" : undefined,
    });

    const arrayBuffer = await upstream.arrayBuffer();
    const payload = Buffer.from(arrayBuffer);

    res.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(payload);
  } catch (err) {
    send(res, 502, JSON.stringify({ error: `proxy error: ${err.message}` }), "application/json; charset=utf-8");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (url.pathname.startsWith("/api/v1/")) {
    await proxyApi(req, res, url.pathname, url.search);
    return;
  }

  if (url.pathname === "/health") {
    send(res, 200, "ok\n");
    return;
  }

  const abs = mapFilePath(url.pathname);
  if (!abs) {
    send(res, 400, "bad path\n");
    return;
  }

  fs.stat(abs, (err, stat) => {
    if (err || !stat.isFile()) {
      send(res, 404, "not found\n");
      return;
    }

    const ext = path.extname(abs).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    fs.createReadStream(abs).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`Server: http://localhost:${PORT}`);
  console.log(`Proxy : /api/v1 -> ${LM_STUDIO_BASE}`);
});
