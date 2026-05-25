const STORAGE_KEY = "ss-ordering.v1";
const DEBUG_SESSION_ID = "realtime-cross-device";

//#region debug-point dbg-transport
const dbgUrl = (() => {
  try {
    const qs = new URLSearchParams(location.search || "");
    const fromQs = qs.get("dbg");
    if (fromQs) return decodeURIComponent(fromQs);
    const fromStore = sessionStorage.getItem("dbg.url");
    if (fromStore) return fromStore;
  } catch {}
  return "";
})();

const dbgReport = async (point, data = {}, meta = {}) => {
  if (!dbgUrl) return;
  try {
    sessionStorage.setItem("dbg.url", dbgUrl);
  } catch {}
  const payload = {
    sessionId: DEBUG_SESSION_ID,
    point,
    ts: Date.now(),
    ...meta,
    data,
  };
  try {
    await fetch(dbgUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {}
};
//#endregion debug-point dbg-transport

const formatIdr = (value) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value || 0);

const escapeHtml = (value) =>
  `${value ?? ""}`.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const nowIso = () => new Date().toISOString();

const imageFileToDataUrl = async (file, { maxSide = 900, quality = 0.82 } = {}) => {
  if (!file) return "";
  const type = `${file.type || ""}`.toLowerCase();
  if (!type.startsWith("image/")) throw new Error("File bukan gambar");
  if (file.size > 8 * 1024 * 1024) throw new Error("File terlalu besar (maks 8MB)");

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Gagal membaca gambar"));
      img.src = objectUrl;
    });

    const srcW = Number(img.naturalWidth || img.width || 0);
    const srcH = Number(img.naturalHeight || img.height || 0);
    if (!srcW || !srcH) throw new Error("Gambar tidak valid");

    const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
    const outW = Math.max(1, Math.round(srcW * scale));
    const outH = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas tidak tersedia");
    ctx.drawImage(img, 0, 0, outW, outH);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) return canvas.toDataURL("image/jpeg", quality);

    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(`${reader.result || ""}`);
      reader.onerror = () => reject(new Error("Gagal encode gambar"));
      reader.readAsDataURL(blob);
    });
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const GH_TOKEN_KEY = "gh.token";
const getGithubToken = () => {
  try {
    return `${sessionStorage.getItem(GH_TOKEN_KEY) || ""}`.trim();
  } catch {
    return "";
  }
};
const setGithubToken = (token) => {
  try {
    const t = `${token || ""}`.trim();
    if (!t) sessionStorage.removeItem(GH_TOKEN_KEY);
    else sessionStorage.setItem(GH_TOKEN_KEY, t);
  } catch {}
};

const encodeGithubPath = (path) =>
  `${path || ""}`
    .split("/")
    .filter(Boolean)
    .map((s) => encodeURIComponent(s))
    .join("/");

const githubGetFileSha = async ({ owner, repo, branch, path, token }) => {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeGithubPath(path)}?ref=${encodeURIComponent(
    branch || "main"
  )}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Gagal cek file GitHub");
  const json = await res.json();
  return json?.sha || null;
};

const githubPutFile = async ({ owner, repo, branch, path, contentBase64, message, token }) => {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeGithubPath(path)}`;
  const sha = await githubGetFileSha({ owner, repo, branch, path, token });
  const body = {
    message: message || `Update ${path}`,
    content: `${contentBase64 || ""}`.replace(/\s+/g, ""),
    branch: branch || "main",
    ...(sha ? { sha } : {}),
  };
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Upload ke GitHub gagal");
  return res.json();
};

const githubSettings = () => {
  const g = state?.settings?.github || {};
  return {
    enabled: Boolean(g.enabled),
    owner: `${g.owner || ""}`.trim(),
    repo: `${g.repo || ""}`.trim(),
    branch: `${g.branch || "main"}`.trim() || "main",
  };
};

const sanitizeAssetFileName = (raw) => {
  const base = `${raw || ""}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return `${base || "image"}.jpg`;
};

const uploadMenuImageToGithubAssetsIfEnabled = async ({ menuId, dataUrl }) => {
  const cfg = githubSettings();
  if (!cfg.enabled) return { ok: false, reason: "disabled" };
  if (!cfg.owner || !cfg.repo) return { ok: false, reason: "missing_repo" };
  const token = getGithubToken();
  if (!token) return { ok: false, reason: "missing_token" };
  const base64 = `${dataUrl || ""}`.includes(",") ? `${dataUrl || ""}`.split(",")[1] : "";
  if (!base64) return { ok: false, reason: "bad_data" };
  const fileName = sanitizeAssetFileName(`menu-${menuId}`);
  const path = `assets/${fileName}`;
  await githubPutFile({
    owner: cfg.owner,
    repo: cfg.repo,
    branch: cfg.branch,
    path,
    contentBase64: base64,
    message: `Update image ${menuId}`,
    token,
  });
  return { ok: true, assetPath: `./assets/${fileName}?v=${Date.now()}` };
};

const imageUrlToDataUrl = async (url) => {
  const u = `${url || ""}`.trim();
  if (!/^https?:\/\//i.test(u)) throw new Error("URL gambar tidak valid");
  const res = await fetch(u, { mode: "cors", cache: "no-store" });
  if (!res.ok) throw new Error("Gagal mengambil gambar dari URL");
  const blob = await res.blob();
  const file = new File([blob], "image", { type: blob.type || "image/jpeg" });
  return imageFileToDataUrl(file);
};

const uid = () => {
  const raw = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return raw.toUpperCase();
};

const orderCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();

const defaultMenu = () => [
  {
    id: "M-AYAMGEPREK",
    name: "Ayam Geprek",
    category: "food",
    price: 18000,
    stock: 20,
    image: "./assets/ayam-geprek.svg",
    variants: [
      { name: "Level Pedas", values: ["0", "1", "2", "3", "4", "5"] },
      { name: "Nasi", values: ["Pakai", "Tanpa"] },
    ],
  },
  {
    id: "M-NASIGORENG",
    name: "Nasi Goreng",
    category: "food",
    price: 22000,
    stock: 15,
    image: "./assets/nasi-goreng.svg",
    variants: [{ name: "Level Pedas", values: ["0", "1", "2", "3"] }],
  },
  {
    id: "M-MIEGORENG",
    name: "Mie Goreng",
    category: "food",
    price: 20000,
    stock: 10,
    image: "./assets/mie-goreng.svg",
    variants: [{ name: "Level Pedas", values: ["0", "1", "2", "3"] }],
  },
  {
    id: "M-ESTEH",
    name: "Es Teh",
    category: "drink",
    price: 6000,
    stock: 40,
    image: "./assets/es-teh.svg",
    variants: [
      { name: "Gula", values: ["Normal", "Less", "No Sugar"] },
      { name: "Es", values: ["Normal", "Less Ice"] },
    ],
  },
  {
    id: "M-ESKOPI",
    name: "Es Kopi Susu",
    category: "drink",
    price: 18000,
    stock: 25,
    image: "./assets/es-kopi.svg",
    variants: [
      { name: "Gula", values: ["Normal", "Less"] },
      { name: "Ukuran", values: ["Regular", "Large"] },
    ],
  },
];

const loadState = () => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {
      version: 1,
      auth: { role: "guest" },
      menu: defaultMenu(),
      orders: [],
      session: {
        method: null,
        tableNumber: "",
        cart: [],
        orderNote: "",
      },
      ui: {
        addingMenuId: null,
        addingVariantSelections: {},
        cashierQrisOrderId: null,
        adminImageMenuId: null,
        sound: { cashier: false, kitchen: false },
      },
      settings: {
        github: { enabled: false, owner: "", repo: "", branch: "main" },
      },
    };
  }
  try {
    const parsed = JSON.parse(raw);
    const role = parsed?.auth?.role === "bar" ? "kitchen" : parsed?.auth?.role || "guest";
    const orders = (Array.isArray(parsed.orders) ? parsed.orders : []).map((o) => {
      const kitchen = o?.kitchen || { printedAt: null, startedAt: null, doneAt: null };
      const bar = o?.bar || null;
      const mergedKitchen = {
        printedAt: kitchen?.printedAt || bar?.printedAt || null,
        startedAt: kitchen?.startedAt || null,
        doneAt: kitchen?.doneAt || bar?.doneAt || null,
      };
      const next = { ...(o || {}) };
      next.kitchen = mergedKitchen;
      if ("bar" in next) delete next.bar;
      if (!next.paymentType && next.paymentMethod === "ONLINE") next.paymentType = "QRIS";
      if (!next.paymentType && next.paymentMethod === "CASHIER") next.paymentType = "TUNAI";
      if (next.status === "AWAITING_PAYMENT") next.status = "RECEIVED";
      if (next.kitchen?.doneAt && next.status !== "CANCELLED") next.status = "COMPLETED";
      if (next.stockDeducted == null) next.stockDeducted = next.paymentStatus === "PAID";
      if (!next.deductedAt && next.stockDeducted) next.deductedAt = next.paidAt || next.createdAt || null;
      return next;
    });
    return {
      version: 1,
      auth: { role },
      menu: Array.isArray(parsed.menu) && parsed.menu.length ? parsed.menu : defaultMenu(),
      orders,
      session: parsed.session || { method: null, tableNumber: "", cart: [], orderNote: "" },
      ui: {
        addingMenuId: null,
        addingVariantSelections: {},
        cashierQrisOrderId: null,
        adminImageMenuId: null,
        sound: { cashier: false, kitchen: false },
        ...(parsed.ui || {}),
      },
      settings: {
        github: { enabled: false, owner: "", repo: "", branch: "main" },
        ...(parsed.settings || {}),
      },
    };
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return loadState();
  }
};

const saveState = (state) => localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

let state = loadState();

const $app = document.getElementById("app");
const $nav = document.getElementById("topnav");
const $subtitle = document.getElementById("subtitle");
const $toast = document.getElementById("toast");

const toast = (msg) => {
  $toast.textContent = msg;
  $toast.classList.add("is-on");
  window.clearTimeout(toast._t);
  toast._t = window.setTimeout(() => $toast.classList.remove("is-on"), 2400);
};

const setHash = (hash) => {
  if (location.hash === hash) return;
  location.hash = hash;
};

const getHashRoute = () => {
  const raw = location.hash.replace(/^#/, "");
  if (!raw) return { path: "/", params: [] };
  const [pathPart, query] = raw.split("?");
  const path = pathPart.startsWith("/") ? pathPart : `/${pathPart}`;
  const params = path.split("/").filter(Boolean);
  const qs = new URLSearchParams(query || "");
  return { path, params, qs };
};

const rolePins = {
  admin: "admin123",
  cashier: "cashier123",
  kitchen: "kitchen123",
};

const appConfig = typeof window !== "undefined" && window.APP_CONFIG && typeof window.APP_CONFIG === "object" ? window.APP_CONFIG : {};
const realtimeConfig = appConfig.realtime && typeof appConfig.realtime === "object" ? appConfig.realtime : {};

const realtime = {
  enabled: false,
  ready: false,
  db: null,
  fs: null,
  unsub: [],
  lastOrderIds: new Set(),
  initialOrdersLoaded: false,
};

const isRealtimeEnabled = () =>
  Boolean(
    realtimeConfig &&
      realtimeConfig.enabled &&
      realtimeConfig.provider === "firebase" &&
      realtimeConfig.firebaseConfig &&
      realtimeConfig.firebaseConfig.projectId
  );

const tsToIso = (v) => (v && typeof v.toDate === "function" ? v.toDate().toISOString() : v || null);

let audioCtx = null;
const ensureSound = async () => {
  if (audioCtx) return true;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return false;
  audioCtx = new Ctx();
  if (audioCtx.state === "suspended") await audioCtx.resume();
  return true;
};

const playBeep = async () => {
  const ok = await ensureSound();
  if (!ok) return;
  if (audioCtx.state === "suspended") await audioCtx.resume();
  const t0 = audioCtx.currentTime;
  const mk = (freq, start, dur, peak) => {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    g.gain.value = 0.0001;
    o.connect(g);
    g.connect(audioCtx.destination);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(peak, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.start(start);
    o.stop(start + dur + 0.02);
  };
  mk(880, t0, 0.22, 0.14);
  mk(660, t0 + 0.26, 0.22, 0.14);
};

const isSoundEnabledForRole = (role) => Boolean(state.ui?.sound && state.ui.sound[role]);

const initRealtime = async () => {
  await dbgReport(
    "initRealtime:start",
    {
      href: location.href,
      role: state.auth?.role || "guest",
      enabled: Boolean(realtimeConfig?.enabled),
      provider: realtimeConfig?.provider || null,
      projectId: realtimeConfig?.firebaseConfig?.projectId || null,
      isRealtimeEnabled: isRealtimeEnabled(),
      ua: navigator.userAgent,
    },
    { hypothesisId: "A", runId: "pre" }
  );
  if (!isRealtimeEnabled()) return;
  try {
    const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js");
    const fs = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js");
    const app = initializeApp(realtimeConfig.firebaseConfig);
    const db = fs.getFirestore(app);
    realtime.enabled = true;
    realtime.ready = true;
    realtime.db = db;
    realtime.fs = fs;
    renderNav();
    toast("Realtime aktif");
    await dbgReport("initRealtime:ready", { ok: true }, { runId: "pre" });

    const unsubMenu = fs.onSnapshot(
      fs.collection(db, "menu"),
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        state.menu = items.length ? items : state.menu;
        dbgReport("fs:menuSnapshot", { count: items.length }, { runId: "pre" });
        if (!items.length) {
          toast("Menu server kosong. Masuk Admin → Reset Menu Default.");
        }
        render();
      },
      (err) => {
        dbgReport("fs:menuSnapshot:error", { message: err?.message || String(err), code: err?.code || null }, { hypothesisId: "B", runId: "pre" });
      }
    );

    const ordersQ = fs.query(fs.collection(db, "orders"), fs.orderBy("createdAt", "desc"));
    const unsubOrders = fs.onSnapshot(
      ordersQ,
      (snap) => {
        const nextOrders = snap.docs.map((d) => {
          const data = d.data() || {};
          const kitchen = data.kitchen || {};
          return {
            id: d.id,
            ...data,
            createdAt: tsToIso(data.createdAt) || data.createdAt || nowIso(),
            paidAt: tsToIso(data.paidAt),
            deductedAt: tsToIso(data.deductedAt),
            kitchen: {
              printedAt: tsToIso(kitchen.printedAt),
              startedAt: tsToIso(kitchen.startedAt),
              doneAt: tsToIso(kitchen.doneAt),
            },
          };
        });

        state.orders = nextOrders;

        dbgReport("fs:ordersSnapshot", { count: nextOrders.length }, { runId: "pre" });

        if (!realtime.initialOrdersLoaded) {
          realtime.lastOrderIds = new Set(nextOrders.map((o) => o.id));
          realtime.initialOrdersLoaded = true;
          dbgReport("fs:ordersInitialLoaded", { count: nextOrders.length }, { runId: "pre" });
          render();
          return;
        }

        const role = state.auth.role || "guest";
        const added = nextOrders.filter((o) => !realtime.lastOrderIds.has(o.id));
        for (const o of added) realtime.lastOrderIds.add(o.id);

        if (added.length) {
          dbgReport("fs:ordersAdded", { addedCount: added.length, first: added[0]?.code || added[0]?.id || null, role }, { runId: "pre" });
        }

        if (added.length && (role === "cashier" || role === "kitchen") && isSoundEnabledForRole(role)) {
          dbgReport("sound:newOrderBeep", { role }, { hypothesisId: "D", runId: "pre" });
          playBeep();
          toast(`Pesanan baru: ${added[0].code || added[0].id}`);
        }

        render();
      },
      (err) => {
        dbgReport("fs:ordersSnapshot:error", { message: err?.message || String(err), code: err?.code || null }, { hypothesisId: "B", runId: "pre" });
      }
    );

    realtime.unsub.push(unsubMenu, unsubOrders);
  } catch (err) {
    realtime.enabled = false;
    realtime.ready = false;
    renderNav();
    toast("Realtime gagal aktif");
    await dbgReport(
      "initRealtime:error",
      { ok: false, message: err?.message || String(err), name: err?.name || null },
      { hypothesisId: "C", runId: "pre" }
    );
  }
};

const rtUpdateOrder = async (orderId, patch) => {
  if (!realtime.ready) return false;
  const fs = realtime.fs;
  const db = realtime.db;
  dbgReport("rt:updateOrder", { orderId, keys: Object.keys(patch || {}) }, { runId: "pre" });
  await fs.updateDoc(fs.doc(db, "orders", orderId), { ...patch, updatedAt: fs.serverTimestamp() });
  return true;
};

const rtUpdateMenu = async (menuId, patch) => {
  if (!realtime.ready) return false;
  const fs = realtime.fs;
  const db = realtime.db;
  dbgReport("rt:updateMenu", { menuId, keys: Object.keys(patch || {}) }, { runId: "pre" });
  await fs.updateDoc(fs.doc(db, "menu", menuId), { ...patch, updatedAt: fs.serverTimestamp() });
  return true;
};

const rtDeleteMenu = async (menuId) => {
  if (!realtime.ready) return false;
  const fs = realtime.fs;
  const db = realtime.db;
  dbgReport("rt:deleteMenu", { menuId }, { runId: "pre" });
  await fs.deleteDoc(fs.doc(db, "menu", menuId));
  return true;
};

const rtSetMenu = async (menu) => {
  if (!realtime.ready) return false;
  const fs = realtime.fs;
  const db = realtime.db;
  dbgReport("rt:setMenu", { menuId: menu?.id || null }, { runId: "pre" });
  await fs.setDoc(fs.doc(db, "menu", menu.id), { ...menu, updatedAt: fs.serverTimestamp() }, { merge: true });
  return true;
};

const rtSeedMenu = async () => {
  if (!realtime.ready) return false;
  const fs = realtime.fs;
  const db = realtime.db;
  dbgReport("rt:seedMenu", { count: defaultMenu().length }, { runId: "pre" });
  const batch = fs.writeBatch(db);
  for (const m of defaultMenu()) {
    batch.set(fs.doc(db, "menu", m.id), { ...m, updatedAt: fs.serverTimestamp() }, { merge: true });
  }
  await batch.commit();
  return true;
};

const rtCreateOrder = async (order) => {
  if (!realtime.ready) return { ok: false, issues: ["Realtime belum siap"] };
  const fs = realtime.fs;
  const db = realtime.db;
  dbgReport("rt:createOrder:start", { id: order?.id || null, code: order?.code || null }, { hypothesisId: "E", runId: "pre" });
  const needed = new Map();
  for (const line of order.items || []) needed.set(line.menuId, (needed.get(line.menuId) || 0) + line.qty);
  try {
    await fs.runTransaction(db, async (tx) => {
      for (const [menuId, qty] of needed.entries()) {
        const ref = fs.doc(db, "menu", menuId);
        const snap = await tx.get(ref);
        if (!snap.exists()) {
          throw new Error(`Menu ${menuId} belum ada di server. Buka Admin → Reset Menu Default (seed).`);
        }
        const rawStock = snap.data()?.stock;
        const stock = Number.isFinite(Number(rawStock)) ? Number(rawStock) : 0;
        if (qty > stock) throw new Error(`${menuId} stok kurang`);
        tx.update(ref, { stock: stock - qty, updatedAt: fs.serverTimestamp() });
      }
      const orderRef = fs.doc(db, "orders", order.id);
      tx.set(orderRef, { ...order, stockDeducted: true, deductedAt: fs.serverTimestamp(), createdAt: fs.serverTimestamp(), updatedAt: fs.serverTimestamp() });
    });
    dbgReport("rt:createOrder:ok", { id: order?.id || null }, { runId: "pre" });
    return { ok: true, issues: [] };
  } catch (e) {
    dbgReport("rt:createOrder:error", { message: e?.message || String(e) }, { hypothesisId: "B", runId: "pre" });
    return { ok: false, issues: [e?.message || "Gagal membuat pesanan"] };
  }
};

const rtCancelOrder = async (orderId) => {
  if (!realtime.ready) return false;
  const fs = realtime.fs;
  const db = realtime.db;
  await fs.runTransaction(db, async (tx) => {
    const orderRef = fs.doc(db, "orders", orderId);
    const snap = await tx.get(orderRef);
    if (!snap.exists()) return;
    const order = snap.data() || {};
    if (order.paymentStatus === "PAID") throw new Error("Sudah lunas");
    if (order.stockDeducted) {
      const needed = new Map();
      for (const line of order.items || []) needed.set(line.menuId, (needed.get(line.menuId) || 0) + line.qty);
      for (const [menuId, qty] of needed.entries()) {
        const ref = fs.doc(db, "menu", menuId);
        const ms = await tx.get(ref);
        const stock = Number(ms.data()?.stock ?? 0);
        tx.update(ref, { stock: stock + qty, updatedAt: fs.serverTimestamp() });
      }
    }
    tx.update(orderRef, { status: "CANCELLED", stockDeducted: false, deductedAt: null, updatedAt: fs.serverTimestamp() });
  });
  return true;
};

const setRole = (role) => {
  state.auth = { role };
  saveState(state);
  render();
};

const requireRole = (role) => {
  if (state.auth.role === role) return true;
  const pin = window.prompt(`Masukkan PIN untuk ${role}:`);
  if (!pin) return false;
  if (pin === rolePins[role]) {
    setRole(role);
    return true;
  }
  toast("PIN salah");
  return false;
};

const resetDemo = () => {
  localStorage.removeItem(STORAGE_KEY);
  state = loadState();
  applyIncomingQr();
  render();
  toast("Data demo direset");
};

const applyIncomingQr = () => {
  const url = new URL(location.href);
  const qr = url.searchParams.get("qr") || "";
  const table = url.searchParams.get("table") || "";
  const takeaway = url.searchParams.get("takeaway") || "";

  if (qr.startsWith("table-")) {
    const n = qr.replace("table-", "");
    state.session.method = "dinein";
    state.session.tableNumber = `${n}`;
    saveState(state);
    return;
  }
  if (table) {
    state.session.method = "dinein";
    state.session.tableNumber = `${table}`;
    saveState(state);
    return;
  }
  if (takeaway) {
    state.session.method = "takeaway";
    state.session.tableNumber = "";
    saveState(state);
  }
};

applyIncomingQr();

const menuById = (id) => state.menu.find((m) => m.id === id);

const cartTotals = () => {
  const subtotal = state.session.cart.reduce((sum, line) => sum + line.price * line.qty, 0);
  const itemsCount = state.session.cart.reduce((sum, line) => sum + line.qty, 0);
  return { subtotal, itemsCount };
};

const cartQtyForMenu = (menuId, excludeKey = null) =>
  state.session.cart.reduce((sum, line) => sum + (line.menuId === menuId && line.key !== excludeKey ? Number(line.qty || 0) : 0), 0);

const orderTotals = (order) => {
  const subtotal = (order.items || []).reduce((sum, line) => sum + line.price * line.qty, 0);
  const itemsCount = (order.items || []).reduce((sum, line) => sum + line.qty, 0);
  return { subtotal, itemsCount };
};

const statusLabel = (order) => {
  const s = order.status || "CREATED";
  if (s === "RECEIVED") return "Pesanan Diterima";
  if (s === "COOKING") return "Sedang Dibuat";
  if (s === "READY") return "Selesai Dibuat";
  if (s === "COMPLETED") return "Selesai";
  if (s === "CANCELLED") return "Dibatalkan";
  return s;
};

const paymentTypeLabel = (paymentType) => {
  if (paymentType === "QRIS") return "QRIS";
  if (paymentType === "TUNAI") return "Tunai";
  if (paymentType === "DEBIT") return "Debit";
  return null;
};

const paymentLabel = (order) => {
  if (order.paymentStatus === "PAID") {
    const t = paymentTypeLabel(order.paymentType);
    return t ? `Lunas (${t})` : "Lunas";
  }
  if (order.paymentMethod === "CASHIER") return "Bayar di Kasir";
  if (order.paymentMethod === "ONLINE") return "Bayar Online (QRIS)";
  return "Belum dipilih";
};

const ensureMethod = () => {
  if (state.session.method) return true;
  toast("Pilih metode dulu (Dine-In / Takeaway)");
  return false;
};

const renderNeedMethod = (goHash) => `
  <div class="grid">
    <section class="card col-12">
      <div class="card__hd">
        <div>
          <div class="card__title">Pilih Metode Terlebih Dahulu</div>
          <div class="card__sub">Silakan pilih Dine-In atau Takeaway untuk melanjutkan.</div>
        </div>
        <span class="badge badge--warn">Belum dipilih</span>
      </div>
      <div class="card__bd">
        <div class="row">
          <button class="btn btn--primary" data-action="set-method-go" data-method="dinein" data-go="${goHash}">Dine-In</button>
          <button class="btn btn--primary" data-action="set-method-go" data-method="takeaway" data-go="${goHash}">Takeaway</button>
          <button class="btn btn--ghost" data-nav="#/">Kembali</button>
        </div>
      </div>
    </section>
  </div>
`;

const ensureTableIfDineIn = () => {
  if (state.session.method !== "dinein") return true;
  const t = `${state.session.tableNumber || ""}`.trim();
  if (!t) {
    toast("Nomor meja wajib diisi untuk Dine-In");
    return false;
  }
  return true;
};

const upsertCartLine = ({ menuId, variantText, itemNote, qtyDelta }) => {
  const menu = menuById(menuId);
  if (!menu) return;
  const stock = Number(menu.stock ?? 0);
  if (!Number.isFinite(stock) || stock <= 0) {
    toast("Stok habis");
    return;
  }

  const key = `${menuId}::${variantText || ""}::${itemNote || ""}`;
  const existing = state.session.cart.find((l) => l.key === key);
  const otherQty = cartQtyForMenu(menuId, existing ? existing.key : null);
  const availableForThisLine = Math.max(0, stock - otherQty);
  if (existing) {
    const desired = Math.max(1, Number(existing.qty || 0) + Number(qtyDelta || 0));
    if (desired > availableForThisLine) {
      if (availableForThisLine <= 0) {
        toast(`Stok ${menu.name} habis`);
        return;
      }
      existing.qty = availableForThisLine;
      toast(`Stok ${menu.name} tersisa ${availableForThisLine}`);
    } else {
      existing.qty = desired;
    }
  } else {
    if (availableForThisLine <= 0) {
      toast(`Stok ${menu.name} habis`);
      return;
    }
    const initialQty = Math.max(1, Number(qtyDelta || 0));
    const qty = Math.min(initialQty, availableForThisLine);
    if (qty < initialQty) toast(`Stok ${menu.name} tersisa ${availableForThisLine}`);
    state.session.cart.push({
      key,
      menuId,
      name: menu.name,
      category: menu.category,
      price: menu.price,
      qty,
      variantText: variantText || "",
      itemNote: itemNote || "",
    });
  }
  saveState(state);
  render();
};

const changeCartQty = (key, delta) => {
  const idx = state.session.cart.findIndex((l) => l.key === key);
  if (idx < 0) return;
  const line = state.session.cart[idx];
  const next = Number(line.qty || 0) + Number(delta || 0);
  if (next <= 0) {
    state.session.cart.splice(idx, 1);
  } else {
    if (delta > 0) {
      const m = menuById(line.menuId);
      const stock = Number(m?.stock ?? 0);
      const otherQty = cartQtyForMenu(line.menuId, line.key);
      const availableForThisLine = Number.isFinite(stock) ? Math.max(0, stock - otherQty) : 0;
      if (stock <= 0 || next > availableForThisLine) {
        toast(`Stok ${line.name} tersisa ${availableForThisLine}`);
        return;
      }
    }
    line.qty = next;
  }
  saveState(state);
  render();
};

const clearCart = () => {
  state.session.cart = [];
  state.session.orderNote = "";
  state.ui.addingMenuId = null;
  state.ui.addingVariantSelections = {};
  state.ui.cashierQrisOrderId = null;
  saveState(state);
  render();
};

const createOrderFromSession = async () => {
  if (!ensureMethod()) return null;
  if (!ensureTableIfDineIn()) return null;
  if (!state.session.cart.length) {
    toast("Keranjang masih kosong");
    return null;
  }

  const order = {
    id: uid(),
    code: orderCode(),
    method: state.session.method,
    tableNumber: state.session.method === "dinein" ? `${state.session.tableNumber}`.trim() : "",
    items: state.session.cart.map((l) => ({ ...l })),
    orderNote: `${state.session.orderNote || ""}`.trim(),
    status: "RECEIVED",
    paymentMethod: null,
    paymentType: null,
    paymentStatus: "UNPAID",
    createdAt: nowIso(),
    paidAt: null,
    stockDeducted: false,
    deductedAt: null,
    kitchen: { printedAt: null, startedAt: null, doneAt: null },
  };

  if (isRealtimeEnabled()) {
    const res = await rtCreateOrder(order);
    if (!res.ok) {
      window.alert(`Stok tidak cukup:\n- ${res.issues.join("\n- ")}`);
      return null;
    }
  } else {
    const stockRes = applyStockDeductionIfNeeded(order);
    if (!stockRes.ok) {
      window.alert(`Stok tidak cukup:\n- ${stockRes.issues.join("\n- ")}`);
      return null;
    }
  }

  state.orders.unshift(order);
  saveState(state);
  clearCart();
  return order;
};

const findOrder = (id) => state.orders.find((o) => o.id === id);

const validateStockForOrder = (order) => {
  const needed = new Map();
  for (const line of order.items || []) {
    needed.set(line.menuId, (needed.get(line.menuId) || 0) + line.qty);
  }
  const issues = [];
  for (const [menuId, qty] of needed.entries()) {
    const m = menuById(menuId);
    const stock = m ? Number(m.stock ?? 0) : 0;
    if (!m) issues.push(`${menuId} tidak ditemukan`);
    else if (qty > stock) issues.push(`${m.name} stok kurang (butuh ${qty}, sisa ${stock})`);
  }
  return issues;
};

const applyStockDeductionIfNeeded = (order) => {
  if (order.stockDeducted) return { ok: true, issues: [] };
  const issues = validateStockForOrder(order);
  if (issues.length) return { ok: false, issues };
  const needed = new Map();
  for (const line of order.items || []) needed.set(line.menuId, (needed.get(line.menuId) || 0) + line.qty);
  for (const [menuId, qty] of needed.entries()) {
    const m = menuById(menuId);
    if (!m) continue;
    m.stock = Math.max(0, Number(m.stock ?? 0) - qty);
  }
  order.stockDeducted = true;
  order.deductedAt = nowIso();
  return { ok: true, issues: [] };
};

const restoreStockForOrderIfNeeded = (order) => {
  if (!order.stockDeducted) return;
  const needed = new Map();
  for (const line of order.items || []) needed.set(line.menuId, (needed.get(line.menuId) || 0) + line.qty);
  for (const [menuId, qty] of needed.entries()) {
    const m = menuById(menuId);
    if (!m) continue;
    m.stock = Math.max(0, Number(m.stock ?? 0) + qty);
  }
  order.stockDeducted = false;
  order.deductedAt = null;
};

const applyPaymentPaid = (order, method, paymentType) => {
  const res = applyStockDeductionIfNeeded(order);
  if (!res.ok) {
    toast("Pembayaran ditahan: stok tidak cukup");
    return res;
  }

  order.paymentMethod = method;
  order.paymentType =
    paymentType || order.paymentType || (method === "ONLINE" ? "QRIS" : method === "CASHIER" ? "TUNAI" : null);
  order.paymentStatus = "PAID";
  order.paidAt = nowIso();
  if (!order.kitchen?.doneAt) order.status = order.kitchen?.startedAt ? "COOKING" : "RECEIVED";
  saveState(state);
  render();
  return res;
};

const updateOrderStatusFromStations = (order) => {
  const done = Boolean(order.kitchen?.doneAt);
  const started = Boolean(order.kitchen?.startedAt);
  if (done) {
    if (order.status !== "CANCELLED") order.status = "COMPLETED";
    return;
  }
  if (started) {
    order.status = "COOKING";
    return;
  }
  if (order.status !== "CANCELLED" && order.status !== "COMPLETED") order.status = "RECEIVED";
};

const renderNav = () => {
  const totals = cartTotals();
  const role = state.auth.role || "guest";

  const navItems =
    role === "admin"
      ? [{ label: "Admin", hash: "#/admin" }]
      : role === "cashier"
        ? [{ label: "Kasir", hash: "#/cashier" }]
        : role === "kitchen"
          ? [{ label: "Dapur", hash: "#/kitchen" }]
          : [
              { label: "Beranda", hash: "#/" },
              { label: `Keranjang (${totals.itemsCount})`, hash: "#/menu" },
              { label: "Pesanan", hash: "#/orders" },
            ];

  $nav.innerHTML = navItems
    .map(
      (it) =>
        `<button class="navbtn ${it.hash === location.hash ? "navbtn--brand" : ""}" data-nav="${it.hash}">${it.label}</button>`
    )
    .join("");
  if (role === "cashier" || role === "kitchen") {
    const on = isSoundEnabledForRole(role);
    $nav.insertAdjacentHTML(
      "beforeend",
      `<button class="navbtn" data-action="toggle-sound" data-role="${role}">Suara: ${on ? "On" : "Off"}</button><button class="navbtn" data-action="test-sound" data-role="${role}">Tes Bunyi</button>`
    );
  }
  if (role !== "guest") {
    $nav.insertAdjacentHTML('beforeend', `<button class="navbtn" data-action="logout">Keluar</button>`);
  }

  const method = state.session.method === "dinein" ? `Dine-In · Meja ${state.session.tableNumber || "-"}` : "Takeaway";
  const subtitleRole = role === "guest" ? "Pelanggan" : role.toUpperCase();
  const subtitleMethod = state.session.method ? method : "Belum pilih metode";
  const rtLabel = realtime.ready ? "Realtime: On" : "Realtime: Off";
  $subtitle.textContent = role === "guest" ? `${subtitleRole} · ${subtitleMethod} · ${rtLabel}` : `${subtitleRole} · ${rtLabel}`;
};

const renderHome = () => {
  const m = state.session.method;
  const isDineIn = m === "dinein";
  const isTakeaway = m === "takeaway";

  return `
    <div class="grid">
      <section class="card col-12">
        <div class="card__hd">
          <div>
            <div class="card__title">Adindang Food</div>
            <div class="card__sub">Scan QR → Pilih Metode → Pesan → Bayar</div>
          </div>
          <div class="row">
            <button class="btn btn--ghost" data-action="reset">Reset Data Demo</button>
          </div>
        </div>
        <div class="card__bd">
          <div class="grid">
            <div class="card col-8">
              <div class="card__hd">
                <div>
                  <div class="card__title">1) Pemindaian & Metode</div>
                  <div class="card__sub">QR meja bisa mengisi otomatis nomor meja, tapi nomor meja tetap bisa diubah manual.</div>
                </div>
                <span class="badge ${m ? "badge--ok" : ""}">${m ? "Aktif" : "Belum dipilih"}</span>
              </div>
              <div class="card__bd">
                <div class="row">
                  <button class="btn ${isDineIn ? "btn--primary" : ""}" data-action="set-method" data-method="dinein">Dine-In</button>
                  <button class="btn ${isTakeaway ? "btn--primary" : ""}" data-action="set-method" data-method="takeaway">Takeaway</button>
                </div>
                <div class="sep"></div>
                <div class="row">
                  <div class="field">
                    <label>Nomor Meja (manual)</label>
                    <input class="input" inputmode="numeric" placeholder="Contoh: 12" value="${state.session.tableNumber || ""}" data-field="tableNumber" ${isDineIn ? "" : "disabled"} />
                  </div>
                  <div class="field">
                    <label>Info</label>
                    <div class="badge">${isDineIn ? "Untuk dine-in: wajib isi nomor meja" : "Untuk takeaway: nomor meja tidak diperlukan"}</div>
                  </div>
                </div>
                <div class="sep"></div>
                <div class="row">
                  <button class="btn btn--primary" data-nav="#/menu">Lanjut Pilih Menu</button>
                </div>
              </div>
            </div>
            <div class="card col-4">
              <div class="card__hd">
                <div>
                  <div class="card__title">Ringkas</div>
                  <div class="card__sub">Keranjang & status cepat.</div>
                </div>
              </div>
              <div class="card__bd">
                <div class="row">
                  <span class="badge">Item: ${cartTotals().itemsCount}</span>
                  <span class="badge">Subtotal: ${formatIdr(cartTotals().subtotal)}</span>
                </div>
                <div class="sep"></div>
                <div class="row">
                  <button class="btn" data-nav="#/orders">Lihat Pesanan</button>
                  <button class="btn btn--ok" data-nav="#/menu">Tambah Menu</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  `;
};

const renderMenu = () => {
  if (!ensureMethod()) return renderNeedMethod("#/menu");

  const methodBadge =
    state.session.method === "dinein"
      ? `<span class="badge badge--ok">Dine-In · Meja ${state.session.tableNumber || "-"}</span>`
      : `<span class="badge badge--ok">Takeaway</span>`;

  const menuCards = state.menu
    .slice()
    .sort((a, b) => (a.category === b.category ? a.name.localeCompare(b.name) : a.category.localeCompare(b.category)))
    .map((m) => {
      const soldOut = Number(m.stock ?? 0) <= 0;
      const img = m.image || "./assets/placeholder.svg";
      return `
        <div class="menuitem">
          <img class="menuitem__img" src="${img}" alt="${escapeHtml(m.name)}" loading="lazy" />
          <div class="menuitem__meta">
            <div class="menuitem__name">${escapeHtml(m.name)}</div>
            <div class="menuitem__sub">${m.category === "food" ? "Makanan" : "Minuman"} · ${formatIdr(
              m.price
            )} · <span class="${soldOut ? "badge badge--danger" : "badge"}">Stok: ${m.stock ?? 0}</span></div>
          </div>
          <div class="menuitem__actions">
            <button class="btn ${soldOut ? "" : "btn--primary"}" ${soldOut ? "disabled" : ""} data-action="open-add" data-menu="${m.id}">
              ${soldOut ? "Sold Out" : "Tambah"}
            </button>
          </div>
        </div>
      `;
    })
    .join("");

  const adding = state.ui.addingMenuId ? menuById(state.ui.addingMenuId) : null;
  const addPanel = adding
    ? `
      <div class="modal">
        <button type="button" class="modal__backdrop" data-action="close-add" aria-label="Tutup"></button>
        <div class="modal__content">
          <section class="card">
            <div class="card__hd">
              <div>
                <div class="card__title">Tambah Item</div>
                <div class="card__sub">${escapeHtml(adding.name)} · ${formatIdr(adding.price)} · Stok ${adding.stock ?? 0}</div>
              </div>
              <div class="row">
                <button class="btn btn--ghost" data-action="close-add" type="button">Tutup</button>
              </div>
            </div>
            <div class="card__bd">
              <div class="addgrid">
                <img class="menuitem__img menuitem__img--lg" src="${adding.image || "./assets/placeholder.svg"}" alt="${escapeHtml(adding.name)}" loading="lazy" />
                <div class="addgrid__meta">
                  <div class="row">
                    <span class="badge">${adding.category === "food" ? "Makanan" : "Minuman"}</span>
                    <span class="badge ${Number(adding.stock ?? 0) > 0 ? "badge--ok" : "badge--danger"}">${Number(adding.stock ?? 0) > 0 ? "Tersedia" : "Habis"}</span>
                  </div>
                  <div class="sep"></div>
                  <form data-form="add-to-cart" class="addform">
                    <input type="hidden" name="menuId" value="${adding.id}" />
                    ${((adding.variants || []).length
                      ? (adding.variants || [])
                          .map((v, idx) => {
                            const selected =
                              state.ui.addingVariantSelections && state.ui.addingVariantSelections[idx] != null
                                ? `${state.ui.addingVariantSelections[idx]}`
                                : `${(v.values || [])[0] || ""}`;
                            return `
                              <div class="field field--chips">
                                <label>${v.name}</label>
                                <div class="chip-group">
                                  ${(v.values || [])
                                    .map(
                                      (vv) => `
                                        <button type="button" class="chip ${`${vv}` === selected ? "chip--active" : ""}" data-action="variant-pick" data-idx="${idx}" data-value="${vv}">
                                          ${vv}
                                        </button>
                                      `
                                    )
                                    .join("")}
                                </div>
                              </div>
                            `;
                          })
                          .join("")
                      : `<div class="field"><label>Variasi</label><div class="badge">Tidak ada variasi</div></div>`)}
                    <div class="row">
                      <div class="field">
                        <label>Catatan Item (opsional)</label>
                        <input class="input" name="itemNote" placeholder="Contoh: tanpa saus" />
                      </div>
                      <div class="field" style="max-width:140px">
                        <label>Qty</label>
                        <input class="input" type="number" name="qty" min="1" value="1" />
                      </div>
                    </div>
                    <div class="row">
                      <button class="btn btn--primary" type="submit" ${Number(adding.stock ?? 0) > 0 ? "" : "disabled"}>Tambah ke Keranjang</button>
                      <button class="btn" type="button" data-action="close-add">Batal</button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    `
    : "";

  const cartLines = state.session.cart
    .map(
      (l) => `
      <div class="cartline">
        <div class="cartline__left">
          <div class="cartline__title">${escapeHtml(l.name)}</div>
          <div class="cartline__sub">
            ${l.variantText ? `${escapeHtml(l.variantText)} · ` : ""}${l.itemNote ? `Catatan: ${escapeHtml(l.itemNote)} · ` : ""}${formatIdr(
        l.price
      )}
          </div>
        </div>
        <div class="cartline__right">
          <span class="qty">x ${l.qty}</span>
          <button class="btn" data-action="qty" data-key="${l.key}" data-delta="-1">-</button>
          <button class="btn" data-action="qty" data-key="${l.key}" data-delta="1">+</button>
          <button class="btn btn--danger" data-action="remove-line" data-key="${l.key}">Hapus</button>
        </div>
      </div>
    `
    )
    .join("");

  const totals = cartTotals();
  return `
    <div class="grid">
      ${addPanel}
      <section class="card col-8">
        <div class="card__hd">
          <div>
            <div class="card__title">2) Pilih Menu</div>
            <div class="card__sub">Pilih makanan/minuman, variasi, dan masukkan ke keranjang.</div>
          </div>
          ${methodBadge}
        </div>
        <div class="card__bd" style="display:flex;flex-direction:column;gap:12px">
          ${menuCards || `<div class="muted">Menu kosong. Admin bisa menambahkan menu.</div>`}
        </div>
      </section>
      <aside class="card col-4">
        <div class="card__hd">
          <div>
            <div class="card__title">Keranjang</div>
            <div class="card__sub">Cek ulang sebelum checkout.</div>
          </div>
          <span class="badge">${totals.itemsCount} item</span>
        </div>
        <div class="card__bd">
          ${state.session.cart.length ? cartLines : `<div class="muted">Keranjang kosong.</div>`}
          <div class="sep"></div>
          <div class="row" style="justify-content:space-between">
            <span class="badge">Subtotal</span>
            <span class="badge badge--ok">${formatIdr(totals.subtotal)}</span>
          </div>
          <div class="sep"></div>
          <div class="row">
            <button class="btn btn--primary" ${state.session.cart.length ? "" : "disabled"} data-nav="#/checkout">Checkout</button>
            <button class="btn btn--ghost" ${state.session.cart.length ? "" : "disabled"} data-action="clear-cart">Kosongkan</button>
          </div>
        </div>
      </aside>
    </div>
  `;
};

const renderCheckout = () => {
  if (!ensureMethod()) return renderNeedMethod("#/checkout");
  if (!state.session.cart.length) {
    toast("Keranjang masih kosong");
    setHash("#/menu");
    return "";
  }

  const totals = cartTotals();
  const lines = state.session.cart
    .map(
      (l) => `
        <tr>
          <td>
            <div style="font-weight:680">${l.name}</div>
            <div class="muted" style="font-size:13px;line-height:1.35">
              ${l.variantText ? `${l.variantText}<br/>` : ""}${l.itemNote ? `Catatan item: ${l.itemNote}` : ""}
            </div>
          </td>
          <td>${l.qty}</td>
          <td>${formatIdr(l.price)}</td>
          <td>${formatIdr(l.price * l.qty)}</td>
        </tr>
      `
    )
    .join("");

  const isDineIn = state.session.method === "dinein";

  return `
    <div class="grid">
      <section class="card col-8">
        <div class="card__hd">
          <div>
            <div class="card__title">3) Checkout</div>
            <div class="card__sub">Tambahkan catatan pesanan, pastikan nomor meja sesuai, lalu buat pesanan.</div>
          </div>
          <span class="badge badge--ok">${isDineIn ? `Dine-In` : `Takeaway`}</span>
        </div>
        <div class="card__bd">
          <div class="row">
            <div class="field">
              <label>Nomor Meja (wajib untuk Dine-In)</label>
              <input class="input" inputmode="numeric" value="${state.session.tableNumber || ""}" data-field="tableNumber" ${
    isDineIn ? "" : "disabled"
  } />
            </div>
            <div class="field">
              <label>Catatan Pesanan (opsional)</label>
              <textarea class="textarea" placeholder="Contoh: alergi kacang / pisahkan sambal" data-field="orderNote">${
                state.session.orderNote || ""
              }</textarea>
            </div>
          </div>
          <div class="sep"></div>
          <table class="table">
            <thead>
              <tr>
                <th>Item</th>
                <th style="width:80px">Qty</th>
                <th style="width:140px">Harga</th>
                <th style="width:160px">Total</th>
              </tr>
            </thead>
            <tbody>${lines}</tbody>
          </table>
          <div class="sep"></div>
          <div class="row" style="justify-content:space-between">
            <span class="badge">Subtotal</span>
            <span class="badge badge--ok">${formatIdr(totals.subtotal)}</span>
          </div>
        </div>
      </section>
      <aside class="card col-4">
        <div class="card__hd">
          <div>
            <div class="card__title">Lanjut Pembayaran</div>
            <div class="card__sub">Pilih bayar online (QRIS) atau bayar di kasir.</div>
          </div>
        </div>
        <div class="card__bd">
          <div class="row">
            <button class="btn btn--primary" data-action="create-order">Buat Pesanan</button>
            <button class="btn btn--ghost" data-nav="#/menu">Kembali</button>
          </div>
          <div class="sep"></div>
          <div class="muted" style="font-size:13px;line-height:1.45">
            Setelah pesanan dibuat, Anda akan memilih metode pembayaran:
            <div class="sep"></div>
            <span class="badge">Opsi A: Bayar Online (QRIS simulasi)</span>
            <span class="badge">Opsi B: Bayar di Kasir (kode pesanan)</span>
          </div>
        </div>
      </aside>
    </div>
  `;
};

const renderPay = (orderId) => {
  const order = findOrder(orderId);
  if (!order) return renderNotFound("Pesanan tidak ditemukan");

  const totals = orderTotals(order);
  const role = state.auth.role || "guest";

  if (role === "cashier") {
    const method = order.method === "dinein" ? `Meja ${order.tableNumber || "-"}` : "Takeaway";
    const unpaid = order.paymentStatus !== "PAID";
    const paidType = paymentTypeLabel(order.paymentType);
    const qrisActive = state.ui.cashierQrisOrderId === order.id && unpaid;
    return `
      <div class="grid">
        <section class="card col-12">
          <div class="card__hd">
            <div>
              <div class="card__title">Kasir · Detail Pembayaran</div>
              <div class="card__sub">Konfirmasi pembayaran berdasarkan kode pesanan.</div>
            </div>
            <span class="badge ${order.paymentStatus === "PAID" ? "badge--ok" : "badge--warn"}">${paymentLabel(order)}</span>
          </div>
          <div class="card__bd">
            <div class="row">
              <span class="badge">Kode: <span style="font-family:var(--mono)">${order.code}</span></span>
              <span class="badge">${method}</span>
              <span class="badge badge--ok">Total: ${formatIdr(totals.subtotal)}</span>
            </div>
            ${order.orderNote ? `<div class="sep"></div><div class="badge">Catatan: ${order.orderNote}</div>` : ""}
            ${paidType ? `<div class="sep"></div><div class="badge">Metode bayar: ${paidType}</div>` : ""}
            ${
              qrisActive
                ? `
                  <div class="sep"></div>
                  <div class="qrbox">
                    <div class="qr"></div>
                    <div class="qrtext">QRIS (simulasi) · Total: ${formatIdr(totals.subtotal)}</div>
                  </div>
                `
                : ""
            }
            <div class="sep"></div>
            <table class="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th style="width:80px">Qty</th>
                  <th style="width:140px">Harga</th>
                  <th style="width:160px">Total</th>
                </tr>
              </thead>
              <tbody>
                ${(order.items || [])
                  .map(
                    (l) => `
                      <tr>
                        <td>
                          <div style="font-weight:680">${l.name}</div>
                          <div class="muted" style="font-size:13px;line-height:1.35">
                            ${l.variantText ? `${l.variantText}<br/>` : ""}${l.itemNote ? `Catatan item: ${l.itemNote}` : ""}
                          </div>
                        </td>
                        <td>${l.qty}</td>
                        <td>${formatIdr(l.price)}</td>
                        <td>${formatIdr(l.price * l.qty)}</td>
                      </tr>
                    `
                  )
                  .join("")}
              </tbody>
            </table>
            <div class="sep"></div>
            <div class="row">
              <button class="btn btn--primary" ${unpaid ? "" : "disabled"} data-action="cashier-show-qris" data-order="${order.id}">${qrisActive ? "QRIS Ditampilkan" : "Tampilkan QRIS"}</button>
              <button class="btn btn--ok" ${unpaid ? "" : "disabled"} data-action="cashier-pay" data-order="${order.id}" data-paytype="QRIS">Konfirmasi Lunas QRIS</button>
              <button class="btn btn--ok" ${unpaid ? "" : "disabled"} data-action="cashier-pay" data-order="${order.id}" data-paytype="TUNAI">Konfirmasi Tunai</button>
              <button class="btn btn--ok" ${unpaid ? "" : "disabled"} data-action="cashier-pay" data-order="${order.id}" data-paytype="DEBIT">Konfirmasi Debit</button>
              <button class="btn" ${order.paymentStatus === "PAID" ? "" : "disabled"} data-action="print-receipt" data-order="${order.id}">Cetak Struk</button>
              <button class="btn" data-nav="#/cashier">Kembali</button>
            </div>
          </div>
        </section>
      </div>
    `;
  }

  return `
    <div class="grid">
      <section class="card col-8">
        <div class="card__hd">
          <div>
            <div class="card__title">Pembayaran</div>
            <div class="card__sub">Pilih salah satu metode pembayaran. Pesanan tetap bisa diproses di dapur tanpa menunggu pembayaran.</div>
          </div>
          <span class="badge ${order.paymentStatus === "PAID" ? "badge--ok" : "badge--warn"}">${paymentLabel(order)}</span>
        </div>
        <div class="card__bd">
          <div class="row">
            <span class="badge">Kode: <span style="font-family:var(--mono)">${order.code}</span></span>
            <span class="badge">${order.method === "dinein" ? `Meja ${order.tableNumber}` : "Takeaway"}</span>
            <span class="badge">Total: ${formatIdr(totals.subtotal)}</span>
          </div>
          ${order.orderNote ? `<div class="sep"></div><div class="badge">Catatan: ${order.orderNote}</div>` : ""}
          <div class="sep"></div>
          <div class="grid">
            <div class="card col-6">
              <div class="card__hd">
                <div>
                  <div class="card__title">Opsi A: Bayar Online (QRIS)</div>
                  <div class="card__sub">Prototype menampilkan QR dinamis dan tombol simulasi.</div>
                </div>
              </div>
              <div class="card__bd">
                <div class="qrbox">
                  <div class="qr"></div>
                  <div class="qrtext">QRIS Dinamis (simulasi) · Total: ${formatIdr(totals.subtotal)}</div>
                </div>
                <div class="sep"></div>
                <div class="row">
                  <button class="btn btn--ok" ${order.paymentStatus === "PAID" ? "disabled" : ""} data-action="pay-online" data-order="${
    order.id
  }">Simulasikan Pembayaran Sukses</button>
                </div>
              </div>
            </div>
            <div class="card col-6">
              <div class="card__hd">
                <div>
                  <div class="card__title">Opsi B: Bayar di Kasir</div>
                  <div class="card__sub">Tunjukkan kode pesanan ini ke kasir.</div>
                </div>
              </div>
              <div class="card__bd">
                <div class="badge">Kode Pesanan</div>
                <div style="font-family:var(--mono);font-size:32px;font-weight:820;letter-spacing:2px;margin-top:8px">${
                  order.code
                }</div>
                <div class="sep"></div>
                <div class="row">
                  <button class="btn btn--primary" ${order.paymentStatus === "PAID" ? "disabled" : ""} data-action="set-cashier-method" data-order="${
    order.id
  }">Saya akan bayar di kasir</button>
                </div>
              </div>
            </div>
          </div>
          <div class="sep"></div>
          <div class="row">
            <button class="btn" data-nav="#/track/${order.id}">Lihat Status Pesanan</button>
            <button class="btn btn--ghost" data-nav="#/orders">Kembali ke daftar pesanan</button>
          </div>
        </div>
      </section>
      <aside class="card col-4">
        <div class="card__hd">
          <div>
            <div class="card__title">Ringkasan</div>
            <div class="card__sub">Item yang dipesan.</div>
          </div>
        </div>
        <div class="card__bd">
          ${(order.items || [])
            .map(
              (l) => `
                <div class="cartline">
                  <div class="cartline__left">
                    <div class="cartline__title">${l.name}</div>
                    <div class="cartline__sub">${l.variantText ? `${l.variantText} · ` : ""}${l.itemNote ? `Catatan: ${l.itemNote}` : ""}</div>
                  </div>
                  <div class="cartline__right">
                    <span class="qty">x ${l.qty}</span>
                  </div>
                </div>
              `
            )
            .join("")}
        </div>
      </aside>
    </div>
  `;
};

const renderOrders = () => {
  const rows = state.orders
    .slice(0, 30)
    .map((o) => {
      const totals = orderTotals(o);
      const badgeCls = o.paymentStatus === "PAID" ? "badge--ok" : "badge--warn";
      const method = o.method === "dinein" ? `Dine-In · Meja ${o.tableNumber || "-"}` : "Takeaway";
      return `
        <tr>
          <td><span style="font-family:var(--mono)">${o.code}</span></td>
          <td>${method}</td>
          <td>${new Date(o.createdAt).toLocaleString("id-ID")}</td>
          <td><span class="badge ${badgeCls}">${paymentLabel(o)}</span></td>
          <td><span class="badge">${statusLabel(o)}</span></td>
          <td>${formatIdr(totals.subtotal)}</td>
          <td>
            <div class="row">
              <button class="btn btn--primary" data-nav="#/pay/${o.id}">Bayar / Detail</button>
              <button class="btn" data-nav="#/track/${o.id}">Status</button>
              <button class="btn btn--danger" data-action="cancel-order" data-order="${o.id}" ${
        o.paymentStatus === "PAID" ? "disabled" : ""
      }>Batalkan</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="grid">
      <section class="card col-12">
        <div class="card__hd">
          <div>
            <div class="card__title">Daftar Pesanan</div>
            <div class="card__sub">Pesanan terbaru (maks 30). Untuk demo, data tersimpan di browser (localStorage).</div>
          </div>
        </div>
        <div class="card__bd">
          <table class="table">
            <thead>
              <tr>
                <th>Kode</th>
                <th>Metode</th>
                <th>Dibuat</th>
                <th>Pembayaran</th>
                <th>Status</th>
                <th>Total</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              ${rows || `<tr><td colspan="7" class="muted">Belum ada pesanan.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;
};

const renderTrack = (orderId) => {
  const order = findOrder(orderId);
  if (!order) return renderNotFound("Pesanan tidak ditemukan");

  updateOrderStatusFromStations(order);
  saveState(state);

  const steps = [
    {
      key: "RECEIVED",
      title: "Pesanan Diterima",
      sub: "Pesanan sudah diterima sistem dan langsung masuk antrian dapur.",
      active: order.status === "RECEIVED",
      done: ["COOKING", "COMPLETED"].includes(order.status),
    },
    {
      key: "COOKING",
      title: "Sedang Dibuat",
      sub: "Dapur sedang membuat pesanan.",
      active: order.status === "COOKING",
      done: ["COMPLETED"].includes(order.status),
    },
    {
      key: "COMPLETED",
      title: "Selesai",
      sub: order.method === "dinein" ? "Akan diantar ke meja." : "Ambil di counter / dipanggil nomor antrean.",
      done: order.status === "COMPLETED",
    },
  ];

  const stepHtml = steps
    .map((s) => {
      const badge = s.done ? `<span class="badge badge--ok">Selesai</span>` : s.active ? `<span class="badge badge--warn">Aktif</span>` : `<span class="badge">Menunggu</span>`;
      return `
        <div class="step">
          <div class="row" style="justify-content:space-between;align-items:flex-start">
            <div>
              <div class="step__title">${s.title}</div>
              <div class="step__sub">${s.sub}</div>
            </div>
            ${badge}
          </div>
        </div>
      `;
    })
    .join("");

  return `
    <div class="grid">
      <section class="card col-12">
        <div class="card__hd">
          <div>
            <div class="card__title">Status Pesanan</div>
            <div class="card__sub">Kode: <span style="font-family:var(--mono)">${order.code}</span> · ${
    order.method === "dinein" ? `Meja ${order.tableNumber}` : "Takeaway"
  } · ${paymentLabel(order)}</div>
          </div>
          <span class="badge">${statusLabel(order)}</span>
        </div>
        <div class="card__bd">
          <div class="timeline">${stepHtml}</div>
          <div class="sep"></div>
          <div class="row">
            <button class="btn btn--primary" data-nav="#/pay/${order.id}">Bayar / Detail</button>
            <button class="btn" data-nav="#/orders">Kembali</button>
          </div>
        </div>
      </section>
    </div>
  `;
};

const renderAdmin = () => {
  if (!requireRole("admin")) {
    setRole("guest");
    setHash("#/");
    return "";
  }

  const gh = githubSettings();
  const ghTokenSet = Boolean(getGithubToken());

  const imageEditing = state.ui.adminImageMenuId ? menuById(state.ui.adminImageMenuId) : null;
  const imageModal = imageEditing
    ? `
      <div class="modal">
        <button type="button" class="modal__backdrop" data-action="admin-close-image" aria-label="Tutup"></button>
        <div class="modal__content">
          <section class="card">
            <div class="card__hd">
              <div>
                <div class="card__title">Ganti Gambar Menu</div>
                <div class="card__sub">${escapeHtml(imageEditing.name)}</div>
              </div>
              <div class="row">
                <button class="btn btn--ghost" data-action="admin-close-image" type="button">Tutup</button>
              </div>
            </div>
            <div class="card__bd">
              <div class="addgrid">
                <img class="menuitem__img menuitem__img--lg" src="${imageEditing.image || "./assets/placeholder.svg"}" alt="${escapeHtml(
        imageEditing.name
      )}" loading="lazy" />
                <div class="addgrid__meta">
                  <div class="row">
                    <div class="field" style="flex:1">
                      <label>Gambar (URL)</label>
                      <input class="input" id="admin-image-url" inputmode="url" placeholder="https://... (opsional)" value="${escapeHtml(
                        imageEditing.image || ""
                      )}" />
                    </div>
                  </div>
                  <div class="row">
                    <div class="field" style="flex:1">
                      <label>Upload Gambar</label>
                      <input class="input" id="admin-image-file" type="file" accept="image/*" />
                    </div>
                  </div>
                  <div class="sep"></div>
                  <div class="row">
                    <button class="btn btn--primary" data-action="admin-save-image" data-menu="${imageEditing.id}" type="button">Simpan</button>
                    <button class="btn btn--danger" data-action="admin-remove-image" data-menu="${imageEditing.id}" type="button">Hapus Gambar</button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    `
    : "";

  const rows = state.menu
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((m) => {
      const soldOut = Number(m.stock ?? 0) <= 0;
      return `
        <tr>
          <td><span style="font-family:var(--mono)">${m.id}</span></td>
          <td>${escapeHtml(m.name)}</td>
          <td>${m.category === "food" ? "Makanan" : "Minuman"}</td>
          <td>${formatIdr(m.price)}</td>
          <td><span class="badge ${soldOut ? "badge--danger" : ""}">${m.stock ?? 0}</span></td>
          <td>
            <div class="row">
              <button class="btn" data-action="edit-menu" data-menu="${m.id}">Edit</button>
              <button class="btn" data-action="edit-variants" data-menu="${m.id}">Variasi</button>
              <button class="btn" data-action="admin-edit-image" data-menu="${m.id}">Gambar</button>
              <button class="btn btn--danger" data-action="delete-menu" data-menu="${m.id}">Hapus</button>
              <button class="btn btn--danger" data-action="set-stock" data-menu="${m.id}" data-stock="0">Sold Out</button>
              <button class="btn btn--ok" data-action="add-stock" data-menu="${m.id}">Tambah Stok</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  const kpi = {
    menuCount: state.menu.length,
    soldOut: state.menu.filter((m) => Number(m.stock ?? 0) <= 0).length,
    unpaidOrders: state.orders.filter((o) => o.paymentStatus !== "PAID" && o.status !== "CANCELLED").length,
  };

  const orderHistory = state.orders
    .slice()
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, 50);
  const orderRows = orderHistory
    .map((o) => {
      const totals = orderTotals(o);
      const method = o.method === "dinein" ? `Meja ${o.tableNumber || "-"}` : "Takeaway";
      const createdAt = o.createdAt ? new Date(o.createdAt).toLocaleString("id-ID") : "-";
      const canReceipt = o.paymentStatus === "PAID";
      return `
        <tr>
          <td><span style="font-family:var(--mono)">${o.code}</span></td>
          <td>${createdAt}</td>
          <td>${method}</td>
          <td><span class="badge">${paymentLabel(o)}</span></td>
          <td><span class="badge">${statusLabel(o)}</span></td>
          <td>${formatIdr(totals.subtotal)}</td>
          <td>
            <div class="row">
              <button class="btn" data-action="view-order" data-order="${o.id}" data-title="Detail Pesanan">Detail</button>
              <button class="btn" data-action="print-receipt" data-order="${o.id}" ${canReceipt ? "" : "disabled"}>Struk</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="grid">
      ${imageModal}
      <section class="card col-12">
        <div class="card__hd">
          <div>
            <div class="card__title">Admin</div>
            <div class="card__sub">Kelola stok & menu yang tersedia.</div>
          </div>
          <div class="row">
            <button class="btn btn--ghost" data-action="logout">Logout</button>
          </div>
        </div>
        <div class="card__bd">
          <div class="kpi">
            <div class="kpi__card">
              <div class="kpi__label">Jumlah Menu</div>
              <div class="kpi__value">${kpi.menuCount}</div>
            </div>
            <div class="kpi__card">
              <div class="kpi__label">Sold Out</div>
              <div class="kpi__value">${kpi.soldOut}</div>
            </div>
            <div class="kpi__card">
              <div class="kpi__label">Pesanan Belum Lunas</div>
              <div class="kpi__value">${kpi.unpaidOrders}</div>
            </div>
          </div>
          <div class="sep"></div>
          <form class="card" data-form="github-assets">
            <div class="card__hd">
              <div>
                <div class="card__title">Upload Gambar ke GitHub Assets (opsional)</div>
                <div class="card__sub">Agar gambar benar-benar masuk folder assets di repo GitHub.</div>
              </div>
              <span class="badge ${ghTokenSet ? "badge--ok" : "badge--warn"}">${ghTokenSet ? "Token tersimpan (session)" : "Token belum ada"}</span>
            </div>
            <div class="card__bd">
              <div class="row">
                <div class="field" style="flex:0 0 auto;min-width:220px">
                  <label>Aktifkan</label>
                  <label style="display:flex;gap:10px;align-items:center">
                    <input type="checkbox" name="enabled" ${gh.enabled ? "checked" : ""} />
                    <span class="badge">${gh.enabled ? "On" : "Off"}</span>
                  </label>
                </div>
                <div class="field" style="flex:1;min-width:220px">
                  <label>Owner</label>
                  <input class="input" name="owner" placeholder="username" value="${escapeHtml(gh.owner)}" />
                </div>
                <div class="field" style="flex:1;min-width:220px">
                  <label>Repo</label>
                  <input class="input" name="repo" placeholder="nama-repo" value="${escapeHtml(gh.repo)}" />
                </div>
                <div class="field" style="flex:0 0 auto;min-width:160px">
                  <label>Branch</label>
                  <input class="input" name="branch" placeholder="main" value="${escapeHtml(gh.branch)}" />
                </div>
              </div>
              <div class="row">
                <div class="field" style="flex:1;min-width:220px">
                  <label>Token (tidak disimpan permanen)</label>
                  <input class="input" name="token" type="password" placeholder="${ghTokenSet ? "Biarkan kosong untuk tetap pakai token yang ada" : "ghp_..."}" />
                </div>
              </div>
              <div class="row">
                <button class="btn btn--primary" type="submit">Simpan</button>
                <button class="btn btn--danger" type="button" data-action="github-clear-token">Hapus Token</button>
              </div>
            </div>
          </form>
          <div class="sep"></div>
          <form class="card" data-form="create-menu">
            <div class="card__hd">
              <div>
                <div class="card__title">Tambah Menu Baru</div>
                <div class="card__sub">Item baru langsung muncul di menu pelanggan.</div>
              </div>
            </div>
            <div class="card__bd">
              <div class="row">
                <div class="field">
                  <label>Nama</label>
                  <input class="input" name="name" required placeholder="Contoh: Sate Ayam" />
                </div>
                <div class="field">
                  <label>Kategori</label>
                  <select class="select" name="category">
                    <option value="food">Makanan</option>
                    <option value="drink">Minuman</option>
                  </select>
                </div>
                <div class="field">
                  <label>Harga</label>
                  <input class="input" name="price" type="number" min="0" required value="0" />
                </div>
                <div class="field">
                  <label>Stok</label>
                  <input class="input" name="stock" type="number" min="0" required value="0" />
                </div>
              </div>
              <div class="row">
                <div class="field">
                  <label>Variasi (opsional)</label>
                  <input class="input" name="variants" placeholder="Format: Nama:opsi1|opsi2, Nama2:opsi1|opsi2" />
                </div>
              </div>
              <div class="row">
                <div class="field" style="flex:1">
                  <label>Gambar (URL)</label>
                  <input class="input" name="imageUrl" inputmode="url" placeholder="https://... (opsional)" />
                </div>
                <div class="field" style="flex:1">
                  <label>Upload Gambar</label>
                  <input class="input" name="imageFile" type="file" accept="image/*" />
                </div>
              </div>
              <div class="row">
                <button class="btn btn--primary" type="submit">Tambah</button>
                <button class="btn" type="button" data-action="seed-menu">Reset Menu Default</button>
              </div>
            </div>
          </form>
          <div class="sep"></div>
          <table class="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Nama</th>
                <th>Kategori</th>
                <th>Harga</th>
                <th>Stok</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              ${rows || `<tr><td colspan="6" class="muted">Menu kosong.</td></tr>`}
            </tbody>
          </table>
          <div class="sep"></div>
          <div class="row" style="justify-content:space-between">
            <div class="badge">Riwayat Pesanan (terbaru)</div>
            <div class="badge">${orderHistory.length} pesanan</div>
          </div>
          <div class="sep"></div>
          <table class="table">
            <thead>
              <tr>
                <th>Kode</th>
                <th>Waktu</th>
                <th>Meja/Takeaway</th>
                <th>Pembayaran</th>
                <th>Status</th>
                <th>Total</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              ${orderRows || `<tr><td colspan="7" class="muted">Belum ada pesanan.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;
};

const renderCashier = () => {
  if (!requireRole("cashier")) {
    setRole("guest");
    setHash("#/");
    return "";
  }

  const unpaid = state.orders.filter((o) => o.paymentStatus !== "PAID" && o.status !== "CANCELLED");
  const paid = state.orders.filter((o) => o.paymentStatus === "PAID" && o.status !== "CANCELLED");

  const qrisOrder = state.ui.cashierQrisOrderId ? findOrder(state.ui.cashierQrisOrderId) : null;
  const qrisPanel =
    qrisOrder && qrisOrder.paymentStatus !== "PAID"
      ? `
        <section class="card col-12">
          <div class="card__hd">
            <div>
              <div class="card__title">QRIS (Kasir) · ${qrisOrder.code}</div>
              <div class="card__sub">Tunjukkan QR ini ke pelanggan, lalu konfirmasi setelah pembayaran berhasil.</div>
            </div>
            <span class="badge badge--warn">Menunggu</span>
          </div>
          <div class="card__bd">
            <div class="row">
              <span class="badge">${qrisOrder.method === "dinein" ? `Meja ${qrisOrder.tableNumber || "-"}` : "Takeaway"}</span>
              <span class="badge badge--ok">Total: ${formatIdr(orderTotals(qrisOrder).subtotal)}</span>
            </div>
            <div class="sep"></div>
            <div class="qrbox">
              <div class="qr"></div>
              <div class="qrtext">QRIS (simulasi) · Total: ${formatIdr(orderTotals(qrisOrder).subtotal)}</div>
            </div>
            <div class="sep"></div>
            <div class="row">
              <button class="btn btn--ok" data-action="cashier-pay" data-order="${qrisOrder.id}" data-paytype="QRIS">Konfirmasi Lunas QRIS</button>
              <button class="btn" data-action="cashier-close-qris">Tutup</button>
            </div>
          </div>
        </section>
      `
      : "";
  const rows = unpaid
    .slice(0, 50)
    .map((o) => {
      const totals = orderTotals(o);
      const method = o.method === "dinein" ? `Meja ${o.tableNumber || "-"}` : "Takeaway";
      const preferred = o.paymentMethod === "CASHIER";
      return `
        <tr>
          <td><span style="font-family:var(--mono)">${o.code}</span></td>
          <td>${method}</td>
          <td>${formatIdr(totals.subtotal)}</td>
          <td><span class="badge ${preferred ? "badge--ok" : "badge"}">${preferred ? "Bayar di kasir" : "Belum pilih"}</span></td>
          <td>
            <div class="row">
              <button class="btn btn--primary" data-action="cashier-show-qris" data-order="${o.id}">QRIS</button>
              <button class="btn btn--ok" data-action="cashier-pay" data-order="${o.id}" data-paytype="TUNAI">Tunai</button>
              <button class="btn btn--ok" data-action="cashier-pay" data-order="${o.id}" data-paytype="DEBIT">Debit</button>
              <button class="btn" data-nav="#/pay/${o.id}">Detail</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  const paidRows = paid
    .slice(0, 15)
    .map((o) => {
      const totals = orderTotals(o);
      const method = o.method === "dinein" ? `Meja ${o.tableNumber || "-"}` : "Takeaway";
      const payType = paymentTypeLabel(o.paymentType) || "-";
      return `
        <tr>
          <td><span style="font-family:var(--mono)">${o.code}</span></td>
          <td>${method}</td>
          <td>${formatIdr(totals.subtotal)}</td>
          <td><span class="badge badge--ok">${payType}</span></td>
          <td>
            <div class="row">
              <button class="btn" data-action="print-receipt" data-order="${o.id}">Cetak Struk</button>
              <button class="btn" data-nav="#/pay/${o.id}">Detail</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="grid">
      ${qrisPanel}
      <section class="card col-12">
        <div class="card__hd">
          <div>
            <div class="card__title">Kasir</div>
            <div class="card__sub">Kelola pembayaran di kasir (tunai/kartu) dengan kode pesanan.</div>
          </div>
          <div class="row">
            <button class="btn btn--ghost" data-action="logout">Logout</button>
          </div>
        </div>
        <div class="card__bd">
          <form class="row" data-form="cashier-find">
            <div class="field" style="max-width:320px">
              <label>Cari dengan Kode</label>
              <input class="input" name="code" placeholder="Contoh: A1B2C3" style="text-transform:uppercase" />
            </div>
            <button class="btn btn--primary" type="submit">Cari</button>
          </form>
          <div class="sep"></div>
          <table class="table">
            <thead>
              <tr>
                <th>Kode</th>
                <th>Meja/Takeaway</th>
                <th>Total</th>
                <th>Preferensi</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              ${rows || `<tr><td colspan="5" class="muted">Tidak ada pesanan yang perlu dibayar.</td></tr>`}
            </tbody>
          </table>
          <div class="sep"></div>
          <div class="row" style="justify-content:space-between">
            <div class="badge">Riwayat Lunas (terbaru)</div>
            <div class="badge">${paid.length} pesanan lunas</div>
          </div>
          <div class="sep"></div>
          <table class="table">
            <thead>
              <tr>
                <th>Kode</th>
                <th>Meja/Takeaway</th>
                <th>Total</th>
                <th>Metode</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              ${paidRows || `<tr><td colspan="5" class="muted">Belum ada pesanan lunas.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;
};

const stationFilterItems = (order, category) => (order.items || []).filter((i) => i.category === category);

const renderKitchen = () => {
  if (!requireRole("kitchen")) {
    setRole("guest");
    setHash("#/");
    return "";
  }

  const title = "Dapur";
  const activeOrders = state.orders.filter((o) => o.status !== "CANCELLED" && o.status !== "COMPLETED");
  const historyOrders = state.orders
    .filter((o) => o.status === "COMPLETED" || o.status === "CANCELLED")
    .slice()
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, 30);

  const rows = activeOrders
    .map((o) => {
      const items = o.items || [];
      if (!items.length) return "";
      const printedAt = o.kitchen?.printedAt;
      const startedAt = o.kitchen?.startedAt;
      const doneAt = o.kitchen?.doneAt;

      const itemList = items
        .map(
          (it) => `
            <div style="display:flex;justify-content:space-between;gap:10px">
              <div style="min-width:0">
                <div style="font-weight:700">${escapeHtml(it.name)} <span class="badge" style="margin-left:8px">${it.category === "drink" ? "Minuman" : "Makanan"}</span></div>
                <div class="muted" style="font-size:13px;line-height:1.35">
                  ${it.variantText ? `${escapeHtml(it.variantText)} · ` : ""}${it.itemNote ? `Catatan: ${escapeHtml(it.itemNote)}` : ""}
                </div>
              </div>
              <div class="qty">x ${it.qty}</div>
            </div>
          `
        )
        .join('<div style="height:10px"></div>');

      return `
        <tr>
          <td><span style="font-family:var(--mono)">${o.code}</span></td>
          <td>${o.method === "dinein" ? `Meja ${o.tableNumber || "-"}` : "Takeaway"}</td>
          <td>
            ${itemList}
            ${o.orderNote ? `<div class="sep"></div><div class="badge">Catatan: ${escapeHtml(o.orderNote)}</div>` : ""}
          </td>
          <td>
            <div class="row">
              <span class="badge ${printedAt ? "badge--ok" : "badge--warn"}">${printedAt ? "Tercetak" : "Belum cetak"}</span>
              <span class="badge ${startedAt ? "badge--warn" : ""}">${startedAt ? "Sedang dibuat" : "Belum mulai"}</span>
              <span class="badge ${doneAt ? "badge--ok" : ""}">${doneAt ? "Selesai" : "Belum selesai"}</span>
            </div>
          </td>
          <td>
            <div class="row">
              <button class="btn btn--primary" data-action="print-ticket" data-order="${o.id}">Cetak</button>
              <button class="btn" data-action="view-order" data-order="${o.id}" data-title="Detail Pesanan">Detail</button>
              <button class="btn ${startedAt ? "" : "btn--primary"}" data-action="station-start" data-order="${o.id}">${
        startedAt ? "Batalkan Mulai" : "Mulai Buat"
      }</button>
              <button class="btn btn--ok" data-action="station-done" data-order="${o.id}">${
        doneAt ? "Batalkan Selesai" : "Tandai Selesai"
      }</button>
            </div>
          </td>
        </tr>
      `;
    })
    .filter(Boolean)
    .join("");

  const historyRows = historyOrders
    .map((o) => {
      const items = o.items || [];
      const itemList = items
        .map(
          (it) => `
            <div style="display:flex;justify-content:space-between;gap:10px">
              <div style="min-width:0">
                <div style="font-weight:700">${escapeHtml(it.name)} <span class="badge" style="margin-left:8px">${it.category === "drink" ? "Minuman" : "Makanan"}</span></div>
                <div class="muted" style="font-size:13px;line-height:1.35">
                  ${it.variantText ? `${escapeHtml(it.variantText)} · ` : ""}${it.itemNote ? `Catatan: ${escapeHtml(it.itemNote)}` : ""}
                </div>
              </div>
              <div class="qty">x ${it.qty}</div>
            </div>
          `
        )
        .join('<div style="height:10px"></div>');
      const doneAt = o.kitchen?.doneAt || null;
      const when = doneAt ? new Date(doneAt).toLocaleString("id-ID") : new Date(o.createdAt || nowIso()).toLocaleString("id-ID");
      return `
        <tr>
          <td><span style="font-family:var(--mono)">${o.code}</span></td>
          <td>${o.method === "dinein" ? `Meja ${o.tableNumber || "-"}` : "Takeaway"}</td>
          <td><span class="badge">${statusLabel(o)}</span></td>
          <td>${when}</td>
          <td>
            ${itemList}
            ${o.orderNote ? `<div class="sep"></div><div class="badge">Catatan: ${escapeHtml(o.orderNote)}</div>` : ""}
          </td>
          <td>
            <div class="row">
              <button class="btn" data-action="view-order" data-order="${o.id}" data-title="Detail Pesanan">Detail</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="grid">
      <section class="card col-12">
        <div class="card__hd">
          <div>
            <div class="card__title">${title}</div>
            <div class="card__sub">Pesanan langsung masuk ke ${title} dan bisa diproses tanpa menunggu pembayaran (makanan + minuman).</div>
          </div>
          <div class="row">
            <button class="btn btn--ghost" data-action="logout">Logout</button>
          </div>
        </div>
        <div class="card__bd">
          <div class="row" style="justify-content:space-between">
            <div class="badge">Antrian</div>
            <div class="badge">${activeOrders.length} pesanan</div>
          </div>
          <div class="sep"></div>
          <table class="table">
            <thead>
              <tr>
                <th>Kode</th>
                <th>Meja/Takeaway</th>
                <th>Item</th>
                <th>Status</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              ${rows || `<tr><td colspan="5" class="muted">Belum ada pesanan untuk diproses.</td></tr>`}
            </tbody>
          </table>
          <div class="sep"></div>
          <div class="row" style="justify-content:space-between">
            <div class="badge">Riwayat (Selesai / Dibatalkan)</div>
            <div class="badge">${historyOrders.length} terakhir</div>
          </div>
          <div class="sep"></div>
          <table class="table">
            <thead>
              <tr>
                <th>Kode</th>
                <th>Meja/Takeaway</th>
                <th>Status</th>
                <th>Waktu</th>
                <th>Item</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              ${historyRows || `<tr><td colspan="6" class="muted">Belum ada riwayat.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;
};

const renderNotFound = (msg) => `
  <div class="grid">
    <section class="card col-12">
      <div class="card__hd">
        <div>
          <div class="card__title">Tidak ditemukan</div>
          <div class="card__sub">${msg}</div>
        </div>
      </div>
      <div class="card__bd">
        <button class="btn btn--primary" data-nav="#/">Kembali ke Beranda</button>
      </div>
    </section>
  </div>
`;

const render = () => {
  renderNav();

  const route = getHashRoute();
  const p = route.params;
  const base = p[0] || "";
  const role = state.auth.role || "guest";

  if (role !== "guest") {
    const allowed =
      role === "admin"
        ? new Set(["admin"])
        : role === "cashier"
          ? new Set(["cashier", "pay"])
          : role === "kitchen"
            ? new Set(["kitchen"])
            : new Set([""]);
    if (!allowed.has(base)) {
      setHash(role === "admin" ? "#/admin" : role === "cashier" ? "#/cashier" : role === "kitchen" ? "#/kitchen" : "#/");
      return;
    }
  }

  if (base === "") {
    $app.innerHTML = renderHome();
    $app.classList.remove("page-enter");
    void $app.offsetWidth;
    $app.classList.add("page-enter");
    return;
  }

  if (base === "menu") {
    $app.innerHTML = renderMenu();
    $app.classList.remove("page-enter");
    void $app.offsetWidth;
    $app.classList.add("page-enter");
    return;
  }

  if (base === "checkout") {
    $app.innerHTML = renderCheckout();
    $app.classList.remove("page-enter");
    void $app.offsetWidth;
    $app.classList.add("page-enter");
    return;
  }

  if (base === "pay" && p[1]) {
    $app.innerHTML = renderPay(p[1]);
    $app.classList.remove("page-enter");
    void $app.offsetWidth;
    $app.classList.add("page-enter");
    return;
  }

  if (base === "orders") {
    $app.innerHTML = renderOrders();
    $app.classList.remove("page-enter");
    void $app.offsetWidth;
    $app.classList.add("page-enter");
    return;
  }

  if (base === "track" && p[1]) {
    $app.innerHTML = renderTrack(p[1]);
    $app.classList.remove("page-enter");
    void $app.offsetWidth;
    $app.classList.add("page-enter");
    return;
  }

  if (base === "admin") {
    $app.innerHTML = renderAdmin();
    $app.classList.remove("page-enter");
    void $app.offsetWidth;
    $app.classList.add("page-enter");
    return;
  }

  if (base === "cashier") {
    $app.innerHTML = renderCashier();
    $app.classList.remove("page-enter");
    void $app.offsetWidth;
    $app.classList.add("page-enter");
    return;
  }

  if (base === "kitchen") {
    $app.innerHTML = renderKitchen();
    $app.classList.remove("page-enter");
    void $app.offsetWidth;
    $app.classList.add("page-enter");
    return;
  }

  $app.innerHTML = renderNotFound("Halaman tidak tersedia");
  $app.classList.remove("page-enter");
  void $app.offsetWidth;
  $app.classList.add("page-enter");
};

const buildVariantTextFromForm = (form, menu) => {
  const parts = [];
  const variants = menu.variants || [];
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    const value = form[`v${i}`]?.value ?? "";
    if (value) parts.push(`${v.name}: ${value}`);
  }
  return parts.join(", ");
};

const buildVariantTextFromSelections = (menu, selections) => {
  const parts = [];
  const variants = menu.variants || [];
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    const selected = selections && selections[i] != null ? `${selections[i]}` : `${(v.values || [])[0] || ""}`;
    if (selected) parts.push(`${v.name}: ${selected}`);
  }
  return parts.join(", ");
};

const parseVariantsInput = (raw) => {
  const text = `${raw || ""}`.trim();
  if (!text) return [];
  const blocks = text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const variants = [];
  for (const b of blocks) {
    const [namePart, valuesPart] = b.split(":");
    const name = (namePart || "").trim();
    const values = (valuesPart || "")
      .split("|")
      .map((v) => v.trim())
      .filter(Boolean);
    if (name && values.length) variants.push({ name, values });
  }
  return variants;
};

const openTicketWindow = ({ title, order }) => {
  const items = order.items || [];
  const meta = order.method === "dinein" ? `Meja ${order.tableNumber || "-"}` : "Takeaway";

  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${title}</title>
      <style>
        body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;margin:18px;color:#0f172a}
        .mono{font-family:${state && state ? "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace" : "monospace"}}
        h1{font-size:18px;margin:0 0 6px}
        .sub{color:#334155;font-size:12px;margin-bottom:12px}
        .box{border:1px solid #cbd5e1;border-radius:12px;padding:12px}
        .row{display:flex;justify-content:space-between;gap:12px}
        .item{padding:10px 0;border-bottom:1px dashed #cbd5e1}
        .item:last-child{border-bottom:none}
        .small{font-size:12px;color:#334155}
        .btn{margin-top:12px;padding:10px 12px;border-radius:10px;border:1px solid #94a3b8;background:#0f172a;color:#fff;cursor:pointer}
      </style>
    </head>
    <body>
      <div class="box">
        <div class="row">
          <div>
            <h1>${title}</h1>
            <div class="sub">Kode: <span class="mono">${order.code}</span> · ${meta}</div>
          </div>
          <div class="sub">${new Date(order.paidAt || order.createdAt).toLocaleString("id-ID")}</div>
        </div>
        ${order.orderNote ? `<div class="small"><b>Catatan:</b> ${order.orderNote}</div>` : ""}
        <div style="margin-top:10px"></div>
        ${items
          .map(
            (it) => `
              <div class="item">
                <div class="row">
                  <div><b>${it.name}</b> <span class="small">(${it.category === "drink" ? "Minuman" : "Makanan"})</span></div>
                  <div class="mono">x ${it.qty}</div>
                </div>
                <div class="small">${it.variantText ? `${it.variantText}<br/>` : ""}${it.itemNote ? `Catatan item: ${it.itemNote}` : ""}</div>
              </div>
            `
          )
          .join("")}
      </div>
      <button class="btn" onclick="window.print()">Print</button>
    </body>
  </html>`;

  const w = window.open("", "_blank", "width=460,height=740");
  if (!w) {
    toast("Pop-up diblokir browser");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
};

const openReceiptWindow = ({ order }) => {
  const totals = orderTotals(order);
  const meta = order.method === "dinein" ? `Meja ${order.tableNumber || "-"}` : "Takeaway";
  const paidAt = order.paidAt || order.createdAt;
  const payType = paymentTypeLabel(order.paymentType) || "-";
  const items = order.items || [];

  const rows = items
    .map((it) => {
      const lineTotal = (it.price || 0) * (it.qty || 0);
      return `
        <tr>
          <td>
            <div style="font-weight:700">${it.name}</div>
            <div class="small">${it.variantText ? `${it.variantText}<br/>` : ""}${it.itemNote ? `Catatan: ${it.itemNote}` : ""}</div>
          </td>
          <td class="mono" style="text-align:right">${it.qty}</td>
          <td class="mono" style="text-align:right">${formatIdr(it.price)}</td>
          <td class="mono" style="text-align:right">${formatIdr(lineTotal)}</td>
        </tr>
      `;
    })
    .join("");

  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Struk</title>
      <style>
        body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;margin:18px;color:#0f172a}
        .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace}
        .box{border:1px solid #cbd5e1;border-radius:12px;padding:12px}
        h1{font-size:18px;margin:0}
        .sub{color:#334155;font-size:12px;margin-top:6px;line-height:1.4}
        .sep{height:1px;background:#cbd5e1;margin:12px 0}
        table{width:100%;border-collapse:collapse}
        th,td{padding:8px 6px;border-bottom:1px dashed #cbd5e1;vertical-align:top}
        th{font-size:12px;color:#334155;text-align:left}
        tr:last-child td{border-bottom:none}
        .small{font-size:12px;color:#334155;line-height:1.35}
        .row{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
        .btn{margin-top:12px;padding:10px 12px;border-radius:10px;border:1px solid #94a3b8;background:#0f172a;color:#fff;cursor:pointer}
      </style>
    </head>
    <body>
      <div class="box">
        <div class="row">
          <div>
            <h1>Struk Pembayaran</h1>
            <div class="sub">Kode: <span class="mono">${order.code}</span> · ${meta}</div>
            <div class="sub">Metode: <b>${payType}</b></div>
          </div>
          <div class="sub">${new Date(paidAt).toLocaleString("id-ID")}</div>
        </div>
        ${order.orderNote ? `<div class="sep"></div><div class="small"><b>Catatan Pesanan:</b> ${order.orderNote}</div>` : ""}
        <div class="sep"></div>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th style="text-align:right">Qty</th>
              <th style="text-align:right">Harga</th>
              <th style="text-align:right">Total</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="sep"></div>
        <div class="row">
          <div class="small">Total</div>
          <div class="mono"><b>${formatIdr(totals.subtotal)}</b></div>
        </div>
      </div>
      <button class="btn" onclick="window.print()">Print</button>
    </body>
  </html>`;

  const w = window.open("", "_blank", "width=520,height=740");
  if (!w) {
    toast("Pop-up diblokir browser");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
};

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  const nav = btn.getAttribute("data-nav");
  if (nav) {
    setHash(nav);
    return;
  }

  const action = btn.getAttribute("data-action");
  if (!action) return;

  if (action === "toggle-sound") {
    const role = btn.getAttribute("data-role") || state.auth.role || "guest";
    const prev = Boolean(state.ui?.sound?.[role]);
    state.ui.sound = { ...(state.ui.sound || {}), [role]: !prev };
    saveState(state);
    renderNav();
    if (!prev) {
      await ensureSound();
      playBeep();
      dbgReport("sound:enabled", { role, audioState: audioCtx?.state || null }, { hypothesisId: "D", runId: "pre" });
      toast("Suara notifikasi aktif");
    } else {
      dbgReport("sound:disabled", { role }, { hypothesisId: "D", runId: "pre" });
      toast("Suara notifikasi mati");
    }
    return;
  }

  if (action === "test-sound") {
    const role = btn.getAttribute("data-role") || state.auth.role || "guest";
    await ensureSound();
    playBeep();
    dbgReport("sound:test", { role, audioState: audioCtx?.state || null }, { hypothesisId: "D", runId: "pre" });
    toast("Tes bunyi diputar");
    return;
  }

  if (action === "reset") {
    setHash("#/");
    resetDemo();
    return;
  }

  if (action === "logout") {
    setHash("#/");
    setRole("guest");
    toast("Logout");
    return;
  }

  if (action === "set-method") {
    const method = btn.getAttribute("data-method");
    state.session.method = method === "takeaway" ? "takeaway" : "dinein";
    if (state.session.method === "takeaway") state.session.tableNumber = "";
    saveState(state);
    render();
    return;
  }

  if (action === "set-method-go") {
    const method = btn.getAttribute("data-method");
    const go = btn.getAttribute("data-go") || "#/";
    state.session.method = method === "takeaway" ? "takeaway" : "dinein";
    if (state.session.method === "takeaway") state.session.tableNumber = "";
    saveState(state);
    setHash(go);
    render();
    return;
  }

  if (action === "open-add") {
    const menuId = btn.getAttribute("data-menu");
    state.ui.addingMenuId = menuId;
    const menu = menuById(menuId);
    const selections = {};
    (menu?.variants || []).forEach((v, idx) => {
      selections[idx] = (v.values || [])[0] || "";
    });
    state.ui.addingVariantSelections = selections;
    saveState(state);
    render();
    return;
  }

  if (action === "close-add") {
    state.ui.addingMenuId = null;
    state.ui.addingVariantSelections = {};
    saveState(state);
    render();
    return;
  }

  if (action === "variant-pick") {
    const idx = Number(btn.getAttribute("data-idx") || "0");
    const value = btn.getAttribute("data-value") || "";
    state.ui.addingVariantSelections = { ...(state.ui.addingVariantSelections || {}), [idx]: value };
    saveState(state);
    render();
    return;
  }

  if (action === "qty") {
    const key = btn.getAttribute("data-key");
    const delta = Number(btn.getAttribute("data-delta") || "0");
    changeCartQty(key, delta);
    return;
  }

  if (action === "remove-line") {
    const key = btn.getAttribute("data-key");
    const idx = state.session.cart.findIndex((l) => l.key === key);
    if (idx >= 0) state.session.cart.splice(idx, 1);
    saveState(state);
    render();
    return;
  }

  if (action === "clear-cart") {
    clearCart();
    toast("Keranjang dikosongkan");
    return;
  }

  if (action === "create-order") {
    const order = await createOrderFromSession();
    if (!order) return;
    toast("Pesanan masuk ke dapur. Pantau status pesanan.");
    setHash(`#/track/${order.id}`);
    return;
  }

  if (action === "set-cashier-method") {
    const order = findOrder(btn.getAttribute("data-order"));
    if (!order) return;
    if (order.paymentStatus === "PAID") return;
    order.paymentMethod = "CASHIER";
    if (isRealtimeEnabled()) await rtUpdateOrder(order.id, { paymentMethod: "CASHIER" });
    saveState(state);
    render();
    toast("Silakan bayar di kasir dengan kode pesanan");
    return;
  }

  if (action === "pay-online") {
    const order = findOrder(btn.getAttribute("data-order"));
    if (!order) return;
    if (order.paymentStatus === "PAID") return;
    if (isRealtimeEnabled()) {
      order.paymentMethod = "ONLINE";
      order.paymentType = "QRIS";
      order.paymentStatus = "PAID";
      order.paidAt = nowIso();
      await rtUpdateOrder(order.id, {
        paymentMethod: "ONLINE",
        paymentType: "QRIS",
        paymentStatus: "PAID",
        paidAt: nowIso(),
      });
      saveState(state);
      render();
    } else {
      const res = applyPaymentPaid(order, "ONLINE", "QRIS");
      if (!res.ok) {
        window.alert(`Stok tidak cukup:\n- ${res.issues.join("\n- ")}`);
        return;
      }
    }
    toast("Pembayaran sukses. Pesanan masuk ke Dapur.");
    setHash(`#/track/${order.id}`);
    return;
  }

  if (action === "cashier-pay") {
    const order = findOrder(btn.getAttribute("data-order"));
    if (!order) return;
    if (order.paymentStatus === "PAID") return;
    const payType = btn.getAttribute("data-paytype") || "TUNAI";
    const payLabel = paymentTypeLabel(payType) || payType;
    const ok = window.confirm(`Konfirmasi pembayaran ${payLabel} untuk kode ${order.code}?`);
    if (!ok) return;
    if (isRealtimeEnabled()) {
      order.paymentMethod = "CASHIER";
      order.paymentType = payType;
      order.paymentStatus = "PAID";
      order.paidAt = nowIso();
      await rtUpdateOrder(order.id, {
        paymentMethod: "CASHIER",
        paymentType: payType,
        paymentStatus: "PAID",
        paidAt: nowIso(),
      });
    } else {
      const res = applyPaymentPaid(order, "CASHIER", payType);
      if (!res.ok) {
        window.alert(`Stok tidak cukup:\n- ${res.issues.join("\n- ")}`);
        return;
      }
    }
    state.ui.cashierQrisOrderId = null;
    saveState(state);
    toast("Pembayaran dikonfirmasi. Tiket masuk ke Dapur.");
    openReceiptWindow({ order });
    setHash("#/cashier");
    return;
  }

  if (action === "cashier-show-qris") {
    const order = findOrder(btn.getAttribute("data-order"));
    if (!order) return;
    if (order.paymentStatus === "PAID") return;
    state.ui.cashierQrisOrderId = order.id;
    saveState(state);
    render();
    return;
  }

  if (action === "cashier-close-qris") {
    state.ui.cashierQrisOrderId = null;
    saveState(state);
    render();
    return;
  }

  if (action === "print-receipt") {
    const order = findOrder(btn.getAttribute("data-order"));
    if (!order) return;
    if (order.paymentStatus !== "PAID") return;
    openReceiptWindow({ order });
    return;
  }

  if (action === "cancel-order") {
    const order = findOrder(btn.getAttribute("data-order"));
    if (!order) return;
    if (order.paymentStatus === "PAID") return;
    const ok = window.confirm("Batalkan pesanan ini?");
    if (!ok) return;
    if (isRealtimeEnabled()) {
      try {
        await rtCancelOrder(order.id);
      } catch {
        toast("Gagal membatalkan");
        return;
      }
    } else {
      restoreStockForOrderIfNeeded(order);
    }
    state.ui.cashierQrisOrderId = state.ui.cashierQrisOrderId === order.id ? null : state.ui.cashierQrisOrderId;
    order.status = "CANCELLED";
    saveState(state);
    render();
    toast("Pesanan dibatalkan");
    return;
  }

  if (action === "seed-menu") {
    if (isRealtimeEnabled()) {
      await rtSeedMenu();
      toast("Menu default dikirim ke server");
    } else {
      state.menu = defaultMenu();
      saveState(state);
      render();
      toast("Menu direset ke default");
    }
    return;
  }

  if (action === "admin-edit-image") {
    const menuId = btn.getAttribute("data-menu");
    const m = menuById(menuId);
    if (!m) return;
    state.ui.adminImageMenuId = m.id;
    saveState(state);
    render();
    return;
  }

  if (action === "admin-close-image") {
    state.ui.adminImageMenuId = null;
    saveState(state);
    render();
    return;
  }

  if (action === "admin-remove-image") {
    const m = menuById(btn.getAttribute("data-menu"));
    if (!m) return;
    m.image = null;
    if (isRealtimeEnabled()) await rtUpdateMenu(m.id, { image: null });
    state.ui.adminImageMenuId = null;
    saveState(state);
    render();
    toast("Gambar dihapus");
    return;
  }

  if (action === "admin-save-image") {
    const m = menuById(btn.getAttribute("data-menu"));
    if (!m) return;

    const urlEl = document.getElementById("admin-image-url");
    const fileEl = document.getElementById("admin-image-file");
    const url = urlEl instanceof HTMLInputElement ? `${urlEl.value || ""}`.trim() : "";
    const file = fileEl instanceof HTMLInputElement ? fileEl.files?.[0] || null : null;

    const cfg = githubSettings();
    let image = url;
    let dataUrl = "";
    try {
      if (file) dataUrl = await imageFileToDataUrl(file);
      else if (url && cfg.enabled) dataUrl = await imageUrlToDataUrl(url);
    } catch (err) {
      toast(err?.message || "Gagal memproses gambar");
      return;
    }

    if (dataUrl) {
      try {
        const up = await uploadMenuImageToGithubAssetsIfEnabled({ menuId: m.id, dataUrl });
        if (up.ok) image = up.assetPath;
        else image = dataUrl;
      } catch {
        image = dataUrl;
        toast("Upload ke GitHub gagal, pakai gambar lokal dulu");
      }
    }

    if (!image) {
      toast("Isi URL atau upload gambar");
      return;
    }

    m.image = image;
    if (isRealtimeEnabled()) await rtUpdateMenu(m.id, { image: m.image });
    state.ui.adminImageMenuId = null;
    saveState(state);
    render();
    toast("Gambar diperbarui");
    return;
  }

  if (action === "github-clear-token") {
    setGithubToken("");
    toast("Token dihapus");
    render();
    return;
  }

  if (action === "set-stock") {
    const m = menuById(btn.getAttribute("data-menu"));
    if (!m) return;
    const stock = Number(btn.getAttribute("data-stock") || "0");
    m.stock = Math.max(0, stock);
    if (isRealtimeEnabled()) await rtUpdateMenu(m.id, { stock: m.stock });
    saveState(state);
    render();
    toast("Stok diperbarui");
    return;
  }

  if (action === "add-stock") {
    const m = menuById(btn.getAttribute("data-menu"));
    if (!m) return;
    const add = Number(window.prompt(`Tambah stok untuk ${m.name}:`, "10") || "0");
    if (!Number.isFinite(add) || add <= 0) return;
    m.stock = Math.max(0, Number(m.stock ?? 0) + add);
    if (isRealtimeEnabled()) await rtUpdateMenu(m.id, { stock: m.stock });
    saveState(state);
    render();
    toast("Stok ditambah");
    return;
  }

  if (action === "edit-menu") {
    const m = menuById(btn.getAttribute("data-menu"));
    if (!m) return;
    const name = window.prompt("Nama menu:", m.name);
    if (!name) return;
    const price = Number(window.prompt("Harga (angka):", `${m.price}`) || `${m.price}`);
    if (!Number.isFinite(price) || price < 0) return;
    const stock = Number(window.prompt("Stok (angka):", `${m.stock ?? 0}`) || `${m.stock ?? 0}`);
    if (!Number.isFinite(stock) || stock < 0) return;
    const variantsToText = (variants) =>
      (variants || [])
        .map((v) => `${(v?.name || "").trim()}:${(v?.values || []).map((vv) => `${vv}`.trim()).filter(Boolean).join("|")}`)
        .filter((s) => s.includes(":") && !s.endsWith(":"))
        .join(", ");
    const variantsRaw = window.prompt("Variasi (opsional). Format: Nama:opsi1|opsi2, Nama2:opsi1|opsi2", variantsToText(m.variants));
    if (variantsRaw == null) return;
    const variants = parseVariantsInput(variantsRaw);
    const imageRaw = window.prompt("Gambar (URL). Kosongkan untuk hapus:", m.image || "");
    if (imageRaw == null) return;
    m.name = name.trim();
    m.price = Math.round(price);
    m.stock = Math.round(stock);
    m.variants = variants;
    m.image = `${imageRaw}`.trim() || null;
    if (isRealtimeEnabled())
      await rtUpdateMenu(m.id, { name: m.name, price: m.price, stock: m.stock, variants: m.variants, image: m.image });
    saveState(state);
    render();
    toast("Menu diperbarui");
    return;
  }

  if (action === "edit-variants") {
    const m = menuById(btn.getAttribute("data-menu"));
    if (!m) return;
    const variantsToText = (variants) =>
      (variants || [])
        .map((v) => `${(v?.name || "").trim()}:${(v?.values || []).map((vv) => `${vv}`.trim()).filter(Boolean).join("|")}`)
        .filter((s) => s.includes(":") && !s.endsWith(":"))
        .join(", ");
    const raw = window.prompt("Variasi (opsional). Format: Nama:opsi1|opsi2, Nama2:opsi1|opsi2", variantsToText(m.variants));
    if (raw == null) return;
    m.variants = parseVariantsInput(raw);
    if (isRealtimeEnabled()) await rtUpdateMenu(m.id, { variants: m.variants });
    saveState(state);
    render();
    toast("Variasi diperbarui");
    return;
  }

  if (action === "delete-menu") {
    const menuId = btn.getAttribute("data-menu");
    const m = menuById(menuId);
    if (!m) return;
    const ok = window.confirm(`Hapus menu "${m.name}"?`);
    if (!ok) return;
    const idx = state.menu.findIndex((x) => x.id === menuId);
    if (idx >= 0) state.menu.splice(idx, 1);
    state.session.cart = state.session.cart.filter((l) => l.menuId !== menuId);
    if (isRealtimeEnabled()) {
      try {
        await rtDeleteMenu(menuId);
      } catch {
        toast("Gagal hapus menu di server");
      }
    }
    saveState(state);
    render();
    toast("Menu dihapus");
    return;
  }

  if (action === "view-order") {
    const order = findOrder(btn.getAttribute("data-order"));
    if (!order) return;
    const title = btn.getAttribute("data-title") || "Detail Pesanan";
    openTicketWindow({ title, order });
    return;
  }

  if (action === "print-ticket") {
    const order = findOrder(btn.getAttribute("data-order"));
    if (!order) return;
    const title = "Tiket Dapur";
    openTicketWindow({ title, order });

    const t = nowIso();
    order.kitchen = { ...(order.kitchen || {}), printedAt: t };

    updateOrderStatusFromStations(order);
    if (isRealtimeEnabled()) await rtUpdateOrder(order.id, { kitchen: order.kitchen, status: order.status });
    saveState(state);
    render();
    toast("Tiket dibuka");
    return;
  }

  if (action === "station-start") {
    const order = findOrder(btn.getAttribute("data-order"));
    if (!order) return;
    if (order.status === "CANCELLED" || order.status === "COMPLETED") return;
    const prev = order.kitchen || { printedAt: null, startedAt: null, doneAt: null };
    const nextStartedAt = prev.startedAt ? null : nowIso();
    const nextDoneAt = nextStartedAt ? null : prev.doneAt;
    order.kitchen = { ...prev, startedAt: nextStartedAt, doneAt: nextDoneAt };
    updateOrderStatusFromStations(order);
    if (isRealtimeEnabled()) await rtUpdateOrder(order.id, { kitchen: order.kitchen, status: order.status });
    saveState(state);
    render();
    toast(order.kitchen.startedAt ? "Pesanan dimulai" : "Mulai dibatalkan");
    return;
  }

  if (action === "station-done") {
    const order = findOrder(btn.getAttribute("data-order"));
    if (!order) return;
    if (order.status === "CANCELLED" || order.status === "COMPLETED") return;
    const prev = order.kitchen || { printedAt: null, startedAt: null, doneAt: null };
    const nextDoneAt = prev.doneAt ? null : nowIso();
    const nextStartedAt = nextDoneAt ? prev.startedAt || nowIso() : prev.startedAt;
    order.kitchen = { ...prev, startedAt: nextStartedAt, doneAt: nextDoneAt };

    updateOrderStatusFromStations(order);
    if (isRealtimeEnabled()) await rtUpdateOrder(order.id, { kitchen: order.kitchen, status: order.status });
    saveState(state);
    render();
    toast(order.kitchen.doneAt ? "Ditandai selesai" : "Status selesai dibatalkan");
    return;
  }
});

document.addEventListener("input", (e) => {
  const el = e.target;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
  const field = el.getAttribute("data-field");
  if (!field) return;

  if (field === "tableNumber") state.session.tableNumber = el.value;
  if (field === "orderNote") state.session.orderNote = el.value;
  saveState(state);
  renderNav();
});

document.addEventListener("submit", async (e) => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;

  const type = form.getAttribute("data-form");
  if (!type) return;

  e.preventDefault();

  if (type === "add-to-cart") {
    const menuId = form.menuId.value;
    const menu = menuById(menuId);
    if (!menu) return;
    const qty = Math.max(1, Number(form.qty.value || "1"));
    const variantText = buildVariantTextFromSelections(menu, state.ui.addingVariantSelections || {});
    const itemNote = `${form.itemNote.value || ""}`.trim();
    state.ui.addingMenuId = null;
    state.ui.addingVariantSelections = {};
    saveState(state);
    upsertCartLine({ menuId, variantText, itemNote, qtyDelta: qty });
    toast("Ditambahkan ke keranjang");
    return;
  }

  if (type === "create-menu") {
    const name = `${form.name.value || ""}`.trim();
    const category = form.category.value === "drink" ? "drink" : "food";
    const price = Number(form.price.value || "0");
    const stock = Number(form.stock.value || "0");
    const variants = parseVariantsInput(form.variants.value);
    const imageUrl = `${form.imageUrl?.value || ""}`.trim();
    const imageFile = form.imageFile instanceof HTMLInputElement ? form.imageFile.files?.[0] || null : null;
    if (!name) return;
    if (!Number.isFinite(price) || price < 0) return;
    if (!Number.isFinite(stock) || stock < 0) return;

    const base = name.replace(/[^a-z0-9]+/gi, "").toUpperCase().slice(0, 16) || "MENU";
    const id = `M-${base}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    const cfg = githubSettings();
    let image = imageUrl;
    let dataUrl = "";
    try {
      if (imageFile) dataUrl = await imageFileToDataUrl(imageFile);
      else if (imageUrl && cfg.enabled) dataUrl = await imageUrlToDataUrl(imageUrl);
    } catch (err) {
      toast(err?.message || "Gagal memproses gambar");
      return;
    }
    if (dataUrl) {
      try {
        const up = await uploadMenuImageToGithubAssetsIfEnabled({ menuId: id, dataUrl });
        if (up.ok) image = up.assetPath;
        else image = dataUrl;
      } catch {
        image = dataUrl;
        toast("Upload ke GitHub gagal, pakai gambar lokal dulu");
      }
    }
    const menu = { id, name, category, price: Math.round(price), stock: Math.round(stock), variants, ...(image ? { image } : {}) };
    state.menu.push(menu);
    if (isRealtimeEnabled()) await rtSetMenu(menu);
    saveState(state);
    form.reset();
    render();
    toast("Menu ditambahkan");
    return;
  }

  if (type === "github-assets") {
    const enabled = Boolean(form.enabled?.checked);
    const owner = `${form.owner?.value || ""}`.trim();
    const repo = `${form.repo?.value || ""}`.trim();
    const branch = `${form.branch?.value || ""}`.trim() || "main";
    const token = `${form.token?.value || ""}`.trim();

    state.settings = {
      ...(state.settings || {}),
      github: { enabled, owner, repo, branch },
    };
    if (token) setGithubToken(token);
    saveState(state);
    form.token.value = "";
    render();
    toast("Pengaturan GitHub disimpan");
    return;
  }

  if (type === "cashier-find") {
    const code = `${form.code.value || ""}`.trim().toUpperCase();
    if (!code) return;
    const order = state.orders.find((o) => o.code === code);
    if (!order) {
      toast("Kode tidak ditemukan");
      return;
    }
    setHash(`#/pay/${order.id}`);
    return;
  }
});

window.addEventListener("hashchange", () => render());
window.addEventListener("storage", (e) => {
  if (e.key !== STORAGE_KEY) return;
  state = loadState();
  render();
});

if (!location.hash) location.hash = "#/";
render();
if (!isRealtimeEnabled()) {
  toast("Mode lokal: antar perangkat tidak sinkron");
}
initRealtime();
