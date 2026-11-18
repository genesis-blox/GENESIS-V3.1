const $ = id => document.getElementById(id);
let currentUser = null;
let allItems = [];
let nextCursor = null;
let loading = false;

function formatNumber(value) {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(Number(value) || 0);
}
function setStatus(message, isError = false) {
  $("status").textContent = message;
  $("status").style.color = isError ? "#ff9292" : "";
}
async function api(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Permintaan gagal (${response.status})`);
  return data;
}
function getOwnershipAge(acquiredAt) {
  if (!acquiredAt) return "Tanggal diperoleh tidak tersedia";
  const acquired = new Date(acquiredAt);
  if (Number.isNaN(acquired.getTime())) return "Tanggal tidak valid";
  const days = Math.max(0, Math.floor((Date.now() - acquired.getTime()) / 86400000));
  const years = Math.floor(days / 365);
  const months = Math.floor((days % 365) / 30);
  const remainingDays = days % 30;
  const parts = [];
  if (years) parts.push(`${years} th`);
  if (months) parts.push(`${months} bln`);
  if (remainingDays || !parts.length) parts.push(`${remainingDays} hari`);
  return parts.join(" ");
}

$("scanProfile").addEventListener("click", async () => {
  const username = $("username").value.trim();
  if (!username) return setStatus("Masukkan username terlebih dahulu.", true);
  $("scanProfile").disabled = true;
  setStatus("Sedang mencari profil...");
  $("profileCard").classList.add("hidden");
  $("inventoryPanel").classList.add("hidden");
  $("extendedProfile").classList.add("hidden");
  $("creatorSummary").classList.add("hidden");
  $("exportFullReport").disabled = true;
  window._loadedCommunities = []; window._loadedCreations = [];
  intelligenceState.profile = null;
  intelligenceState.social = null;
  intelligenceState.communities = null;
  intelligenceState.creations = null;
  intelligenceState.inventory = null;
  renderAccountIntelligence();
  $("extendedStatus").textContent = "Data tambahan dimuat saat tombol ditekan.";
  $("communityList").replaceChildren(); $("creationList").replaceChildren();
  currentUser = null;
  allItems = [];
  nextCursor = null;
  try {
    const user = await api(`/api/user/${encodeURIComponent(username)}`);
    currentUser = user;
    $("avatar").src = user.avatar || "";
    updateProfileBackdrop(user);
    $("displayName").textContent = user.displayName || user.name;
    $("handle").textContent = "@" + user.name;
    $("userId").textContent = "User ID: " + user.id;
    $("description").textContent = user.description || "Tidak ada deskripsi publik.";
    $("created").textContent = "Bergabung: " + new Date(user.created).toLocaleDateString("id-ID");
    $("banned").textContent = user.isBanned ? "Status: banned" : "Status: tidak ditandai banned";
    $("profileCard").classList.remove("hidden");
    renderValueTracker();
    intelligenceState.profile = [currentUser.name, currentUser.displayName || currentUser.name, currentUser.description, currentUser.created, currentUser.avatar].filter(value => value !== null && value !== undefined && String(value).trim() !== "").length * 20;
    renderAccountIntelligence();
    setStatus("Profil berhasil ditemukan.");
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    $("scanProfile").disabled = false;
  }
});



// V2.8: Creator analytics and a consolidated public-data report export.
function renderCreatorSummary(communities, creations) {
  const box = $("creatorSummary");
  box.classList.remove("hidden");
  const owned = communities.filter(group => group.isOwner).length;
  const totalVisits = creations.reduce((sum, game) => sum + Number(game.visits || 0), 0);
  const totalPlaying = creations.reduce((sum, game) => sum + Number(game.playing || 0), 0);
  const best = [...creations].sort((a,b) => Number(b.visits || 0) - Number(a.visits || 0))[0];
  box.replaceChildren();
  const heading = document.createElement("h3");
  heading.textContent = "Creator Overview";
  const stats = document.createElement("div");
  stats.className = "creator-stat-grid";
  [
    ["Community diikuti", communities.length],
    ["Role Owner terdeteksi", owned],
    ["Experience dimuat", creations.length],
    ["Total visits (data dimuat)", formatNumber(totalVisits)],
    ["Pemain aktif saat scan", formatNumber(totalPlaying)]
  ].forEach(([label,value]) => {
    const card=document.createElement("div");
    const small=document.createElement("span"); small.textContent=label;
    const strong=document.createElement("strong"); strong.textContent=String(value);
    card.append(small,strong); stats.appendChild(card);
  });
  box.append(heading,stats);
  if (best) {
    const note=document.createElement("p");
    note.className="small muted";
    note.textContent=`Experience dengan visits terbanyak di halaman yang dimuat: ${best.name} (${formatNumber(best.visits)} visits).`;
    box.appendChild(note);
  }
}
function exportFullPublicReport() {
  if (!currentUser) return;
  const communities = window._loadedCommunities || [];
  const creations = window._loadedCreations || [];
  const inventory = window.inventoryItems || window.currentInventoryItems || [];
  const history = readHistory().filter(entry => String(entry.userId) === String(currentUser.id));
  const report = {
    reportVersion: "2.8",
    generatedAt: new Date().toISOString(),
    dataScope: "Public Roblox API data and inventory items currently loaded in the scanner",
    account: currentUser,
    inventory: {
      loadedItemCount: inventory.length,
      items: inventory.map(item => ({
        name: item.name || "",
        assetId: item.assetId || item.id || null,
        rap: Number(item.rap || 0)
      }))
    },
    communities,
    publicExperiences: creations,
    savedInventorySnapshots: history
  };
  const blob = new Blob([JSON.stringify(report,null,2)],{type:"application/json"});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href=url;
  link.download=`roblox-public-report-${currentUser.id}-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}
$("exportFullReport").addEventListener("click", exportFullPublicReport);

// V2.7: additional public profile information (communities and public experiences).
let nextCreationCursor = null;
async function renderPublicList(containerId, rows, kind) {
  const box = $(containerId);
  box.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "muted small";
    empty.textContent = "Tidak ada data publik yang tersedia.";
    box.appendChild(empty);
    return;
  }
  rows.forEach(entry => {
    const card = document.createElement("article");
    card.className = "public-card";
    const title = document.createElement("strong");
    title.textContent = entry.name;
    const detail = document.createElement("p");
    detail.className = "small muted";
    if (kind === "community") {
      detail.textContent = `${entry.isOwner ? "Owner" : entry.roleName} · ${formatNumber(entry.memberCount)} anggota`;
    } else {
      detail.textContent = `${formatNumber(entry.visits)} visits · ${formatNumber(entry.playing)} sedang bermain`;
    }
    card.append(title, detail);
    if (entry.description) {
      const desc = document.createElement("p");
      desc.className = "small public-description";
      desc.textContent = entry.description;
      card.appendChild(desc);
    }
    if (entry.url) {
      const link = document.createElement("a");
      link.href = entry.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = kind === "community" ? "Buka community" : "Buka experience";
      card.appendChild(link);
    }
    box.appendChild(card);
  });
}
async function loadCreationsPage() {
  if (!currentUser) return;
  $("loadMoreCreations").disabled = true;
  try {
    const query = nextCreationCursor ? `?cursor=${encodeURIComponent(nextCreationCursor)}` : "";
    const result = await api(`/api/creations/${currentUser.id}${query}`);
    const current = window._loadedCreations || [];
    window._loadedCreations = current.concat(result.creations || []);
    intelligenceState.creations = 100;
    renderAccountIntelligence();
    nextCreationCursor = result.nextPageCursor || null;
    await renderPublicList("creationList", window._loadedCreations, "creation");
    if (window._loadedCommunities) renderCreatorSummary(window._loadedCommunities, window._loadedCreations);
    $("loadMoreCreations").disabled = !nextCreationCursor;
  } catch (err) {
    $("extendedStatus").textContent = `Experience: ${err.message}`;
    $("loadMoreCreations").disabled = true;
  }
}
$("loadExtendedProfile").addEventListener("click", async () => {
  if (!currentUser) return;
  $("loadExtendedProfile").disabled = true;
  $("extendedProfile").classList.remove("hidden");
  $("extendedStatus").textContent = "Memuat daftar community dan experience publik...";
  nextCreationCursor = null;
  window._loadedCreations = [];
  try {
    const [communityResult] = await Promise.all([
      api(`/api/communities/${currentUser.id}`),
      loadCreationsPage()
    ]);
    intelligenceState.communities = 100;
    renderAccountIntelligence();
    window._loadedCommunities = communityResult.communities || [];
    await renderPublicList("communityList", window._loadedCommunities, "community");
    renderCreatorSummary(window._loadedCommunities, window._loadedCreations || []);
    $("exportFullReport").disabled = false;
    const owned = (communityResult.communities || []).filter(group => group.isOwner).length;
    $("extendedStatus").textContent = `${communityResult.communities?.length || 0} community ditemukan; ${owned} dengan role Owner terdeteksi. Experience publik dimuat sesuai ketersediaan API.`;
  } catch (err) {
    $("extendedStatus").textContent = err.message;
  } finally {
    $("loadExtendedProfile").disabled = false;
  }
});
$("loadMoreCreations").addEventListener("click", loadCreationsPage);


$("loadSocialInsights").addEventListener("click", async () => {
  if (!currentUser) return;

  const button = $("loadSocialInsights");
  const output = $("socialInsights");

  button.disabled = true;
  output.replaceChildren();
  $("socialStatus").textContent = "Memuat statistik sosial publik...";

  try {
    const result = await api("/api/social/" + currentUser.id);
    const social = result.social || {};
    const socialValues = ["friends", "followers", "following"].map(key => social[key]);
    intelligenceState.social = Math.round(socialValues.filter(value => value !== null && value !== undefined && Number.isFinite(Number(value))).length / 3 * 100);
    renderAccountIntelligence();

    const labels = [
      ["friends", "Teman"],
      ["followers", "Followers"],
      ["following", "Following"]
    ];

    labels.forEach(([key, label]) => {
      const card = document.createElement("div");
      const title = document.createElement("span");
      const value = document.createElement("strong");

      title.textContent = label;
      value.textContent = social[key] === null ||
        social[key] === undefined
        ? "Tidak tersedia"
        : formatNumber(social[key]);

      card.append(title, value);
      output.appendChild(card);
    });

    $("socialStatus").textContent =
      "Statistik selesai dimuat. Data mengikuti ketersediaan API Roblox.";
  } catch (err) {
    $("socialStatus").textContent =
      "Gagal memuat statistik: " + err.message;
  } finally {
    button.disabled = false;
  }
});

$("scanInventory").addEventListener("click", async () => {
  if (!currentUser) return;
  allItems = [];
  nextCursor = null;
  $("inventoryPanel").classList.remove("hidden");
  $("itemsGrid").replaceChildren();
  $("inventorySummary").textContent = "Memuat halaman pertama...";
  $("loadMore").disabled = true;
  $("exportCsv").disabled = true;
  await loadInventoryPage();
});

async function loadInventoryPage() {
  if (!currentUser || loading) return;
  loading = true;
  $("loadMore").disabled = true;
  $("pageStatus").textContent = "Sedang memuat...";
  try {
    const query = nextCursor ? `?cursor=${encodeURIComponent(nextCursor)}` : "";
    const result = await api(`/api/inventory/${currentUser.id}${query}`);
    allItems.push(...result.items);
    intelligenceState.inventory = 100;
    renderAccountIntelligence();
    nextCursor = result.nextPageCursor;
    renderDashboard();
    $("inventorySummary").textContent = `${formatNumber(allItems.length)} item dimuat${nextCursor ? " — masih ada halaman berikutnya" : " — semua halaman yang tersedia telah dimuat"}.`;
    $("loadMore").disabled = !nextCursor;
    $("pageStatus").textContent = nextCursor ? "Ada halaman berikutnya." : "Tidak ada halaman berikutnya.";
    $("exportCsv").disabled = allItems.length === 0;
    $("saveSnapshot").disabled = allItems.length === 0;
  } catch (err) {
    $("pageStatus").textContent = err.message;
    $("pageStatus").style.color = "#ff9292";
  } finally {
    loading = false;
  }
}

function getSortedItems() {
  const sort = $("sortItems").value;
  const query = $("filterItems").value.trim().toLowerCase();
  const minRaw = $("minRap").value.trim();
  const maxRaw = $("maxRap").value.trim();
  const minRap = minRaw === "" ? null : Number(minRaw);
  const maxRap = maxRaw === "" ? null : Number(maxRaw);
  const filtered = allItems.filter(item => {
    const matchesText = String(item.name || "").toLowerCase().includes(query) || String(item.assetId || "").includes(query);
    const rap = Number(item.rap) || 0;
    const matchesMin = minRap === null || (Number.isFinite(minRap) && rap >= minRap);
    const matchesMax = maxRap === null || (Number.isFinite(maxRap) && rap <= maxRap);
    return matchesText && matchesMin && matchesMax;
  });
  if (sort === "rap-asc") filtered.sort((a, b) => a.rap - b.rap);
  else if (sort === "name-asc") filtered.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  else filtered.sort((a, b) => b.rap - a.rap);
  return filtered;
}

function renderDashboard() {
  const totalRap = allItems.reduce((sum, item) => sum + (Number(item.rap) || 0), 0);
  const averageRap = allItems.length ? Math.round(totalRap / allItems.length) : 0;
  const ranked = [...allItems].sort((a, b) => b.rap - a.rap);
  const highest = ranked[0];
  $("totalItems").textContent = formatNumber(allItems.length);
  $("totalRap").textContent = formatNumber(totalRap);
  $("averageRap").textContent = formatNumber(averageRap);
  $("highestRap").textContent = highest ? formatNumber(highest.rap) : "—";
  $("highestRapName").textContent = highest ? highest.name : "Belum tersedia";
  renderTopChart(ranked.slice(0, 5));
  renderGallery();
}

function renderTopChart(items) {
  const chart = $("topRapChart");
  chart.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Belum ada data untuk ditampilkan.";
    chart.appendChild(empty);
    return;
  }
  const maxRap = Math.max(...items.map(item => Number(item.rap) || 0), 1);
  items.forEach(item => {
    const row = document.createElement("div");
    row.className = "chart-row";
    const name = document.createElement("div");
    name.className = "chart-name";
    name.textContent = item.name;
    name.title = item.name;
    const track = document.createElement("div");
    track.className = "chart-track";
    const fill = document.createElement("div");
    fill.className = "chart-fill";
    fill.style.width = `${Math.max(1, (Number(item.rap || 0) / maxRap) * 100)}%`;
    track.appendChild(fill);
    const value = document.createElement("div");
    value.className = "chart-value";
    value.textContent = formatNumber(item.rap);
    row.append(name, track, value);
    chart.appendChild(row);
  });
}

function renderGallery() {
  const grid = $("itemsGrid");
  grid.replaceChildren();
  const items = getSortedItems();
  const filteredRap = items.reduce((sum, item) => sum + (Number(item.rap) || 0), 0);
  const highest = items.reduce((best, item) => !best || (Number(item.rap) || 0) > (Number(best.rap) || 0) ? item : best, null);
  $("filteredCount").textContent = formatNumber(items.length);
  $("filteredRap").textContent = formatNumber(filteredRap);
  $("filteredHighest").textContent = highest ? formatNumber(highest.rap) : "—";
  const minValue = $("minRap").value.trim();
  const maxValue = $("maxRap").value.trim();
  if (minValue && maxValue && Number(minValue) > Number(maxValue)) {
    $("filterNotice").textContent = "Rentang tidak valid: RAP minimum lebih besar daripada RAP maksimum.";
    $("filterNotice").style.color = "#ff9292";
  } else {
    $("filterNotice").textContent = `Menampilkan ${formatNumber(items.length)} dari ${formatNumber(allItems.length)} item yang sudah dimuat. Filter tidak mengambil data tambahan dari Roblox.`;
    $("filterNotice").style.color = "";
  }
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = allItems.length ? "Tidak ada item yang cocok dengan pencarian." : "Tidak ada collectible publik yang ditemukan.";
    grid.appendChild(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  items.forEach(item => {
    const card = document.createElement("article");
    card.className = "item-card";
    const imageWrap = document.createElement("div");
    imageWrap.className = "item-image-wrap";
    if (item.thumbnail) {
      const img = document.createElement("img");
      img.className = "item-image";
      img.src = item.thumbnail;
      img.alt = item.name;
      img.loading = "lazy";
      img.onerror = () => {
        img.remove();
        const fallback = document.createElement("span");
        fallback.className = "image-fallback";
        fallback.textContent = "Gambar tidak tersedia";
        imageWrap.appendChild(fallback);
      };
      imageWrap.appendChild(img);
    } else {
      const fallback = document.createElement("span");
      fallback.className = "image-fallback";
      fallback.textContent = "Gambar tidak tersedia";
      imageWrap.appendChild(fallback);
    }
    const info = document.createElement("div");
    info.className = "item-info";
    const name = document.createElement("div");
    name.className = "item-name";
    name.textContent = item.name || "Item tanpa nama";
    const rap = document.createElement("div");
    rap.className = "item-rap";
    rap.textContent = `${formatNumber(item.rap)} RAP`;
    const id = document.createElement("div");
    id.className = "item-meta";
    id.textContent = `Asset ID: ${item.assetId || "—"}`;
    const age = document.createElement("div");
    age.className = "item-age";
    age.textContent = getOwnershipAge(item.acquiredAt);
    info.append(name, rap, id, age);
    card.append(imageWrap, info);
    fragment.appendChild(card);
  });
  grid.appendChild(fragment);
}

$("loadMore").addEventListener("click", loadInventoryPage);
$("filterItems").addEventListener("input", renderGallery);
$("sortItems").addEventListener("change", renderGallery);
$("minRap").addEventListener("input", renderGallery);
$("maxRap").addEventListener("input", renderGallery);
$("resetFilters").addEventListener("click", () => {
  $("filterItems").value = "";
  $("minRap").value = "";
  $("maxRap").value = "";
  $("sortItems").value = "rap-desc";
  renderGallery();
});

$("exportCsv").addEventListener("click", () => {
  if (!allItems.length) return;
  const rows = [["Item", "Asset ID", "RAP", "Thumbnail URL", "Tanggal diperoleh"], ...[...allItems].sort((a, b) => b.rap - a.rap).map(item => [item.name, item.assetId, item.rap, item.thumbnail || "", item.acquiredAt || "Tidak tersedia"])];
  const csv = rows.map(row => row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `roblox-inventory-${currentUser?.id || "scan"}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});


// V2.5: locally stored inventory snapshots. Data remains in this browser only.
const HISTORY_KEY = "robloxAccountScannerHistoryV25";
function readHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function writeHistory(history) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    return true;
  } catch {
    $("historyStatus").textContent = "Penyimpanan browser penuh atau tidak tersedia. Hapus beberapa data browser atau snapshot lama.";
    return false;
  }
}
function snapshotRap(items) {
  return items.reduce((sum, item) => sum + (Number(item.rap) || 0), 0);
}

function renderValueTracker() {
  const rapBox = $("rapTrendChart");
  const itemBox = $("itemTrendChart");
  rapBox.replaceChildren(); itemBox.replaceChildren();
  const history = readHistory().filter(entry => currentUser && String(entry.userId) === String(currentUser.id))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  $("trackerSnapshotCount").textContent = formatNumber(history.length);
  if (!history.length) {
    $("trackerRapDelta").textContent = "—"; $("trackerItemDelta").textContent = "—";
    $("trackerNote").textContent = "Belum ada snapshot untuk akun ini. Simpan snapshot setelah memuat inventory.";
    return;
  }
  const first = history[0], last = history[history.length - 1];
  const rapDelta = Number(last.totalRap || 0) - Number(first.totalRap || 0);
  const itemDelta = Number(last.itemCount || 0) - Number(first.itemCount || 0);
  const signed = value => `${value > 0 ? "+" : ""}${formatNumber(value)}`;
  $("trackerRapDelta").textContent = signed(rapDelta);
  $("trackerItemDelta").textContent = signed(itemDelta);
  $("trackerRapDelta").className = rapDelta > 0 ? "positive" : rapDelta < 0 ? "negative" : "";
  $("trackerItemDelta").className = itemDelta > 0 ? "positive" : itemDelta < 0 ? "negative" : "";
  function draw(box, key, label) {
    const values = history.slice(-12);
    const max = Math.max(1, ...values.map(row => Number(row[key]) || 0));
    values.forEach((entry, index) => {
      const row = document.createElement("div"); row.className = "trend-bar-row";
      const date = document.createElement("span"); date.textContent = new Date(entry.createdAt).toLocaleDateString("id-ID"); date.className = "trend-date";
      const track = document.createElement("div"); track.className = "trend-track";
      const fill = document.createElement("div"); fill.className = "trend-fill"; fill.style.width = `${Math.max(1, (Number(entry[key] || 0) / max) * 100)}%`;
      track.appendChild(fill);
      const value = document.createElement("strong"); value.textContent = formatNumber(entry[key]); value.className = "trend-value";
      row.append(date, track, value); box.appendChild(row);
    });
  }
  draw(rapBox, "totalRap", "RAP"); draw(itemBox, "itemCount", "item");
  $("trackerNote").textContent = `Menampilkan maksimal 12 snapshot terakhir dari ${formatNumber(history.length)} snapshot akun ini. Grafik menghubungkan snapshot tersimpan, bukan data real-time.`;
}

function refreshHistoryUI() {
  const history = readHistory();
  const selectA = $("historySelectA");
  const selectB = $("historySelectB");
  const oldA = selectA.value;
  const oldB = selectB.value;
  [selectA, selectB].forEach(select => {
    select.replaceChildren();
    const initial = document.createElement("option");
    initial.value = "";
    initial.textContent = "Pilih snapshot";
    select.appendChild(initial);
    history.forEach(entry => {
      const option = document.createElement("option");
      option.value = entry.id;
      option.textContent = `${entry.username} · ${new Date(entry.createdAt).toLocaleString("id-ID")}`;
      select.appendChild(option);
    });
  });
  if (history.some(entry => entry.id === oldA)) selectA.value = oldA;
  if (history.some(entry => entry.id === oldB)) selectB.value = oldB;
  $("exportHistory").disabled = history.length === 0;
  renderValueTracker();
  const list = $("historyList");
  list.replaceChildren();
  if (!history.length) {
    const empty = document.createElement("p");
    empty.className = "muted small";
    empty.textContent = "Belum ada snapshot tersimpan.";
    list.appendChild(empty);
    return;
  }
  history.slice().reverse().forEach(entry => {
    const row = document.createElement("div");
    row.className = "history-row";
    const info = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = "@" + entry.username;
    const detail = document.createElement("small");
    detail.textContent = `${new Date(entry.createdAt).toLocaleString("id-ID")} · ${formatNumber(entry.itemCount)} item · ${formatNumber(entry.totalRap)} RAP`;
    info.append(name, detail);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Hapus";
    remove.addEventListener("click", () => {
      const updated = readHistory().filter(item => item.id !== entry.id);
      if (writeHistory(updated)) {
        $("historyStatus").textContent = "Snapshot dihapus dari browser ini.";
        refreshHistoryUI();
        $("snapshotComparison").classList.add("hidden");
      }
    });
    row.append(info, remove);
    list.appendChild(row);
  });
}

$("saveSnapshot").addEventListener("click", () => {
  if (!currentUser || !allItems.length) {
    $("historyStatus").textContent = "Scan inventaris terlebih dahulu sebelum menyimpan snapshot.";
    return;
  }
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    userId: currentUser.id,
    username: currentUser.name,
    displayName: currentUser.displayName || currentUser.name,
    createdAt: new Date().toISOString(),
    itemCount: allItems.length,
    totalRap: snapshotRap(allItems),
    items: allItems.map(item => ({
      name: item.name,
      assetId: item.assetId,
      rap: Number(item.rap) || 0
    }))
  };
  const history = readHistory();
  history.push(entry);
  // Keep the newest 50 snapshots to avoid filling browser storage.
  const trimmed = history.slice(-50);
  if (writeHistory(trimmed)) {
    $("historyStatus").textContent = `Snapshot @${currentUser.name} berhasil disimpan secara lokal.`;
    refreshHistoryUI();
  }
});

$("compareSnapshots").addEventListener("click", () => {
  const history = readHistory();
  const a = history.find(entry => entry.id === $("historySelectA").value);
  const b = history.find(entry => entry.id === $("historySelectB").value);
  if (!a || !b) {
    $("historyStatus").textContent = "Pilih dua snapshot untuk dibandingkan.";
    return;
  }
  if (a.userId !== b.userId) {
    $("historyStatus").textContent = "Pilih snapshot dari akun yang sama agar perubahan dari waktu ke waktu dapat dibandingkan.";
    return;
  }
  const itemDelta = b.itemCount - a.itemCount;
  const rapDelta = b.totalRap - a.totalRap;
  const formatDelta = value => `${value > 0 ? "+" : ""}${formatNumber(value)}`;
  $("snapshotItemDelta").textContent = formatDelta(itemDelta);
  $("snapshotRapDelta").textContent = formatDelta(rapDelta);
  $("snapshotItemDetail").textContent = `${formatNumber(a.itemCount)} → ${formatNumber(b.itemCount)} item`;
  $("snapshotRapDetail").textContent = `${formatNumber(a.totalRap)} → ${formatNumber(b.totalRap)} RAP`;
  $("snapshotItemDelta").className = itemDelta > 0 ? "history-delta-positive" : itemDelta < 0 ? "history-delta-negative" : "history-delta-neutral";
  $("snapshotRapDelta").className = rapDelta > 0 ? "history-delta-positive" : rapDelta < 0 ? "history-delta-negative" : "history-delta-neutral";
  $("snapshotComparisonNote").textContent = `Dari ${new Date(a.createdAt).toLocaleString("id-ID")} sampai ${new Date(b.createdAt).toLocaleString("id-ID")}. Perbandingan memakai jumlah dan RAP dari item yang tersimpan pada masing-masing snapshot; ini bukan riwayat transaksi Roblox.`;
  $("snapshotComparison").classList.remove("hidden");
});

$("exportHistory").addEventListener("click", () => {
  const history = readHistory();
  if (!history.length) return;
  const blob = new Blob([JSON.stringify(history, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "roblox-scan-history.json";
  a.click();
  URL.revokeObjectURL(url);
});

$("saveSnapshot").disabled = true;
refreshHistoryUI();

/* =========================================================
   ROBLOX ACCOUNT SCANNER V2.9
   Integrated Account Intelligence Dashboard
   ========================================================= */

(function initV29Dashboard() {
  const style = document.createElement("style");
  style.textContent = `
    #v29Dashboard{margin:16px 0;padding:18px;background:rgba(18,23,34,.96);border:1px solid #57458c;border-radius:16px;box-shadow:0 12px 35px #0003}
    #v29Dashboard h2{margin:0;font-size:22px}
    #v29Dashboard h3{font-size:15px;margin:0 0 12px}
    .v29-subtitle{color:#9aa6b7;font-size:12px;margin:5px 0 16px}
    .v29-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
    .v29-card{min-width:0;padding:13px;background:#0b111c;border:1px solid #2b3850;border-radius:11px}
    .v29-card span{display:block;color:#9aa6b7;font-size:11px}
    .v29-card strong{display:block;font-size:21px;margin-top:5px;overflow-wrap:anywhere}
    .v29-section{margin-top:20px}
    .v29-list{display:grid;gap:7px}
    .v29-row{display:flex;justify-content:space-between;gap:10px;padding:9px 11px;background:#0b111c;border:1px solid #293448;border-radius:9px;font-size:12px}
    .v29-row span:first-child{overflow-wrap:anywhere}
    .v29-row strong{white-space:nowrap;color:#c8b7ff}
    .v29-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:16px}
    .v29-note{font-size:11px;color:#9aa6b7;margin-top:12px}
    @media(max-width:650px){.v29-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.v29-card{padding:10px}.v29-card strong{font-size:18px}}
  `;
  document.head.appendChild(style);

  const dashboard = document.createElement("section");
  dashboard.id = "v29Dashboard";
  dashboard.className = "hidden";
  dashboard.innerHTML = `
    <div class="eyebrow">V2.9 · ACCOUNT INTELLIGENCE</div>
    <h2>Integrated Dashboard</h2>
    <p class="v29-subtitle">Ringkasan informasi publik akun Roblox dalam satu tampilan.</p>
    <div class="v29-grid" id="v29AccountStats"></div>
    <div class="v29-section">
      <h3>Inventory Insights · Top 10 RAP</h3>
      <div class="v29-list" id="v29TopItems"><p class="muted small">Scan inventaris untuk melihat item.</p></div>
    </div>
    <div class="v29-section">
      <h3>Creator & Community Analytics</h3>
      <div class="v29-grid" id="v29CreatorStats"></div>
    </div>
    <div class="v29-actions">
      <button type="button" id="v29ExportJson">Ekspor Full Report JSON</button>
      <button type="button" class="secondary" id="v29ExportCsv">Ekspor Full Report CSV</button>
    </div>
    <p class="v29-note">Data berdasarkan informasi publik dan item yang sudah berhasil dimuat. Nilai RAP merupakan estimasi, bukan nilai transaksi atau saldo Robux.</p>
  `;

  const profileCard = $("profileCard");
  profileCard.insertAdjacentElement("afterend", dashboard);

  function statCard(label, value) {
    const card = document.createElement("div");
    card.className = "v29-card";
    const name = document.createElement("span");
    name.textContent = label;
    const number = document.createElement("strong");
    number.textContent = String(value);
    card.append(name, number);
    return card;
  }

  function addRow(container, label, value) {
    const row = document.createElement("div");
    row.className = "v29-row";
    const name = document.createElement("span");
    name.textContent = label;
    const number = document.createElement("strong");
    number.textContent = String(value);
    row.append(name, number);
    container.appendChild(row);
  }

  function render() {
    if (!currentUser) {
      dashboard.classList.add("hidden");
      return;
    }

    dashboard.classList.remove("hidden");

    const communities = window._loadedCommunities || [];
    const creations = window._loadedCreations || [];
    const totalRap = allItems.reduce((sum, item) => sum + (Number(item.rap) || 0), 0);
    const visits = creations.reduce((sum, item) => sum + (Number(item.visits) || 0), 0);
    const playing = creations.reduce((sum, item) => sum + (Number(item.playing) || 0), 0);
    const owners = communities.filter(item => item.isOwner).length;
    const topItems = [...allItems].sort((a, b) => (Number(b.rap) || 0) - (Number(a.rap) || 0)).slice(0, 10);

    const accountStats = $("v29AccountStats");
    accountStats.replaceChildren(
      statCard("Username", "@" + currentUser.name),
      statCard("User ID", formatNumber(currentUser.id)),
      statCard("Umur akun", currentUser.created ? Math.floor((Date.now() - new Date(currentUser.created).getTime()) / 86400000).toLocaleString("id-ID") + " hari" : "—"),
      statCard("Status akun", currentUser.isBanned ? "Banned" : "Tidak ditandai banned"),
      statCard("Item dimuat", formatNumber(allItems.length)),
      statCard("Total estimasi RAP", formatNumber(totalRap)),
      statCard("Community", formatNumber(communities.length)),
      statCard("Experience publik", formatNumber(creations.length))
    );

    const topBox = $("v29TopItems");
    topBox.replaceChildren();
    if (!topItems.length) {
      const empty = document.createElement("p");
      empty.className = "muted small";
      empty.textContent = "Belum ada data inventaris. Tekan Scan Inventory terlebih dahulu.";
      topBox.appendChild(empty);
    } else {
      topItems.forEach((item, index) => {
        addRow(topBox, `${index + 1}. ${item.name || "Item tanpa nama"} · ID ${item.assetId || "—"}`, formatNumber(item.rap));
      });
    }

    const creatorBox = $("v29CreatorStats");
    creatorBox.replaceChildren(
      statCard("Community dengan role Owner", formatNumber(owners)),
      statCard("Total visits experience dimuat", formatNumber(visits)),
      statCard("Pemain aktif saat scan", formatNumber(playing)),
      statCard("Total community dimuat", formatNumber(communities.length))
    );
  }

  function makeReport() {
    return {
      reportVersion: "2.9",
      generatedAt: new Date().toISOString(),
      dataScope: "Public Roblox data and currently loaded inventory, community and public experiences",
      account: currentUser,
      inventory: {
        loadedItemCount: allItems.length,
        totalEstimatedRap: allItems.reduce((sum, item) => sum + (Number(item.rap) || 0), 0),
        items: allItems
      },
      communities: window._loadedCommunities || [],
      publicExperiences: window._loadedCreations || [],
      savedInventorySnapshots: readHistory().filter(entry => String(entry.userId) === String(currentUser.id))
    };
  }

  function downloadFile(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportJson() {
    if (!currentUser) return;
    downloadFile(
      `roblox-account-report-v2.9-${currentUser.id}.json`,
      JSON.stringify(makeReport(), null, 2),
      "application/json"
    );
  }

  function exportCsv() {
    if (!currentUser) return;
    const report = makeReport();
    const rows = [["Type", "Name", "ID", "Details", "Value"]];
    rows.push(["Account", report.account.name, report.account.id, report.account.displayName || "", report.account.created || ""]);
    report.communities.forEach(group => rows.push([
      "Community", group.name, group.id, group.roleName || "", group.memberCount || 0
    ]));
    report.publicExperiences.forEach(game => rows.push([
      "Experience", game.name, game.id, game.url || "", game.visits || 0
    ]));
    report.inventory.items.forEach(item => rows.push([
      "Inventory", item.name, item.assetId, "RAP", Number(item.rap) || 0
    ]));
    const csv = rows.map(row => row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    downloadFile(
      `roblox-account-report-v2.9-${currentUser.id}.csv`,
      "\uFEFF" + csv,
      "text/csv;charset=utf-8"
    );
  }

  $("v29ExportJson").addEventListener("click", exportJson);
  $("v29ExportCsv").addEventListener("click", exportCsv);

  // Update dashboard whenever existing V2.8 render functions run.
  const previousRenderDashboard = renderDashboard;
  renderDashboard = function() {
    previousRenderDashboard();
    render();
  };

  const previousRenderCreatorSummary = renderCreatorSummary;
  renderCreatorSummary = function(communities, creations) {
    previousRenderCreatorSummary(communities, creations);
    render();
  };

  // Keep the original full-report button, but correct its inventory source.
  const oldExportButton = $("exportFullReport");
  const newExportButton = oldExportButton.cloneNode(true);
  oldExportButton.replaceWith(newExportButton);
  newExportButton.addEventListener("click", exportJson);

  // Detect when a new profile is displayed.
  const observer = new MutationObserver(render);
  observer.observe(profileCard, { attributes: true, attributeFilter: ["class"] });

  render();
})();

// V3.0: Dynamic Roblox avatar profile background
function updateProfileBackdrop(user) {
  const card = $("profileCard");
  let backdrop = card.querySelector(".profile-backdrop");

  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.className = "profile-backdrop";
    backdrop.setAttribute("aria-hidden", "true");
    card.prepend(backdrop);
  }

  backdrop.style.backgroundImage = user.avatar
    ? "url(\x27" + user.avatar + "\x27)"
    : "none";
}
const intelligenceState = {
  profile: null,
  social: null,
  communities: null,
  creations: null,
  inventory: null
};

function renderAccountIntelligence() {
  const checks = [
    ["profile", "Kelengkapan profil"],
    ["social", "Statistik sosial"],
    ["communities", "Community"],
    ["creations", "Experience"],
    ["inventory", "Inventory"]
  ];

  const details = $("intelligenceDetails");
  details.replaceChildren();

  const checked = [];

  checks.forEach(([key, label]) => {
    const value = intelligenceState[key];
    const card = document.createElement("div");
    card.className = "intelligence-item";

    const title = document.createElement("span");
    title.textContent = label;

    const result = document.createElement("strong");
    result.textContent = value === null
      ? "Belum diperiksa"
      : value + "%";

    card.append(title, result);
    details.appendChild(card);

    if (value !== null) checked.push(value);
  });

  const score = checked.length
    ? Math.round(checked.reduce((a, b) => a + b, 0) / checked.length)
    : null;

  $("intelligenceScore").textContent =
    score === null ? "-- / 100" : score + " / 100";

  $("intelligenceStatus").textContent = checked.length
    ? `${checked.length} dari 5 sumber sudah diperiksa. Skor menunjukkan kelengkapan data publik.`
    : "Menunggu pemeriksaan data.";
}
