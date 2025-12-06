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


    if (path === "/save-token" && method === "POST") {
      const body = await request.json();
      const token = body.expoPushToken;

      if (!token) {
        return Response.json({ error: "expoPushToken is required" }, { status: 400 });
      }

      await env.TOKENS.put(token, "1");
      return Response.json({ success: true });
    }

    if (path === "/order-created" && method === "POST") {
      const order = await request.json();
      const first = order?.billing?.first_name || "Customer";
      const total = order?.total || "0";
      const orderId = order?.id || "";

      const keys = await env.TOKENS.list();
      const tokens = keys.keys.map((k) => k.name);

      for (const token of tokens) {
        const payload = {
          to: token,
          sound: "default",
          title: `New Order #${orderId}`,
          body: `Amount ₹${total} from ${first}`,
          data: { orderId },
        };

        await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      return Response.json({ success: true });
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


    if (path === "/test-notification") {
      try {
        const keys = await env.TOKENS.list();
        const tokens = keys.keys.map((k) => k.name);

        for (const token of tokens) {
          await fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              to: token,
              sound: "default",
              title: "Test Notification",
              body: "Worker test message",
            }),
          });
        }

        return Response.json({ ok: true, sent: tokens.length });
      } catch (err) {
        return Response.json({ error: err.toString() }, { status: 500 });
      }
    }


    return new Response("Woo Admin Backend Worker Running", { status: 200 });
  },
};
