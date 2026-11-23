(async () => {
  // ---- Language.
  const LANGS = ["fr", "en"];
  const saved = localStorage.getItem("camLang");
  const LANG = LANGS.includes(saved) ? saved : (/^en/i.test(navigator.language) ? "en" : "fr");
  document.documentElement.lang = LANG;

  function t(key, params = {}) {
    const text = (window.I18N[LANG] && window.I18N[LANG][key]) || window.I18N.fr[key] || key;
    return text.replace(/\{(\w+)\}/g, (_, p) => String(params[p] ?? ""));
  }

  function applyStatic(root) {
    for (const node of root.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
    for (const node of root.querySelectorAll("[data-i18n-placeholder]")) node.placeholder = t(node.dataset.i18nPlaceholder);
  }

  // ---- Reference data (generated from the vendor package + AI explanations).
  const loadJson = (url) => fetch(url).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  const [vendorHelp, aiHelp, choiceSpecs, vendorLang] = await Promise.all([
    loadJson("/param-help-vendor.json"),
    loadJson("/param-help-ai.json"),
    loadJson("/param-choices.json"),
    loadJson("/vendor-lang.json")
  ]);
  let abilities = {};

  const TABS = [
    { id: "conn", label: "tab.conn", kind: "connection" },
    { id: "live", label: "tab.live", kind: "live" },
    {
      id: "image", label: "tab.image", sub: [
        { label: "sub.sensor", cfg: "Camera.Param.[0]" },
        { label: "sub.sensorEx", cfg: "Camera.ParamEx.[0]" },
        { label: "sub.colors", cfg: "AVEnc.VideoColor.[0]" },
        { label: "sub.osd", cfg: "AVEnc.VideoWidget.[0]" }
      ]
    },
    { id: "video", label: "tab.video", sub: [{ label: "sub.encode", cfg: "Simplify.Encode" }] },
    {
      id: "net", label: "tab.net", sub: [
        { label: "sub.netIface", cfg: "NetWork.NetCommon", risky: true },
        { label: "sub.dhcp", cfg: "NetWork.NetDHCP", risky: true },
        { label: "sub.dns", cfg: "NetWork.NetDNS" },
        { label: "sub.rtsp", cfg: "NetWork.RTSP" },
        { label: "sub.ntp", cfg: "NetWork.NetNTP" },
        { label: "sub.cloud", cfg: "NetWork.Nat" },
        { label: "sub.upnp", cfg: "NetWork.Upnp" },
        { label: "sub.ddns", cfg: "NetWork.NetDDNS" }
      ]
    },
    {
      id: "detect", label: "tab.detect", sub: [
        { label: "sub.motion", cfg: "Detect.MotionDetect.[0]" },
        { label: "sub.human", cfg: "Detect.HumanDetection.[0]" }
      ]
    },
    {
      id: "sys", label: "tab.sys", sub: [
        { label: "sub.general", cfg: "General.General" },
        { label: "sub.location", cfg: "General.Location" },
        { label: "sub.timezone", cfg: "System.TimeZone" },
        { label: "sub.account", kind: "account" },
        { label: "sub.maintenance", kind: "maintenance" },
        { label: "sub.expert", kind: "expert" }
      ]
    },
    {
      id: "fw", label: "tab.fw", sub: [
        { label: "sub.fwVersion", kind: "firmware" },
        { label: "sub.fwAuto", cfg: "NetWork.OnlineUpgrade" },
        { label: "sub.backup", kind: "backup" }
      ]
    }
  ];

  const $ = (sel, root = document) => root.querySelector(sel);
  const statusLine = $("#statusLine");
  const mainTabs = $("#mainTabs");
  const mainPanes = $("#mainPanes");
  const connBadge = $("#connBadge");

  const mainButtons = new Map();
  const configPanes = [];
  let player = null;

  const setStatus = (text) => {
    statusLine.textContent = text;
  };

  // Camera values are untrusted: DOM is built with properties/textContent only.
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    for (const c of children) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    return node;
  }

  async function api(method, url, body) {
    const headers = { "X-Lang": LANG };
    if (body) headers["Content-Type"] = "application/json";
    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    if (data.error) throw new Error(data.error);
    return data;
  }

  async function postFile(url, file) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Lang": LANG }, body: file });
    const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    if (data.error) throw new Error(data.error);
    return data;
  }

  const guard = (fn) => async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      setStatus(t("status.error", { msg: err.message }));
    }
  };

  const nowTime = () => new Date().toLocaleTimeString(LANG);
  const baseName = (cfgName) => String(cfgName).replace(/\.\[\d+\]$/, "");

  // ---- IP fields are stored by the camera as little-endian hex ("0x0A0200C0" = 192.0.2.10).
  const IP_KEY = /(IP|GateWay|Gateway|Submask|Mask|DnsServer|Address)/;
  const HEX32 = /^0x[0-9A-Fa-f]{8}$/;
  const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

  function hexToIp(hex) {
    const v = parseInt(hex, 16) >>> 0;
    return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255].join(".");
  }

  function ipToHex(ip, path) {
    const m = IPV4.exec(ip.trim());
    if (!m || m.slice(1).some((p) => Number(p) > 255)) throw new Error(t("cfg.invalidIp", { path: path.join(".") }));
    const [a, b, c, d] = m.slice(1).map(Number);
    return toHex32((a | (b << 8) | (c << 16) | (d << 24)) >>> 0);
  }

  const toHex32 = (n) => "0x" + (n >>> 0).toString(16).toUpperCase().padStart(8, "0");

  // ---- Tooltips: vendor label (from the .exe) and AI explanation, clearly separated.
  function vendorEntriesFor(cfgName, key) {
    const exact = (vendorHelp[baseName(cfgName)] || {})[key];
    if (exact && exact.length) return { entries: exact, approx: false };
    const found = [];
    for (const bucket of Object.values(vendorHelp)) {
      for (const e of bucket[key] || []) if (!found.some((f) => f.fr === e.fr)) found.push(e);
    }
    return found.length && found.length <= 3 ? { entries: found, approx: true } : { entries: [], approx: false };
  }

  function helpNode(cfgName, key, choice) {
    const parts = [el("div", { className: "help-key", textContent: `${t("help.key")} : ${key}` })];

    const { entries, approx } = vendorEntriesFor(cfgName, key);
    if (entries.length) {
      const labels = entries.map((e) => `« ${(LANG === "en" ? e.en : e.fr) || e.fr} » (${t("help.page")} ${e.page})`);
      parts.push(el("div", { className: "help-src vendor", textContent: t(approx ? "help.vendorApprox" : "help.vendor") }));
      parts.push(el("div", { textContent: labels.join(" ; ") }));
      for (const e of entries) if (e.tipFr) parts.push(el("div", { textContent: e.tipFr }));
    }

    if (choice) {
      const listKey = choice.spec.source === "ai" ? "help.listAi" : choice.spec.source === "camera" ? "help.listCamera" : "help.listVendor";
      parts.push(el("div", { className: `help-src ${choice.spec.source === "ai" ? "ai" : "vendor"}`, textContent: t(listKey, { origin: choice.spec.origin || "" }) }));
      if (choice.fixed) parts.push(el("div", { className: "help-src ai", textContent: t("help.listFixed") }));
    }

    const ai = aiHelp[`${baseName(cfgName)}:${key}`] || aiHelp[key];
    if (ai && ai[LANG]) {
      parts.push(el("div", { className: "help-src ai", textContent: t(ai.guess ? "help.aiGuess" : "help.ai") }));
      parts.push(el("div", { textContent: ai[LANG] }));
    }

    if (parts.length === 1) parts.push(el("div", { textContent: t("help.none") }));
    return el("span", { className: "help", tabIndex: 0, textContent: "?" }, [el("span", { className: "help-pop" }, parts)]);
  }

  // ---- Dropdowns: vendor lists, filtered by camera abilities when the .exe does so.
  function optionLabel(o) {
    if (o.fix && o.fix[LANG]) return o.fix[LANG];
    if (o.lg) return (vendorLang[LANG] && vendorLang[LANG][o.lg]) || (vendorLang.en && vendorLang.en[o.lg]) || o.lg;
    return o.text !== undefined ? String(o.text) : String(o.value);
  }

  function dynamicOptions(spec, path) {
    const tables = choiceSpecs._vendorTables || {};
    const streamIdx = path.includes("ExtraFormat") ? 1 : 0;
    const encInfo = abilities.EncodeCapability && abilities.EncodeCapability.EncodeInfo && abilities.EncodeCapability.EncodeInfo[streamIdx];
    switch (spec.dynamic) {
      case "compression": {
        const mask = encInfo ? parseInt(encInfo.CompressionMask, 16) : -1;
        return tables.compression.map((name, i) => ({ value: name, text: name, bit: i })).filter((o) => mask === -1 || (mask & (1 << o.bit)));
      }
      case "resolution": {
        const mask = encInfo ? parseInt(encInfo.ResolutionMask, 16) >>> 0 : 0xffffffff;
        return tables.resType
          .map((name, i) => ({ value: name, text: `${tables.resText[i]} — ${tables.resW[i]}×${tables.resH[i]}`, bit: i }))
          .filter((o) => (mask >>> o.bit) & 1);
      }
      case "fps":
        return Array.from({ length: 25 }, (_, i) => ({ value: i + 1, text: String(i + 1) }));
      case "exposure": {
        const cam = abilities.Camera || {};
        const speeds = (cam.Speeds || []).map((s) => parseInt(s, 16)).filter((n) => n > 0).sort((a, b) => b - a);
        const manual = (vendorLang[LANG] || {}).IDS_CAM_ExposureManual || "Manual";
        return [{ value: 0, lg: "IDS_CAM_ExposureAuto" }, ...speeds.map((s, j) => ({ value: j + 1, text: `${manual} 1/${Math.round(1000000 / s)}` }))];
      }
      case "videoFormat":
        return String(abilities.MultiVstd || "PAL|NTSC").split("|").filter(Boolean).map((v) => ({ value: v, text: v }));
      case "language":
        return (abilities.MultiLanguage || []).map((v) => ({ value: v, text: v }));
      default:
        return [];
    }
  }

  function choicesFor(cfgName, path, key) {
    const spec = choiceSpecs[`${baseName(cfgName)}:${key}`];
    if (!spec) return null;
    let options;
    if (spec.dynamic) options = dynamicOptions(spec, path);
    else if (spec.range) options = Array.from({ length: spec.range[1] - spec.range[0] + 1 }, (_, i) => ({ value: spec.range[0] + i, text: String(spec.range[0] + i) }));
    else if (spec.options === "onOff") options = choiceSpecs._onOff;
    else options = spec.options || [];
    if (!options.length) return null;
    return { spec, options, fixed: options.some((o) => o.fix && o.lg) };
  }

  function makeSelect(choice, value) {
    const isHex = Boolean(choice.spec.hex);
    const encode = (v) => (isHex ? toHex32(Number(v)) : String(v));
    const current = isHex ? toHex32(parseInt(value, 16)) : String(value);
    const select = el("select");
    let found = false;
    for (const o of choice.options) {
      const v = encode(o.value);
      const label = optionLabel(o);
      const text = label === v ? label : `${label}  [${v}]`;
      const opt = el("option", { value: v, textContent: text });
      if (v.toLowerCase() === current.toLowerCase()) {
        opt.selected = true;
        found = true;
      }
      select.appendChild(opt);
    }
    if (!found) select.appendChild(el("option", { value: String(value), textContent: `${value}  (${t("choice.current")})`, selected: true }));
    return select;
  }

  // ---- Generic form generated from the camera JSON.
  function renderValue(value, path, label, keyName, cfgName) {
    if (value && typeof value === "object") {
      const isArray = Array.isArray(value);
      const entries = isArray ? value.map((v, i) => [String(i), v]) : Object.entries(value);
      const fs = el("fieldset", {}, [el("legend", { textContent: label })]);
      for (const [k, v] of entries) fs.appendChild(renderValue(v, [...path, k], isArray ? `${keyName} [${k}]` : k, isArray ? keyName : k, cfgName));
      return fs;
    }

    let kind = value === null ? "null" : typeof value;
    const choice = kind !== "boolean" ? choicesFor(cfgName, path, keyName) : null;
    let input;
    if (choice) {
      input = makeSelect(choice, value);
      kind = kind === "number" ? "select-number" : "select";
    } else if (kind === "boolean") {
      input = el("input", { type: "checkbox", checked: value });
    } else if (kind === "number") {
      input = el("input", { type: "number", value: String(value), step: "any" });
    } else if (kind === "string" && HEX32.test(value) && IP_KEY.test(keyName)) {
      kind = "ip";
      input = el("input", { type: "text", value: hexToIp(value) });
    } else {
      input = el("input", { type: "text", value: value === null ? "" : String(value) });
    }
    input.dataset.path = JSON.stringify(path);
    input.dataset.kind = kind;
    const name = el("span", { className: "cfg-name" }, [label, helpNode(cfgName, keyName, choice)]);
    return el("label", { className: "cfg-row" }, [name, input]);
  }

  function collectValue(form, original) {
    let value = structuredClone(original);
    for (const input of form.querySelectorAll("[data-path]")) {
      const path = JSON.parse(input.dataset.path);
      let v;
      switch (input.dataset.kind) {
        case "boolean":
          v = input.checked;
          break;
        case "number":
          v = Number(input.value);
          if (input.value.trim() === "" || !Number.isFinite(v)) throw new Error(t("cfg.invalidNumber", { path: path.join(".") }));
          break;
        case "select-number":
          v = Number(input.value);
          break;
        case "ip":
          v = ipToHex(input.value, path);
          break;
        default:
          v = input.value;
      }
      if (path.length === 0) {
        value = v;
        continue;
      }
      let target = value;
      for (const key of path.slice(0, -1)) target = target[key];
      target[path[path.length - 1]] = v;
    }
    return value;
  }

  // ---- Config sub-tab with its own Reload / Save.
  function makeConfigPane(def, subButton) {
    const status = el("span", { className: "pane-status", textContent: t("cfg.notLoaded") });
    const form = el("form", { className: "cfg-form", onsubmit: (e) => e.preventDefault() });
    const nameInput = def.kind === "expert" ? el("input", { type: "text", placeholder: t("cfg.expertPh") }) : null;
    const ctl = { def, value: null, name: def.cfg };

    ctl.reload = async () => {
      const name = nameInput ? nameInput.value.trim() : def.cfg;
      if (!name) throw new Error(t("cfg.nameRequired"));
      status.textContent = t("cfg.reading");
      const data = await api("GET", `/api/cam/config?name=${encodeURIComponent(name)}`);
      const r = data.result;
      if (!data.ok) {
        ctl.value = null;
        form.replaceChildren();
        status.textContent = t("cfg.unsupported", { ret: r.Ret });
        if (subButton) subButton.classList.add("unsupported");
        return false;
      }
      ctl.name = r.Name || name;
      ctl.value = r[ctl.name];
      if (subButton) subButton.classList.remove("unsupported");
      form.replaceChildren(renderValue(ctl.value, [], ctl.name, ctl.name, ctl.name));
      status.textContent = t("cfg.readAt", { time: nowTime() });
      return true;
    };

    ctl.save = async () => {
      if (ctl.value === null) throw new Error(t("cfg.nothing"));
      const value = collectValue(form, ctl.value);
      if (def.risky && !confirm(t("cfg.riskyConfirm"))) return;
      status.textContent = t("cfg.saving");
      const data = await api("PUT", "/api/cam/config", { name: ctl.name, value });
      if (!data.ok) throw new Error(t("cfg.refused", { ret: data.result.Ret }));
      status.textContent = t("cfg.savedAt", { time: nowTime() });
      setStatus(t("cfg.saved", { name: ctl.name }));
      await ctl.reload();
    };

    const toolbar = el("div", { className: "pane-toolbar" }, [
      ...(nameInput ? [nameInput] : []),
      el("button", { type: "button", textContent: t(nameInput ? "cfg.read" : "cfg.reload"), onclick: guard(ctl.reload) }),
      el("button", { type: "button", className: "primary", textContent: t("cfg.save"), onclick: guard(ctl.save) }),
      status
    ]);
    if (!nameInput) configPanes.push(ctl);
    return el("div", { className: "card" }, [toolbar, form]);
  }

  // ---- Special panes.
  function infoGrid(fields) {
    return fields.map(([k, v]) => el("div", {}, [el("b", { textContent: `${k} : ` }), String(v ?? "?")]));
  }

  function makeAccountPane() {
    const p1 = el("input", { type: "password", placeholder: t("account.new"), autocomplete: "new-password" });
    const p2 = el("input", { type: "password", placeholder: t("account.confirm"), autocomplete: "new-password" });
    const change = guard(async () => {
      if (p1.value !== p2.value) throw new Error(t("account.mismatch"));
      if (!confirm(t("account.confirmMsg"))) return;
      const data = await api("POST", "/api/cam/password", { newPassword: p1.value });
      if (!data.ok) throw new Error(t("cfg.refused", { ret: data.result.Ret }));
      p1.value = "";
      p2.value = "";
      setStatus(t("account.done"));
    });
    return el("div", { className: "card" }, [
      el("h3", { textContent: t("account.title") }),
      el("div", { className: "form-grid" }, [p1, p2, el("button", { type: "button", className: "primary", textContent: t("account.change"), onclick: change })])
    ]);
  }

  function makeMaintenancePane() {
    const sync = guard(async () => {
      await api("POST", "/api/cam/time-sync");
      setStatus(t("maint.synced"));
    });
    const reboot = guard(async () => {
      if (!confirm(t("maint.rebootConfirm"))) return;
      await api("POST", "/api/cam/reboot");
      setStatus(t("maint.rebooting"));
      setConnected(false);
    });
    return el("div", { className: "card" }, [
      el("div", { className: "actions" }, [
        el("button", { type: "button", textContent: t("maint.sync"), onclick: sync }),
        el("button", { type: "button", className: "danger", textContent: t("maint.reboot"), onclick: reboot })
      ])
    ]);
  }

  function makeFirmwarePane() {
    const info = el("div", { className: "dev-info" });
    const report = el("div", { className: "dev-info" });
    const progress = el("progress", { max: 100, value: 0, className: "hidden" });
    const fileInput = el("input", { type: "file", accept: ".bin,.zip" });
    const upgradeBtn = el("button", { type: "button", className: "danger", textContent: t("fw.flash"), disabled: true });

    const refresh = guard(async () => {
      const { result } = await api("GET", "/api/fw/info");
      const s = result.SystemInfo || {};
      const o = result.OnlineUpgrade || {};
      info.replaceChildren(...infoGrid([
        [t("fw.hardware"), s.HardWare],
        [t("fw.firmware"), s.SoftWareVersion],
        [t("fw.build"), s.BuildTime],
        [t("fw.server"), o.ServerAddr ? `${o.ServerAddr}:${o.ServerPort}` : "?"],
        [t("fw.auto"), o.AutoUpgradeImp ? t("fw.autoOn") : t("fw.autoOff")],
        [t("fw.autoCheck"), o.AutoCheck ? t("fw.yes") : t("fw.no")]
      ]));
      setStatus(t("fw.infoRead"));
    });

    const onlineCheck = guard(async () => {
      setStatus(t("fw.checking"));
      const { result } = await api("POST", "/api/fw/online-check");
      const rep = result.OPVersionRep || {};
      setStatus(result.Ret === 100 && rep.FileName
        ? t("fw.newVersion", { file: rep.FileName, date: rep.Date })
        : t("fw.noUpdate", { ret: result.Ret }));
    });

    const inspect = guard(async () => {
      const file = fileInput.files[0];
      upgradeBtn.disabled = true;
      if (!file) throw new Error(t("fw.chooseFile"));
      setStatus(t("fw.analyzing"));
      const { result } = await postFile(`/api/fw/inspect?name=${encodeURIComponent(file.name)}`, file);
      report.replaceChildren(...infoGrid([
        [t("fw.file"), `${file.name} (${(result.size / 1048576).toFixed(1)} Mo)`],
        [t("fw.target"), result.hardware || t("fw.unknown")],
        [t("fw.current"), result.currentHardware],
        [t("fw.compatible"), result.compatible ? t("fw.compatYes") : t("fw.compatNo")],
        [t("fw.content"), result.files.map((f) => f.name).join(", ")]
      ]));
      upgradeBtn.disabled = !result.compatible;
      setStatus(result.compatible ? t("fw.ready") : t("fw.incompatible"));
    });

    const pollProgress = async () => {
      for (let i = 0; i < 180; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const data = await api("GET", "/api/fw/status").catch(() => null);
        const r = data && data.result;
        if (!r) return setStatus(t("fw.noAnswer"));
        if (r.Status === "Finish") return setStatus(t("fw.finished"));
        if (r.Status === "Abort") return setStatus(t("fw.aborted"));
        if (r.Ret >= 0 && r.Ret <= 100) progress.value = r.Ret;
        setStatus(t("fw.progress", { pct: r.Ret }));
      }
    };

    const upgrade = guard(async () => {
      if (!confirm(t("fw.confirm1"))) return;
      if (!confirm(t("fw.confirm2"))) return;
      upgradeBtn.disabled = true;
      progress.classList.remove("hidden");
      progress.value = 0;
      setStatus(t("fw.sending"));
      const data = await api("POST", "/api/fw/upgrade");
      if (!data.ok) throw new Error(t("fw.sendRefused", { ret: data.result.Ret }));
      await pollProgress();
      setConnected(false);
    });

    fileInput.addEventListener("change", inspect);
    upgradeBtn.addEventListener("click", upgrade);
    return el("div", { className: "card" }, [
      el("div", { className: "actions" }, [
        el("button", { type: "button", textContent: t("fw.readVersion"), onclick: refresh }),
        el("button", { type: "button", textContent: t("fw.onlineCheck"), onclick: onlineCheck })
      ]),
      info,
      el("h3", { textContent: t("fw.fileTitle") }),
      el("p", { className: "hint", textContent: t("fw.fileHint") }),
      el("div", { className: "actions" }, [fileInput, upgradeBtn]),
      report,
      progress
    ]);
  }

  function makeBackupPane() {
    const fileInput = el("input", { type: "file", accept: ".cfg" });
    const restore = guard(async () => {
      const file = fileInput.files[0];
      if (!file) throw new Error(t("backup.chooseFile"));
      if (!confirm(t("backup.confirm"))) return;
      const data = await postFile("/api/fw/config-restore", file);
      if (!data.ok) throw new Error(t("backup.refused", { ret: data.result.Ret }));
      setStatus(t("backup.done"));
    });
    return el("div", { className: "card" }, [
      el("div", { className: "actions" }, [
        el("a", { href: "/api/fw/config-backup", className: "button-link", textContent: t("backup.download") })
      ]),
      el("h3", { textContent: t("backup.restoreTitle") }),
      el("div", { className: "actions" }, [fileInput, el("button", { type: "button", className: "danger", textContent: t("backup.restore"), onclick: restore })])
    ]);
  }

  // ---- Tabs.
  function activateMain(id) {
    for (const [tabId, { button, pane }] of mainButtons) {
      button.classList.toggle("active", tabId === id);
      pane.classList.toggle("active", tabId === id);
    }
    if (id !== "live") stopStream();
  }

  function buildSubTabs(def) {
    const nav = el("nav", { className: "tabs sub-tabs" });
    const holder = el("div");
    const makers = { account: makeAccountPane, maintenance: makeMaintenancePane, firmware: makeFirmwarePane, backup: makeBackupPane };
    const items = def.sub.map((sub) => {
      const button = el("button", { type: "button", textContent: t(sub.label) });
      const content = makers[sub.kind] ? makers[sub.kind]() : makeConfigPane(sub, sub.kind === "expert" ? null : button);
      const pane = el("div", { className: "pane" }, [content]);
      nav.appendChild(button);
      holder.appendChild(pane);
      return { button, pane };
    });
    const select = (i) => items.forEach((it, j) => {
      it.button.classList.toggle("active", i === j);
      it.pane.classList.toggle("active", i === j);
    });
    items.forEach((it, i) => it.button.addEventListener("click", () => select(i)));
    select(0);
    return [nav, holder];
  }

  function buildTabs() {
    for (const def of TABS) {
      const button = el("button", { type: "button", textContent: t(def.label), onclick: () => activateMain(def.id) });
      let children;
      if (def.kind === "connection" || def.kind === "live") {
        const frag = $(def.kind === "connection" ? "#tplConnection" : "#tplLive").content.cloneNode(true);
        applyStatic(frag);
        children = [frag];
      } else {
        children = buildSubTabs(def);
      }
      const pane = el("section", { className: "pane" }, children);
      mainTabs.appendChild(button);
      mainPanes.appendChild(pane);
      mainButtons.set(def.id, { button, pane });
    }
  }

  function setConnected(value, who) {
    connBadge.textContent = value ? t("badge.on", { who }) : t("badge.off");
    connBadge.className = `badge ${value ? "on" : "off"}`;
    for (const [id, { button }] of mainButtons) button.disabled = !value && id !== "conn";
    if (!value) {
      stopStream();
      activateMain("conn");
    }
  }

  // ---- Connection.
  function renderInfo(s) {
    const uptimeMin = parseInt(s.DeviceRunTime, 16);
    $("#devInfo").replaceChildren(...infoGrid([
      [t("info.model"), s.DeviceModel],
      [t("info.firmware"), s.SoftWareVersion],
      [t("info.build"), s.BuildTime],
      [t("info.serial"), s.SerialNo],
      [t("info.channels"), s.VideoInChannel],
      [t("info.uptime"), Number.isFinite(uptimeMin) ? t("info.uptimeValue", { d: Math.floor(uptimeMin / 1440), h: Math.floor((uptimeMin % 1440) / 60) }) : "?"]
    ]));
  }

  async function loadAbilities() {
    abilities = {};
    for (const name of ["EncodeCapability", "MultiLanguage", "MultiVstd", "Camera"]) {
      const data = await api("GET", `/api/cam/ability?name=${name}`).catch(() => null);
      if (data && data.ok) abilities[name] = data.result[name];
    }
  }

  async function loadAllConfig() {
    await loadAbilities();
    let failed = 0;
    for (let i = 0; i < configPanes.length; i++) {
      setStatus(t("conn.loading", { i: i + 1, n: configPanes.length }));
      const ok = await configPanes[i].reload().catch(() => false);
      if (!ok) failed++;
    }
    setStatus(t("conn.loaded", { ok: configPanes.length - failed, ko: failed }));
  }

  function initConnection() {
    const form = $("#connForm");
    const savedConn = JSON.parse(localStorage.getItem("camConn") || "{}");
    for (const key of ["host", "port", "user"]) if (savedConn[key]) form.elements[key].value = savedConn[key];

    form.addEventListener("submit", guard(async (e) => {
      e.preventDefault();
      const body = {
        host: form.elements.host.value.trim(),
        port: Number(form.elements.port.value || 80),
        user: form.elements.user.value.trim(),
        password: form.elements.password.value
      };
      setStatus(t("conn.connecting", { host: body.host }));
      setConnected(false);
      const data = await api("POST", "/api/connect", body);
      localStorage.setItem("camConn", JSON.stringify({ host: body.host, port: body.port, user: body.user }));
      renderInfo(data.result.SystemInfo || {});
      setConnected(true, `${body.user}@${body.host}`);
      await loadAllConfig();
    }));

    $("#disconnectBtn").addEventListener("click", guard(async () => {
      await api("POST", "/api/disconnect");
      $("#devInfo").replaceChildren();
      setConnected(false);
      setStatus(t("conn.disconnected"));
    }));
  }

  // ---- Live.
  function startStream() {
    stopStream();
    const q = $("#streamQuality").value;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    player = new window.JSMpeg.Player(`${proto}://${location.host}/api/stream?q=${q}`, {
      canvas: $("#videoCanvas"),
      audio: false,
      videoBufferSize: q === "main" ? 8 * 1024 * 1024 : 1024 * 1024
    });
    $("#videoCanvas").classList.remove("hidden");
    $("#snapImg").classList.add("hidden");
    setStatus(t("live.started"));
  }

  function stopStream() {
    if (!player) return;
    player.destroy();
    player = null;
    setStatus(t("live.stopped"));
  }

  async function snapshot() {
    setStatus(t("live.snapping"));
    const res = await fetch(`/api/snapshot?t=${Date.now()}`, { headers: { "X-Lang": LANG } });
    if (!res.ok) throw new Error(t("live.snapFailed"));
    const url = URL.createObjectURL(await res.blob());
    const img = $("#snapImg");
    if (img.src.startsWith("blob:")) URL.revokeObjectURL(img.src);
    img.src = url;
    img.classList.remove("hidden");
    stopStream();
    $("#videoCanvas").classList.add("hidden");
    const link = $("#snapLink");
    link.href = url;
    link.download = `capture-${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`;
    link.classList.remove("hidden");
    setStatus(t("live.snapped"));
  }

  function initLive() {
    $("#startBtn").addEventListener("click", startStream);
    $("#stopBtn").addEventListener("click", stopStream);
    $("#snapBtn").addEventListener("click", guard(snapshot));

    const step = () => Number($("#ptzStep").value);
    const ptz = (body) => api("POST", "/api/ptz", body).then((d) => {
      if (!d.ok) throw new Error(t("ptz.refused", { ret: d.result.Ret }));
    });

    // Press-and-hold, re-sent every 400 ms like the vendor client.
    for (const button of document.querySelectorAll("[data-ptz]")) {
      let timer = null;
      const command = button.dataset.ptz;
      const start = guard(async (e) => {
        e.preventDefault();
        if (timer) return;
        timer = setInterval(() => ptz({ command, step: step() }).catch(() => {}), 400);
        await ptz({ command, step: step() });
      });
      const stop = guard(async () => {
        if (!timer) return;
        clearInterval(timer);
        timer = null;
        await ptz({ command, step: step(), stop: true });
      });
      button.addEventListener("pointerdown", start);
      for (const evt of ["pointerup", "pointerleave", "pointercancel"]) button.addEventListener(evt, stop);
    }

    $("#presetGoto").addEventListener("click", guard(async () => {
      await ptz({ command: "GotoPreset", preset: Number($("#presetNum").value) });
      setStatus(t("ptz.gone"));
    }));
    $("#presetSet").addEventListener("click", guard(async () => {
      await ptz({ command: "SetPreset", preset: Number($("#presetNum").value) });
      setStatus(t("ptz.saved"));
    }));
  }

  // ---- Start.
  applyStatic(document);
  const langSelect = $("#langSelect");
  langSelect.value = LANG;
  langSelect.addEventListener("change", () => {
    localStorage.setItem("camLang", langSelect.value);
    location.reload();
  });

  buildTabs();
  initConnection();
  initLive();
  activateMain("conn");

  api("GET", "/api/status").then((s) => {
    setConnected(s.connected, s.connected ? `${s.user}@${s.host}` : "");
    if (s.connected) loadAllConfig();
  }).catch(() => setConnected(false));
})();
