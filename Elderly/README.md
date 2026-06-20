# Elder Ease

**An accessibility-first online store that removes the digital barriers preventing older adults from independently buying the products that help them live comfortably — pairing a senior-friendly storefront with a complete, secure commerce and admin backend.**

Elder Ease is a full-stack e-commerce web application selling everyday-living and assistive products (mobility aids, bathroom safety, health monitors, kitchen helpers, comfort items) designed specifically for **elderly and less tech-confident shoppers** and their caregivers.

---

## The problem it solves

Most online stores are hard for older people to use — small text, cramped buttons, low-contrast colours, confusing flows, and products scattered across generic catalogues. That friction means seniors either give up, depend on others to shop for them, or miss out on aids that would help them live independently.

Elder Ease tackles this on two fronts:

**1. An accessible, low-friction shopping experience**
- Large 17px+ text, high-contrast colour (WCAG-grade), big unmistakable buttons, visible keyboard focus, 44px touch targets, and `prefers-reduced-motion` support.
- A calm, consistent "Warm Civic Trust" design — friendly Rubik / Nunito Sans type, soft surfaces, a blue identity with a single warm-orange "action" colour so it's always clear what to click.
- A cinematic but reassuring landing page, clear trust signals (free shipping, easy returns, human support), and simple navigation.

**2. A curated, well-organised catalogue of independent-living products**
- 65 products grouped into **7 departments** (Mobility, Bathroom, Kitchen & Dining, Health, Comfort & Bedroom, Daily Living, Safety & Home), each with plain-language descriptions, real photos, and INR pricing.
- Search with live autocomplete, department filtering, and related-product suggestions.

---

## Features

### For customers
- Browse, **search (with live autocomplete)**, and **filter by department**
- Product detail pages with stock status and related items
- **Cart & checkout** with a real **order-confirmation email**
- **Order history** — track, **cancel** (while Processing), and **reorder** past orders
- **Wishlist / favourites**
- **Back-in-stock email alerts**
- Account & profile editing with **photo upload**
- Register / log in / log out

### For admins
- **Sales dashboard** — revenue, order & status breakdown, best sellers, low-stock, date-range filter
- **Product management** — create / edit / delete with image upload, stock, and department
- **Order management** — view any order, update status
- **CSV export** of all orders
- **Low-stock email alerts**

### Engineering qualities
- **Security** — bcrypt password hashing, sessions, **CSRF protection on every form**, **login rate-limiting**, admin-only route guards, configurable secret & SMTP via environment variables
- **Inventory integrity** — stock validated and **atomically decremented at checkout**; out-of-stock items blocked and quantities capped
- **Resilience** — real product photos with inline-SVG fallbacks when offline; email sends via real SMTP, an Ethereal test inbox, or console — fire-and-forget so it never blocks checkout

---

## Tech stack

| Layer | Choice |
|-------|--------|
| Runtime | Node.js |
| Server | Express |
| Views | EJS (server-rendered) |
| Database | SQLite via `better-sqlite3` |
| Auth | `express-session` + `bcryptjs` |
| Uploads | `multer` |
| Email | `nodemailer` |
| Frontend | Plain CSS + vanilla JS (no framework) |
| Fonts | Rubik (display) + Nunito Sans (body) |

---

## Getting started

### Prerequisites
- Node.js (18+ recommended)

### Install & seed
```bash
npm install      # install dependencies
npm run seed     # create and populate the SQLite database (65 products, demo user)
```

### Run
```bash
npm start        # start the server on http://localhost:3000
# or
npm run dev
```

Then open **http://localhost:3000**.

### Demo login
| Role | Email | Password |
|------|-------|----------|
| Admin / customer | `margaret@example.com` | `password123` |

The demo user is an admin, so the **Admin** dashboard appears in the nav once logged in.

---

## Configuration

All configuration is via environment variables (see `.env.example`). All are optional for local use — sensible defaults apply.

| Variable | Purpose | Default |
|----------|---------|---------|
| `SESSION_SECRET` | Signs session cookies (set a long random value in production) | insecure dev default (warns at startup) |
| `PORT` | Port to listen on | `3000` |
| `ADMIN_EMAIL` | Recipient for low-stock alerts | first admin user's email |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` | Real email delivery | falls back to an **Ethereal** test inbox (logs a preview URL), then to console |
| `MAIL_FROM` | "From" address on emails | `"Elder Ease" <orders@elderease.example>` |

Example:
```bash
SESSION_SECRET="a-long-random-string" ADMIN_EMAIL="admin@example.com" npm start
```

---

## Project structure

```
.
├── server.js              # Express app: routes, auth, cart, checkout, admin, email hooks
├── mail.js                # Nodemailer transport + order/stock email templates
├── db/
│   ├── db.js              # SQLite connection, schema, lightweight migrations
│   ├── seed.js            # `npm run seed` — products, departments, demo user, sample orders
│   └── elderease.db       # generated database (git-ignored)
├── views/                 # EJS templates
│   ├── partials/          # head, header (glass nav), footer, csrf, wishlist-button, admin-nav
│   ├── landing.ejs        # cinematic video landing page (home)
│   ├── shopmore / product / cart / wishlist / search ...
│   ├── myacc / editprofile / order-detail / order-confirmation ...
│   ├── login / register
│   └── admin* (dashboard, products, orders, order-detail, product-form)
├── public/
│   ├── css/               # app.css (tokens + global system) + per-page stylesheets
│   ├── js/                # search.js (autocomplete), ui.js (nav/back-to-top), hero-video.js
│   └── uploads/           # user-uploaded images (git-ignored)
├── .env.example
└── package.json
```

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` / `npm run dev` | Start the server |
| `npm run seed` | Reset and reseed the database |

---

## Notes

- Product photos are keyword-matched stock images and require an internet connection; an inline-SVG placeholder is shown as a fallback when offline.
- Re-running `npm run seed` resets the database to a clean demo state (catalogue + sample orders; clears carts, wishlists, and uploads references).
- The cinematic landing page streams a background video; the readable hero text shows immediately while it buffers, and the video is hidden for users who prefer reduced motion.
