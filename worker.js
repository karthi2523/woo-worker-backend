export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;


    const WOO_URL = env.WOO_URL;
    const CK = env.WOO_CK;
    const CS = env.WOO_CS;

    function buildWooURL(endpoint) {
      const hasQuery = endpoint.includes("?");
      const auth = `consumer_key=${CK}&consumer_secret=${CS}`;
      return `${WOO_URL}/wp-json/wc/v3/${endpoint}${hasQuery ? "&" : "?"}${auth}`;
    }


    async function wc(endpoint) {
      const apiUrl = buildWooURL(endpoint);
      const res = await fetch(apiUrl);
      if (!res.ok) {
        return { error: true, status: res.status, message: await res.text() };
      }
      return res.json();
    }


    if (path === "/products") {
      const data = await wc("products?per_page=100");
      return Response.json(data);
    }


    if (path === "/orders") {
      const data = await wc("orders?per_page=100&status=any");
      return Response.json(data);
    }


    if (path.startsWith("/orders/")) {
      const id = path.split("/")[2];
      const data = await wc(`orders/${id}`);
      return Response.json(data);
    }


    if (path === "/customers") {
      const orders = await wc("orders?per_page=100&status=any");

      const customers = {};

      (orders || []).forEach((order) => {
        const billing = order.billing || {};
        const key = billing.phone || billing.email;
        if (!key) return;

        if (!customers[key]) {
          customers[key] = {
            id: key,
            name: `${billing.first_name || ""} ${billing.last_name || ""}`.trim(),
            email: billing.email || "",
            phone: billing.phone || "",
            city: billing.city || "",
            state: billing.state || "",
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

      const orders = await wc("orders?per_page=100&status=any");

      const filtered = (orders || []).filter((o) => {
        const email = (o.billing.email || "").trim().toLowerCase();
        const phone = (o.billing.phone || "").trim().toLowerCase();
        return email === id || phone === id;
      });

      return Response.json(filtered);
    }

   

    return new Response("Woo Admin Backend Worker Running", { status: 200 });
  },
};
