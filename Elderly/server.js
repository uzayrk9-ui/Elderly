const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const db = require('./db/db');
const { sendOrderConfirmation, sendBackInStock, sendLowStockAlert } = require('./mail');

const app = express();
const PORT = process.env.PORT || 3000;

// --- File uploads (profile photos + product images) ---
const uploadDir = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

// --- View engine & middleware ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
const SESSION_SECRET = process.env.SESSION_SECRET || 'elder-ease-dev-secret-change-me';
if (!process.env.SESSION_SECRET) {
  console.warn('[warn] SESSION_SECRET not set — using an insecure dev default. Set it in production.');
}
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 1000 * 60 * 60 * 24 }, // 1 day
}));

// Inline SVG placeholder image helper (no external assets needed)
function placeholder(text, w = 300, h = 200) {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>` +
    `<rect width='100%' height='100%' fill='#dbeafe'/>` +
    `<text x='50%' y='50%' fill='#2563eb' font-size='20' text-anchor='middle' ` +
    `dy='.35em' font-family='Arial'>${text}</text></svg>`;
  // Escape single quotes too, so the data URI is safe inside both
  // double-quoted attributes and single-quoted JS onerror handlers.
  return 'data:image/svg+xml,' + encodeURIComponent(svg).replace(/'/g, '%27');
}

// Expose common data to every view (user, cart count, flash, helpers)
app.use((req, res, next) => {
  let user = null;
  if (req.session.userId) {
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId) || null;
  }
  const cart = req.session.cart || {};
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  let wishlistIds = [];
  if (user) {
    wishlistIds = db.prepare('SELECT product_id FROM wishlist WHERE user_id = ?')
      .all(user.id).map((r) => r.product_id);
  }
  res.locals.user = user;
  res.locals.cartCount = Object.values(cart).reduce((a, b) => a + b, 0);
  res.locals.wishlistIds = wishlistIds;
  res.locals.wishlistCount = wishlistIds.length;
  res.locals.placeholder = placeholder;
  res.locals.money = money;
  res.locals.formatDate = formatDate;
  res.locals.csrfToken = req.session.csrfToken;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

// --- CSRF protection (synchronizer-token pattern) ---
function validCsrf(req) {
  const token = (req.body && req.body._csrf) || req.get('x-csrf-token');
  return !!token && token === req.session.csrfToken;
}
function rejectCsrf(req, res) {
  req.session.flash = { type: 'error', msg: 'Security check failed. Please try again.' };
  res.redirect(req.get('referer') || '/');
}
// Global guard: validates normal form posts. Multipart bodies aren't parsed
// yet at this stage, so those routes re-validate with csrfCheck after multer.
function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const ct = req.get('content-type') || '';
  if (ct.startsWith('multipart/form-data')) return next();
  if (!validCsrf(req)) return rejectCsrf(req, res);
  next();
}
// In-route guard for multipart routes, placed after multer has parsed req.body.
function csrfCheck(req, res, next) {
  if (!validCsrf(req)) return rejectCsrf(req, res);
  next();
}
app.use(csrfGuard);

function requireLogin(req, res, next) {
  if (!req.session.userId) {
    req.session.flash = { type: 'error', msg: 'Please log in to continue.' };
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!res.locals.user) {
    req.session.flash = { type: 'error', msg: 'Please log in to continue.' };
    return res.redirect('/login');
  }
  if (!res.locals.user.is_admin) {
    req.session.flash = { type: 'error', msg: 'Admin access only.' };
    return res.redirect('/');
  }
  next();
}

const money = (n) =>
  '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

// SQLite stores datetime('now') as 'YYYY-MM-DD HH:MM:SS' in UTC
function formatDate(s) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

// --- Simple in-memory login rate limiter (per IP) ---
const loginAttempts = new Map(); // ip -> { count, resetAt }
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function loginLimiter(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (rec && now > rec.resetAt) loginAttempts.delete(ip);
  const cur = loginAttempts.get(ip);
  if (cur && cur.count >= MAX_LOGIN_ATTEMPTS) {
    const mins = Math.max(1, Math.ceil((cur.resetAt - now) / 60000));
    req.session.flash = {
      type: 'error',
      msg: `Too many login attempts. Please try again in ${mins} minute${mins === 1 ? '' : 's'}.`,
    };
    return res.redirect('/login');
  }
  next();
}

function recordLoginFailure(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (!rec || now > rec.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  } else {
    rec.count += 1;
  }
}

// --- Stock-change side effects: back-in-stock + low-stock admin alerts ---
const LOW_STOCK_THRESHOLD = 5;

function adminEmail() {
  if (process.env.ADMIN_EMAIL) return process.env.ADMIN_EMAIL;
  const admin = db.prepare('SELECT email FROM users WHERE is_admin = 1 ORDER BY id LIMIT 1').get();
  return admin ? admin.email : null;
}

function handleStockChange(productId, oldStock, newStock) {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!product) return;

  // Back in stock: went from none to some -> notify subscribers, then clear them
  if (oldStock <= 0 && newStock > 0) {
    const subs = db.prepare(`
      SELECT sn.id, u.name, u.email FROM stock_notifications sn
      JOIN users u ON u.id = sn.user_id WHERE sn.product_id = ?
    `).all(productId);
    for (const s of subs) {
      sendBackInStock({ name: s.name, email: s.email }, product)
        .catch((e) => console.error('[mail] back-in-stock failed:', e.message));
    }
    if (subs.length) {
      db.prepare('DELETE FROM stock_notifications WHERE product_id = ?').run(productId);
    }
  }

  // Crossed below the low-stock threshold (but not yet zero) -> alert admin once
  if (oldStock > LOW_STOCK_THRESHOLD && newStock <= LOW_STOCK_THRESHOLD && newStock > 0) {
    const to = adminEmail();
    if (to) {
      sendLowStockAlert(to, product)
        .catch((e) => console.error('[mail] low-stock alert failed:', e.message));
    }
  }
}

// ---------------------------------------------------------------- Pages

// Home
app.get('/', (req, res) => {
  const featured = db.prepare("SELECT * FROM products WHERE category = 'featured'").all();
  const popular = db.prepare("SELECT * FROM products WHERE category = 'popular'").all();
  res.render('landing', { title: 'Elder Ease — Independent living, made simple', featured, popular });
});

// Shop departments (subcategory filter)
const DEPARTMENTS = ['Mobility', 'Bathroom', 'Kitchen & Dining', 'Health', 'Comfort & Bedroom', 'Daily Living', 'Safety & Home'];

// Shop (paginated + department filter)
app.get('/shop', (req, res) => {
  const perPage = 9;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const department = DEPARTMENTS.includes(req.query.department) ? req.query.department : 'all';

  const where = department === 'all' ? '' : 'WHERE department = ?';
  const filterParams = department === 'all' ? [] : [department];

  const total = db.prepare(`SELECT COUNT(*) AS c FROM products ${where}`).get(...filterParams).c;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(page, totalPages);
  const products = db.prepare(
    `SELECT * FROM products ${where} ORDER BY name LIMIT ? OFFSET ?`
  ).all(...filterParams, perPage, (safePage - 1) * perPage);

  res.render('shopmore', {
    title: 'Elder Ease — Shop',
    products, page: safePage, totalPages, total, department,
    departments: DEPARTMENTS,
  });
});

// Search
app.get('/search', (req, res) => {
  const q = (req.query.q || '').trim();
  let results = [];
  if (q) {
    const like = `%${q}%`;
    results = db.prepare(
      'SELECT * FROM products WHERE name LIKE ? OR description LIKE ? ORDER BY name'
    ).all(like, like);
  }
  res.render('search', { title: 'Elder Ease — Search', q, results });
});

// Autocomplete suggestions (JSON)
app.get('/api/suggest', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  const like = `%${q}%`;
  const rows = db.prepare(
    'SELECT id, name, price, image FROM products WHERE name LIKE ? OR description LIKE ? ORDER BY name LIMIT 6'
  ).all(like, like);
  res.json(rows);
});

// Product detail
app.get('/product/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!product) {
    req.session.flash = { type: 'error', msg: 'That product could not be found.' };
    return res.redirect('/shop');
  }
  // A few "related" products from the same department (excluding this one)
  const related = db.prepare(
    'SELECT * FROM products WHERE department = ? AND id != ? ORDER BY RANDOM() LIMIT 3'
  ).all(product.department, id);
  res.render('product', { title: `Elder Ease — ${product.name}`, product, related });
});

// --------------------------------------------------------------- Cart

app.post('/cart/add', (req, res) => {
  const id = String(parseInt(req.body.productId));
  let qty = parseInt(req.body.quantity);
  if (!Number.isInteger(qty) || qty < 1) qty = 1;
  if (qty > 99) qty = 99;
  const product = db.prepare('SELECT id, name, stock FROM products WHERE id = ?').get(id);
  if (product) {
    req.session.cart = req.session.cart || {};
    const inCart = req.session.cart[id] || 0;
    if (product.stock <= 0) {
      req.session.flash = { type: 'error', msg: `${product.name} is out of stock.` };
    } else if (inCart + qty > product.stock) {
      req.session.cart[id] = product.stock; // cap at available stock
      req.session.flash = { type: 'error', msg: `Only ${product.stock} of ${product.name} in stock — cart updated to the maximum.` };
    } else {
      req.session.cart[id] = inCart + qty;
      req.session.flash = { type: 'success', msg: 'Item added to your cart.' };
    }
  }
  res.redirect(req.get('referer') || '/');
});

app.get('/cart', (req, res) => {
  const cart = req.session.cart || {};
  const ids = Object.keys(cart);
  let items = [];
  let total = 0;
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const rows = db.prepare(`SELECT * FROM products WHERE id IN (${placeholders})`).all(...ids);
    items = rows.map((p) => {
      const quantity = cart[String(p.id)];
      const lineTotal = p.price * quantity;
      total += lineTotal;
      return { ...p, quantity, lineTotal, overStock: quantity > p.stock };
    });
  }
  res.render('cart', { title: 'Elder Ease — Cart', items, total });
});

app.post('/cart/update', (req, res) => {
  const id = String(parseInt(req.body.productId));
  const action = req.body.action;
  const cart = req.session.cart || {};
  if (cart[id]) {
    if (action === 'inc') {
      const product = db.prepare('SELECT stock FROM products WHERE id = ?').get(id);
      if (product && cart[id] < product.stock) {
        cart[id]++;
      } else {
        req.session.flash = { type: 'error', msg: 'No more stock available for this item.' };
      }
    }
    if (action === 'dec') cart[id]--;
    if (cart[id] <= 0) delete cart[id];
  }
  req.session.cart = cart;
  res.redirect('/cart');
});

app.post('/cart/remove', (req, res) => {
  const id = String(parseInt(req.body.productId));
  if (req.session.cart) delete req.session.cart[id];
  res.redirect('/cart');
});

app.post('/cart/checkout', requireLogin, (req, res) => {
  const cart = req.session.cart || {};
  const ids = Object.keys(cart);
  if (!ids.length) {
    req.session.flash = { type: 'error', msg: 'Your cart is empty.' };
    return res.redirect('/cart');
  }
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM products WHERE id IN (${placeholders})`).all(...ids);

  // Validate stock before placing the order
  const shortages = rows.filter((p) => cart[String(p.id)] > p.stock);
  if (shortages.length) {
    const names = shortages.map((p) => `${p.name} (only ${p.stock} left)`).join(', ');
    req.session.flash = { type: 'error', msg: `Not enough stock for: ${names}. Please adjust your cart.` };
    return res.redirect('/cart');
  }

  const total = rows.reduce((sum, p) => sum + p.price * cart[String(p.id)], 0);

  const createOrder = db.transaction(() => {
    const orderId = db.prepare(
      'INSERT INTO orders (user_id, total, status) VALUES (?, ?, ?)'
    ).run(req.session.userId, total, 'Processing').lastInsertRowid;
    const addItem = db.prepare(
      'INSERT INTO order_items (order_id, name, price, quantity) VALUES (?, ?, ?, ?)'
    );
    const reduceStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');
    for (const p of rows) {
      addItem.run(orderId, p.name, p.price, cart[String(p.id)]);
      reduceStock.run(cart[String(p.id)], p.id);
    }
    return orderId;
  });
  const newOrderId = createOrder();

  // Low-stock alerts if any item crossed the threshold on this purchase
  for (const p of rows) {
    const qty = cart[String(p.id)];
    handleStockChange(p.id, p.stock, p.stock - qty);
  }

  // Send the confirmation email (don't block checkout on it)
  const orderForEmail = {
    id: newOrderId,
    total,
    status: 'Processing',
    items: rows.map((p) => ({ name: p.name, price: p.price, quantity: cart[String(p.id)] })),
  };
  sendOrderConfirmation(orderForEmail, res.locals.user)
    .catch((e) => console.error('[mail] confirmation failed:', e.message));

  req.session.cart = {};
  res.redirect(`/order/${newOrderId}/confirmation`);
});

// Email-style order confirmation (shown right after checkout)
app.get('/order/:id/confirmation', requireLogin, (req, res) => {
  const order = db.prepare(
    'SELECT * FROM orders WHERE id = ? AND user_id = ?'
  ).get(parseInt(req.params.id), req.session.userId);
  if (!order) {
    req.session.flash = { type: 'error', msg: 'Order not found.' };
    return res.redirect('/account');
  }
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  res.render('order-confirmation', { title: `Elder Ease — Order #${order.id} Confirmed`, order });
});

// ------------------------------------------------------------- Account

app.get('/account', requireLogin, (req, res) => {
  const perPage = 5;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const totalOrders = db.prepare(
    'SELECT COUNT(*) AS c FROM orders WHERE user_id = ?'
  ).get(req.session.userId).c;
  const totalPages = Math.max(1, Math.ceil(totalOrders / perPage));
  const safePage = Math.min(page, totalPages);

  const orders = db.prepare(
    'SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?'
  ).all(req.session.userId, perPage, (safePage - 1) * perPage);
  const itemStmt = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  orders.forEach((o) => { o.items = itemStmt.all(o.id); });

  res.render('myacc', {
    title: 'Elder Ease — My Account',
    orders, page: safePage, totalPages, totalOrders,
  });
});

app.get('/account/edit', requireLogin, (req, res) => {
  res.render('editprofile', { title: 'Elder Ease — Edit Profile' });
});

app.post('/account/edit', requireLogin, upload.single('photo'), csrfCheck, (req, res) => {
  const { name, email, phone, address } = req.body;
  try {
    db.prepare(
      'UPDATE users SET name = ?, email = ?, phone = ?, address = ? WHERE id = ?'
    ).run(name, email, phone, address, req.session.userId);
    if (req.file) {
      const photoPath = '/uploads/' + req.file.filename;
      db.prepare('UPDATE users SET photo = ? WHERE id = ?').run(photoPath, req.session.userId);
    }
    req.session.flash = { type: 'success', msg: 'Profile updated.' };
  } catch (e) {
    req.session.flash = { type: 'error', msg: 'That email is already in use.' };
  }
  res.redirect('/account');
});

app.get('/account/orders/:id', requireLogin, (req, res) => {
  const order = db.prepare(
    'SELECT * FROM orders WHERE id = ? AND user_id = ?'
  ).get(parseInt(req.params.id), req.session.userId);
  if (!order) {
    req.session.flash = { type: 'error', msg: 'Order not found.' };
    return res.redirect('/account');
  }
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  res.render('order-detail', { title: `Elder Ease — Order #${order.id}`, order });
});

// Customer cancels their own order (only while still Processing)
app.post('/account/orders/:id/cancel', requireLogin, (req, res) => {
  const id = parseInt(req.params.id);
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(id, req.session.userId);
  if (!order) {
    req.session.flash = { type: 'error', msg: 'Order not found.' };
    return res.redirect('/account');
  }
  if (order.status !== 'Processing') {
    req.session.flash = { type: 'error', msg: `Order #${id} can no longer be cancelled (status: ${order.status}).` };
    return res.redirect(`/account/orders/${id}`);
  }
  db.prepare("UPDATE orders SET status = 'Cancelled' WHERE id = ?").run(id);
  req.session.flash = { type: 'success', msg: `Order #${id} has been cancelled.` };
  res.redirect(`/account/orders/${id}`);
});

// Re-add a past order's items to the cart (matched to current catalog by name)
app.post('/account/orders/:id/reorder', requireLogin, (req, res) => {
  const id = parseInt(req.params.id);
  const order = db.prepare('SELECT id FROM orders WHERE id = ? AND user_id = ?').get(id, req.session.userId);
  if (!order) {
    req.session.flash = { type: 'error', msg: 'Order not found.' };
    return res.redirect('/account');
  }
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id);
  req.session.cart = req.session.cart || {};
  let added = 0;
  let missing = 0;
  for (const item of items) {
    const product = db.prepare('SELECT id, stock FROM products WHERE name = ?').get(item.name);
    if (product && product.stock > 0) {
      const pid = String(product.id);
      const inCart = req.session.cart[pid] || 0;
      const want = inCart + item.quantity;
      const capped = Math.min(want, product.stock);
      req.session.cart[pid] = capped;
      added += capped - inCart;
    } else {
      missing += 1;
    }
  }
  if (added === 0) {
    req.session.flash = { type: 'error', msg: 'None of those items are available right now.' };
    return res.redirect(`/account/orders/${id}`);
  }
  req.session.flash = {
    type: 'success',
    msg: `Added ${added} item${added === 1 ? '' : 's'} to your cart${missing ? ` (${missing} unavailable)` : ''}.`,
  };
  res.redirect('/cart');
});

// ------------------------------------------------------------- Support

app.get('/support', (req, res) => {
  res.render('support', { title: 'Elder Ease — Support' });
});

app.post('/support/contact', (req, res) => {
  req.session.flash = { type: 'success', msg: 'Thank you! Your message has been sent.' };
  res.redirect('/support');
});

// ----------------------------------------------------------- Wishlist

app.get('/wishlist', requireLogin, (req, res) => {
  const items = db.prepare(`
    SELECT p.* FROM wishlist w JOIN products p ON p.id = w.product_id
    WHERE w.user_id = ? ORDER BY w.created_at DESC
  `).all(req.session.userId);
  res.render('wishlist', { title: 'Elder Ease — Wishlist', items });
});

app.post('/wishlist/add', requireLogin, (req, res) => {
  const pid = parseInt(req.body.productId);
  if (db.prepare('SELECT id FROM products WHERE id = ?').get(pid)) {
    db.prepare('INSERT OR IGNORE INTO wishlist (user_id, product_id) VALUES (?, ?)')
      .run(req.session.userId, pid);
    req.session.flash = { type: 'success', msg: 'Saved to your wishlist.' };
  }
  res.redirect(req.get('referer') || '/wishlist');
});

app.post('/wishlist/remove', requireLogin, (req, res) => {
  const pid = parseInt(req.body.productId);
  db.prepare('DELETE FROM wishlist WHERE user_id = ? AND product_id = ?').run(req.session.userId, pid);
  req.session.flash = { type: 'success', msg: 'Removed from your wishlist.' };
  res.redirect(req.get('referer') || '/wishlist');
});

// Back-in-stock notification signup (shown when a product is out of stock)
app.post('/product/:id/notify-me', requireLogin, (req, res) => {
  const pid = parseInt(req.params.id);
  const product = db.prepare('SELECT id, name, stock FROM products WHERE id = ?').get(pid);
  if (!product) {
    req.session.flash = { type: 'error', msg: 'Product not found.' };
    return res.redirect('/shop');
  }
  if (product.stock > 0) {
    req.session.flash = { type: 'success', msg: `${product.name} is in stock now!` };
    return res.redirect(`/product/${pid}`);
  }
  db.prepare('INSERT OR IGNORE INTO stock_notifications (user_id, product_id) VALUES (?, ?)')
    .run(req.session.userId, pid);
  req.session.flash = { type: 'success', msg: `We'll email you when ${product.name} is back in stock.` };
  res.redirect(`/product/${pid}`);
});

// --------------------------------------------------------- Admin (products)

const ADMIN_CATEGORIES = ['featured', 'popular', 'more'];

function cleanProductInput(body) {
  const name = (body.name || '').trim();
  const description = (body.description || '').trim();
  let price = parseFloat(body.price);
  if (!Number.isFinite(price) || price < 0) price = 0;
  let stock = parseInt(body.stock);
  if (!Number.isInteger(stock) || stock < 0) stock = 0;
  const category = ADMIN_CATEGORIES.includes(body.category) ? body.category : 'more';
  const department = DEPARTMENTS.includes(body.department) ? body.department : 'Daily Living';
  return { name, description, price, category, stock, department };
}

const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

// Build a reusable date filter for the orders alias `o` (or a given column)
function dateFilter(from, to, col = 'o.created_at') {
  const conds = [];
  const params = [];
  if (isYmd(from)) { conds.push(`date(${col}) >= date(?)`); params.push(from); }
  if (isYmd(to)) { conds.push(`date(${col}) <= date(?)`); params.push(to); }
  return { conds, params };
}

app.get('/admin', requireAdmin, (req, res) => {
  const from = (req.query.from || '').trim();
  const to = (req.query.to || '').trim();
  const { conds, params } = dateFilter(from, to);
  const dateAnd = conds.length ? ' AND ' + conds.join(' AND ') : '';
  const dateWhere = conds.length ? ' WHERE ' + conds.join(' AND ') : '';

  // Sales totals exclude cancelled orders
  const revenueRow = db.prepare(
    `SELECT COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS orders
     FROM orders o WHERE status != 'Cancelled'${dateAnd}`
  ).get(...params);
  const allOrders = db.prepare(`SELECT COUNT(*) AS c FROM orders o${dateWhere}`).get(...params).c;
  const avgOrder = revenueRow.orders ? revenueRow.revenue / revenueRow.orders : 0;

  const statusRows = db.prepare(
    `SELECT status, COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
     FROM orders o${dateWhere} GROUP BY status`
  ).all(...params);
  const byStatus = {};
  for (const r of statusRows) byStatus[r.status] = r;

  const productCount = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
  const customerCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const lowStock = db.prepare(
    'SELECT name, stock FROM products WHERE stock <= 5 ORDER BY stock ASC, name LIMIT 8'
  ).all();

  // Best sellers by units sold (excluding cancelled orders)
  const topProducts = db.prepare(`
    SELECT oi.name, SUM(oi.quantity) AS units, SUM(oi.price * oi.quantity) AS revenue
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.status != 'Cancelled'${dateAnd}
    GROUP BY oi.name ORDER BY units DESC LIMIT 5
  `).all(...params);

  const recentOrders = db.prepare(`
    SELECT o.*, u.name AS customer_name FROM orders o JOIN users u ON u.id = o.user_id
    ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
    ORDER BY o.id DESC LIMIT 5
  `).all(...params);

  res.render('admin-dashboard', {
    title: 'Elder Ease — Dashboard',
    stats: {
      revenue: revenueRow.revenue,
      paidOrders: revenueRow.orders,
      allOrders,
      avgOrder,
      productCount,
      customerCount,
    },
    statuses: ['Processing', 'Shipped', 'Delivered', 'Cancelled'],
    byStatus,
    topProducts,
    recentOrders,
    lowStock,
    filter: { from: isYmd(from) ? from : '', to: isYmd(to) ? to : '' },
  });
});

app.get('/admin/products', requireAdmin, (req, res) => {
  const products = db.prepare('SELECT * FROM products ORDER BY category, name').all();
  res.render('admin', { title: 'Elder Ease — Products', products });
});

app.get('/admin/products/new', requireAdmin, (req, res) => {
  res.render('product-form', {
    title: 'Elder Ease — New Product',
    product: null, categories: ADMIN_CATEGORIES, departments: DEPARTMENTS,
  });
});

app.post('/admin/products', requireAdmin, upload.single('image'), csrfCheck, (req, res) => {
  const { name, description, price, category, stock, department } = cleanProductInput(req.body);
  if (!name) {
    req.session.flash = { type: 'error', msg: 'Product name is required.' };
    return res.redirect('/admin/products/new');
  }
  const image = req.file
    ? '/uploads/' + req.file.filename
    : (req.body.imageUrl || '').trim();
  db.prepare(
    'INSERT INTO products (name, description, price, category, image, stock, department) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(name, description, price, category, image, stock, department);
  req.session.flash = { type: 'success', msg: `“${name}” added.` };
  res.redirect('/admin/products');
});

app.get('/admin/products/:id/edit', requireAdmin, (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(parseInt(req.params.id));
  if (!product) {
    req.session.flash = { type: 'error', msg: 'Product not found.' };
    return res.redirect('/admin/products');
  }
  res.render('product-form', {
    title: `Elder Ease — Edit ${product.name}`,
    product, categories: ADMIN_CATEGORIES, departments: DEPARTMENTS,
  });
});

app.post('/admin/products/:id', requireAdmin, upload.single('image'), csrfCheck, (req, res) => {
  const id = parseInt(req.params.id);
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!existing) {
    req.session.flash = { type: 'error', msg: 'Product not found.' };
    return res.redirect('/admin/products');
  }
  const { name, description, price, category, stock, department } = cleanProductInput(req.body);
  if (!name) {
    req.session.flash = { type: 'error', msg: 'Product name is required.' };
    return res.redirect(`/admin/products/${id}/edit`);
  }
  // New upload wins; else a pasted URL; else keep the existing image.
  let image = existing.image;
  if (req.file) image = '/uploads/' + req.file.filename;
  else if ((req.body.imageUrl || '').trim()) image = req.body.imageUrl.trim();

  db.prepare(
    'UPDATE products SET name = ?, description = ?, price = ?, category = ?, image = ?, stock = ?, department = ? WHERE id = ?'
  ).run(name, description, price, category, image, stock, department, id);
  handleStockChange(id, existing.stock, stock);
  req.session.flash = { type: 'success', msg: `“${name}” updated.` };
  res.redirect('/admin/products');
});

app.post('/admin/products/:id/delete', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const product = db.prepare('SELECT name FROM products WHERE id = ?').get(id);
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
  req.session.flash = {
    type: 'success',
    msg: product ? `“${product.name}” deleted.` : 'Product deleted.',
  };
  res.redirect('/admin/products');
});

// ----------------------------------------------------------- Admin (orders)

const ORDER_STATUSES = ['Processing', 'Shipped', 'Delivered', 'Cancelled'];

app.get('/admin/orders', requireAdmin, (req, res) => {
  const orders = db.prepare(`
    SELECT o.*, u.name AS customer_name, u.email AS customer_email
    FROM orders o JOIN users u ON u.id = o.user_id
    ORDER BY o.id DESC
  `).all();
  const itemStmt = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  orders.forEach((o) => { o.items = itemStmt.all(o.id); });
  res.render('admin-orders', { title: 'Elder Ease — Manage Orders', orders, statuses: ORDER_STATUSES });
});

// CSV export of all orders (defined before :id so the path isn't treated as an id)
app.get('/admin/orders/export.csv', requireAdmin, (req, res) => {
  const orders = db.prepare(`
    SELECT o.id, o.created_at, o.status, o.total, u.name AS customer_name, u.email AS customer_email
    FROM orders o JOIN users u ON u.id = o.user_id
    ORDER BY o.id DESC
  `).all();
  const itemStmt = db.prepare('SELECT name, quantity FROM order_items WHERE order_id = ?');

  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = ['Order ID', 'Date', 'Customer', 'Email', 'Status', 'Items', 'Total (INR)'];
  const lines = [header.join(',')];
  for (const o of orders) {
    const items = itemStmt.all(o.id).map((i) => `${i.name} x${i.quantity}`).join('; ');
    lines.push([o.id, o.created_at, o.customer_name, o.customer_email, o.status, items, o.total]
      .map(esc).join(','));
  }
  const csv = '﻿' + lines.join('\r\n'); // BOM for Excel

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="elder-ease-orders.csv"');
  res.send(csv);
});

app.get('/admin/orders/:id', requireAdmin, (req, res) => {
  const order = db.prepare(`
    SELECT o.*, u.name AS customer_name, u.email AS customer_email, u.address AS customer_address
    FROM orders o JOIN users u ON u.id = o.user_id
    WHERE o.id = ?
  `).get(parseInt(req.params.id));
  if (!order) {
    req.session.flash = { type: 'error', msg: 'Order not found.' };
    return res.redirect('/admin/orders');
  }
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  res.render('admin-order-detail', { title: `Elder Ease — Order #${order.id}`, order, statuses: ORDER_STATUSES });
});

app.post('/admin/orders/:id/status', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const status = ORDER_STATUSES.includes(req.body.status) ? req.body.status : null;
  if (!status) {
    req.session.flash = { type: 'error', msg: 'Invalid status.' };
    return res.redirect('/admin/orders');
  }
  const result = db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
  req.session.flash = result.changes
    ? { type: 'success', msg: `Order #${id} marked as ${status}.` }
    : { type: 'error', msg: 'Order not found.' };
  res.redirect('/admin/orders');
});

// ---------------------------------------------------------------- Auth

app.get('/register', (req, res) => {
  res.render('register', { title: 'Elder Ease — Register' });
});

app.post('/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    req.session.flash = { type: 'error', msg: 'All fields are required.' };
    return res.redirect('/register');
  }
  try {
    const hash = bcrypt.hashSync(password, 10);
    const info = db.prepare(
      'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)'
    ).run(name, email, hash);
    req.session.userId = info.lastInsertRowid;
    req.session.flash = { type: 'success', msg: `Welcome, ${name}!` };
    res.redirect('/account');
  } catch (e) {
    req.session.flash = { type: 'error', msg: 'An account with that email already exists.' };
    res.redirect('/register');
  }
});

app.get('/login', (req, res) => {
  res.render('login', { title: 'Elder Ease — Log In' });
});

app.post('/login', loginLimiter, (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    recordLoginFailure(req.ip);
    req.session.flash = { type: 'error', msg: 'Invalid email or password.' };
    return res.redirect('/login');
  }
  loginAttempts.delete(req.ip); // reset on successful login
  req.session.userId = user.id;
  req.session.flash = { type: 'success', msg: `Welcome back, ${user.name}!` };
  res.redirect('/account');
});

app.post('/logout', (req, res) => {
  const cart = req.session.cart;
  req.session.regenerate(() => {
    req.session.cart = cart; // keep cart across logout
    req.session.flash = { type: 'success', msg: 'You have been logged out.' };
    res.redirect('/');
  });
});

// Upload errors (e.g. file too large) shouldn't crash the request
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    req.session.flash = {
      type: 'error',
      msg: err.code === 'LIMIT_FILE_SIZE' ? 'Image must be under 2 MB.' : 'Upload failed.',
    };
    return res.redirect(req.get('referer') || '/');
  }
  next(err);
});

app.listen(PORT, () => {
  console.log(`Elder Ease running at http://localhost:${PORT}`);
});
