/**
 * Auto Email Reader + All 6 Tracker Firer
 * - Fires ALL 6 tracking methods per email
 * - Marks each email as read after firing
 * - Run manually for now, add time trigger later
 */

// ─── WEB APP ENTRY POINT ──────────────────────────────────────────────────────
// function doGet(e) {
//   try {
//     autoReadAndFireTrackers(); // Calls your main function
//     return ContentService
//       .createTextOutput("✅ Success! Emails processed.")
//       .setMimeType(ContentService.MimeType.TEXT);
//   } catch (error) {
//     return ContentService
//       .createTextOutput("❌ Error: " + error.message)
//       .setMimeType(ContentService.MimeType.TEXT);
//   }
// }

// function doGet(e) {
//   // Trigger the main function in background
//   // Return response IMMEDIATELY without waiting
//   ScriptApp.newTrigger("autoReadAndFireTrackers")
//     .timeBased()
//     .after(1000) // Run after 1 second
//     .create();

//   return ContentService
//     .createTextOutput("✅ Job started! Emails are being processed in background.")
//     .setMimeType(ContentService.MimeType.TEXT);
// }

const QUERY      = "is:unread in:inbox";
const MAX_EMAILS = 10; // Set higher than 130 to make sure all are caught

// ─── MAIN FUNCTION ────────────────────────────────────────────────────────────
function autoReadAndFireTrackers() {
  const threads = GmailApp.search(QUERY, 0, MAX_EMAILS);

  if (threads.length === 0) {
    Logger.log("✅ No unread emails found.");
    return;
  }

  Logger.log(`📬 Found ${threads.length} unread thread(s). Processing...\n`);
  Logger.log("=".repeat(70));

  let totalEmails  = 0;
  let totalTrackers = 0;

  threads.forEach(thread => {
    thread.getMessages().forEach(message => {
      if (!message.isUnread()) return;

      const from    = message.getFrom();
      const subject = message.getSubject();
      const body    = message.getBody();
      const fired   = [];

      Logger.log(`\n📧 "${subject}"`);
      Logger.log(`   From: ${from}`);

      // ── 1. Tracking Pixels (1x1 or 0x0 img) ────────────────────────────
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

        if (isPixel) {
          const success = fireUrl(src);
          if (success) {
            fired.push(`🔴 Pixel: ${src.substring(0, 80)}`);
          }
        }
      });

      // ── 2. Tracked Links ─────────────────────────────────────────────────
      const links = body.match(/<a[^>]+href=["']([^"']+)["'][^>]*>/gi) || [];
      links.forEach(link => {
        const href = (link.match(/href=["']([^"']+)["']/i) || ["", ""])[1];
        if (!href || href.startsWith("mailto:") || href.startsWith("#")) return;

        const isTracked = /track|click|redirect|open\?|\/e\/|sendgrid|mailchimp|hubspot|klaviyo|convertkit|drip|activehosted|mailgun|sparkpost|constantcontact|marketo|salesforce|intercom|customer\.io|mandrillapp|myemma|sendinblue|pstmrk|getresponse|mailjet|yesware|mixmax|mailfoogae|mailtrack|bananatag|superhuman|close\.com/i.test(href);

        if (isTracked) {
          const success = fireUrl(href);
          if (success) {
            fired.push(`🔵 Tracked Link: ${href.substring(0, 80)}`);
          }
        }
      });

      // ── 3. CSS Background Beacons ────────────────────────────────────────
      const cssMatches = body.match(/background(?:-image)?\s*:\s*url\(["']?([^"')]+)["']?\)/gi) || [];
      cssMatches.forEach(css => {
        const url = (css.match(/url\(["']?([^"')]+)["']?\)/i) || ["", ""])[1];
        if (!url || url.startsWith("data:")) return;

        const success = fireUrl(url);
        if (success) {
          fired.push(`🟡 CSS Beacon: ${url.substring(0, 80)}`);
        }
      });

      // ── 4. Iframe Beacons ────────────────────────────────────────────────
      const iframes = body.match(/<iframe[^>]+src=["']([^"']+)["'][^>]*>/gi) || [];
      iframes.forEach(iframe => {
        const src = (iframe.match(/src=["']([^"']+)["']/i) || ["", ""])[1];
        if (!src) return;

        const success = fireUrl(src);
        if (success) {
          fired.push(`🟠 Iframe Beacon: ${src.substring(0, 80)}`);
        }
      });

      // ── 5. Preload / Prefetch Beacons ────────────────────────────────────
      const preloads = body.match(/<link[^>]+rel=["'](?:preload|prefetch)["'][^>]*>/gi) || [];
      preloads.forEach(link => {
        const href = (link.match(/href=["']([^"']+)["']/i) || ["", ""])[1];
        if (!href) return;

        const success = fireUrl(href);
        if (success) {
          fired.push(`🟣 Preload Beacon: ${href.substring(0, 80)}`);
        }
      });

      // ── 6. Hidden Input Beacons ──────────────────────────────────────────
      const hiddenInputs = body.match(/<input[^>]+type=["']hidden["'][^>]*>/gi) || [];
      hiddenInputs.forEach(input => {
        const value = (input.match(/value=["']([^"']+)["']/i) || ["", ""])[1];
        if (value && value.startsWith("http")) {
          const success = fireUrl(value);
          if (success) {
            fired.push(`⚪ Hidden Input: ${value.substring(0, 80)}`);
          }
        }
      });

      // ── Mark as read ─────────────────────────────────────────────────────
      message.markRead();
      totalEmails++;
      totalTrackers += fired.length;

      if (fired.length > 0) {
        Logger.log(`   Trackers fired (${fired.length}):`);
        fired.forEach(f => Logger.log(`   → ${f} ✅`));
      } else {
        Logger.log(`   → No trackers found (clean email)`);
      }
      Logger.log(`   → Marked as read ✅`);
    });
  });

  Logger.log("\n" + "=".repeat(70));
  Logger.log(`\n🎉 Done!`);
  Logger.log(`   Emails processed : ${totalEmails}`);
  Logger.log(`   Trackers fired   : ${totalTrackers}`);
}


// ─── HELPER: Fire a URL safely ────────────────────────────────────────────────
function fireUrl(url) {
  try {
    UrlFetchApp.fetch(url, {
      method:            "GET",
      followRedirects:   true,
      muteHttpExceptions: true,
      headers: {
        // Simulate a real browser opening the email
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept":     "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
      }
    });
    return true;
  } catch (e) {
    Logger.log(`   ⚠️ Failed to fire: ${url.substring(0, 60)} — ${e.message}`);
    return false;
  }
}
