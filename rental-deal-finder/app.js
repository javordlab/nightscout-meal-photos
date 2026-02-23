const providers = [
  { name: "Hertz", domain: "hertz.com" },
  { name: "Rentalcars", domain: "rentalcars.com" },
  { name: "DiscoverCars", domain: "discovercars.com" },
  { name: "Auto Europe", domain: "autoeurope.com" },
  { name: "Kayak", domain: "kayak.com" },
  { name: "Skyscanner", domain: "skyscanner.com" },
  { name: "Expedia", domain: "expedia.com" },
  { name: "Booking", domain: "booking.com" }
];

const ids = (id) => document.getElementById(id);
const quoteStorageKey = "rentalDealFinderQuotesV3";
const profileStorageKey = "rentalDealFinderProfileV3";
const autoStorageKey = "rentalDealFinderAutoV3";
let quotes = loadQuotes();
let huntTimer = null;

function loadProfile() {
  try { return JSON.parse(localStorage.getItem(profileStorageKey) || "{}"); } catch { return {}; }
}

function saveProfile() {
  const profile = {
    driverAge: ids("driverAge").value,
    expectedKm: Number(ids("expectedKm").value || 0),
    budgetUsd: Number(ids("budgetUsd").value || 0),
    fxUsdPerEur: Number(ids("fxUsdPerEur").value || 1.09),
    insuranceNeed: ids("insuranceNeed").value,
    prefAAA: ids("prefAAA").checked,
    prefAmex: ids("prefAmex").checked,
    prefHertz: ids("prefHertz").checked,
  };
  localStorage.setItem(profileStorageKey, JSON.stringify(profile));
}

function hydrateProfile() {
  const p = loadProfile();
  if (!Object.keys(p).length) return;
  ids("driverAge").value = p.driverAge ?? "25+";
  ids("expectedKm").value = p.expectedKm ?? 500;
  ids("budgetUsd").value = p.budgetUsd ?? 550;
  ids("fxUsdPerEur").value = p.fxUsdPerEur ?? 1.09;
  ids("insuranceNeed").value = p.insuranceNeed ?? "none";
  ids("prefAAA").checked = !!p.prefAAA;
  ids("prefAmex").checked = !!p.prefAmex;
  ids("prefHertz").checked = !!p.prefHertz;
}

function tripQuery() {
  const pickupDate = ids("pickupDate").value;
  const dropoffDate = ids("dropoffDate").value;
  const vehicleType = ids("vehicleType").value;
  const transmission = ids("transmission").value;

  // Keep search query short and robust; avoid over-constraining with timestamps/benefit text.
  return `Asturias Airport OVD Leon train station one way car rental Spain ${pickupDate} ${dropoffDate} ${vehicleType} ${transmission}`;
}

function providerUrl(domain) {
  const q = encodeURIComponent(`site:${domain} OVD Leon one way car rental Spain April 2026`);
  return `https://www.google.com/search?q=${q}`;
}

function renderProviders() {
  const root = ids("providers");
  root.innerHTML = "";
  providers.forEach((p) => {
    const item = document.createElement("div");
    item.className = "provider";
    const label = document.createElement("span");
    label.textContent = p.name;
    const btn = document.createElement("button");
    btn.textContent = "Open search";
    btn.onclick = () => window.open(providerUrl(p.domain), "_blank", "noopener");
    item.append(label, btn);
    root.appendChild(item);
  });
}

function calcEffectiveEur(q) {
  const afterMember = Number(q.price) * (1 - Number(q.memberPct || 0) / 100);
  return Math.max(0, afterMember - Number(q.coupon || 0) + Number(q.insuranceAddOn || 0));
}

function policyBonus(q, profile) {
  let bonus = 0;
  if (q.cancel === "yes") bonus += 10;
  if (q.fuel === "full-to-full") bonus += 8;
  if (!q.mileageKm || q.mileageKm >= profile.expectedKm) bonus += 10;
  else bonus -= 10;
  if (profile.insuranceNeed === "none" && q.insuranceAddOn > 0) bonus -= 8;
  if (profile.prefHertz && /hertz/i.test(q.provider)) bonus += 5;
  return bonus;
}

function rankQuotes(list) {
  const profile = {
    expectedKm: Number(ids("expectedKm").value || 500),
    budgetUsd: Number(ids("budgetUsd").value || 550),
    fxUsdPerEur: Number(ids("fxUsdPerEur").value || 1.09),
    insuranceNeed: ids("insuranceNeed").value,
    prefHertz: ids("prefHertz").checked
  };

  return [...list].map((q) => {
    const effectiveEur = calcEffectiveEur(q);
    const effectiveUsd = effectiveEur * profile.fxUsdPerEur;
    const budgetPenalty = effectiveUsd > profile.budgetUsd ? (effectiveUsd - profile.budgetUsd) / 8 : 0;
    const rawCost = effectiveEur + Number(q.deposit || 0) * 0.01;
    const score = Math.max(0, 130 - rawCost / 2.7 + policyBonus(q, profile) - budgetPenalty);
    return { ...q, effectiveEur: +effectiveEur.toFixed(2), effectiveUsd: +effectiveUsd.toFixed(2), score: +score.toFixed(1), budgetFit: effectiveUsd <= profile.budgetUsd };
  }).sort((a, b) => b.score - a.score);
}

function renderQuotes() {
  const body = ids("quotesTable");
  body.innerHTML = "";
  const ranked = rankQuotes(quotes);

  ranked.forEach((q, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>#${i + 1}</td>
      <td>${q.provider}</td>
      <td>${q.className}</td>
      <td>${Number(q.price).toFixed(2)}</td>
      <td>${q.effectiveEur.toFixed(2)}</td>
      <td>${q.effectiveUsd.toFixed(2)}</td>
      <td>${q.score}</td>
      <td>${q.budgetFit ? "✅ under budget" : "⚠️ above budget"}</td>
      <td>${q.url ? `<a href="${q.url}" target="_blank" rel="noopener">offer</a>` : "-"}</td>
      <td><button data-id="${q.id}">Delete</button></td>
    `;
    tr.querySelector("button").onclick = () => {
      quotes = quotes.filter((x) => x.id !== q.id);
      saveQuotes();
      renderQuotes();
    };
    body.appendChild(tr);
  });
}

function loadQuotes() {
  try { return JSON.parse(localStorage.getItem(quoteStorageKey) || "[]"); } catch { return []; }
}

function saveQuotes() {
  localStorage.setItem(quoteStorageKey, JSON.stringify(quotes));
}

function exportQuotes() {
  const payload = {
    profile: loadProfile(),
    auto: loadAuto(),
    quotes
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "rental-quotes-spain-phase3.json";
  a.click();
  URL.revokeObjectURL(url);
}

function importQuotes(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (Array.isArray(data)) quotes = data;
      else {
        quotes = Array.isArray(data.quotes) ? data.quotes : [];
        if (data.profile) localStorage.setItem(profileStorageKey, JSON.stringify(data.profile));
        if (data.auto) localStorage.setItem(autoStorageKey, JSON.stringify(data.auto));
      }
      hydrateProfile();
      hydrateAuto();
      saveQuotes();
      renderQuotes();
      renderProviders();
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    }
  };
  reader.readAsText(file);
}

function extractPriceHints(text) {
  const prices = [];
  const eur = [...text.matchAll(/(?:€|EUR\s?)(\d{2,4}(?:[.,]\d{1,2})?)/gi)].map((m) => Number(m[1].replace(",", ".")));
  const usd = [...text.matchAll(/(?:\$|USD\s?)(\d{2,4}(?:[.,]\d{1,2})?)/gi)].map((m) => Number(m[1].replace(",", ".")));
  eur.forEach((v) => Number.isFinite(v) && prices.push({ currency: "EUR", value: v }));
  usd.forEach((v) => Number.isFinite(v) && prices.push({ currency: "USD", value: v }));
  return prices.filter((p) => p.value >= 80 && p.value <= 2000).slice(0, 6);
}

async function runBackendHunt() {
  const q = tripQuery();
  const fx = Number(ids("fxUsdPerEur").value || 1.09);
  const res = await fetch(`/api/hunt?q=${encodeURIComponent(q)}&fx=${encodeURIComponent(String(fx))}`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

function setHuntStatus(msg) {
  ids("huntStatus").textContent = msg;
}

async function runHunt() {
  setHuntStatus("Running hunt…");

  let payload;
  try {
    payload = await runBackendHunt();
  } catch (err) {
    setHuntStatus("Auto-hunt failed. Make sure server.py is running (not plain http.server).");
    console.warn(err);
    return;
  }

  const found = (payload.results || []).map((q) => ({
    id: crypto.randomUUID(),
    provider: q.provider,
    className: ids("vehicleType").value,
    price: Number(q.price),
    deposit: 0,
    mileageKm: Number(ids("expectedKm").value || 500),
    coupon: 0,
    memberPct: 0,
    insuranceAddOn: 0,
    cancel: "yes",
    fuel: "full-to-full",
    url: q.url || "",
    source: q.source || "auto-hunter"
  }));

  if (!found.length) {
    const debug = payload.debug || [];
    const noResults = debug.every((d) => (d.resultUrls || 0) === 0);
    if (noResults) {
      setHuntStatus("No indexed provider results found. This host lacks a search API key and public engines are returning generic pages. Use Open all provider searches for now.");
    } else {
      setHuntStatus("No price hints found this run. Use Open all provider searches and add manual quotes.");
    }
    return;
  }

  const seen = new Set(quotes.map((q) => `${q.provider}|${Math.round(q.price)}`));
  const fresh = found.filter((q) => !seen.has(`${q.provider}|${Math.round(q.price)}`));
  quotes.push(...fresh);
  saveQuotes();
  renderQuotes();

  const best = rankQuotes(quotes)[0];
  setHuntStatus(`Hunt complete: +${fresh.length} hints. Best now: ${best.provider} at ~$${best.effectiveUsd}.`);

  if (best?.budgetFit) {
    alert(`Deal alert: ${best.provider} is under your $${ids("budgetUsd").value} target (~$${best.effectiveUsd}).`);
  }
}

function loadAuto() {
  try { return JSON.parse(localStorage.getItem(autoStorageKey) || "{}"); } catch { return {}; }
}

function saveAuto(minutes) {
  localStorage.setItem(autoStorageKey, JSON.stringify({ minutes }));
}

function hydrateAuto() {
  const auto = loadAuto();
  ids("huntInterval").value = auto.minutes ?? 0;
  applyAutoRun();
}

function applyAutoRun() {
  if (huntTimer) {
    clearInterval(huntTimer);
    huntTimer = null;
  }
  const minutes = Number(ids("huntInterval").value || 0);
  saveAuto(minutes);
  if (minutes > 0) {
    huntTimer = setInterval(runHunt, minutes * 60 * 1000);
    setHuntStatus(`Auto-hunter armed: every ${minutes} min`);
  } else {
    setHuntStatus("Auto-hunter idle (manual only)");
  }
}

function init() {
  hydrateProfile();
  hydrateAuto();
  renderProviders();
  renderQuotes();

  ["pickup", "dropoff", "pickupDate", "pickupTime", "dropoffDate", "dropoffTime", "vehicleType", "transmission", "prefAAA", "prefAmex", "prefHertz"]
    .forEach((id) => ids(id).addEventListener("input", () => {
      saveProfile();
      renderProviders();
      renderQuotes();
    }));

  ["driverAge", "expectedKm", "budgetUsd", "fxUsdPerEur", "insuranceNeed"]
    .forEach((id) => ids(id).addEventListener("input", () => {
      saveProfile();
      renderQuotes();
    }));

  ids("openAll").onclick = () => providers.forEach((p, i) => setTimeout(() => window.open(providerUrl(p.domain), "_blank", "noopener"), i * 120));
  ids("huntNow").onclick = runHunt;
  ids("saveAutoRun").onclick = applyAutoRun;

  ids("quoteForm").onsubmit = (e) => {
    e.preventDefault();
    const quote = {
      id: crypto.randomUUID(),
      provider: ids("qProvider").value.trim(),
      className: ids("qClass").value.trim(),
      price: Number(ids("qPrice").value),
      deposit: Number(ids("qDeposit").value || 0),
      mileageKm: Number(ids("qMileageKm").value || 0),
      coupon: Number(ids("qCoupon").value || 0),
      memberPct: Number(ids("qMemberPct").value || 0),
      insuranceAddOn: Number(ids("qInsurance").value || 0),
      cancel: ids("qCancel").value,
      fuel: ids("qFuel").value,
      url: ids("qUrl").value.trim()
    };
    quotes.push(quote);
    saveQuotes();
    renderQuotes();
    e.target.reset();
    ids("qDeposit").value = "0";
    ids("qCoupon").value = "0";
    ids("qMemberPct").value = "0";
    ids("qInsurance").value = "0";
    ids("qCancel").value = "yes";
    ids("qFuel").value = "full-to-full";
  };

  ids("exportBtn").onclick = exportQuotes;
  ids("importFile").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) importQuotes(file);
  });
}

init();
