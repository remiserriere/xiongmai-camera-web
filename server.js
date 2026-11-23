const { spawn } = require("child_process");
const express = require("express");
const rtspRelay = require("rtsp-relay");
const ffmpegPath = require("ffmpeg-static");
const { XmCamera } = require("./lib/xm-cgi");
const { inspectFirmware } = require("./lib/fw-inspect");
const { AppError, errorMessage, langOf, tr } = require("./lib/messages");

const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || "127.0.0.1";

const app = express();

// Explicit authorities preserve Host filtering behind a reverse proxy or NodePort.
const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, `${host}:${port}`]);
for (const value of (process.env.ALLOWED_HOSTS || "").split(",")) {
  const entry = value.trim().toLowerCase();
  if (!entry) continue;
  try {
    if (!/^(?:[a-z0-9.-]+|\[[a-f0-9:.]+\])(?::\d{1,5})?$/.test(entry)) throw new Error();
    new URL(`http://${entry}`);
  } catch {
    throw new Error("Invalid ALLOWED_HOSTS: use comma-separated hosts with optional ports, without schemes, paths or wildcards.");
  }
  allowedHosts.add(entry);
}
app.use((req, res, next) => {
  if (!allowedHosts.has(String(req.headers.host || "").toLowerCase())) {
    res.status(403).send(tr(langOf(req), "forbiddenHost"));
    return;
  }
  next();
});
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

const relay = rtspRelay(app);

// Single in-memory session: credentials are never written to disk.
let session = null;

function requireSession() {
  if (!session) throw new AppError(409, "notConnected");
  return session;
}

function rtspUrl(stream) {
  const s = requireSession();
  const user = encodeURIComponent(s.user);
  const pass = encodeURIComponent(s.password);
  return `rtsp://${s.host}:${s.rtspPort}/user=${user}&password=${pass}&channel=1&stream=${stream}.sdp?real_stream`;
}

const HOST_RE = /^[A-Za-z0-9.-]{1,253}$/;
const CONFIG_NAME_RE = /^[A-Za-z][\w@]*(\.[\w@]+)*(\.\[\d+\])?$/;
const PTZ_COMMANDS = new Set([
  "DirectionUp", "DirectionDown", "DirectionLeft", "DirectionRight",
  "DirectionLeftUp", "DirectionLeftDown", "DirectionRightUp", "DirectionRightDown",
  "ZoomWide", "ZoomTile", "FocusFar", "FocusNear", "IrisLarge", "IrisSmall",
  "GotoPreset", "SetPreset", "ClearPreset"
]);

function isOk(result) {
  return result.Ret === undefined || result.Ret === 100 || result.Ret === 603 || result.Ret === 150;
}

function route(handler) {
  return async (req, res) => {
    try {
      const result = await handler(req);
      res.json({ ok: isOk(result), result });
    } catch (err) {
      res.status(err.status || 502).json({ ok: false, error: errorMessage(req, err) });
    }
  };
}

function badRequest(key, params) {
  return new AppError(400, key, params);
}

function requireConfigName(name) {
  const value = String(name || "");
  if (!CONFIG_NAME_RE.test(value)) throw badRequest("invalidConfigName");
  return value;
}

app.post("/api/connect", route(async (req) => {
  const camHost = String(req.body.host || "").trim();
  const httpPort = Number(req.body.port || 80);
  const user = String(req.body.user || "admin").trim();
  const password = String(req.body.password || "");
  if (!HOST_RE.test(camHost)) throw badRequest("invalidHost");
  if (!Number.isInteger(httpPort) || httpPort < 1 || httpPort > 65535) throw badRequest("invalidPort");

  if (session) await session.cam.logout();
  session = null;

  const cam = new XmCamera({ host: camHost, port: httpPort, user, password });
  await cam.login();
  const info = await cam.getInfo("SystemInfo");
  const rtsp = await cam.getConfig("NetWork.RTSP").catch(() => null);
  const rtspPort = (rtsp && rtsp["NetWork.RTSP"] && rtsp["NetWork.RTSP"].Server && rtsp["NetWork.RTSP"].Server.Port) || 554;

  session = { cam, host: camHost, httpPort, user, password, rtspPort };
  return { Ret: 100, SystemInfo: info.SystemInfo, rtspPort };
}));

app.post("/api/disconnect", route(async () => {
  if (session) await session.cam.logout();
  session = null;
  return { Ret: 100 };
}));

app.get("/api/status", (req, res) => {
  res.json({ ok: true, connected: Boolean(session), host: session && session.host, user: session && session.user });
});

const streamProxies = new Map();

app.ws("/api/stream", (ws, req) => {
  let url;
  try {
    url = rtspUrl(req.query.q === "main" ? 0 : 1);
  } catch {
    ws.close(1011, "Not connected");
    return;
  }
  if (!streamProxies.has(url)) {
    streamProxies.set(url, relay.proxy({ url, transport: "tcp", additionalFlags: ["-q", "1"], verbose: false }));
  }
  streamProxies.get(url)(ws, req);
});

app.get("/api/snapshot", (req, res) => {
  let url;
  try {
    url = rtspUrl(req.query.q === "sub" ? 1 : 0);
  } catch (err) {
    res.status(409).json({ ok: false, error: errorMessage(req, err) });
    return;
  }
  const ff = spawn(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-rtsp_transport", "tcp", "-i", url, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "-"]);
  const chunks = [];
  const timer = setTimeout(() => ff.kill("SIGKILL"), 15000);
  ff.stdout.on("data", (c) => chunks.push(c));
  ff.on("close", () => {
    clearTimeout(timer);
    if (!chunks.length) {
      res.status(502).json({ ok: false, error: tr(langOf(req), "snapshotFailed") });
      return;
    }
    res.set("Content-Type", "image/jpeg").set("Cache-Control", "no-store").send(Buffer.concat(chunks));
  });
});

app.get("/api/cam/config", route((req) => requireSession().cam.getConfig(requireConfigName(req.query.name))));

app.put("/api/cam/config", route((req) => {
  const name = requireConfigName(req.body.name);
  if (req.body.value === undefined) throw badRequest("missingValue");
  return requireSession().cam.setConfig(name, req.body.value);
}));

app.get("/api/cam/info", route((req) => requireSession().cam.getInfo("SystemInfo")));

app.get("/api/cam/ability", route((req) => requireSession().cam.getAbility(requireConfigName(req.query.name))));

app.post("/api/cam/time-sync", route(() => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  return requireSession().cam.opDev("OPTimeSetting", stamp);
}));

app.post("/api/cam/reboot", route(() => requireSession().cam.opDev("OPMachine", { Action: "Reboot" })));

app.post("/api/cam/password", route(async (req) => {
  const s = requireSession();
  const newPassword = String(req.body.newPassword || "");
  if (newPassword.length < 8) throw badRequest("passwordTooShort");
  const result = await s.cam.request("usermanager", {
    Name: "ModifyPassword",
    EncryptType: "NONE",
    UserName: s.user,
    PassWord: s.password,
    NewPassWord: newPassword
  });
  if (result.Ret === 100) {
    s.password = newPassword;
    s.cam.password = newPassword;
    streamProxies.clear();
  }
  return result;
}));

app.post("/api/ptz", route((req) => {
  const command = String(req.body.command || "");
  if (!PTZ_COMMANDS.has(command)) throw badRequest("invalidPtz");
  const step = Math.min(8, Math.max(1, Number(req.body.step) || 5));
  let preset = req.body.stop ? -1 : 65535;
  if (command.endsWith("Preset")) {
    preset = Number(req.body.preset);
    if (!Number.isInteger(preset) || preset < 1 || preset > 255) throw badRequest("invalidPreset");
  }
  return requireSession().cam.ptz(command, { step, preset });
}));

// ---- Firmware & configuration backup.
const rawBody = express.raw({ type: "application/octet-stream", limit: "64mb" });
let pendingFirmware = null;

app.get("/api/fw/info", route(async () => {
  const cam = requireSession().cam;
  const info = await cam.getInfo("SystemInfo");
  const online = await cam.getConfig("NetWork.OnlineUpgrade").catch(() => ({}));
  return { Ret: 100, SystemInfo: info.SystemInfo, OnlineUpgrade: online["NetWork.OnlineUpgrade"] || null };
}));

app.post("/api/fw/online-check", route(async () => {
  const cam = requireSession().cam;
  const s = (await cam.getInfo("SystemInfo")).SystemInfo;
  return cam.request("cldupgrade", {
    Name: "OPVersionReq",
    OPVersionReq: {
      CurVersion: s.BuildTime,
      DevID: s.SoftWareVersion.split(".").slice(3).join(""),
      DevType: 0,
      Expect: 0,
      Language: "English",
      Manual: 1,
      UUID: s.SerialNo
    }
  }, 30000);
}));

app.get("/api/fw/config-backup", async (req, res) => {
  try {
    const cam = requireSession().cam;
    const r = await cam.request("opdev", { Name: "ConfigExport" }, 30000);
    if (r.Ret !== 100 || !r.Data) throw new AppError(502, "exportRefused", { ret: r.Ret });
    const s = (await cam.getInfo("SystemInfo")).SystemInfo;
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    res.set("Content-Type", "application/octet-stream");
    res.set("Content-Disposition", `attachment; filename="Cfg_${s.SoftWareVersion}_${stamp}.cfg"`);
    res.send(Buffer.from(r.Data, "base64"));
  } catch (err) {
    res.status(err.status || 502).json({ ok: false, error: errorMessage(req, err) });
  }
});

app.post("/api/fw/config-restore", rawBody, route((req) => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw badRequest("emptyFile");
  return requireSession().cam.request("opdev", { Name: "ConfigImport", DataType: "BinaryBase64", Data: req.body.toString("base64") }, 60000);
}));

app.post("/api/fw/inspect", rawBody, route(async (req) => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw badRequest("emptyFile");
  const s = (await requireSession().cam.getInfo("SystemInfo")).SystemInfo;
  const report = inspectFirmware(req.body, s);
  pendingFirmware = report.compatible ? { data: req.body, name: String(req.query.name || "firmware.bin").replace(/[^\w.-]/g, "_") } : null;
  return { Ret: 100, size: req.body.length, ...report };
}));

app.post("/api/fw/upgrade", route(async () => {
  if (!pendingFirmware) throw badRequest("noVerifiedFirmware");
  const fw = pendingFirmware;
  pendingFirmware = null;
  return requireSession().cam.uploadFirmware(fw.data, fw.name);
}));

// Ret is the progress percentage here, not a status code.
app.get("/api/fw/status", async (req, res) => {
  try {
    const r = await requireSession().cam.upgradeStatus();
    res.json({ ok: true, result: r });
  } catch (err) {
    res.status(err.status || 502).json({ ok: false, error: errorMessage(req, err) });
  }
});

app.listen(port, host, () => {
  console.log(`Camera web app running on http://${host}:${port}`);
});
