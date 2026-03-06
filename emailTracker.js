/**
 * emailTracker.js
 * Hosted on GitHub — fetched and run by all accounts
 * No secrets here — all secrets stored in Apps Script Properties
 */

function autoReadAndFireTrackers() {
  // ── Clean up trigger ──────────────────────────────────────────────────────
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === "autoReadAndFireTrackers") {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // ── Load secrets from Properties ─────────────────────────────────────────
  const props            = PropertiesService.getScriptProperties();
  const TELEGRAM_TOKEN   = props.getProperty("TELEGRAM_TOKEN");
  const TELEGRAM_CHAT_ID = props.getProperty("TELEGRAM_CHAT_ID");
  const QUERY            = props.getProperty("QUERY") || "is:unread in:inbox";
  const MAX_EMAILS       = parseInt(props.getProperty("MAX_EMAILS")) || 200;

  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    Logger.log("❌ Secrets not found! Run setSecrets() first.");
    return;
  }

  // ── Tracker Signatures ────────────────────────────────────────────────────
  const TRACKER_SIGNATURES = [
    { name: "Mailchimp",       pattern: /list-manage\.com\/track|mailchimp\.com\/track/i },
    { name: "SendGrid",        pattern: /sendgrid\.net\/wf\/open|sendgrid\.net\/trk/i },
    { name: "HubSpot",         pattern: /hubspot\.com\/e2t|hs-analytics\.net|hubspotemail\.net/i },
    { name: "ConvertKit",      pattern: /convertkit\.com.*open|ck\.page/i },
    { name: "Klaviyo",         pattern: /klaviyomail\.com|klaviyo\.com\/open/i },
    { name: "ActiveCampaign",  pattern: /activehosted\.com\/lt\.php|activecampaign\.com/i },
    { name: "Mailgun",         pattern: /mailgun\.us\/e\/|mailgun\.org\/e\//i },
    { name: "Yesware",         pattern: /yesware\.com\/trk|yesware\.com\/e\//i },
    { name: "Mixmax",          pattern: /mixmax\.com\/e\/|track\.mixmax\.com/i },
    { name: "Mailtrack",       pattern: /mailtrack\.io\/trace/i },
    { name: "Superhuman",      pattern: /r\.superhuman\.com/i },
    { name: "Generic Tracker", pattern: /\/track\/open|\/pixel\/|\/beacon\/|\/open\?|\/e\/open/i },
  ];

  const account = Session.getActiveUser().getEmail();
  const threads = GmailApp.search(QUERY, 0, MAX_EMAILS);

  if (threads.length === 0) {
    Logger.log("✅ No unread emails found.");
    sendTelegram(TELEGRAM_TOKEN, TELEGRAM_CHAT_ID,
      `📭 *No Unread Emails*\n👤 *Account:* ${account}\n⏱️ ${new Date().toLocaleString()}`
    );
    return;
  }

  Logger.log(`📬 Found ${threads.length} thread(s). Processing...`);
  Logger.log("=".repeat(70));

  let totalEmails = 0;
  const counts = {
    pixel: 0, link: 0, css: 0,
    iframe: 0, preload: 0, hidden: 0
  };

  threads.forEach(thread => {
    thread.getMessages().forEach(message => {
      if (!message.isUnread()) return;

      const body    = message.getBody();
      const from    = message.getFrom();
      const subject = message.getSubject();
      const fired   = [];

      Logger.log(`\n📧 "${subject}"`);
      Logger.log(`   From: ${from}`);

      // ── 1. Tracking Pixels ─────────────────────────────────────────────
      const imgs = body.match(/<img[^>]+>/gi) || [];
      imgs.forEach(img => {
        const src = (img.match(/src=["']([^"']+)["']/i) || ["", ""])[1];
        if (!src || src.startsWith("data:")) return;

        const isPixel = (
          /width=["']?[01]["']?/i.test(img)  ||
          /height=["']?[01]["']?/i.test(img) ||
          /width:\s*[01]px/i.test(img)       ||
          /height:\s*[01]px/i.test(img)      ||
          /display:\s*none/i.test(img)
        );

        if (isPixel && fireUrl(src)) {
          counts.pixel++;
          fired.push(`🔴 Pixel`);
        }
      });

      // ── 2. Tracked Links ───────────────────────────────────────────────
      const links = body.match(/<a[^>]+href=["']([^"']+)["'][^>]*>/gi) || [];
      links.forEach(link => {
        const href = (link.match(/href=["']([^"']+)["']/i) || ["", ""])[1];
        if (!href || href.startsWith("mailto:") || href.startsWith("#")) return;

        const isTracked = TRACKER_SIGNATURES.some(t => t.pattern.test(href));
        if (isTracked && fireUrl(href)) {
          counts.link++;
          fired.push(`🔵 Link`);
        }
      });

      // ── 3. CSS Background Beacons ──────────────────────────────────────
      const cssMatches = body.match(/background(?:-image)?\s*:\s*url\(["']?([^"')]+)["']?\)/gi) || [];
      cssMatches.forEach(css => {
        const url = (css.match(/url\(["']?([^"')]+)["']?\)/i) || ["", ""])[1];
        if (!url || url.startsWith("data:")) return;

        if (fireUrl(url)) {
          counts.css++;
          fired.push(`🟡 CSS`);
        }
      });

      // ── 4. Iframe Beacons ──────────────────────────────────────────────
      const iframes = body.match(/<iframe[^>]+src=["']([^"']+)["'][^>]*>/gi) || [];
      iframes.forEach(iframe => {
        const src = (iframe.match(/src=["']([^"']+)["']/i) || ["", ""])[1];
        if (!src) return;

        if (fireUrl(src)) {
          counts.iframe++;
          fired.push(`🟠 Iframe`);
        }
      });

      // ── 5. Preload / Prefetch Beacons ──────────────────────────────────
      const preloads = body.match(/<link[^>]+rel=["'](?:preload|prefetch)["'][^>]*>/gi) || [];
      preloads.forEach(link => {
        const href = (link.match(/href=["']([^"']+)["']/i) || ["", ""])[1];
        if (!href) return;

        if (fireUrl(href)) {
          counts.preload++;
          fired.push(`🟣 Preload`);
        }
      });

      // ── 6. Hidden Input Beacons ────────────────────────────────────────
      const hiddenInputs = body.match(/<input[^>]+type=["']hidden["'][^>]*>/gi) || [];
      hiddenInputs.forEach(input => {
        const value = (input.match(/value=["']([^"']+)["']/i) || ["", ""])[1];
        if (value && value.startsWith("http") && fireUrl(value)) {
          counts.hidden++;
          fired.push(`⚪ Hidden`);
        }
      });

      // ── Mark as read ───────────────────────────────────────────────────
      message.markRead();
      totalEmails++;

      Logger.log(fired.length > 0
        ? `   Fired: ${fired.join(", ")} ✅`
        : `   → Clean email`
      );
    });
  });

  // ── Log to Sheet ─────────────────────────────────────────────────────────
  logToSheet(account, totalEmails, counts);

  // ── Send Telegram Summary ─────────────────────────────────────────────────
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const msg =
`🤖 *Email Tracker Report*

👤 *Account*  : ${account}
📬 *Emails*   : ${totalEmails} processed
─────────────────────
🔴 *Pixels*   : ${counts.pixel} fired
🔵 *Links*    : ${counts.link} fired
🟡 *CSS*      : ${counts.css} fired
🟠 *Iframes*  : ${counts.iframe} fired
🟣 *Preload*  : ${counts.preload} fired
⚪ *Hidden*   : ${counts.hidden} fired
─────────────────────
✅ *Total*    : ${total} trackers fired
⏱️ *Time*     : ${new Date().toLocaleString()}`;

  sendTelegram(TELEGRAM_TOKEN, TELEGRAM_CHAT_ID, msg);

  Logger.log("\n" + "=".repeat(70));
  Logger.log(`🎉 Done! ${totalEmails} emails | ${total} trackers fired`);
}


// ─── FIRE A URL ───────────────────────────────────────────────────────────────
function fireUrl(url) {
  try {
    const response = UrlFetchApp.fetch(url, {
      method:             "GET",
      followRedirects:    true,
      muteHttpExceptions: true,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept":     "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
      }
    });
    const status = response.getResponseCode();
    Logger.log(`   🚀 ${status < 400 ? "✅" : "⚠️"} ${status} → ${url.substring(0, 80)}`);
    return status < 400;
  } catch(e) {
    Logger.log(`   ❌ Failed → ${url.substring(0, 80)} — ${e.message}`);
    return false;
  }
}


// ─── SEND TELEGRAM ────────────────────────────────────────────────────────────
function sendTelegram(token, chatId, msg) {
  try {
    UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:      "post",
      contentType: "application/json",
      payload: JSON.stringify({
        chat_id:    chatId,
        text:       msg,
        parse_mode: "Markdown"
      })
    });
    Logger.log("📱 Telegram sent ✅");
  } catch(e) {
    Logger.log("❌ Telegram failed: " + e.message);
  }
}


// ─── LOG TO GOOGLE SHEET ──────────────────────────────────────────────────────
function logToSheet(account, totalEmails, counts) {
  try {
    const total  = Object.values(counts).reduce((a, b) => a + b, 0);
    const files  = DriveApp.getFilesByName("Email Tracker Log");
    let ss;

    if (files.hasNext()) {
      ss = SpreadsheetApp.open(files.next());
    } else {
      ss = SpreadsheetApp.create("Email Tracker Log");
      const sheet   = ss.getActiveSheet();
      sheet.setName("Log");
      const headers = ["Date", "Account", "Emails", "Pixels", "Links", "CSS", "Iframes", "Preload", "Hidden", "Total"];
      sheet.appendRow(headers);
      const headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setBackground("#0f172a");
      headerRange.setFontColor("#ffffff");
      headerRange.setFontWeight("bold");
      sheet.autoResizeColumns(1, headers.length);
    }

    ss.getSheetByName("Log").appendRow([
      new Date().toLocaleString(),
      account,
      totalEmails,
      counts.pixel,
      counts.link,
      counts.css,
      counts.iframe,
      counts.preload,
      counts.hidden,
      total
    ]);

    Logger.log("📊 Sheet logged ✅");
  } catch(e) {
    Logger.log("❌ Sheet log failed: " + e.message);
  }
}