// worker.js
import bcrypt from "bcryptjs"; // make sure bcryptjs is installed in your project (npm i bcryptjs)

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    /****************************
     * DB helper - load a user row by id (x-user-id header) or by email
     ****************************/
    async function loadUserById(userId) {
      if (!userId) return null;
      const row = await env.DB.prepare(
        "SELECT id, email, hashed_password, password, woo_url, woo_ck, woo_cs FROM users WHERE id = ?"
      )
        .bind(userId)
        .first();
      return row || null;
    }

    async function loadUserByEmail(email) {
      if (!email) return null;
      const row = await env.DB.prepare(
        "SELECT id, email, hashed_password, password, woo_url, woo_ck, woo_cs FROM users WHERE email = ?"
      )
        .bind(email)
        .first();
      return row || null;
    }

    /****************************
     * Woo helpers (build URL using provided keys)
     ****************************/
    function buildWooURLForKeys(wooUrl, ck, cs, endpoint) {
      const hasQuery = endpoint.includes("?");
      const auth = `consumer_key=${ck}&consumer_secret=${cs}`;
      // ensure no trailing slash on wooUrl
      return `${wooUrl.replace(/\/$/, "")}/wp-json/wc/v3/${endpoint}${hasQuery ? "&" : "?"}${auth}`;
    }

    async function wcGetWithKeys(wooUrl, ck, cs, endpoint) {
      const apiUrl = buildWooURLForKeys(wooUrl, ck, cs, endpoint);
      const res = await fetch(apiUrl);
      if (!res.ok) {
        const text = await res.text();
        return { error: true, status: res.status, message: text };
      }
      return res.json();
    }

    async function wcUpdateWithKeys(wooUrl, ck, cs, endpoint, body) {
      const apiUrl = buildWooURLForKeys(wooUrl, ck, cs, endpoint);
      const res = await fetch(apiUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        return { error: true, status: res.status, message: text };
      }
    }

    /****************************
     * LOGIN - POST /login
     * body: { email, password }
     * returns: { success: true, userId }
     ****************************/
    if (path === "/login" && method === "POST") {
      try {
        const { email, password } = await request.json();
        if (!email || !password) {
          return new Response(JSON.stringify({ error: "Email & password required" }), { status: 400 });
        }

        const row = await loadUserByEmail(email);
        if (!row) return new Response(JSON.stringify({ error: "Invalid credentials" }), { status: 401 });

        // Prefer hashed_password column; fall back to password for legacy
        const hash = row.hashed_password || row.password;
        if (!hash) return new Response(JSON.stringify({ error: "User password not set" }), { status: 500 });

        const ok = await bcrypt.compare(password, hash);
        if (!ok) return new Response(JSON.stringify({ error: "Invalid credentials" }), { status: 401 });

        // success -> return user id (client will pass x-user-id header for subsequent calls)
        return new Response(JSON.stringify({ success: true, userId: row.id }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.toString() }), { status: 500 });
      }
    }

    /****************************
     * Protected endpoints: require x-user-id header.
     * The pattern: load user (which contains woo_url, woo_ck, woo_cs),
     * then call WooCommerce with that user's keys.
     ****************************/

    if (path === "/products" && method === "GET") {
      try {
        const uid = request.headers.get("x-user-id");
        const user = await loadUserById(uid);
        if (!user) return new Response(JSON.stringify({ error: "Missing or invalid x-user-id header" }), { status: 401 });

        const data = await wcGetWithKeys(user.woo_url, user.woo_ck, user.woo_cs, "products?per_page=100");
        return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.toString() }), { status: 500 });
      }
    }

    if (path.startsWith("/products/") && method === "PUT") {
      try {
        const uid = request.headers.get("x-user-id");
        const user = await loadUserById(uid);
        if (!user) return new Response(JSON.stringify({ error: "Missing or invalid x-user-id header" }), { status: 401 });

        const id = path.split("/")[2];
        const body = await request.json();
        const updated = await wcUpdateWithKeys(user.woo_url, user.woo_ck, user.woo_cs, `products/${id}`, body);
        return new Response(JSON.stringify(updated), { headers: { "Content-Type": "application/json" } });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.toString() }), { status: 500 });
      }
    }

    if (path === "/orders" && method === "GET") {
      try {
        const uid = request.headers.get("x-user-id");
        const user = await loadUserById(uid);
        if (!user) return new Response(JSON.stringify({ error: "Missing or invalid x-user-id header" }), { status: 401 });

        const data = await wcGetWithKeys(user.woo_url, user.woo_ck, user.woo_cs, "orders?per_page=100&status=any");
        return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.toString() }), { status: 500 });
      }
    }

    if (path.startsWith("/orders/") && method === "GET") {
      try {
        const uid = request.headers.get("x-user-id");
        const user = await loadUserById(uid);
        if (!user) return new Response(JSON.stringify({ error: "Missing or invalid x-user-id header" }), { status: 401 });

        const id = path.split("/")[2];
        const data = await wcGetWithKeys(user.woo_url, user.woo_ck, user.woo_cs, `orders/${id}`);
        return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.toString() }), { status: 500 });
      }
    }

    if (path === "/customers" && method === "GET") {
      try {
        const uid = request.headers.get("x-user-id");
        const user = await loadUserById(uid);
        if (!user) return new Response(JSON.stringify({ error: "Missing or invalid x-user-id header" }), { status: 401 });

        const orders = await wcGetWithKeys(user.woo_url, user.woo_ck, user.woo_cs, "orders?per_page=100&status=any");
        const customers = {};
        (orders || []).forEach((order) => {
          const b = order.billing || {};
          const key = b.phone || b.email;
          if (!key) return;
          if (!customers[key]) {
            customers[key] = {
              id: key,
              name: `${b.first_name || ""} ${b.last_name || ""}`.trim(),
              email: b.email || "",
              phone: b.phone || "",
              city: b.city || "",
              state: b.state || "",
              totalOrders: 1,
              totalSpent: Number(order.total) || 0,
              lastOrderDate: order.date_created || null,
            };
          } else {
            customers[key].totalOrders++;
            customers[key].totalSpent += Number(order.total) || 0;
            const newer = new Date(order.date_created);
            const older = new Date(customers[key].lastOrderDate);
            if (newer > older) customers[key].lastOrderDate = order.date_created;
          }
        });

        return new Response(JSON.stringify(Object.values(customers)), { headers: { "Content-Type": "application/json" } });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.toString() }), { status: 500 });
      }
    }

    if (path.startsWith("/customers/orders/") && method === "GET") {
      try {
        const uid = request.headers.get("x-user-id");
        const user = await loadUserById(uid);
        if (!user) return new Response(JSON.stringify({ error: "Missing or invalid x-user-id header" }), { status: 401 });

        const id = decodeURIComponent(path.split("/")[3]).toLowerCase();
        const orders = await wcGetWithKeys(user.woo_url, user.woo_ck, user.woo_cs, "orders?per_page=100&status=any");
        const filtered = (orders || []).filter((o) => {
          const email = (o.billing.email || "").trim().toLowerCase();
          const phone = (o.billing.phone || "").trim().toLowerCase();
          return email === id || phone === id;
        });

        return new Response(JSON.stringify(filtered), { headers: { "Content-Type": "application/json" } });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.toString() }), { status: 500 });
      }
    }

    /****************************
     * FCM / push helpers and endpoints (unchanged from previous working version)
     ****************************/
    async function getAccessToken(env) {
      const header = { alg: "RS256", typ: "JWT" };
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: env.FCM_CLIENT_EMAIL,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      };

      const base64url = (obj) =>
        btoa(JSON.stringify(obj))
          .replace(/=/g, "")
          .replace(/\+/g, "-")
          .replace(/\//g, "_");

      const unsigned = `${base64url(header)}.${base64url(payload)}`;
      const privateKey = env.FCM_PRIVATE_KEY;

      function pemToBinary(pem) {
        const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, "")
          .replace(/-----END PRIVATE KEY-----/, "")
          .replace(/\s+/g, "");
        const raw = atob(b64);
        const buffer = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) {
          buffer[i] = raw.charCodeAt(i);
        }
        return buffer.buffer;
      }

      const binaryKey = pemToBinary(privateKey);

      const key = await crypto.subtle.importKey(
        "pkcs8",
        binaryKey,
        {
          name: "RSASSA-PKCS1-v1_5",
          hash: "SHA-256"
        },
        false,
        ["sign"]
      );

      const signatureBuffer = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        key,
        new TextEncoder().encode(unsigned)
      );

      const signature = btoa(
        String.fromCharCode(...new Uint8Array(signatureBuffer))
      )
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");

      const jwt = `${unsigned}.${signature}`;

      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body:
          "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=" +
          jwt,
      });

      const json = await tokenRes.json();
      return json.access_token;
    }

    if (path === "/save-token" && method === "POST") {
      const { fcmToken } = await request.json();

      if (!fcmToken) {
        return Response.json(
          { error: "fcmToken is required" },
          { status: 400 }
        );
      }

      await env.TOKENS.put(fcmToken, "1");
      return Response.json({ success: true });
    }

    if (path === "/order-created" && method === "POST") {
      const order = await request.json();
      const first = order?.billing?.first_name || "Customer";
      const total = order?.total || "0";
      const orderId = order?.id?.toString() || "";

      const keys = await env.TOKENS.list();
      const tokens = keys.keys.map((k) => k.name);

      if (tokens.length === 0) {
        return Response.json({ success: true, sent: 0 });
      }

      const accessToken = await getAccessToken(env);

      for (const token of tokens) {
        const message = {
          message: {
            token,
            notification: {
              title: `New Order #${orderId}`,
              body: `₹${total} from ${first}`,
            },
            data: {
              orderId,
            },
          },
        };

        await fetch(
          `https://fcm.googleapis.com/v1/projects/${env.FCM_PROJECT_ID}/messages:send`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(message),
          }
        );
      }

      return Response.json({ success: true, sent: tokens.length });
    }

    /****************************
     * test-notification route
     ****************************/
    if (path === "/test-notification" && method === "GET") {
      try {
        const keys = await env.TOKENS.list();
        const tokens = keys.keys.map(k => k.name);

        if (tokens.length === 0) {
          return Response.json({ error: "No tokens stored" }, { status: 404 });
        }

        const accessToken = await getAccessToken(env);

        let successCount = 0;

        for (const token of tokens) {
          const message = {
            message: {
              token,
              notification: {
                title: "Test Notification",
                body: "Your FCM setup is working! 🎉",
              },
              data: {
                type: "test",
              },
            },
          };

          const response = await fetch(
            `https://fcm.googleapis.com/v1/projects/${env.FCM_PROJECT_ID}/messages:send`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(message),
            }
          );

          if (response.ok) successCount++;
        }

        return Response.json({
          success: true,
          sent: successCount,
          total: tokens.length,
        });
      } catch (err) {
        return Response.json({ error: err.toString() }, { status: 500 });
      }
    }

    return new Response("Woo Admin Backend Worker Running", { status: 200 });
  },
};
