// ============================================================
//  generate-blog-draft  (Supabase Edge Function)
//  Runs daily via cron. Steps:
//    1. Read a free RSS education-news feed (metadata only)
//    2. Ask Gemini (free tier) to write an ORIGINAL Sikar-parent post
//       inspired by the topic, with ONE school mentioned naturally
//    3. Save as a DRAFT in blog_posts (status='draft')
//    4. Send a preview to Telegram with Approve / Reject buttons
//
//  SECRETS (set in Supabase -> Edge Functions -> Secrets):
//    SB_SERVICE_KEY      service_role key
//    GEMINI_API_KEY      Google AI Studio key (free tier)
//    TELEGRAM_BOT_TOKEN  from @BotFather
//    TELEGRAM_CHAT_ID    your own chat id (where approvals are sent)
//    PEXELS_API_KEY      free key from pexels.com (thumbnails)
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE_KEY = Deno.env.get("SB_SERVICE_KEY")!;
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY")!;
const TG_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TG_CHAT = Deno.env.get("TELEGRAM_CHAT_ID")!;
const PEXELS_KEY = Deno.env.get("PEXELS_API_KEY") ?? "";

// Free RSS feeds (no key needed). Google News query feeds are free & syndication-friendly.
const RSS_FEEDS = [
  "https://news.google.com/rss/search?q=CBSE+school+education+India&hl=en-IN&gl=IN&ceid=IN:en",
  "https://news.google.com/rss/search?q=RBSE+Rajasthan+school&hl=en-IN&gl=IN&ceid=IN:en",
  "https://news.google.com/rss/search?q=school+admission+parenting+India&hl=en-IN&gl=IN&ceid=IN:en",
  "https://news.google.com/rss/search?q=student+wellbeing+education+India&hl=en-IN&gl=IN&ceid=IN:en",
];

// School directory for backlinks. `url` = real official website (never AI-guessed).
// `keywords` decide topic match. Euro is the featured school and is preferred.
// `desc` is how the AI should refer to it. Order matters: Euro first.
const SCHOOL_TABLE = [
  { name: "Euro International School", url: "https://eurointernationalschool.in", featured: true,
    desc: "the first futuristic CBSE school in Sikar",
    keywords: ["cbse","coding","skill","wellbeing","well-being","mental","preschool","primary","admission","parenting","future","holistic","english","finland","entrepreneur","financial"] },
  { name: "PCP Sikar", url: "https://pcpsikar.com", featured: false,
    desc: "a leading JEE/NEET foundation campus in Sikar",
    keywords: ["jee","neet","foundation","competitive","medical","engineering","iit","aiims","dropper","olympiad"] },
  { name: "Prince Sainik School", url: "https://princesainikschool.com", featured: false,
    desc: "a leading NDA / defence academy in Sikar",
    keywords: ["nda","defence","defense","army","sainik","military","ssb"] },
  { name: "Swami Keshwanand School", url: "https://www.keshwanandschool.com", featured: false,
    desc: "a well-known boarding school in Sikar",
    keywords: ["boarding","hostel","residential","sports","swimming","outstation"] },
  { name: "Floreto World School", url: "https://floretoworldschool.com", featured: false,
    desc: "a leading ICSE school in Sikar",
    keywords: ["icse","cisce","montessori","early years","robotics"] },
  { name: "MHS World School", url: "https://www.mhsworldschool.org", featured: false,
    desc: "a top RBSE school in Sikar",
    keywords: ["rbse","rajasthan board","state board","stse","ntse"] },
];

Deno.serve(async (req) => {
  try {
    const supabase = createClient(SB_URL, SB_SERVICE_KEY);

    // Detect a "regenerate text" request (from the New-text button).
    let regenerate: number | null = null;
    let tgMessageId: number | null = null;
    let prevSeed = 0;
    try {
      const b = await req.json();
      if (b && b.regenerate) {
        regenerate = Number(b.regenerate);
        tgMessageId = b.tg_message_id ?? null;
        prevSeed = Number(b.prev_seed ?? 0);
      }
    } catch (_e) { /* no body = normal daily run */ }

    // 1) Pick a topic. Fresh run uses a time seed; regenerate advances the
    //    previous seed so it lands on a DIFFERENT topic each tap.
    const seed = regenerate
      ? (prevSeed + 1 + Math.floor(Math.random() * 3))
      : Math.floor(Date.now() / 1000) % 1000;
    const item = await getTopic(seed);
    if (!item) return json({ ok: false, reason: "no rss item" });

    // Pick the most relevant school for THIS topic (Euro preferred when it fits).
    const topicText = (item.title + " " + (item.source || "")).toLowerCase();
    const school = pickSchool(topicText);

    // 2) Gemini writes an ORIGINAL post (model: gemini-3.6-flash, free tier)
    const prompt =
`You write for "Best School Guide Sikar", a directory helping parents in Sikar, Rajasthan.
A news topic today (headline only): "${item.title}" (source: ${item.source}).

Write an ORIGINAL 400-500 word blog post for Sikar parents INSPIRED BY this topic.
STRICT RULES:
- Do NOT copy any sentence from the source. 100% your own words.
- Make it genuinely useful and specific to Sikar families.
${school ? `- Mention "${school.name}" (${school.desc}) exactly once, naturally, ONLY if it genuinely fits the topic. Write the school's name in full and exactly as given so it can be linked. If it does not fit, do not force it.` : `- Do not mention any specific school.`}
- Warm, clear, practical tone. No hype.
Return STRICT JSON only, no markdown, no backticks:
{"title": string, "category": one of ["Admissions","Boards","Fees","Parenting","Exams","Campus Life"], "body": string with \\n between paragraphs}`;

    const MODEL = "gemini-3.6-flash";
    const raw = await callGeminiWithRetry(MODEL, prompt, 4);
    if (!raw) return json({ ok: false, reason: "gemini unavailable after retries" });
    const post = JSON.parse(raw.replace(/```json|```/g, "").trim());
    post.body = insertSchoolLinks(post.body);

    const imageOptions = await fetchPexelsImages(post.category, item.title);
    const firstImage = imageOptions.length ? imageOptions[0] : null;

    const caption = `📝 *New blog draft*\n\n*${escMd(post.title)}*\n_${post.category}_\n\n${escMd(post.body.slice(0, 300))}...`;

    // ---- REGENERATE: update the existing draft row and edit the TG message ----
    if (regenerate) {
      const { error: upErr } = await supabase.from("blog_posts").update({
        title: post.title, category: post.category ?? "Parenting", body: post.body,
        image_url: firstImage, image_options: imageOptions, image_index: 0,
        topic_seed: seed, source_name: item.source, source_url: item.link,
      }).eq("id", regenerate);
      if (upErr) throw upErr;

      const buttons = fourButtons(regenerate);
      if (tgMessageId) {
        if (firstImage) {
          await tg("editMessageMedia", {
            chat_id: TG_CHAT, message_id: tgMessageId,
            media: { type: "photo", media: firstImage, caption, parse_mode: "Markdown" },
            reply_markup: buttons,
          });
        } else {
          await tg("editMessageCaption", {
            chat_id: TG_CHAT, message_id: tgMessageId, caption,
            parse_mode: "Markdown", reply_markup: buttons,
          });
        }
      }
      return json({ ok: true, regenerated: regenerate, title: post.title });
    }

    // ---- FRESH: insert a new draft and send a new Telegram message ----
    const { data, error } = await supabase.from("blog_posts").insert({
      title: post.title,
      category: post.category ?? "Parenting",
      author: "Editorial",
      body: post.body,
      image_url: firstImage,
      image_options: imageOptions,
      image_index: 0,
      topic_seed: seed,
      status: "draft",
      source_name: item.source,
      source_url: item.link,
    }).select().single();
    if (error) throw error;

    const buttons = fourButtons(data.id);
    if (firstImage) {
      await tg("sendPhoto", {
        chat_id: TG_CHAT, photo: firstImage, caption,
        parse_mode: "Markdown", reply_markup: buttons,
      });
    } else {
      await tg("sendMessage", {
        chat_id: TG_CHAT, text: caption,
        parse_mode: "Markdown", reply_markup: buttons,
      });
    }

    return json({ ok: true, draftId: data.id, title: post.title });
  } catch (e) {
    return json({ ok: false, error: String(e) });
  }
});

// The 4-button layout shared by fresh + regenerated drafts.
function fourButtons(id: number | string) {
  return {
    inline_keyboard: [
      [{ text: "🔄 New text", callback_data: `text:${id}` },
       { text: "🖼️ New image", callback_data: `image:${id}` }],
      [{ text: "✅ Approve & Publish", callback_data: `approve:${id}` },
       { text: "❌ Reject", callback_data: `reject:${id}` }],
    ],
  };
}

// --- helpers ---

// Pick a topic from the RSS feeds using a seed, so different seeds -> different
// feed + different headline (used by "New text" to move to a fresh topic).
async function getTopic(seed: number) {
  const feed = RSS_FEEDS[seed % RSS_FEEDS.length];
  try {
    const xml = await (await fetch(feed)).text();
    const items = parseItems(xml, 8);
    if (!items.length) return null;
    // pick a headline offset by the seed so repeats land on different stories
    return items[Math.floor(seed / RSS_FEEDS.length) % items.length];
  } catch (_e) {
    return null;
  }
}

// Choose the best school for a topic. Euro (featured) wins if it matches OR
// if nothing else matches (it fits most general parenting/admissions topics).
function pickSchool(topicText: string) {
  const euro = SCHOOL_TABLE.find((s) => s.featured)!;
  // 1) A non-Euro school whose keyword strongly matches the topic takes priority
  //    ONLY for clearly specialised topics (boarding, NDA, JEE/NEET, ICSE, RBSE).
  for (const s of SCHOOL_TABLE) {
    if (s.featured) continue;
    if (s.keywords.some((k) => topicText.includes(k))) return s;
  }
  // 2) Otherwise Euro if it matches any of its (broad) keywords
  if (euro.keywords.some((k) => topicText.includes(k))) return euro;
  // 3) Fallback: Euro anyway (featured school, fits general topics)
  return euro;
}

// Wrap the FIRST occurrence of a known school name with a link to its official
// site. Only exact known names are linked, from our trusted table — the AI never
// supplies a URL. Names are matched once each to avoid over-linking.
function insertSchoolLinks(body: string): string {
  let out = body;
  for (const s of SCHOOL_TABLE) {
    const idx = out.indexOf(s.name);
    if (idx === -1) continue;
    const link = `<a href="${s.url}" target="_blank" rel="noopener">${s.name}</a>`;
    out = out.slice(0, idx) + link + out.slice(idx + s.name.length);
  }
  return out;
}

// Free, licensed thumbnails from Pexels, strongly biased toward Indian schools.
// Returns a LIST of landscape image URLs (for the Change-image cycle).
async function fetchPexelsImages(category: string, _title: string): Promise<string[]> {
  if (!PEXELS_KEY) return [];
  // Indian-first search terms per category.
  const map: Record<string, string> = {
    Admissions: "indian school students admission",
    Boards: "indian students classroom exam",
    Fees: "indian school building campus",
    Parenting: "indian parent child studying",
    Exams: "indian student studying books",
    "Campus Life": "indian school children playground",
  };
  const primary = map[category] || "indian school education";
  // Try the Indian query first; if too few results, fall back to a broader one.
  let urls = await pexelsSearch(primary);
  if (urls.length < 3) {
    const extra = await pexelsSearch("india education classroom");
    urls = urls.concat(extra);
  }
  // de-dupe, keep up to 15
  return [...new Set(urls)].slice(0, 15);
}

async function pexelsSearch(query: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=15&orientation=landscape`,
      { headers: { Authorization: PEXELS_KEY } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.photos || [])
      .map((p: any) => p?.src?.landscape || p?.src?.large || p?.src?.medium)
      .filter(Boolean);
  } catch (_e) {
    return [];
  }
}

// Small Telegram API helper.
async function tg(method: string, payload: unknown) {
  return fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// Calls Gemini generateContent; retries on 503 "high demand" with backoff.
async function callGeminiWithRetry(model: string, prompt: string, maxTries: number): Promise<string | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      });
      if (res.status === 503 || res.status === 429) {
        // overloaded / rate-limited — wait and retry
        await sleep(attempt * 4000);
        continue;
      }
      const g = await res.json();
      const text = g?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      if (text) return text;
      // empty response — retry once more
      await sleep(attempt * 2000);
    } catch (_e) {
      await sleep(attempt * 2000);
    }
  }
  return null;
}
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// Parse up to N items from an RSS feed (title/link/source each).
function parseItems(xml: string, max = 8) {
  const blocks = xml.split("<item>").slice(1, max + 1);
  const items: { title: string; link: string; source: string }[] = [];
  for (const block of blocks) {
    const pick = (tag: string) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "";
    };
    const title = pick("title");
    if (title) items.push({ title, link: pick("link"), source: pick("source") || "News" });
  }
  return items;
}
function escMd(t: string) { return t.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1"); }
function json(o: unknown) {
  return new Response(JSON.stringify(o), { headers: { "content-type": "application/json" } });
}
