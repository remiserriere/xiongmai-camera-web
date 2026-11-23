// Inspects a Xiongmai firmware .bin (a ZIP archive with an "InstallDesc" JSON manifest) without extracting it to disk.
const zlib = require("zlib");
const { AppError } = require("./messages");

function listZipEntries(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new AppError(400, "fwNotZip");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new AppError(400, "fwZipCorrupt");
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const size = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
    entries.push({ name, method, compSize, size, localOff });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntry(buf, entry) {
  const nameLen = buf.readUInt16LE(entry.localOff + 26);
  const extraLen = buf.readUInt16LE(entry.localOff + 28);
  const start = entry.localOff + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + entry.compSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return zlib.inflateRawSync(data);
  throw new AppError(400, "fwZipMethod", { method: entry.method });
}

function inspectFirmware(buf, systemInfo) {
  const entries = listZipEntries(buf);
  const descEntry = entries.find((e) => e.name.toLowerCase() === "installdesc");
  if (!descEntry) throw new AppError(400, "fwNoManifest");
  const raw = readEntry(buf, descEntry).toString("utf8");
  let desc;
  try {
    desc = JSON.parse(raw);
  } catch {
    desc = null;
  }

  const hardware = (desc && (desc.Hardware || desc.HardWare)) || (/"Hard[Ww]are"\s*:\s*"([^"]+)"/.exec(raw) || [])[1] || "";
  const vendor = (desc && desc.Vendor) || "";
  const current = (systemInfo && systemInfo.HardWare) || "";
  return {
    files: entries.map((e) => ({ name: e.name, size: e.size })),
    hardware,
    vendor,
    currentHardware: current,
    compatible: Boolean(hardware) && hardware === current,
    installDesc: raw.slice(0, 4000)
  };
}

module.exports = { inspectFirmware };
