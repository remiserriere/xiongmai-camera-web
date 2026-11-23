// Read-only probe: login, firmware/upgrade info, config export, open ports. Usage: node tools/test-cgi.js <ip> [user] [password]
const net = require("net");
const { XmCamera, md5_8 } = require("../lib/xm-cgi");

const [host, user = "admin", password = ""] = process.argv.slice(2);

function probePort(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: 2000 }, () => {
      s.destroy();
      resolve(true);
    });
    s.on("error", () => resolve(false));
    s.on("timeout", () => {
      s.destroy();
      resolve(false);
    });
  });
}

(async () => {
  if (!host) throw new Error("Usage: node tools/test-cgi.js <ip> [user] [password]");
  console.log("md5_8('') =", md5_8(""), "(expected tlJwpbo6)");
  const cam = new XmCamera({ host, user, password });
  const login = await cam.login();
  console.log("login:", JSON.stringify({ ...login, SessionID: "<hidden>" }));

  const info = (await cam.getInfo("SystemInfo")).SystemInfo;
  console.log("firmware:", info.SoftWareVersion, "build:", info.BuildTime);

  const devId = info.SoftWareVersion.split(".").slice(3).join("");
  const checks = [
    ["getconfig", { Name: "NetWork.OnlineUpgrade" }],
    ["getability", { Name: "SystemFunction" }],
    ["cldupgrade", {
      Name: "OPVersionReq",
      OPVersionReq: { CurVersion: info.BuildTime, DevID: devId, DevType: 0, Expect: 0, Language: "English", Manual: 1, UUID: info.SerialNo }
    }]
  ];
  for (const [cmd, body] of checks) {
    try {
      const r = await cam.request(cmd, body, 30000);
      console.log(`${cmd} ${body.Name}:`, JSON.stringify(r).slice(0, 1500));
    } catch (e) {
      console.log(`${cmd} ${body.Name}: ERROR ${e.message}`);
    }
  }

  try {
    const r = await cam.request("opdev", { Name: "ConfigExport" }, 30000);
    console.log("ConfigExport: Ret", r.Ret, "data bytes", r.Data ? Buffer.from(r.Data, "base64").length : 0);
  } catch (e) {
    console.log("ConfigExport: ERROR", e.message);
  }
  await cam.logout();

  for (const p of [21, 22, 23, 80, 443, 554, 8443, 8899, 9527, 34567, 34568]) {
    console.log(`port ${p}:`, (await probePort(p)) ? "OPEN" : "closed");
  }
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
