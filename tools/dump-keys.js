// Lists the leaf keys of each config section used by the UI (read-only). Usage: node tools/dump-keys.js <ip> [user] [password]
const { XmCamera } = require("../lib/xm-cgi");

const SECTIONS = [
  "Camera.Param.[0]", "Camera.ParamEx.[0]", "AVEnc.VideoColor.[0]", "AVEnc.VideoWidget.[0]", "Simplify.Encode",
  "NetWork.NetCommon", "NetWork.NetDHCP", "NetWork.NetDNS", "NetWork.RTSP", "NetWork.NetNTP", "NetWork.Nat",
  "NetWork.Upnp", "NetWork.NetDDNS", "Detect.MotionDetect.[0]", "Detect.HumanDetection.[0]", "General.General",
  "General.Location", "System.TimeZone", "NetWork.OnlineUpgrade"
];

function leaves(value, prefix, out) {
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) leaves(v, Array.isArray(value) ? prefix : (prefix ? `${prefix}.${k}` : k), out);
  } else {
    out.add(`${prefix}=${JSON.stringify(value).slice(0, 40)}`);
  }
  return out;
}

(async () => {
  const [host, user = "admin", password = ""] = process.argv.slice(2);
  const cam = new XmCamera({ host, user, password });
  await cam.login();
  for (const name of SECTIONS) {
    const r = await cam.getConfig(name).catch(() => null);
    if (!r || r.Ret !== 100) {
      console.log(`## ${name}: Ret=${r && r.Ret}`);
      continue;
    }
    console.log(`## ${name}: ${[...leaves(r[r.Name], "", new Set())].join(" | ")}`);
  }
  await cam.logout();
})();
