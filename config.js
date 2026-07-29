// Bu faylda faqat sozlamalar bor - kod yozish shart emas, shu yerni to'ldirasiz.

module.exports = {
  // Har bir mavzu (topic) qaysi filialga tegishli ekanini shu yerga yozasiz.
  // Guruhda topic yaratilgach, uning message_thread_id raqamini shu yerga qo'yamiz.
  // Buni birga to'ldiramiz - hozircha bo'sh, keyingi qadamda to'ldiramiz.
  branches: {
    // misol: 5: { name: "Ofis", startTime: "09:00" },
  },

  // Necha daqiqadan keyin "kech qoldi" deb hisoblanadi
  lateThresholdMinutes: 15,

  // Rahbarga hisobot va tasdiqlash so'rovlari qayerga boradi (sizning shaxsiy Telegram chat ID'ingiz)
  managerChatId: process.env.MANAGER_CHAT_ID,

  // Google Sheets fayl ID'si (linkdan olinadi)
  spreadsheetId: process.env.SPREADSHEET_ID,
  sheetName: "Davomat",

  // Kunlik hisobot qaysi vaqtda yuborilishi (Toshkent vaqti bilan)
  dailyReportCron: "0 10 * * *",
};
