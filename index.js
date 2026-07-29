require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const cron = require("node-cron");
const config = require("./config");
const { appendRow, updateRowByRequestId, getTodayRows } = require("./sheets");

const bot = new Telegraf(process.env.BOT_TOKEN);

// Vaqtinchalik xotira (bot qayta ishga tushsa tozalanadi - kichik jamoa uchun yetarli)
const waitingForReason = new Map(); // userId -> { requestId, ... }
const waitingForTime = new Map(); // userId -> { requestId, ... }
const pendingApprovals = new Map(); // requestId -> full record

function branchInfo(threadId) {
  return config.branches[threadId] || { name: "Nomalum filial", startTime: "09:00" };
}

function nowInTashkent() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tashkent" }));
}

function fmtTime(date) {
  return date.toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tashkent" });
}

function fmtDate(date) {
  return date.toLocaleDateString("uz-UZ", { timeZone: "Asia/Tashkent" });
}

function isLate(branch, now) {
  const [h, m] = branch.startTime.split(":").map(Number);
  const start = new Date(now);
  start.setHours(h, m, 0, 0);
  const diffMin = (now - start) / 60000;
  return diffMin > config.lateThresholdMinutes;
}

function displayName(from) {
  return [from.first_name, from.last_name].filter(Boolean).join(" ") || from.username || String(from.id);
}

// Har bir filial mavzusida shu buyruq bilan doimiy tugmalar joylashtiriladi
bot.command("panel", async (ctx) => {
  const threadId = ctx.message.message_thread_id;
  await ctx.telegram.sendMessage(ctx.chat.id, "Davomat belgilash:", {
    message_thread_id: threadId,
    ...Markup.inlineKeyboard([
      Markup.button.callback("✅ Keldim", `in:${threadId || 0}`),
      Markup.button.callback("🚪 Ketdim", `out:${threadId || 0}`),
    ]),
  });
});

bot.action(/^out:(.+)$/, async (ctx) => {
  const threadId = Number(ctx.match[1]) || undefined;
  const branch = branchInfo(threadId);
  const now = nowInTashkent();
  const name = displayName(ctx.from);
  await appendRow([fmtDate(now), branch.name, name, ctx.from.id, "Ketdi", fmtTime(now), "", "", ""]);
  await ctx.answerCbQuery("Ketishingiz qayd etildi: " + fmtTime(now));
});

bot.action(/^in:(.+)$/, async (ctx) => {
  const threadId = Number(ctx.match[1]) || undefined;
  const branch = branchInfo(threadId);
  const now = nowInTashkent();
  const name = displayName(ctx.from);

  if (!isLate(branch, now)) {
    await appendRow([fmtDate(now), branch.name, name, ctx.from.id, "Keldi", fmtTime(now), "", "", ""]);
    await ctx.answerCbQuery("Kelishingiz qayd etildi: " + fmtTime(now));
    return;
  }

  // Kech qolgan - sabab yoki vaqt tuzatishni so'raymiz
  const requestId = `${ctx.from.id}_${Date.now()}`;
  pendingApprovals.set(requestId, {
    branch: branch.name,
    threadId,
    chatId: ctx.chat.id,
    name,
    userId: ctx.from.id,
    clickedTime: fmtTime(now),
    date: fmtDate(now),
  });
  await ctx.answerCbQuery();
  await ctx.telegram.sendMessage(
    ctx.chat.id,
    `${name}, siz kechroq belgiladingiz (${fmtTime(now)}). Sababi bormi?`,
    {
      message_thread_id: threadId,
      ...Markup.inlineKeyboard([
        Markup.button.callback("📝 Sababli", `reason:${requestId}`),
        Markup.button.callback("⏰ Aslida ertaroq keldim", `correct:${requestId}`),
      ]),
    }
  );
});

bot.action(/^reason:(.+)$/, async (ctx) => {
  const requestId = ctx.match[1];
  waitingForReason.set(ctx.from.id, requestId);
  await ctx.answerCbQuery();
  await ctx.reply("Sababini yozib yuboring:", { message_thread_id: ctx.callbackQuery.message.message_thread_id });
});

bot.action(/^correct:(.+)$/, async (ctx) => {
  const requestId = ctx.match[1];
  waitingForTime.set(ctx.from.id, requestId);
  await ctx.answerCbQuery();
  await ctx.reply("Aslida necha vaqtda kelgan edingiz? (masalan 09:00) va sababini yozing:", {
    message_thread_id: ctx.callbackQuery.message.message_thread_id,
  });
});

bot.on("text", async (ctx, next) => {
  const userId = ctx.from.id;

  if (waitingForReason.has(userId)) {
    const requestId = waitingForReason.get(userId);
    waitingForReason.delete(userId);
    const rec = pendingApprovals.get(requestId);
    if (!rec) return;
    await appendRow([rec.date, rec.branch, rec.name, rec.userId, "Keldi", rec.clickedTime, ctx.message.text, "Sababli", requestId]);
    pendingApprovals.delete(requestId);
    await ctx.reply("Qabul qilindi, rahmat.");
    return;
  }

  if (waitingForTime.has(userId)) {
    const requestId = waitingForTime.get(userId);
    waitingForTime.delete(userId);
    const rec = pendingApprovals.get(requestId);
    if (!rec) return;
    rec.claimedTime = ctx.message.text;
    pendingApprovals.set(requestId, rec);

    // Rasmiy vaqt hozircha bosgan vaqti bilan, "Kutilmoqda" holatida yoziladi
    await appendRow([rec.date, rec.branch, rec.name, rec.userId, "Keldi", rec.clickedTime, ctx.message.text, "Kutilmoqda", requestId]);

    await ctx.telegram.sendMessage(
      config.managerChatId,
      `${rec.name} (${rec.branch}) botga ${rec.clickedTime}da bosgan, lekin ${rec.claimedTime}da kelganini aytyapti.\nIzoh: ${ctx.message.text}`,
      Markup.inlineKeyboard([
        Markup.button.callback("✅ Tasdiqlash", `appr:${requestId}`),
        Markup.button.callback("❌ Rad etish", `rej:${requestId}`),
      ])
    );
    await ctx.reply("So'rovingiz rahbarga yuborildi, tasdiqlangach xabar beraman.");
    return;
  }

  return next();
});

bot.action(/^appr:(.+)$/, async (ctx) => {
  const requestId = ctx.match[1];
  const rec = pendingApprovals.get(requestId);
  if (!rec) return ctx.answerCbQuery("Topilmadi yoki eskirgan.");
  await updateRowByRequestId(requestId, { vaqt: rec.claimedTime, holat: "Tasdiqlangan" });
  await ctx.answerCbQuery("Tasdiqlandi");
  await ctx.editMessageText(ctx.callbackQuery.message.text + "\n\n✅ Tasdiqlandi");
  await ctx.telegram.sendMessage(rec.userId, `Vaqt tuzatishingiz tasdiqlandi: ${rec.claimedTime}`);
  pendingApprovals.delete(requestId);
});

bot.action(/^rej:(.+)$/, async (ctx) => {
  const requestId = ctx.match[1];
  const rec = pendingApprovals.get(requestId);
  if (!rec) return ctx.answerCbQuery("Topilmadi yoki eskirgan.");
  await updateRowByRequestId(requestId, { holat: "Rad etilgan" });
  await ctx.answerCbQuery("Rad etildi");
  await ctx.editMessageText(ctx.callbackQuery.message.text + "\n\n❌ Rad etildi (rasmiy vaqt o'zgarishsiz qoladi)");
  await ctx.telegram.sendMessage(rec.userId, `Vaqt tuzatish so'rovingiz rad etildi. Rasmiy vaqt: ${rec.clickedTime}`);
  pendingApprovals.delete(requestId);
});

// Kunlik hisobot
cron.schedule(config.dailyReportCron, async () => {
  const rows = await getTodayRows();
  if (rows.length === 0) return;
  const byBranch = {};
  for (const r of rows) {
    const branch = r[1];
    byBranch[branch] = byBranch[branch] || [];
    byBranch[branch].push(r);
  }
  let text = `📋 Bugungi davomat hisoboti (${fmtDate(nowInTashkent())})\n`;
  for (const [branch, list] of Object.entries(byBranch)) {
    text += `\n${branch}:\n`;
    for (const r of list) {
      text += `  ${r[2]} — ${r[4]} ${r[5]}${r[6] ? " (" + r[6] + ")" : ""}${r[7] ? " [" + r[7] + "]" : ""}\n`;
    }
  }
  await bot.telegram.sendMessage(config.managerChatId, text);
}, { timezone: "Asia/Tashkent" });

bot.launch();
console.log("Bot ishga tushdi");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
