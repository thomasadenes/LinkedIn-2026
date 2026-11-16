import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";

const token = process.env.NOTION_TOKEN?.trim();
const password = process.env.DASHBOARD_PASSWORD;
if (!token || !password) throw new Error("Secrets NOTION_TOKEN et DASHBOARD_PASSWORD requis.");
if (password.length < 12) throw new Error("DASHBOARD_PASSWORD doit contenir au moins 12 caractères.");

const API = "https://api.notion.com/v1";
const SOURCES = {
  posts: "2b685b85-3c98-819a-a4c8-000be1ab0080",
  followers: "2ed85b85-3c98-8061-84bb-000b072914e0",
  historical: "41a85b85-3c98-81b4-9e75-000b132c0654"
};
const START = "2026-01-01";
const END_EXCLUSIVE = "2026-11-01";

async function queryAll(id, filter) {
  const rows = [];
  let cursor;
  do {
    const payload = { page_size: 100, filter };
    if (cursor) payload.start_cursor = cursor;
    let response;
    for (let retry = 0; retry < 4; retry++) {
      response = await fetch(`${API}/data_sources/${id}/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": "2025-09-03",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      if (response.status !== 429 && response.status < 500) break;
      await new Promise(resolve => setTimeout(resolve, 1500 * (retry + 1)));
    }
    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Notion API ${response.status} pour ${id}: ${details.slice(0, 1000)}`);
    }
    const page = await response.json();
    rows.push(...page.results);
    cursor = page.has_more ? page.next_cursor : null;
    if (page.has_more && !cursor) throw new Error("Pagination Notion incohérente");
  } while (cursor);
  return rows;
}
const field = (page, key) => page.properties?.[key];
const plain = value => {
  if (!value) return null;
  if (value.type === "title" || value.type === "rich_text") return (value[value.type] ?? []).map(t => t.plain_text ?? t.text?.content ?? "").join("");
  if (value.type === "select" || value.type === "status") return value[value.type]?.name ?? null;
  if (value.type === "date") return value.date?.start ?? null;
  if (value.type === "number") return value.number ?? null;
  if (value.type === "url") return value.url ?? null;
  return null;
};
const get = (p, key) => plain(field(p, key));
const dateOnly = value => typeof value === "string" ? value.slice(0, 10) : null;
const inRange = value => !!value && value >= START && value < END_EXCLUSIVE;
const dateFilter = property => ({
  and: [
    { property, date: { on_or_after: START } },
    { property, date: { before: END_EXCLUSIVE } }
  ]
});

const [postRows, followerRows, historicalRows] = await Promise.all([
  queryAll(SOURCES.posts, {
    and: [
      { property: "Statut", status: { equals: "Publié" } },
      ...dateFilter("Date de publication").and
    ]
  }),
  queryAll(SOURCES.followers, dateFilter("Date de données")),
  queryAll(SOURCES.historical, {and:[{property:"Date de publication",date:{on_or_after:"2024-01-01"}},{property:"Date de publication",date:{before:"2026-01-01"}}]}).catch(error => { console.warn("Archive historique non accessible : partage de la base requis.", error.message); return []; })
]);

const posts2026 = postRows.map(p => ({
  id: p.id,
  title: get(p, "Nom"),
  page: get(p, "Page"),
  date: dateOnly(get(p, "Date de publication")),
  format: get(p, "Format"),
  impressions: get(p, "Impressions"),
  clicks: get(p, "Clics"),
  ctr: get(p, "CTR"),
  reactions: get(p, "Réactions"),
  comments: get(p, "Commentaires"),
  shares: get(p, "Repartages"),
  engagementRate: get(p, "Taux d'engagement"),
  videoViews: get(p, "Vues (vidéo)"),
  topic: get(p, "Sujet éditoriaux"),
  url: get(p, "URL"),
  notionUrl: p.url
})).filter(p => inRange(p.date)).sort((a,b) => a.date.localeCompare(b.date));

const historicalPosts = historicalRows.map(p => ({
  id: p.id,
  title: get(p, "Publication"),
  page: get(p, "Page regroupée") || get(p, "Page historique"),
  originalPage: get(p, "Page historique"),
  date: dateOnly(get(p, "Date de publication")),
  format: ({ "Visuel": "Image", "VIdéo": "Vidéo" })[get(p, "Format")] || get(p, "Format"),
  originalFormat: get(p, "Format"),
  impressions: get(p, "Impressions"),
  clicks: get(p, "Clics"),
  ctr: get(p, "CTR"),
  reactions: get(p, "Réactions"),
  comments: get(p, "Commentaires"),
  shares: get(p, "Repartages"),
  engagementRate: get(p, "Taux d engagement"),
  videoViews: get(p, "Vues"),
  sourceFile: get(p, "Fichier source"),
  url: null,
  notionUrl: p.url
})).filter(p => p.date >= "2024-01-01" && p.date < "2026-01-01");
const posts = [...historicalPosts, ...posts2026].sort((a,b) => a.date.localeCompare(b.date));

const followers = followerRows.map(p => ({
  id: p.id,
  page: get(p, "Page"),
  date: dateOnly(get(p, "Date de données")),
  count: get(p, "Abonnés")
})).filter(p => inRange(p.date) && p.count !== null)
  .sort((a,b) => a.date.localeCompare(b.date));

if (!posts.length && !followers.length) {
  throw new Error("Aucune donnée trouvée : synchronisation annulée pour ne pas remplacer un export valide.");
}
const data = {
  period: { from: "2024-01-01", to: "2026-10-31" },
  syncedAt: new Date().toISOString(),
  posts,
  followers,
  pageAliases: { "ADENES Fr": "ADENES France", "CREATIV’": "ROADIA", "CREATIV\u0027": "ROADIA" },
  note: "Ne pas fusionner Adenes Monde et BATIFIVE sans validation."
};

const salt = randomBytes(16);
const iv = randomBytes(12);
const iterations = 310000;
const key = pbkdf2Sync(password, salt, iterations, 32, "sha256");
const cipher = createCipheriv("aes-256-gcm", key, iv);
const plaintext = Buffer.from(JSON.stringify(data), "utf8");
const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
await writeFile("data.enc.json", JSON.stringify({
  version: 1,
  kdf: "PBKDF2-SHA-256",
  cipher: "AES-GCM",
  salt: salt.toString("base64"),
  iterations,
  iv: iv.toString("base64"),
  ciphertext: ciphertext.toString("base64")
}) + "\n");
console.log(`Export chiffré créé : ${posts.length} publications, ${followers.length} relevés d'abonnés.`);
