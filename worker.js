export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Woocommerce credentials
    const WOO_URL = env.WOO_URL;
    const CK = env.WOO_CK;
    const CS = env.WOO_CS;

    // Helper function to call WooCommerce REST API
    async function wc(endpoint) {
      const apiUrl = `${WOO_URL}/wp-json/wc/v3/${endpoint}&consumer_key=${CK}&consumer_secret=${CS}`;
      const res = await fetch(apiUrl);
      return res.json();
    }

    // ROUTES
    if (path === "/products") {
      const data = await wc("products?per_page=100");
      return Response.json(data);
    }

    if (path === "/orders") {
      const data = await wc("orders?per_page=50");
      return Response.json(data);
    }

    if (path.startsWith("/orders/")) {
      const id = path.split("/")[2];
      const data = await wc(`orders/${id}?`);
      return Response.json(data);
    }

    if (path === "/customers") {
      const orders = await wc("orders?per_page=100&status=any");

      const customers = {};

      orders.forEach((order) => {
        const billing = order.billing || {};
        const id = billing.phone || billing.email;

        if (!id) return;

        if (!customers[id]) {
          customers[id] = {
            id,
            name: `${billing.first_name} ${billing.last_name}`.trim(),
            email: billing.email,
            phone: billing.phone,
            city: billing.city,
            state: billing.state,
            totalOrders: 1,
            totalSpent: Number(order.total),
          };
        } else {
          customers[id].totalOrders++;
          customers[id].totalSpent += Number(order.total);
        }
      });

      return Response.json(Object.values(customers));
    }

    if (path.startsWith("/customers/orders/")) {
      const id = decodeURIComponent(path.split("/")[3]).toLowerCase();

      const orders = await wc("orders?per_page=100&status=any");

      const filtered = orders.filter((o) => {
        const email = (o.billing.email || "").toLowerCase();
        const phone = (o.billing.phone || "").toLowerCase();
        return email === id || phone === id;
      });

      return Response.json(filtered);
    }

    return new Response("Woo Admin Backend Running", { status: 200 });
  },
};
