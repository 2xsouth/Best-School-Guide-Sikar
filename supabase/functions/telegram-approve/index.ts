import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE_KEY = Deno.env.get("SB_SERVICE_KEY")!;
const TG_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TG_CHAT = Deno.env.get("TELEGRAM_CHAT_ID")!;
const WEBHOOK_SECRET = Deno.env.get("TG_WEBHOOK_SECRET")!;

Deno.serve(async (req) => {
  const got = req.headers.get("x-telegram-bot-api-secret-token");
  if (got !== WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }

  const update = await req.json();
  const cb = update.callback_query;
  if (!cb) return ok();

  if (String(cb.from?.id) !== String(TG_CHAT)) {
    await answer(cb.id, "Not authorised.");
    return ok();
  }

  const [action, id] = String(cb.data || "").split(":");

  // This initialization was missing in the diagnostic test
  const supabase = createClient(SB_URL, SB_SERVICE_KEY);

  try {
    if (action === "approve") {
      const { error } = await supabase.from("blog_posts")
        .update({ status: "published" }).eq("id", id);
      if (error) throw error;
      await editCaption(cb, "✅ Published — now live on the site.");
      await answer(cb.id, "Published!");
    } else if (action === "reject") {
      const { error } = await supabase.from("blog_posts").delete().eq("id", id);
      if (error) throw error;
      await editCaption(cb, "❌ Rejected — draft deleted.");
      await answer(cb.id, "Rejected.");
    } else if (action === "image") {
      const { data, error } = await supabase.from("blog_posts")
        .select("image_options, image_index").eq("id", id).single();
      if (error) throw error;
      const opts: string[] = Array.isArray(data?.image_options) ? data.image_options : [];
      if (opts.length < 2) { await answer(cb.id, "No other images available."); return ok(); }
      const nextIndex = ((data.image_index ?? 0) + 1) % opts.length;
      const nextUrl = opts[nextIndex];
      const up = await supabase.from("blog_posts")
        .update({ image_index: nextIndex, image_url: nextUrl }).eq("id", id);
      if (up.error) throw up.error;
      await editPhoto(cb, nextUrl);
      await answer(cb.id, `Image ${nextIndex + 1} of ${opts.length}`);
    } else if (action === "text") {
      // 1. Answer Telegram instantly
      await answer(cb.id, "Writing a new post…");

      const { data } = await supabase.from("blog_posts")
        .select("topic_seed").eq("id", id).single();

      // 2. Trigger generation asynchronously
      fetch(`${SB_URL}/functions/v1/generate-blog-draft`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Authorization": `Bearer ${SB_SERVICE_KEY}`,
        },
        body: JSON.stringify({
          regenerate: Number(id),
          tg_message_id: cb.message.message_id,
          prev_seed: data?.topic_seed ?? 0,
        }),
      }).catch(err => console.error("Trigger failed:", err));

      return ok();
    } else {
      await answer(cb.id, "Unknown action.");
    }
  } catch (e) {
    await answer(cb.id, "Error: " + String(e));
  }
  return ok();
});

async function answer(cbId: string, text: string) {
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callback_query_id: cbId, text }),
  });
}

async function editCaption(cb: any, statusLine: string) {
  const orig = cb.message?.caption ?? cb.message?.text ?? "";
  const method = cb.message?.caption !== undefined ? "editMessageCaption" : "editMessageText";
  const field = method === "editMessageCaption" ? "caption" : "text";
  const body: any = {
    chat_id: cb.message.chat.id,
    message_id: cb.message.message_id,
  };
  body[field] = orig + "\n\n" + statusLine;
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function editPhoto(cb: any, url: string) {
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/editMessageMedia`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: cb.message.chat.id,
      message_id: cb.message.message_id,
      media: { type: "photo", media: url, caption: cb.message?.caption ?? "", parse_mode: "Markdown" },
      reply_markup: cb.message?.reply_markup,
    }),
  });
}

function ok() { return new Response("ok"); }