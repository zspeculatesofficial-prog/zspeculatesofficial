/* ZSPECULATES - Supabase-backed static site */

const STORAGE_KEY = "zspeculates-site-data";
const ADMIN_SESSION_KEY = "zspeculates-admin-unlocked";
const ADMIN_PASSWORD_KEY = "zspeculates-admin-password-hash";
const DEFAULT_ADMIN_PASSWORD_HASH = "d1a1027be663404df1450dfd048855ddafdaf44c0e93b0f3bb22cbf378adf4bc";
const isAdminMode = new URLSearchParams(window.location.search).get("admin") === "1";
const supabaseConfig = window.SUPABASE_CONFIG || {};
const supabaseReady = Boolean(supabaseConfig.url && supabaseConfig.anonKey && window.supabase);
const supabaseClient = supabaseReady
  ? window.supabase.createClient(supabaseConfig.url, supabaseConfig.anonKey)
  : null;

const defaults = {
  profile: {
    brand: window.SITE_PROFILE?.brand || "ZSPECULATES",
    xUrl: window.SITE_PROFILE?.xUrl || "https://x.com/z_speculates",
    youtubeUrl: window.SITE_PROFILE?.youtubeUrl || "https://www.youtube.com/@zspeculates",
    avatar: window.SITE_PROFILE?.avatar || "images/zspeculates-logo-light.png"
  },
  trades: Array.isArray(window.DEFAULT_TRADES) ? window.DEFAULT_TRADES : []
};

let siteData = loadLocalData();
let pendingAvatar = "";
let pendingAvatarFile = null;
let pendingTradeImage = "";
let pendingTradeImageFile = null;
let isAdminUnlocked = false;

function loadLocalData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return structuredClone(defaults);
    return {
      profile: normalizeProfile({ ...defaults.profile, ...(saved.profile || {}) }),
      trades: Array.isArray(saved.trades) ? saved.trades : defaults.trades
    };
  } catch {
    return structuredClone(defaults);
  }
}

function normalizeProfile(profile) {
  if (!profile.avatar || profile.avatar === "images/avatar.jpg") {
    profile.avatar = defaults.profile.avatar;
  }
  return profile;
}

async function loadRemoteData() {
  if (!supabaseClient) return;

  const [{ data: profile, error: profileError }, { data: trades, error: tradesError }] = await Promise.all([
    supabaseClient.from("site_profile").select("*").eq("id", true).maybeSingle(),
    supabaseClient.from("trades").select("*").order("week", { ascending: false })
  ]);

  if (profileError) console.warn("Profile load failed:", profileError.message);
  if (tradesError) console.warn("Trades load failed:", tradesError.message);

  if (profile) {
    siteData.profile = normalizeProfile({
      brand: profile.brand,
      xUrl: profile.x_url,
      youtubeUrl: profile.youtube_url,
      avatar: profile.avatar_url
    });
  }

  if (Array.isArray(trades)) {
    siteData.trades = trades.map(fromDbTrade);
  }

  saveLocalData();
}

function saveLocalData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(siteData));
}

async function saveProfileData() {
  saveLocalData();
  if (!supabaseClient || !isAdminUnlocked) return;

  const { brand, xUrl, youtubeUrl, avatar } = siteData.profile;
  const { error } = await supabaseClient.from("site_profile").upsert({
    id: true,
    brand,
    x_url: xUrl,
    youtube_url: youtubeUrl,
    avatar_url: avatar,
    updated_at: new Date().toISOString()
  });

  if (error) throw error;
}

async function saveTradeData(trade) {
  saveLocalData();
  if (!supabaseClient || !isAdminUnlocked) return;

  const { error } = await supabaseClient.from("trades").upsert(toDbTrade(trade), {
    onConflict: "week"
  });

  if (error) throw error;
}

async function deleteTradeData(week) {
  saveLocalData();
  if (!supabaseClient || !isAdminUnlocked) return;

  const { error } = await supabaseClient.from("trades").delete().eq("week", Number(week));
  if (error) throw error;
}

function toDbTrade(trade) {
  return {
    week: Number(trade.week),
    dates: trade.dates,
    pair: trade.pair,
    direction: trade.direction,
    result: trade.result,
    rr: trade.rr,
    analysis: trade.analysis || [],
    updated_at: new Date().toISOString()
  };
}

function fromDbTrade(trade) {
  return {
    week: trade.week,
    dates: trade.dates,
    pair: trade.pair,
    direction: trade.direction,
    result: trade.result,
    rr: trade.rr,
    analysis: trade.analysis || []
  };
}

function goTo(id) {
  if ((id === "screen-admin-login" || id === "screen-manage") && !isAdminMode) {
    id = "screen-menu";
  }
  if (id === "screen-manage" && !isAdminUnlocked) {
    id = "screen-admin-login";
  }

  document.querySelectorAll(".screen").forEach(screen => screen.classList.remove("active"));
  const target = document.getElementById(id);
  if (target) {
    target.classList.add("active");
    target.scrollTop = 0;
  }
}

function renderEverything() {
  document.body.classList.toggle("is-admin-mode", isAdminMode);
  document.body.classList.toggle("is-admin-unlocked", isAdminUnlocked);
  renderSaveMode();
  renderProfile();
  renderList();
  renderManageTrades();
  fillProfileForm();
}

function renderSaveMode() {
  const note = document.getElementById("save-mode-note");
  if (!note) return;
  note.textContent = supabaseReady
    ? "Saved online with Supabase"
    : "Supabase not configured - saved in this browser";
}

function renderProfile() {
  const { brand, xUrl, youtubeUrl, avatar } = siteData.profile;
  const title = document.getElementById("brand-title");
  const xLink = document.getElementById("profile-x-link");
  const youtubeLink = document.getElementById("profile-youtube-link");
  const img = document.getElementById("avatar-img");
  const hasLogoImage = Boolean(avatar);

  if (title) title.textContent = brand || "ZSPECULATES";
  if (xLink) xLink.href = xUrl || "#";
  if (youtubeLink) youtubeLink.href = youtubeUrl || "#";
  if (img) img.src = avatar || defaults.profile.avatar;
  document.body.classList.toggle("has-logo-image", hasLogoImage);
}

function renderList() {
  const container = document.getElementById("entries-list");
  if (!container) return;

  if (!siteData.trades.length) {
    container.innerHTML = `
      <div class="empty-state">
        Track record updates coming soon
      </div>`;
    return;
  }

  const sorted = [...siteData.trades].sort((a, b) => Number(b.week) - Number(a.week));
  container.innerHTML = sorted.map(trade => `
    <div class="entry-row" onclick="openDetail(${Number(trade.week)})">
      <span class="entry-week">${escapeHTML(trade.week)}</span>
      <div class="entry-mid">
        <span class="entry-dates">${escapeHTML(trade.dates)}</span>
        <span class="entry-pair">${escapeHTML(trade.pair)} &nbsp;${escapeHTML(trade.rr)}</span>
      </div>
      <div class="entry-result">
        <span class="badge badge-${String(trade.result).toLowerCase()}">${escapeHTML(trade.result)}</span>
      </div>
      <span class="entry-arrow">→</span>
    </div>
  `).join("");
}

function openDetail(weekNum) {
  const trade = siteData.trades.find(item => Number(item.week) === Number(weekNum));
  if (!trade) return;

  const analysisHTML = (trade.analysis || []).map(block => `
    <div class="analysis-block">
      <p class="analysis-tf">${escapeHTML(block.tf || "›Execution")}</p>
      ${block.img ? `<img class="analysis-img" src="${block.img}" alt="${escapeHTML(block.tf || "Chart")}" loading="lazy" />` : ""}
      ${block.text ? `<p class="analysis-text">${escapeHTML(block.text)}</p>` : ""}
    </div>
  `).join("");

  document.getElementById("detail-content").innerHTML = `
    <div class="detail-header">
      ${detailMeta("Week", trade.week)}
      ${detailMeta("Pair", trade.pair)}
      ${detailMeta("Direction", trade.direction)}
      ${detailMeta("Result", trade.result, String(trade.result).toLowerCase())}
      ${detailMeta("R:R", trade.rr)}
      ${detailMeta("Dates", trade.dates, "detail-date")}
    </div>
    ${analysisHTML || '<p class="analysis-text empty-detail">No breakdown added yet.</p>'}
  `;

  goTo("screen-detail");
}

function detailMeta(label, value, extraClass = "") {
  return `
    <div class="detail-meta-item">
      <span class="detail-label">${label}</span>
      <span class="detail-value ${extraClass}">${escapeHTML(value || "")}</span>
    </div>
  `;
}

function setupAvatarFallback() {
  const img = document.getElementById("avatar-img");
  if (!img) return;
  img.onerror = () => {
    if (siteData.profile.avatar) return;
    const initial = (siteData.profile.brand || "Z").trim().charAt(0).toUpperCase();
    img.src = `data:image/svg+xml,${encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
        <rect width="120" height="120" rx="60" fill="#e2e4e2"/>
        <text x="60" y="73" text-anchor="middle" font-size="42" font-family="Georgia" fill="#5a5e5a">${initial}</text>
      </svg>
    `)}`;
  };
}

function fillProfileForm() {
  setValue("profile-brand", siteData.profile.brand);
  setValue("profile-x", siteData.profile.xUrl);
  setValue("profile-youtube", siteData.profile.youtubeUrl);
}

function setupProfileForm() {
  const form = document.getElementById("profile-form");
  const avatarInput = document.getElementById("profile-avatar");
  const clearAvatar = document.getElementById("clear-avatar-btn");
  if (!form) return;

  avatarInput?.addEventListener("change", async event => {
    pendingAvatarFile = event.target.files?.[0] || null;
    pendingAvatar = await readImageFile(pendingAvatarFile);
  });

  clearAvatar?.addEventListener("click", async () => {
    siteData.profile.avatar = defaults.profile.avatar;
    pendingAvatar = "";
    pendingAvatarFile = null;
    try {
      await saveProfileData();
      renderProfile();
    } catch (error) {
      alert(`Could not clear image: ${error.message}`);
    }
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    try {
      const avatar = await resolveUploadedImage("profile", pendingAvatarFile, pendingAvatar || siteData.profile.avatar);
      siteData.profile = {
        ...siteData.profile,
        brand: getValue("profile-brand") || "ZSPECULATES",
        xUrl: getValue("profile-x") || "#",
        youtubeUrl: getValue("profile-youtube") || "#",
        avatar
      };
      pendingAvatar = "";
      pendingAvatarFile = null;
      await saveProfileData();
      renderEverything();
    } catch (error) {
      alert(`Could not save profile: ${error.message}`);
    }
  });
}

function setupAdminLogin() {
  const form = document.getElementById("admin-login-form");
  const input = document.getElementById("admin-password");
  const error = document.getElementById("admin-login-error");
  if (!form) return;

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const password = input?.value || "";

    try {
      if (supabaseClient) {
        const { error: authError } = await supabaseClient.auth.signInWithPassword({
          email: supabaseConfig.adminEmail,
          password
        });
        if (authError) throw authError;
      } else {
        const hash = await sha256(password);
        const savedHash = localStorage.getItem(ADMIN_PASSWORD_KEY) || DEFAULT_ADMIN_PASSWORD_HASH;
        if (hash !== savedHash) throw new Error("Wrong password.");
      }

      sessionStorage.setItem(ADMIN_SESSION_KEY, "1");
      isAdminUnlocked = true;
      if (error) error.textContent = "";
      if (input) input.value = "";
      renderEverything();
      goTo("screen-manage");
    } catch (loginError) {
      if (error) error.textContent = loginError.message || "Wrong password.";
    }
  });
}

function setupPasswordForm() {
  const form = document.getElementById("password-form");
  const input = document.getElementById("new-admin-password");
  const message = document.getElementById("password-save-message");
  if (!form) return;

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const password = input?.value || "";

    if (password.length < 8) {
      if (message) message.textContent = "Use at least 8 characters.";
      return;
    }

    try {
      if (supabaseClient) {
        const { error } = await supabaseClient.auth.updateUser({ password });
        if (error) throw error;
        if (message) message.textContent = "Password saved in Supabase.";
      } else {
        localStorage.setItem(ADMIN_PASSWORD_KEY, await sha256(password));
        if (message) message.textContent = "Password saved on this browser.";
      }
      if (input) input.value = "";
    } catch (error) {
      if (message) message.textContent = error.message;
    }
  });
}

function setupTradeForm() {
  const form = document.getElementById("trade-form");
  const imageInput = document.getElementById("trade-image");
  const resetButton = document.getElementById("reset-trade-form-btn");
  if (!form) return;

  imageInput?.addEventListener("change", async event => {
    pendingTradeImageFile = event.target.files?.[0] || null;
    pendingTradeImage = await readImageFile(pendingTradeImageFile);
  });

  resetButton?.addEventListener("click", resetTradeForm);

  form.addEventListener("submit", async event => {
    event.preventDefault();

    try {
      const week = Number(getValue("trade-week"));
      const existingIndex = siteData.trades.findIndex(trade => Number(trade.week) === week);
      const existingTrade = existingIndex >= 0 ? siteData.trades[existingIndex] : null;
      const existingImage = existingTrade?.analysis?.[0]?.img || "";
      const text = getValue("trade-text");
      const img = await resolveUploadedImage(`trade-${week}`, pendingTradeImageFile, pendingTrade || existingImage);

      const trade = {
        week,
        dates: getValue("trade-dates"),
        pair: getValue("trade-pair"),
        direction: getValue("trade-direction"),
        result: getValue("trade-result"),
        rr: getValue("trade-rr"),
        analysis: text || img ? [{
          tf: getValue("trade-tf") || "›Execution",
          img,
          text
        }] : []
      };

      if (existingIndex >= 0) {
        siteData.trades[existingIndex] = trade;
      } else {
        siteData.trades.push(trade);
      }

      await saveTradeData(trade);
      pendingTradeImage = "";
      pendingTradeImageFile = null;
      resetTradeForm();
      renderEverything();
      goTo("screen-list");
    } catch (error) {
      alert(`Could not save trade: ${error.message}`);
    }
  });
}

async function resolveUploadedImage(prefix, file, fallback) {
  if (!file) return fallback || "";
  if (!supabaseClient || !isAdminUnlocked) return fallback || "";

  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const path = `${prefix}-${Date.now()}.${ext}`;
  const { error } = await supabaseClient.storage
    .from(supabaseConfig.storageBucket || "trade-images")
    .upload(path, file, { upsert: true, contentType: file.type });

  if (error) throw error;

  const { data } = supabaseClient.storage
    .from(supabaseConfig.storageBucket || "trade-images")
    .getPublicUrl(path);

  return data.publicUrl;
}

function renderManageTrades() {
  const container = document.getElementById("manage-trades-list");
  if (!container) return;

  if (!siteData.trades.length) {
    container.innerHTML = '<p class="manage-empty">No saved trades yet.</p>';
    return;
  }

  const sorted = [...siteData.trades].sort((a, b) => Number(b.week) - Number(a.week));
  container.innerHTML = sorted.map(trade => `
    <div class="manage-trade-row">
      <div>
        <p class="manage-trade-main">Week ${escapeHTML(trade.week)} - ${escapeHTML(trade.pair)} - ${escapeHTML(trade.rr)}</p>
        <p class="manage-trade-sub">${escapeHTML(trade.dates)} / ${escapeHTML(trade.direction)} / ${escapeHTML(trade.result)}</p>
      </div>
      <div class="manage-row-actions">
        <button type="button" onclick="editTrade(${Number(trade.week)})">Edit</button>
        <button type="button" onclick="deleteTrade(${Number(trade.week)})">Delete</button>
      </div>
    </div>
  `).join("");
}

function editTrade(week) {
  const trade = siteData.trades.find(item => Number(item.week) === Number(week));
  if (!trade) return;
  const analysis = trade.analysis?.[0] || {};

  setValue("trade-editing-week", trade.week);
  setValue("trade-week", trade.week);
  setValue("trade-dates", trade.dates);
  setValue("trade-pair", trade.pair);
  setValue("trade-rr", trade.rr);
  setValue("trade-direction", trade.direction || "Buy");
  setValue("trade-result", trade.result || "Win");
  setValue("trade-tf", analysis.tf || "›Execution");
  setValue("trade-text", analysis.text || "");
  pendingTradeImage = "";
  pendingTradeImageFile = null;
  goTo("screen-manage");
}

async function deleteTrade(week) {
  try {
    siteData.trades = siteData.trades.filter(trade => Number(trade.week) !== Number(week));
    await deleteTradeData(week);
    renderEverything();
  } catch (error) {
    alert(`Could not delete trade: ${error.message}`);
  }
}

function resetTradeForm() {
  document.getElementById("trade-form")?.reset();
  setValue("trade-tf", "›Execution");
  pendingTradeImage = "";
  pendingTradeImageFile = null;
}

function setupBackupTools() {
  document.getElementById("export-data-btn")?.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(siteData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "zspeculates-data.json";
    link.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById("import-data-input")?.addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    const imported = JSON.parse(await file.text());
    siteData = {
      profile: normalizeProfile({ ...defaults.profile, ...(imported.profile || {}) }),
      trades: Array.isArray(imported.trades) ? imported.trades : []
    };
    saveLocalData();
    renderEverything();
  });

  document.getElementById("reset-site-btn")?.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    siteData = structuredClone(defaults);
    renderEverything();
  });
}

function readImageFile(file) {
  if (!file) return Promise.resolve("");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function getValue(id) {
  return document.getElementById(id)?.value.trim() || "";
}

function setValue(id, value) {
  const element = document.getElementById(id);
  if (element) element.value = value || "";
}

document.addEventListener("DOMContentLoaded", async () => {
  setupAvatarFallback();
  setupAdminLogin();
  setupPasswordForm();
  setupProfileForm();
  setupTradeForm();
  setupBackupTools();

  if (supabaseClient) {
    const { data } = await supabaseClient.auth.getSession();
    isAdminUnlocked = isAdminMode && Boolean(data.session);
    await loadRemoteData();
  }

  renderEverything();
});
