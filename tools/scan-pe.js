// Static scan of a PE file: sections, overlay, embedded archive signatures, interesting strings. Never executes the target.
const fs = require("fs");

const file = process.argv[2];
const buf = fs.readFileSync(file);
const out = [];
const log = (...a) => out.push(a.join(" "));

const peOff = buf.readUInt32LE(0x3c);
const nSec = buf.readUInt16LE(peOff + 6);
const optSize = buf.readUInt16LE(peOff + 20);
const magic = buf.readUInt16LE(peOff + 24);
log("PE32+:", magic === 0x20b, "sections:", nSec);
let secEnd = 0;
const secStart = peOff + 24 + optSize;
for (let i = 0; i < nSec; i++) {
  const o = secStart + i * 40;
  const name = buf.toString("ascii", o, o + 8).replace(/\0/g, "");
  const vs = buf.readUInt32LE(o + 8);
  const rs = buf.readUInt32LE(o + 16);
  const rp = buf.readUInt32LE(o + 20);
  secEnd = Math.max(secEnd, rp + rs);
  log(`  section ${name} vsize=${vs} rawsize=${rs} rawptr=${rp}`);
}
log("end of sections:", secEnd, "file size:", buf.length, "overlay bytes:", buf.length - secEnd);

const sigs = {
  NSIS: Buffer.from("NullsoftInst"),
  Inno: Buffer.from("Inno Setup Setup Data"),
  InnoLdr: Buffer.from("rDlPtS"),
  "7z": Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]),
  ZIP: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  MSI_CFB: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  CAB: Buffer.from("MSCF"),
  WiXBurn: Buffer.from(".wixburn"),
  MZ_embedded: Buffer.from("This program cannot be run in DOS mode")
};
for (const [k, s] of Object.entries(sigs)) {
  const hits = [];
  let i = -1;
  while ((i = buf.indexOf(s, i + 1)) !== -1 && hits.length < 15) hits.push(i);
  log(`sig ${k}: ${hits.length ? hits.join(",") : "none"}`);
}

const re = /[\x20-\x7e]{6,}/g;
const ascii = buf.toString("latin1");
const keys = /(https?:\/\/|wss?:\/\/|rtsp|onvif|34567|NetSDK|H264_DVR|XMeye|xiongmai|jftech|Sofia|DVRIP|VideoPlayTool|localhost|127\.0\.0\.1|\.dll|\.exe|\.ocx|HKEY|Software\\|CurrentVersion\\Run|URL Protocol|shell\\open|schtasks|firewall|netsh|Service|Nullsoft|Inno|Qt5|websocket|Login|ConfigGet|ConfigSet|GetConfig)/i;
const seen = new Map();
let m;
while ((m = re.exec(ascii))) {
  if (keys.test(m[0])) seen.set(m[0], (seen.get(m[0]) || 0) + 1);
}
const u16 = buf.toString("utf16le");
const re16 = /[\x20-\x7e]{6,}/g;
while ((m = re16.exec(u16))) {
  if (keys.test(m[0])) seen.set("[u16] " + m[0], (seen.get("[u16] " + m[0]) || 0) + 1);
}
log("--- interesting strings (" + seen.size + ") ---");
for (const [s, c] of [...seen.entries()].slice(0, 600)) log(`${c}x ${s.slice(0, 220)}`);

fs.writeFileSync(process.argv[3], out.join("\n"));
console.log("done", out.length, "lines");
