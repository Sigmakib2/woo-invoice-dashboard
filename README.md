# woo-invoice-dashboard

**woo-invoice-dashboard** is an open-source admin suite for WooCommerce.
It helps shop owners and developers manage orders, generate invoices, export data, and view reports — all outside WordPress — with a modern React + Hono.js + Supabase stack.

---

## 🚀 Features

* 📊 **Dashboard** – a clean React-based admin dashboard for orders, stats, and reporting
* 🧾 **Invoices** – generate secure, shareable invoice links with revocation control
* 🔍 **Search** – powerful filters and search across orders and customers
* 📦 **Exports** – export orders, customers, and items in JSON or CSV
* 🔄 **Sync** – stay up-to-date with WooCommerce via webhooks or manual sync
* ⚡ **Modern stack** – built with React, Hono.js, and Supabase

---

## 🎯 Why this project?

Managing WooCommerce orders inside WordPress can feel limited, and many plugins for invoices, reporting, or exports are **paid and closed-source**.

This project exists to:

1. Provide a **free, open-source alternative** to WooCommerce admin/invoice plugins
2. Show how to build a **decoupled dashboard** outside WordPress
3. Let developers **customize and extend** WooCommerce workflows
4. Serve as a **reference project** for Hono.js + Supabase integrations

---

## 🗂 Project structure

```
woo-invoice-dashboard/
├── apps/
│   ├── dashboard/   # React admin dashboard
│   ├── invoice/     # React public invoice site
│   └── backend/     # Hono.js backend
├── db/
│   └── schema.sql   # Supabase/Postgres schema
├── README.md
├── LICENSE
└── .gitignore
```

---

## ⚡ Quick start

### Prerequisites

* Node.js 18+
* Supabase project (or any Postgres DB)
* WooCommerce store with REST API keys & a webhook secret

### 1. Clone the repo

```bash
git clone https://github.com/Sigmakib2/woo-invoice-dashboard.git
cd woo-invoice-dashboard
```

### 2. Install dependencies

```bash
cd apps/dashboard && npm install
cd ../invoice && npm install
cd ../backend && npm install
```

### 3. Configure environment

First, deploy the backend. Open the `wrangler.jsonc` file and fill in all required variables.

To set this up:

1. Go to Supabase and **create a project**.
2. Copy the DB schema from `./db/schema.sql` and paste it into the Supabase SQL editor to create your tables.
3. Copy the **Service Role key** and **Project URL**, then add them to your config:

```bash
# backend/wrangler.jsonc
"SUPABASE_SERVICE_ROLE_KEY": "*******************.*******************",
"WC_WEBHOOK_SECRET": "this_is_a_secret",
```

4. In your WooCommerce site dashboard, go to **Settings → Advanced → REST API** and create a new key (read-only is fine for now).
   Copy the **Consumer key** and **Consumer secret** and add them to your config:

```bash
"WC_CONSUMER_KEY": "ck_********************************",
"WC_CONSUMER_SECRET": "cs_********************************",
"WC_WEBHOOK_SECRET": "this_is_a_secret"
```

5. Next to the REST API settings, you’ll see **Webhook options**. Create webhooks for order create, update, and delete events.
   You’ll need a webhook URL, so deploy the backend first. (See the deployment section below.)

### 4. Run locally

* **Backend (Hono + Cloudflare Workers):**

```bash
cd apps/backend
npm install
npm run dev
```

You’ll get a localhost address — note it.

* **Invoice site:**

```bash
cd apps/invoice
npm install
npm run dev
```

In `./apps/invoice/src/App.jsx`, replace:

```js
const baseUrl = 'https://example.workers.dev';
```

with the backend localhost address you noted.

* **Dashboard:**

```bash
cd apps/dashboard
npm install
```

In `./apps/dashboard/src/App.jsx`, replace:

```js
const baseUrl = "https://example.workers.dev";
```

with the backend localhost address. Then run:

```bash
npm run dev
```

---

## 📦 Deployment

* **Backend:** Cloudflare Workers (recommended)
  From the backend folder:

  ```bash
  npm install
  npm run build
  npm run deploy
  ```

  Cloudflare will ask you to log in and will handle the deployment. Once complete, you’ll get a `.workers.dev` URL.

* **Frontend:** Vercel / Netlify / Cloudflare Pages

* **Database:** Supabase / Postgres

> **Note:** Update the frontend `baseUrl` values with your deployed backend `.workers.dev` address.

---

## 🛠 Contributing

PRs and issues are welcome! Please open a discussion before proposing major feature changes.

---

## 📄 License

This project is licensed under the [MIT License](./LICENSE).

---

## 🌐 Links

* [WooCommerce REST API docs](https://woocommerce.github.io/woocommerce-rest-api-docs/)
* [Supabase docs](https://supabase.com/docs)
* [Hono.js docs](https://hono.dev)
