/**
 * Gmail relay for the FUTURA AI trial verification email.
 *
 * Deploy this file as a Google Apps Script Web App:
 * - Execute as: Me
 * - Access: Anyone (the endpoint is protected by the shared token)
 * Add the same 48+ character random token to Script Properties using the key
 * FUTURA_RELAY_TOKEN. Configure the /exec URL and token as Cloudflare Worker
 * variables GMAIL_RELAY_URL and GMAIL_RELAY_TOKEN respectively.
 *
 * Never put the token in a URL, source control, or a user-visible page.
 */
function doPost(e) {
  try {
    const input = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const expected = PropertiesService.getScriptProperties().getProperty("FUTURA_RELAY_TOKEN") || "";
    const supplied = String(input.token || "");
    if (!expected || expected.length < 32 || !constantTimeEquals(expected, supplied)) {
      return jsonResponse({ ok: false, error: "unauthorized" });
    }
    const to = String(input.to || "").trim();
    const subject = String(input.subject || "").trim();
    const text = String(input.text || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || subject.length < 1 || subject.length > 180 || text.length > 12000) {
      return jsonResponse({ ok: false, error: "invalid_message" });
    }
    GmailApp.sendEmail(to, subject, text, { name: "FUTURA AI" });
    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({ ok: false, error: "send_failed" });
  }
}

function constantTimeEquals(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function jsonResponse(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
