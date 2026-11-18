const express = require("express");
const path = require("path");

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 30;
const requests = new Map();
let lastCleanup = 0;

app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.use("/api", (req, res, next) => {
  const key = req.ip || "unknown";
  const now = Date.now();
  if (now - lastCleanup >= WINDOW_MS) {
    for (const [ip, record] of requests) {
      if (now - record.start >= WINDOW_MS) requests.delete(ip);
    }
    lastCleanup = now;
  }
  const entry = requests.get(key) || { start: now, count: 0 };
  if (now - entry.start >= WINDOW_MS) {
    entry.start = now;
    entry.count = 0;
  }
  entry.count += 1;
  if (!requests.has(key) && requests.size >= 10000) {
    const oldestKey = requests.keys().next().value;
    if (oldestKey !== undefined) requests.delete(oldestKey);
  }
  requests.set(key, entry);
  if (entry.count > MAX_REQUESTS) {
    return res.status(429).json({ error: "Terlalu banyak permintaan. Coba lagi sebentar." });
  }
  next();
async function robloxJson(url, options = {}) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 10000);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "Accept": "application/json",
        "User-Agent": "RobloxPublicAccountScanner/3.1",
        ...(options.headers || {})
      }
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error(
        body.errors?.[0]?.message ||
        `Roblox API merespons ${response.status}`
      );
      error.status = response.status;
      throw error;
    }

    return body;

  } catch (err) {
    if (err.name === "AbortError") {
      const error = new Error("Permintaan ke Roblox melewati batas waktu.");
      error.status = 504;
      throw error;
    }

    throw err;

  } finally {
    clearTimeout(timeout);
  }
}});

async function robloxJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  const response = await fetch(url, {
    signal: controller.signal,
    ...options,
    headers: {
      "Accept": "application/json",
      "User-Agent": "RobloxPublicAccountScanner/3.1",
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.errors?.[0]?.message || `Roblox API merespons ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

app.get("/api/user/:username", async (req, res) => {
  try {
    const username = String(req.params.username || "").trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({ error: "Username tidak valid." });
    }
    const lookup = await robloxJson("https://users.roblox.com/v1/usernames/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: true })
      });
    const user = lookup.data?.[0];
    if (!user) return res.status(404).json({ error: "Username tidak ditemukan." });

    const [profile, avatar] = await Promise.all([
      robloxJson(`https://users.roblox.com/v1/users/${user.id}`),
      robloxJson(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${user.id}&size=150x150&format=Png&isCircular=false`)
    ]);
    res.json({
      id: user.id,
      name: profile.name,
      displayName: profile.displayName,
      description: profile.description || "",
      created: profile.created,
      isBanned: !!profile.isBanned,
      avatar: avatar.data?.[0]?.imageUrl || ""
    });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message || "Tidak dapat mengambil profil Roblox." });
  }
});

app.get("/api/inventory/:userId", async (req, res) => {
  try {
    const userId = String(req.params.userId || "");
    if (!/^\d+$/.test(userId)) return res.status(400).json({ error: "User ID tidak valid." });

    const params = new URLSearchParams({ sortOrder: "Desc", limit: "100" });
    const cursor = String(req.query.cursor || "");
    if (cursor) params.set("cursor", cursor);
    const data = await robloxJson(
      `https://inventory.roblox.com/v1/users/${userId}/assets/collectibles?${params.toString()}`
    );
    const rawItems = data.data || [];
    const assetIds = [...new Set(rawItems.map(item => Number(item.assetId ?? item.id)).filter(id => Number.isSafeInteger(id) && id > 0))];
    let thumbnails = {};
    if (assetIds.length) {
      try {
        const thumbData = await robloxJson(
          `https://thumbnails.roblox.com/v1/assets?assetIds=${assetIds.join(",")}&size=150x150&format=Png&isCircular=false`
        );
        for (const thumb of (thumbData.data || [])) {
          if (thumb.targetId && thumb.imageUrl) thumbnails[thumb.targetId] = thumb.imageUrl;
        }
      } catch (_) {
        // Thumbnail failure must not prevent inventory data from loading.
      }
    }
    const items = rawItems.map(item => {
      const assetId = item.assetId ?? item.id ?? "";
      // The public collectibles response often has no acquisition timestamp.
      // Only use a timestamp if Roblox actually supplies one in the response.
      const possibleDate = item.acquiredAt || item.purchaseDate || null;
      const parsedDate = possibleDate && !Number.isNaN(Date.parse(possibleDate)) ? new Date(possibleDate).toISOString() : null;
      return {
        name: item.name || "Item tanpa nama",
        assetId,
        thumbnail: thumbnails[Number(assetId)] || null,
        rap: Number(item.recentAveragePrice || 0),
        originalPrice: item.originalPrice ?? null,
        serialNumber: item.serialNumber ?? null,
        acquiredAt: parsedDate
      };
    });
    res.json({
      items,
      nextPageCursor: data.nextPageCursor || null,
      previousPageCursor: data.previousPageCursor || null
    });
  } catch (err) {
    const status = err.status || 502;
    const message = status === 403
      ? "Inventaris tidak dapat diakses. Pengaturan privasi Roblox mungkin membatasi data ini."
      : (err.message || "Gagal mengambil inventaris.");
    res.status(status).json({ error: message });
  }
});


app.get("/api/communities/:userId", async (req, res) => {
  try {
    const userId = String(req.params.userId || "");
    if (!/^\d+$/.test(userId)) return res.status(400).json({ error: "User ID tidak valid." });
    const data = await robloxJson(`https://groups.roblox.com/v2/users/${userId}/groups/roles`);
    const communities = (data.data || []).map(entry => {
      const group = entry.group || {};
      const role = entry.role || {};
      const rank = Number(role.rank ?? 0);
      return {
        id: group.id,
        name: group.name || "Community tanpa nama",
        description: group.description || "",
        memberCount: Number(group.memberCount ?? 0),
        roleName: role.name || "Member",
        roleRank: rank,
        isOwner: rank >= 255,
        url: group.id ? `https://www.roblox.com/communities/${group.id}` : null
      };
    });
    communities.sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || b.memberCount - a.memberCount);
    res.json({ communities });
  } catch (err) {
    const status = err.status || 502;
    res.status(status).json({ error: status === 403 ? "Daftar community tidak tersedia untuk akun ini." : (err.message || "Gagal mengambil community.") });
  }
});

app.get("/api/creations/:userId", async (req, res) => {
  try {
    const userId = String(req.params.userId || "");
    if (!/^\d+$/.test(userId)) return res.status(400).json({ error: "User ID tidak valid." });
    const params = new URLSearchParams({ accessFilter: "Public", limit: "50", sortOrder: "Desc" });
    const cursor = String(req.query.cursor || "");
    if (cursor) params.set("cursor", cursor);
    const data = await robloxJson(`https://games.roblox.com/v2/users/${userId}/games?${params.toString()}`);
    const creations = (data.data || []).map(game => ({
      id: game.id,
      name: game.name || "Experience tanpa nama",
      description: game.description || "",
      playing: Number(game.playing ?? 0),
      visits: Number(game.placeVisits ?? 0),
      created: game.created || null,
      updated: game.updated || null,
      rootPlaceId: game.rootPlaceId || null,
      url: game.rootPlaceId ? `https://www.roblox.com/games/${game.rootPlaceId}` : (game.id ? `https://www.roblox.com/games/${game.id}` : null)
    }));
    res.json({ creations, nextPageCursor: data.nextPageCursor || null });
  } catch (err) {
    const status = err.status || 502;
    res.status(status).json({ error: status === 403 ? "Daftar experience publik tidak tersedia untuk akun ini." : (err.message || "Gagal mengambil daftar experience.") });
  }
});


app.get("/api/social/:userId", async (req, res) => {
  try {
    const userId = String(req.params.userId || "");

    if (!/^\d+$/.test(userId)) {
      return res.status(400).json({
        error: "User ID tidak valid."
      });
    }

    const urls = [
      "https://friends.roblox.com/v1/users/" + userId + "/friends/count",
      "https://friends.roblox.com/v1/users/" + userId + "/followers/count",
      "https://friends.roblox.com/v1/users/" + userId + "/followings/count"
    ];

    const results = await Promise.allSettled(
      urls.map(url => robloxJson(url))
    );

    const keys = ["friends", "followers", "following"];
    const social = {};

    results.forEach((result, index) => {
      social[keys[index]] =
        result.status === "fulfilled" &&
        Number.isFinite(Number(result.value.count))
          ? Number(result.value.count)
          : null;
    });

    res.json({ social });

  } catch (err) {
    res.status(err.status || 502).json({
      error: err.message || "Gagal mengambil statistik sosial."
    });
  }
});


app.get("/api/health", (_req, res) => res.json({ ok: true, version: "3.1.0" }));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Roblox Account Scanner V3.1 berjalan di http://localhost:${PORT}`);
});
