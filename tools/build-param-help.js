// Builds public/param-help-vendor.json from the vendor web UI shipped in VideoPlayToolSetup.exe:
// config key -> form control (cfg/*.js) -> label element (cfg/*.html) -> text id (language.js) -> French/English text (lg/*.xml).
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "analysis", "extracted", "Web");
const cfgDir = path.join(root, "html", "cfg");

function loadLang(file) {
  const xml = fs.readFileSync(path.join(root, "lg", file), "utf8");
  const map = {};
  for (const m of xml.matchAll(/<string id="([^"]+)">([\s\S]*?)<\/string>/g)) {
    map[m[1]] = m[2].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/<[^>]+>/g, " ").trim();
  }
  return map;
}

const fr = loadLang("French.xml");
const en = loadLang("English.xml");

// element id -> text id, from language.js ("Foo.innerHTML = lg.get("IDS_X")").
const elemToLg = {};
const langJs = fs.readFileSync(path.join(root, "plugin", "language.js"), "utf8");
for (const m of langJs.matchAll(/\b(\w+)\.(?:innerHTML|title|value|placeholder)\s*=\s*lg\.get\("([^"]+)"\)/g)) {
  if (!elemToLg[m[1]]) elemToLg[m[1]] = m[2];
}
for (const m of langJs.matchAll(/\$\(["']#(\w+)["']\)\.(?:html|text|attr\("title",)\s*\(?\s*lg\.get\("([^"]+)"\)/g)) {
  if (!elemToLg[m[1]]) elemToLg[m[1]] = m[2];
}

// Tips/explanations sometimes live in text ids containing Tip/Tips/Explain/Note.
const tipIds = Object.keys(fr).filter((id) => /tip|explain|note|desc/i.test(id));

const STOP = new Set(["Name", "length", "value", "checked", "selectedIndex", "innerHTML", "files", "disabled", "options", "style", "display", "Ret", "SessionID", "prototype", "web", "loginRsp", "Ability", "OtherFunction", "devType", "fn"]);

const result = {};

for (const file of fs.readdirSync(cfgDir).filter((f) => f.endsWith(".js"))) {
  const page = file.replace(/\.js$/, "");
  const js = fs.readFileSync(path.join(cfgDir, file), "utf8");
  const htmlPath = path.join(cfgDir, `${page}.html`);
  const html = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, "utf8") : "";

  // control id -> nearest preceding label element that has a translation.
  const controlLabel = {};
  let current = null;
  for (const m of html.matchAll(/<(\w+)[^>]*\bid\s*=\s*["']([^"']+)["']/g)) {
    const [, tag, id] = m;
    if (elemToLg[id] && !/^(select|input|textarea)$/i.test(tag)) current = id;
    else if (current) controlLabel[id] = current;
  }

  // Config names used by the page.
  const configNames = [...new Set([...js.matchAll(/["']((?:[A-Z][\w@]*)(?:\.[\w@]+)+)["']/g)].map((m) => m[1]).filter((n) => !n.endsWith(".js") && !n.endsWith(".html")))];

  // key -> control ids, from lines touching both a config property and a jQuery selector.
  const keyControls = {};
  for (const line of js.split("\n")) {
    const ids = [...line.matchAll(/\$\(\s*["']#(\w+)["']/g)].map((m) => m[1]);
    if (!ids.length) continue;
    const stripped = line.replace(/\$\(\s*["'][^"']*["']\s*\)/g, "");
    const keys = [
      ...[...stripped.matchAll(/\.([A-Za-z_]\w*)\b(?!\s*\()/g)].map((m) => m[1]),
      ...[...stripped.matchAll(/\[\s*["'](\w+)["']\s*\]/g)].map((m) => m[1])
    ].filter((k) => !STOP.has(k) && !/^(val|prop|attr|css|html|text|slider|show|hide|click|change|data|is|find|each|parent|children|addClass|removeClass)$/.test(k));
    for (const k of keys) for (const id of ids) (keyControls[k] = keyControls[k] || new Set()).add(id);
  }

  for (const [key, ids] of Object.entries(keyControls)) {
    for (const id of ids) {
      const labelElem = elemToLg[id] ? id : controlLabel[id];
      const lgId = labelElem && elemToLg[labelElem];
      if (!lgId || !fr[lgId]) continue;
      const entry = { fr: fr[lgId], en: en[lgId] || "", lgId, page, control: id };
      const tip = tipIds.find((t) => t.startsWith(lgId) && t !== lgId);
      if (tip) entry.tipFr = fr[tip];
      for (const cfgName of configNames.length ? configNames : ["*"]) {
        const bucket = (result[cfgName] = result[cfgName] || {});
        const list = (bucket[key] = bucket[key] || []);
        if (!list.some((e) => e.lgId === entry.lgId)) list.push(entry);
      }
    }
  }
}

const out = path.join(__dirname, "..", "public", "param-help-vendor.json");
fs.writeFileSync(out, JSON.stringify(result, null, 1));
const keyCount = Object.values(result).reduce((n, b) => n + Object.keys(b).length, 0);
console.log(`config names: ${Object.keys(result).length}, key entries: ${keyCount} -> ${out}`);

// Vendor texts referenced by the dropdown lists (public/param-choices.json).
const choicesRaw = fs.readFileSync(path.join(__dirname, "..", "public", "param-choices.json"), "utf8");
const lgIds = [...new Set([...choicesRaw.matchAll(/"lg"\s*:\s*"([^"]+)"/g)].map((m) => m[1]))];
const lang = { fr: {}, en: {} };
for (const id of lgIds) {
  if (fr[id]) lang.fr[id] = fr[id];
  if (en[id]) lang.en[id] = en[id];
}
const langOut = path.join(__dirname, "..", "public", "vendor-lang.json");
fs.writeFileSync(langOut, JSON.stringify(lang, null, 1));
console.log(`vendor texts for dropdowns: ${lgIds.length} ids -> ${langOut}`);
