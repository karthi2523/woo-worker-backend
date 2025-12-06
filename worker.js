export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const WOO_URL = env.WOO_URL;
    const CK = env.WOO_CK;
    const CS = env.WOO_CS;

    function buildWooURL(endpoint) {
      const hasQuery = endpoint.includes("?");
      const auth = `consumer_key=${CK}&consumer_secret=${CS}`;
      return `${WOO_URL}/wp-json/wc/v3/${endpoint}${hasQuery ? "&" : "?"}${auth}`;
    }

    async function wcGet(endpoint) {
      const apiUrl = buildWooURL(endpoint);
      const res = await fetch(apiUrl);
      if (!res.ok) {
        return { error: true, status: res.status, message: await res.text() };
      }
      return res.json();
    }

    async function wcUpdate(endpoint, body) {
      const apiUrl = buildWooURL(endpoint);
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
      const privateKey = env.FCM_PRIVATE_KEY.replace(/\\n/g, "\n");

      const key = await crypto.subtle.importKey(
        "pkcs8",
        new TextEncoder().encode(privateKey),
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
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

    if (path === "/products" && method === "GET") {
      const data = await wcGet("products?per_page=100");
      return Response.json(data);
    }

    if (path.startsWith("/products/") && method === "PUT") {
      const id = path.split("/")[2];
      const body = await request.json();
      const updated = await wcUpdate(`products/${id}`, body);
      return Response.json(updated);
    }


    if (path === "/orders" && method === "GET") {
      const data = await wcGet("orders?per_page=100&status=any");
      return Response.json(data);
    }

    if (path.startsWith("/orders/") && method === "GET") {
      const id = path.split("/")[2];
      const data = await wcGet(`orders/${id}`);
      return Response.json(data);
    }

    if (path === "/customers") {
      const orders = await wcGet("orders?per_page=100&status=any");
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

      return Response.json(Object.values(customers));
    }

    if (path.startsWith("/customers/orders/")) {
      const id = decodeURIComponent(path.split("/")[3]).toLowerCase();
      const orders = await wcGet("orders?per_page=100&status=any");

      const filtered = (orders || []).filter((o) => {
        const email = (o.billing.email || "").trim().toLowerCase();
        const phone = (o.billing.phone || "").trim().toLowerCase();
        return email === id || phone === id;
      });

      return Response.json(filtered);
    }

        if (path === "/test-notification" && method === "GET") {
      try {
        // Load tokens from KV
        const keys = await env.TOKENS.list();
        const tokens = keys.keys.map(k => k.name);

        if (tokens.length === 0) {
          return Response.json({ error: "No tokens stored" }, { status: 404 });
        }

        // Generate access token for FCM
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
