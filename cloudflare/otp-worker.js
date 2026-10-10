/**
 * Sri Sai Vani Collections - Admin OTP Worker
 *
 * Required Cloudflare Worker bindings/secrets:
 *   KV namespace binding: OTP_STORE
 *   Secret: RESEND_API_KEY (Vinith)
 *   Secret: RESEND_API_KEY_SRISAI (Sri Sai Vani)
 *
 * Deploy this file to the Worker separately. Committing it to GitHub provides
 * version control only; it does not automatically deploy the Cloudflare Worker.
 */

const ALLOWED_ORIGINS = new Set([
  "https://vinith1111.github.io",
  "https://srisaivanicollections.github.io",
]);

const ADMIN_EMAILS = new Set([
  "vinith.paithari@gmail.com",
  "srisaivanicollections@gmail.com",
]);

const OTP_TTL_SECONDS = 300; // 5 minutes
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_VERIFY_ATTEMPTS = 5;

function jsonResponse(body, status = 200, origin = "") {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
  }

  return new Response(JSON.stringify(body), { status, headers });
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function randomOtp() {
  // Generate a uniformly distributed six-digit code using Web Crypto.
  const values = new Uint32Array(1);
  const range = 1_000_000;
  const ceiling = Math.floor(0x1_0000_0000 / range) * range;
  let value;

  do {
    crypto.getRandomValues(values);
    value = values[0];
  } while (value >= ceiling);

  return String(value % range).padStart(6, "0");
}

async function sendOtpEmail(env, email, otp) {
  // Select the Resend account associated with the requested Admin email.
  const apiKey = email === "srisaivanicollections@gmail.com"
    ? env.RESEND_API_KEY_SRISAI
    : env.RESEND_API_KEY;

  if (!apiKey) {
    console.error("Missing Resend API key for authorized Admin email.");
    throw new Error("Email provider is not configured for this address.");
  }
  const subject = `Your Sri Sai Vani Admin verification code: ${otp}`;
  const text = [
    "Sri Sai Vani Collections Admin verification",
    "",
    `Your verification code is: ${otp}`,
    "",
    "Enter this six-digit code in the Admin sign-in window.",
    "This code expires in 5 minutes and can be used only once.",
    "If you did not request this code, you can ignore this email.",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#faf7f2;color:#1c1917;font-family:Arial,Helvetica,sans-serif">
    <main style="max-width:480px;margin:0 auto;background:#fff;padding:28px;border:1px solid #e4d8c5;border-radius:12px">
      <p style="margin:0 0 12px;color:#7b6848;font-size:12px;letter-spacing:1.5px;text-transform:uppercase">Sri Sai Vani Collections</p>
      <h1 style="font-size:22px;line-height:1.3;margin:0 0 12px">Admin verification code</h1>
      <p style="font-size:15px;line-height:1.6;margin:0 0 18px">Use this six-digit code to sign in to Admin Studio:</p>
      <p style="font-family:Arial,Helvetica,sans-serif;font-size:32px;font-weight:700;letter-spacing:8px;margin:0 0 20px;padding:16px 12px;text-align:center;background:#f4f0e9;border-radius:8px;color:#1c1917">${otp}</p>
      <p style="font-size:14px;line-height:1.6;margin:0 0 8px">This code expires in <strong>5 minutes</strong> and can be used only once.</p>
      <p style="font-size:13px;line-height:1.6;color:#625d55;margin:0">If you did not request this code, ignore this email.</p>
    </main>
  </body>
</html>`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Sri Sai Vani Admin <onboarding@resend.dev>",
      to: [email],
      subject,
      text,
      html,
    }),
  });

  if (!response.ok) {
    // Do not return provider response details or credentials to the browser.
    console.error("Resend email request failed with status", response.status);
    throw new Error("Could not send the verification email. Please try again later.");
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      if (!ALLOWED_ORIGINS.has(origin)) {
        return new Response(null, { status: 403, headers: { "Vary": "Origin" } });
      }

      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
          "Vary": "Origin",
        },
      });
    }

    if (request.method !== "POST") {
      return jsonResponse({ success: false, message: "Method not allowed." }, 405, origin);
    }

    if (!ALLOWED_ORIGINS.has(origin)) {
      return jsonResponse({ success: false, message: "Origin not allowed." }, 403);
    }

    if (!env.OTP_STORE || !env.RESEND_API_KEY) {
      console.error("Worker configuration is missing OTP_STORE or RESEND_API_KEY.");
      return jsonResponse({ success: false, message: "OTP service is not configured." }, 500, origin);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ success: false, message: "Invalid request body." }, 400, origin);
    }

    const action = String(payload?.action || "").trim().toLowerCase();
    const email = normalizeEmail(payload?.email);

    if (!isValidEmail(email)) {
      return jsonResponse({ success: false, message: "Enter a valid email address." }, 400, origin);
    }

    if (!ADMIN_EMAILS.has(email)) {
      return jsonResponse({ success: false, message: "This email is not authorized for Admin access." }, 403, origin);
    }

    const otpKey = `otp:${email}`;
    const cooldownKey = `cooldown:${email}`;
    const attemptsKey = `attempts:${email}`;

    if (action === "send") {
      const existingCooldown = await env.OTP_STORE.get(cooldownKey);
      if (existingCooldown) {
        return jsonResponse({
          success: false,
          message: "Please wait before requesting another code.",
        }, 429, origin);
      }

      const otp = randomOtp();

      try {
        // Send first; store the OTP only if the email provider accepts the request.
        await sendOtpEmail(env, email, otp);
      } catch (error) {
        console.error("OTP email delivery failed:", error instanceof Error ? error.message : "Unknown error");
        return jsonResponse({
          success: false,
          message: "Could not send the verification email. Please try again later.",
        }, 502, origin);
      }

      const record = {
        otp,
        expiresAt: Date.now() + OTP_TTL_SECONDS * 1000,
      };

      await Promise.all([
        env.OTP_STORE.put(otpKey, JSON.stringify(record), { expirationTtl: OTP_TTL_SECONDS }),
        env.OTP_STORE.put(cooldownKey, "1", { expirationTtl: RESEND_COOLDOWN_SECONDS }),
        env.OTP_STORE.delete(attemptsKey),
      ]);

      return jsonResponse({ success: true, message: "OTP sent." }, 200, origin);
    }

    if (action === "verify") {
      const submittedOtp = String(payload?.otp || "").replace(/\D/g, "");
      if (!/^\d{6}$/.test(submittedOtp)) {
        return jsonResponse({ success: false, message: "Enter the 6-digit OTP." }, 400, origin);
      }

      const currentAttempts = Number(await env.OTP_STORE.get(attemptsKey) || "0");
      if (currentAttempts >= MAX_VERIFY_ATTEMPTS) {
        return jsonResponse({
          success: false,
          message: "Too many incorrect attempts. Request a new code.",
        }, 429, origin);
      }

      const stored = await env.OTP_STORE.get(otpKey);
      if (!stored) {
        return jsonResponse({
          success: false,
          message: "This code has expired or was already used. Request a new code.",
        }, 400, origin);
      }

      let record;
      try {
        record = JSON.parse(stored);
      } catch {
        await env.OTP_STORE.delete(otpKey);
        return jsonResponse({ success: false, message: "Invalid code. Request a new one." }, 400, origin);
      }

      if (!record?.expiresAt || Date.now() > record.expiresAt) {
        await Promise.all([
          env.OTP_STORE.delete(otpKey),
          env.OTP_STORE.delete(attemptsKey),
        ]);
        return jsonResponse({
          success: false,
          message: "This code has expired. Request a new code.",
        }, 400, origin);
      }

      if (record.otp !== submittedOtp) {
        const nextAttempts = currentAttempts + 1;
        await env.OTP_STORE.put(attemptsKey, String(nextAttempts), {
          expirationTtl: OTP_TTL_SECONDS,
        });

        return jsonResponse({
          success: false,
          message: nextAttempts >= MAX_VERIFY_ATTEMPTS
            ? "Too many incorrect attempts. Request a new code."
            : "Incorrect code. Please try again.",
        }, 400, origin);
      }

      await Promise.all([
        env.OTP_STORE.delete(otpKey),
        env.OTP_STORE.delete(attemptsKey),
        env.OTP_STORE.delete(cooldownKey),
      ]);

      return jsonResponse({ success: true, message: "OTP verified." }, 200, origin);
    }

    return jsonResponse({ success: false, message: "Unsupported action." }, 400, origin);
  },
};
