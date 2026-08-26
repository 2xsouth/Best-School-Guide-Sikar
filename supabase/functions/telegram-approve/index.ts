// ============================================================
//  telegram-approve  (Supabase Edge Function)
//  Telegram calls this when you tap a button under a draft preview.
//    approve:<id>  -> set status='published' (goes live on the site)
//    reject:<id>   -> delete the draft
//
//  SECURITY:
//    - We verify the update came from Telegram using a secret token
//      that Telegram sends in a header (set when registering webhook).
//    - We check the tapping user's id equals TELEGRAM_CHAT_ID so only
//      YOU can approve, not anyone who finds the URL.
//
//  SECRETS:
//    SB_SERVICE_KEY        service_role key
//    TELEGRAM_BOT_TOKEN    from @BotFather
//    TELEGRAM_CHAT_ID      your chat id (only this user may approve)
//    TG_WEBHOOK_SECRET     any long random string you choose
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE_KEY = Deno.env.get("SB_SERVICE_KEY")!;
const TG_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TG_CHAT = Deno.env.get("TELEGRAM_CHAT_ID")!;
const WEBHOOK_SECRET = Deno.env.get("TG_WEBHOOK_SECRET")!;

Deno.serve(async (req) => {
  // 1) Verify the call really came from Telegram (secret header)
  const got = req.headers.get("x-telegram-bot-api-secret-token");
  if (got !== WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }

  const update = await req.json();
  const cb = update.callback_query;
  if (!cb) return ok();

  // 2) Only YOU (your chat id) may approve/reject
  if (String(cb.from?.id) !== String(TG_CHAT)) {
    await answer(cb.id, "Not authorised.");
    return ok();
  }

  const [action, id] = String(cb.data || "").split(":");
  const supabase = createClient(SB_URL, SB_SERVICE_KEY);

  try {
    if (action === "approve") {
      const { error } = await supabase.from("blog_posts")
        .update({ status: "published" }).eq("id", id);
      if (error) throw error;
      await editMsg(cb, "✅ Published — now live on the site.");
      await answer(cb.id, "Published!");
    } else if (action === "reject") {
      const { error } = await supabase.from("blog_posts").delete().eq("id", id);
      if (error) throw error;
      await editMsg(cb, "❌ Rejected — draft deleted.");
      await answer(cb.id, "Rejected.");
    } else {
      await answer(cb.id, "Unknown action.");
    }
  } catch (e) {
    await answer(cb.id, "Error: " + String(e));
  }
  return ok();
});

// --- Telegram helpers ---
async function answer(cbId: string, text: string) {
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callback_query_id: cbId, text }),
  });
}
async function editMsg(cb: any, statusLine: string) {
  const orig = cb.message?.text ?? "";
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/editMessageText`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: cb.message.chat.id,
      message_id: cb.message.message_id,
      text: orig + "\n\n" + statusLine,
    }),
  });
}
function ok() { return new Response("ok"); }
