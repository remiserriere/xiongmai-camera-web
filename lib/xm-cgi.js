// Client for the Xiongmai/JFTech camera CGI API (/cgi-bin/*.cgi), reverse-engineered from the vendor web UI.
const crypto = require("crypto");

function md5Hex(s) {
  return crypto.createHash("md5").update(s, "utf8").digest("hex");
}

// Vendor "MD5_8" (Sofia) hash: 16 MD5 bytes folded pairwise into 8 alphanumeric chars.
function md5_8(input) {
  const d = crypto.createHash("md5").update(input, "utf8").digest();
  let out = "";
  for (let i = 0; i < 8; i++) {
    const v = (d[2 * i] + d[2 * i + 1]) % 62;
    out += String.fromCharCode(v <= 9 ? v + 48 : v <= 35 ? v + 55 : v + 61);
  }
  return out;
}

function hexToB64Url(hex) {
  const h = hex.length % 2 ? "0" + hex : hex;
  return Buffer.from(h, "hex").toString("base64url");
}

// Equivalent of jsbn RSAKey.encrypt: PKCS#1 v1.5, hex output without leading zero bytes.
function rsaEncryptHex(publicKey, text) {
  const out = crypto.publicEncrypt({ key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(text, "utf8"));
  let hex = out.toString("hex").replace(/^(00)+/, "");
  return hex.length % 2 ? "0" + hex : hex;
}

// Equivalent of CryptoJS AES-CBC with empty IV (= zero IV) and ZeroPadding, base64 output.
function aesEncrypt(text, key) {
  const data = Buffer.from(text, "utf8");
  const padded = Buffer.alloc(Math.ceil(data.length / 16) * 16 || 16);
  data.copy(padded);
  const c = crypto.createCipheriv("aes-128-cbc", Buffer.from(key, "utf8"), Buffer.alloc(16));
  c.setAutoPadding(false);
  return Buffer.concat([c.update(padded), c.final()]).toString("base64");
}

function aesDecrypt(b64, key) {
  const d = crypto.createDecipheriv("aes-128-cbc", Buffer.from(key, "utf8"), Buffer.alloc(16));
  d.setAutoPadding(false);
  const raw = Buffer.concat([d.update(Buffer.from(b64, "base64")), d.final()]);
  let end = raw.length;
  while (end > 0 && raw[end - 1] === 0) end--;
  return raw.subarray(0, end).toString("utf8");
}

function randomAscii16() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(crypto.randomBytes(16), (b) => chars[b % chars.length]).join("");
}

class XmCamera {
  constructor({ host, port = 80, user = "admin", password = "", timeoutMs = 10000 }) {
    this.baseUrl = `http://${host}:${port}`;
    this.user = user;
    this.password = password;
    this.timeoutMs = timeoutMs;
    this.reset();
  }

  reset() {
    this.salt = null;
    this.sessionId = null;
    this.aesKey = null;
    this.cookie = "";
    this.loginInfo = null;
    this.queue = Promise.resolve();
  }

  async rawPost(cmd, body, encrypt, timeoutMs = this.timeoutMs) {
    const payload = encrypt ? aesEncrypt(JSON.stringify(body), this.aesKey) : JSON.stringify(body);
    const headers = { "Content-Type": (encrypt ? "text/plain" : "application/json") + ";charset=utf-8" };
    if (this.cookie) headers.Cookie = this.cookie;

    const res = await fetch(`${this.baseUrl}/cgi-bin/${cmd}.cgi`, {
      method: "POST",
      headers,
      body: payload,
      signal: AbortSignal.timeout(timeoutMs)
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];

    const text = (await res.text()).replace(/[\r\n]/g, "").trim();
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${cmd}.cgi`);
    return this.decode(text);
  }

  decode(text) {
    if (text.startsWith("{")) {
      const obj = JSON.parse(text);
      // Large payloads may come back unencrypted, as in the vendor client.
      if (!this.aesKey || obj.Name !== "" || obj.Ret !== undefined) return obj;
    }
    if (!this.aesKey) throw new Error("Unexpected non-JSON response");
    return JSON.parse(aesDecrypt(text.replace(/^"|"$/g, ""), this.aesKey));
  }

  async login() {
    this.reset();
    const salt = await this.rawPost("login", { Name: "GetSalt" }, false);
    if (salt.Ret !== 100) throw new Error(`GetSalt failed (Ret=${salt.Ret})`);
    this.salt = salt.Salt;

    const req = { Name: "Login", Salt: this.salt };
    let aesKey = null;
    if (String(salt.LoginEncryptionType || "").includes("RSA")) {
      const [n, e] = String(salt.PublicKey).split(",");
      const pub = crypto.createPublicKey({ key: { kty: "RSA", n: hexToB64Url(n), e: hexToB64Url(e) }, format: "jwk" });
      req.LoginEncryptionType = "RSA";
      req.User = rsaEncryptHex(pub, this.user);
      req.Sign = rsaEncryptHex(pub, this.salt + md5Hex(this.password));
      req.VERK = rsaEncryptHex(pub, crypto.randomBytes(48).toString("hex"));
      if (salt.DataEncryptionType === "AES") {
        aesKey = randomAscii16();
        req.DTAK = rsaEncryptHex(pub, aesKey);
      }
    } else {
      req.LoginEncryptionType = "MD5_8";
      req.User = this.user;
      req.Sign = md5_8(this.salt + md5_8(this.password));
    }

    const res = await this.rawPost("login", req, false);
    if (res.Ret !== 100) {
      this.reset();
      throw new Error(`Login refused (Ret=${res.Ret})`);
    }
    this.aesKey = aesKey;
    this.sessionId = res.SessionID;
    this.loginInfo = res;
    return res;
  }

  // Serialized like the vendor client, which refuses concurrent requests.
  exclusive(fn) {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => {});
    return p;
  }

  request(cmd, body, timeoutMs, plain = false) {
    return this.exclusive(async () => {
      if (!this.sessionId) await this.login();
      const send = () => this.rawPost(cmd, { ...body, Salt: this.salt, SessionID: this.sessionId }, Boolean(this.aesKey) && !plain, timeoutMs);
      let res = await send().catch(() => null);
      if (!res || res.Ret === 101 || res.Ret === 103 || res.Ret === 105 || res.Ret === 113) {
        await this.login();
        res = await send();
      }
      return res;
    });
  }

  // Same sequence as the vendor web UI: UpgradeStart, then multipart upload; progress via upgradeStatus().
  async uploadFirmware(data, filename) {
    const start = await this.request("upgrade", { Name: "UpgradeStart", FileLength: data.length }, 30000, true);
    if (start.Ret !== 100) return start;
    return this.exclusive(async () => {
      const form = new FormData();
      form.append("UpgradeData", new Blob([data]), filename);
      const url = `${this.baseUrl}/cgi-bin/upgrade.cgi?Name=UpgradeData&Salt=${encodeURIComponent(this.salt)}&DataLength=${data.length}`;
      const res = await fetch(url, {
        method: "POST",
        body: form,
        headers: this.cookie ? { Cookie: this.cookie } : {},
        signal: AbortSignal.timeout(300000)
      });
      const text = (await res.text()).trim();
      return { Ret: res.ok ? 100 : -1, HttpStatus: res.status, Body: text.slice(0, 300) };
    });
  }

  upgradeStatus() {
    return this.request("upgrade", { Name: "UpgradeStatus" }, 10000, true);
  }

  getConfig(name, channel) {
    const full = channel === undefined || channel === null || channel === "" ? name : `${name}.[${channel}]`;
    return this.request("getconfig", { Name: full });
  }

  setConfig(name, value) {
    return this.request("setconfig", { Name: name, [name]: value }, 60000);
  }

  getAbility(name) {
    return this.request("getability", { Name: name });
  }

  getInfo(name) {
    return this.request("getinfo", { Name: name });
  }

  opDev(name, value, timeoutMs) {
    return this.request("opdev", { Name: name, [name]: value }, timeoutMs);
  }

  ptz(command, { channel = 0, step = 5, preset = 65535, tour = 0 } = {}) {
    return this.request("opptz", {
      Name: "OPPTZControl",
      OPPTZControl: {
        Command: command,
        Parameter: {
          AUX: { Number: 0, Status: "On" },
          Channel: channel,
          MenuOpts: "Enter",
          POINT: { bottom: 0, left: 0, right: 0, top: 0 },
          Pattern: "SetBegin",
          Preset: preset,
          Step: step,
          Tour: tour
        }
      }
    }, 3000);
  }

  async logout() {
    if (!this.sessionId) return;
    await this.rawPost("login", { Name: "Logout", Salt: this.salt, SessionID: this.sessionId }, Boolean(this.aesKey), 3000).catch(() => {});
    this.reset();
  }
}

module.exports = { XmCamera, md5_8 };
