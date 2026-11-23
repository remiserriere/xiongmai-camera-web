const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { once } = require("node:events");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { test } = require("node:test");

const root = path.join(__dirname, "..");

async function startServer(t, allowedHosts = "") {
  const reservation = net.createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));

  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), ALLOWED_HOSTS: allowedHosts },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  const exited = once(child, "exit");
  t.after(async () => {
    child.kill();
    await exited;
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${output}`)), 10000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.includes("Camera web app running")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", () => { clearTimeout(timer); reject(new Error(output)); });
  });
  return port;
}

function request(port, host, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({
      hostname: "127.0.0.1", port, path: "/api/status",
      headers: { Host: host, ...headers }
    }, (res) => {
      res.resume();
      res.once("end", () => resolve(res.statusCode));
    });
    req.once("error", reject);
  });
}

test("default Host policy remains local and does not trust forwarded hosts", async (t) => {
  const port = await startServer(t);
  assert.equal(await request(port, `127.0.0.1:${port}`), 200);
  assert.equal(await request(port, "camera.example.test"), 403);
  assert.equal(await request(port, "other.example.test", { "X-Forwarded-Host": `localhost:${port}` }), 403);
});

test("configured authorities accept ingress, NodePort and IPv6 hosts with exact ports", async (t) => {
  const port = await startServer(t, " CAMERA.Example.Test, 192.0.2.10:30080, [2001:db8::1]:8443, ");
  assert.equal(await request(port, `localhost:${port}`), 200);
  assert.equal(await request(port, "Camera.Example.Test"), 200);
  assert.equal(await request(port, "192.0.2.10:30080"), 200);
  assert.equal(await request(port, "[2001:db8::1]:8443"), 200);
  assert.equal(await request(port, "camera.example.test:8443"), 403);
  assert.equal(await request(port, "192.0.2.10:30081"), 403);
  assert.equal(await request(port, "other.example.test", { "X-Forwarded-Host": "camera.example.test" }), 403);
});

test("invalid allowlists fail explicitly at startup", () => {
  for (const value of ["*", "https://camera.example.test", "camera.example.test/path", "camera.example.test:65536"]) {
    const result = spawnSync(process.execPath, ["server.js"], {
      cwd: root,
      env: { ...process.env, ALLOWED_HOSTS: value },
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "ignore", "pipe"]
    });
    assert.ifError(result.error);
    assert.notEqual(result.status, 0, value);
    assert.match(result.stderr, /Invalid ALLOWED_HOSTS/, value);
  }
});
