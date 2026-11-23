// Read-only probe of the camera web API: fetches its JS and asks for login parameters (GetSalt).
const fs = require("fs");
const host = process.argv[2];
if (!host) {
  console.error("Usage: node tools/probe-camera.js <ip>");
  process.exit(1);
}
const outDir = "analysis/camera-web";
fs.mkdirSync(outDir, { recursive: true });

async function get(path) {
  try {
    const r = await fetch(`http://${host}${path}`, { signal: AbortSignal.timeout(5000) });
    const t = await r.text();
    console.log(`GET ${path} -> ${r.status} (${t.length} bytes)`);
    if (r.ok) fs.writeFileSync(`${outDir}/${path.replace(/[\/?=&]/g, "_")}`, t);
    return r.ok ? t : "";
  } catch (e) {
    console.log(`GET ${path} -> ERROR ${e.message}`);
    return "";
  }
}

(async () => {
  const index = await get("/");
  const plugin = await get("/pluginVersion.js");
  const main = await get("/js/main.js");
  const scripts = new Set();
  for (const src of [index, plugin, main]) {
    for (const m of src.matchAll(/["']((?:js|html|plugin|crypt-js)\/[\w\-./]+\.js)["']/g)) scripts.add(m[1]);
  }
  for (const s of scripts) await get("/" + s);

  try {
    const r = await fetch(`http://${host}/cgi-bin/login.cgi`, {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=utf-8" },
      body: JSON.stringify({ Name: "GetSalt" }),
      signal: AbortSignal.timeout(5000)
    });
    const t = await r.text();
    console.log("GetSalt ->", r.status, t.replace(/"PublicKey"\s*:\s*"[^"]{40}[^"]*"/, '"PublicKey":"<truncated>"'));
  } catch (e) {
    console.log("GetSalt -> ERROR", e.message);
  }
})();
