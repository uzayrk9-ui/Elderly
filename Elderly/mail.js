const nodemailer = require('nodemailer');

// Lazily create one transporter and reuse it.
//  - SMTP_HOST set        -> real SMTP server
//  - otherwise (reachable)-> Ethereal test inbox (returns a preview URL)
//  - otherwise (offline)  -> jsonTransport (logs the message to the console)
let transporterPromise = null;
function getTransporter() {
  if (transporterPromise) return transporterPromise;
  transporterPromise = (async () => {
    if (process.env.SMTP_HOST) {
      return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      });
    }
    try {
      const test = await nodemailer.createTestAccount();
      console.log('[mail] No SMTP configured — using Ethereal test inbox (%s).', test.user);
      return nodemailer.createTransport({
        host: 'smtp.ethereal.email', port: 587, secure: false,
        auth: { user: test.user, pass: test.pass },
      });
    } catch (e) {
      console.warn('[mail] Ethereal unavailable, logging emails to console instead:', e.message);
      return nodemailer.createTransport({ jsonTransport: true });
    }
  })();
  return transporterPromise;
}

const inr = (n) => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

function buildHtml(order, user) {
  const rows = order.items.map((i) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee;">${i.name}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">${i.quantity}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${inr(i.price * i.quantity)}</td>
    </tr>`).join('');
  return `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #eee;border-radius:8px;overflow:hidden;">
    <div style="background:#0044cc;color:#fff;padding:20px;text-align:center;font-size:22px;">Elder Ease</div>
    <div style="padding:24px;">
      <h2 style="color:#0044cc;">Thank you for your order!</h2>
      <p>Hi ${user.name}, your order <strong>#${order.id}</strong> has been received and is now <strong>${order.status || 'Processing'}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <thead><tr>
          <th style="padding:8px;text-align:left;color:#0044cc;border-bottom:2px solid #0044cc;">Item</th>
          <th style="padding:8px;text-align:center;color:#0044cc;border-bottom:2px solid #0044cc;">Qty</th>
          <th style="padding:8px;text-align:right;color:#0044cc;border-bottom:2px solid #0044cc;">Subtotal</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="text-align:right;font-size:18px;color:#0044cc;"><strong>Total: ${inr(order.total)}</strong></p>
      ${user.address ? `<p style="color:#555;"><strong>Shipping to:</strong><br>${user.name}<br>${user.address}</p>` : ''}
    </div>
    <div style="background:#f6f8fc;padding:16px;text-align:center;color:#777;font-size:13px;">
      Questions? Reply to this email or visit our Support page.
    </div>
  </div>`;
}

async function sendOrderConfirmation(order, user) {
  const transporter = await getTransporter();
  const text =
    `Hi ${user.name},\n\nThanks for your order #${order.id}.\n\n` +
    order.items.map((i) => `  ${i.name} x${i.quantity} - ${inr(i.price * i.quantity)}`).join('\n') +
    `\n\nTotal: ${inr(order.total)}\n`;

  const info = await transporter.sendMail({
    from: process.env.MAIL_FROM || '"Elder Ease" <orders@elderease.example>',
    to: user.email,
    subject: `Your Elder Ease order #${order.id} is confirmed`,
    text,
    html: buildHtml(order, user),
  });

  const preview = nodemailer.getTestMessageUrl(info);
  if (preview) {
    console.log('[mail] Order #%s confirmation — preview: %s', order.id, preview);
  } else {
    console.log('[mail] Order #%s confirmation sent to %s (id: %s)', order.id, user.email, info.messageId);
  }
  return info;
}

async function sendBackInStock(user, product) {
  const transporter = await getTransporter();
  const info = await transporter.sendMail({
    from: process.env.MAIL_FROM || '"Elder Ease" <orders@elderease.example>',
    to: user.email,
    subject: `${product.name} is back in stock at Elder Ease`,
    text: `Hi ${user.name},\n\nGood news — ${product.name} (${inr(product.price)}) is back in stock!\n\nShop now before it sells out again.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #eee;border-radius:8px;overflow:hidden;">
        <div style="background:#0044cc;color:#fff;padding:20px;text-align:center;font-size:22px;">Elder Ease</div>
        <div style="padding:24px;">
          <h2 style="color:#0044cc;">Back in stock!</h2>
          <p>Hi ${user.name}, <strong>${product.name}</strong> (${inr(product.price)}) is available again.</p>
          <p>Shop now before it sells out.</p>
        </div>
      </div>`,
  });
  const preview = nodemailer.getTestMessageUrl(info);
  console.log('[mail] Back-in-stock "%s" -> %s%s', product.name, user.email, preview ? ' | preview: ' + preview : '');
  return info;
}

async function sendLowStockAlert(adminEmail, product) {
  const transporter = await getTransporter();
  const info = await transporter.sendMail({
    from: process.env.MAIL_FROM || '"Elder Ease" <orders@elderease.example>',
    to: adminEmail,
    subject: `Low stock: ${product.name} (${product.stock} left)`,
    text: `Heads up — ${product.name} is low on stock: only ${product.stock} remaining. Consider restocking.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #eee;border-radius:8px;overflow:hidden;">
        <div style="background:#9a6700;color:#fff;padding:20px;text-align:center;font-size:20px;">Elder Ease — Low Stock Alert</div>
        <div style="padding:24px;">
          <p><strong>${product.name}</strong> is low on stock: <strong>${product.stock}</strong> remaining.</p>
          <p>Consider restocking soon.</p>
        </div>
      </div>`,
  });
  const preview = nodemailer.getTestMessageUrl(info);
  console.log('[mail] Low-stock alert "%s" (%s left) -> %s%s', product.name, product.stock, adminEmail, preview ? ' | preview: ' + preview : '');
  return info;
}

module.exports = { sendOrderConfirmation, sendBackInStock, sendLowStockAlert };
