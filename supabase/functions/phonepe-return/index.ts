const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex,nofollow" />
    <title>Return to CapDent</title>
    <style>
      :root { color-scheme: light; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f6fafb; color: #18313a; padding: 24px; box-sizing: border-box; }
      main { width: min(100%, 440px); background: #fff; border: 1px solid #dbe7ea; border-radius: 24px; padding: 28px; box-shadow: 0 18px 50px rgba(24,49,58,.08); }
      h1 { margin: 0 0 12px; font-size: 26px; }
      p { margin: 0 0 20px; line-height: 1.55; color: #58717a; }
      a { display: inline-flex; min-height: 48px; align-items: center; justify-content: center; padding: 0 18px; border-radius: 14px; background: #0f766e; color: white; text-decoration: none; font-weight: 800; }
      small { display: block; margin-top: 18px; color: #71868d; line-height: 1.45; }
    </style>
  </head>
  <body>
    <main>
      <h1>Return to CapDent</h1>
      <p>The PhonePe checkout flow has finished. Return to CapDent to verify the payment status against PhonePe before the invoice is updated.</p>
      <a href="dms://reports/invoices">Return to CapDent</a>
      <small>This page does not indicate that a payment succeeded. CapDent marks an invoice paid only after server-side verification.</small>
    </main>
  </body>
</html>`;

Deno.serve((req) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  return new Response(req.method === "HEAD" ? null : html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    },
  });
});
