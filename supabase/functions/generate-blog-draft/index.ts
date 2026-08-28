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
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE_KEY = Deno.env.get("SB_SERVICE_KEY")!;
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY")!;
const TG_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TG_CHAT = Deno.env.get("TELEGRAM_CHAT_ID")!;

// Free RSS feeds (no key needed). Google News query feeds are free & syndication-friendly.
const RSS_FEEDS = [
  "https://news.google.com/rss/search?q=CBSE+school+education+India&hl=en-IN&gl=IN&ceid=IN:en",
  "https://news.google.com/rss/search?q=RBSE+Rajasthan+school&hl=en-IN&gl=IN&ceid=IN:en",
  "https://news.google.com/rss/search?q=school+admission+parenting+India&hl=en-IN&gl=IN&ceid=IN:en",
  "https://news.google.com/rss/search?q=student+wellbeing+education+India&hl=en-IN&gl=IN&ceid=IN:en",
];

// Schools to weave in (rotates). Keep it light — one per post.
const SCHOOLS = [
  "Euro International School (the first futuristic CBSE school in Sikar)",
  "PCP Sikar (a leading JEE/NEET foundation campus in Sikar)",
  "Swami Keshwanand School (a well-known boarding school in Sikar)",
];

Deno.serve(async () => {
  try {
    const supabase = createClient(SB_URL, SB_SERVICE_KEY);

    // 1) Pick today's feed and grab the newest headline (metadata only, no copying)
    const feed = RSS_FEEDS[new Date().getDate() % RSS_FEEDS.length];
    const rssText = await (await fetch(feed)).text();
    const item = parseFirstItem(rssText);
    if (!item) return json({ ok: false, reason: "no rss item" });

    const school = SCHOOLS[new Date().getDate() % SCHOOLS.length];

    // 2) Gemini writes an ORIGINAL post (model: gemini-3.6-flash, free tier)
    const prompt =
`You write for "Best School Guide Sikar", a directory helping parents in Sikar, Rajasthan.
A news topic today (headline only): "${item.title}" (source: ${item.source}).

Write an ORIGINAL 400-500 word blog post for Sikar parents INSPIRED BY this topic.
STRICT RULES:
- Do NOT copy any sentence from the source. 100% your own words.
- Make it genuinely useful and specific to Sikar families.
- Mention ${school} exactly once, naturally, only if it fits.
- Warm, clear, practical tone. No hype.
Return STRICT JSON only, no markdown, no backticks:
{"title": string, "category": one of ["Admissions","Boards","Fees","Parenting","Exams","Campus Life"], "body": string with \\n between paragraphs}`;

    // Call Gemini (model: gemini-3.6-flash) with retries for 503 "high demand".
    const MODEL = "gemini-3.6-flash";
    const raw = await callGeminiWithRetry(MODEL, prompt, 4);
    if (!raw) return json({ ok: false, reason: "gemini unavailable after retries" });
    const post = JSON.parse(raw.replace(/```json|```/g, "").trim());

    // 3) Save as DRAFT (invisible to the public site)
    const { data, error } = await supabase.from("blog_posts").insert({
      title: post.title,
      category: post.category ?? "Parenting",
      author: "Editorial",
      body: post.body,
      image_url: null,
      status: "draft",
      source_name: item.source,
      source_url: item.link,
    }).select().single();
    if (error) throw error;

    // 4) Send Telegram preview with Approve / Reject buttons
    const preview = `📝 *New blog draft*\n\n*${escMd(post.title)}*\n_${post.category}_\n\n${escMd(post.body.slice(0, 350))}...`;
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: TG_CHAT,
        text: preview,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[
            { text: "✅ Approve & Publish", callback_data: `approve:${data.id}` },
            { text: "❌ Reject", callback_data: `reject:${data.id}` },
          ]],
        },
      }),
    });

    return json({ ok: true, draftId: data.id, title: post.title });
  } catch (e) {
    return json({ ok: false, error: String(e) });
  }
});

// --- helpers ---
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

function parseFirstItem(xml: string) {
  const block = xml.split("<item>")[1];
  if (!block) return null;
  const pick = (tag: string) => {
    const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
    return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "";
  };
  const title = pick("title");
  const link = pick("link");
  const source = pick("source") || "News";
  return title ? { title, link, source } : null;
}
function escMd(t: string) { return t.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1"); }
function json(o: unknown) {
  return new Response(JSON.stringify(o), { headers: { "content-type": "application/json" } });
}
