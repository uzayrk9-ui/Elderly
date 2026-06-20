const bcrypt = require('bcryptjs');
const db = require('./db');

console.log('Seeding Elder Ease database...');

// Reset tables (order matters for FKs)
db.exec(`
  DELETE FROM order_items;
  DELETE FROM orders;
  DELETE FROM products;
  DELETE FROM users;
  DELETE FROM sqlite_sequence WHERE name IN ('users','products','orders','order_items');
`);

// --- Products ---
// Image URLs are keyword-based (LoremFlickr) with a fixed lock for stable photos.
const img = (keywords, lock) => `https://loremflickr.com/500/380/${keywords}?lock=${lock}`;

// [ name, description, price (INR), category, image, stock ]
const products = [
  // Featured
  ['Easy-Read Glasses',        'Lightweight magnifying reading glasses with anti-glare lenses.', 1499, 'featured', img('reading,glasses', 11), 40],
  ['Adjustable Walking Cane',  'Sturdy, height-adjustable cane with a comfortable grip.',       1899, 'featured', img('walking,cane', 12), 25],
  ['Weekly Pill Organizer',    'Large-compartment organizer with clear day labels.',             999, 'featured', img('pills,medicine', 13), 60],
  // Popular
  ['Big-Button Phone',         'Easy-dial phone with extra-large buttons and a loud ringer.',   2799, 'popular',  img('telephone', 14), 15],
  ['Soft Heating Pad',         'Soothing heat therapy with auto shut-off for safety.',          2199, 'popular',  img('blanket', 15), 3],
  ['Non-Slip Grip Socks',      'Cozy socks with grips to help prevent slips and falls.',         799, 'popular',  img('socks', 16), 0],
  // More (shop page)
  ['Blood Pressure Monitor',   'Automatic upper-arm monitor with a large, clear display.',      2999, 'more',     img('blood,pressure,monitor', 17), 20],
  ['Reacher Grabber Tool',     'Extends your reach so you never have to bend or stretch.',      1199, 'more',     img('tool', 18), 30],
  ['Easy Jar Opener',          'Opens stubborn lids with minimal effort.',                       699, 'more',     img('jar,kitchen', 19), 50],
  ['Adjustable Shower Stool',  'Non-slip seat for safe and comfortable bathing.',               2399, 'more',     img('bathroom,stool', 20), 12],
  ['LED Magnifier Lamp',       'Bright, hands-free magnification for reading and crafts.',       1799, 'more',     img('lamp,light', 21), 4],
  ['Support Bed Rail',         'Sturdy rail to assist getting in and out of bed safely.',       2699, 'more',     img('bed', 22), 8],
  ['Talking Wrist Watch',      'Announces the time at the press of a button.',                  1399, 'more',     img('watch,wrist', 23), 0],
  ['Foam Grip Cutlery Set',    'Easy-hold utensils with thick, comfortable handles.',           1599, 'more',     img('cutlery,fork', 24), 18],
  ['Wireless Call Button',     'Portable panic button to call for help from any room.',         2499, 'more',     img('button,remote', 25), 22],

  // --- Expanded catalogue (50 more) ---
  ['Anti-Slip Bath Mat',         'Suction-grip bath mat that keeps footing secure on wet surfaces.',          599, 'more', img('bath,mat', 26), 45],
  ['Raised Toilet Seat',         'Adds height to the toilet for easier, safer sitting and standing.',        1799, 'more', img('bathroom,toilet', 27), 20],
  ['Suction Grab Bar',           'Removable support bar that suctions firmly to bathroom tiles.',             899, 'more', img('handle,bathroom', 28), 30],
  ['Bed Wedge Pillow',           'Gentle incline pillow that eases breathing and acid reflux.',             1499, 'more', img('pillow,bed', 29), 25],
  ['Compression Socks',          'Graduated support socks that improve circulation and reduce swelling.',     699, 'more', img('socks,legs', 30), 60],
  ['Digital Thermometer',        'Fast, accurate readings with a large, easy-to-read display.',              499, 'more', img('thermometer,medical', 31), 50],
  ['Fingertip Pulse Oximeter',   'Clips on a fingertip to check oxygen levels and pulse in seconds.',        1299, 'more', img('medical,device', 32), 35],
  ['Hot Water Bottle',           'Soft-cover bottle for soothing warmth and aching joints.',                 449, 'more', img('hot,water,bottle', 33), 40],
  ['Knee Support Brace',         'Adjustable brace that stabilises and comforts tired knees.',               799, 'more', img('knee,brace', 34), 30],
  ['Wrist Support Brace',        'Lightweight wrap that supports weak or sore wrists.',                      599, 'more', img('wrist,bandage', 35), 30],
  ['Orthopedic Seat Cushion',    'Memory-foam cushion that relieves pressure during long sitting.',         1399, 'more', img('cushion,seat', 36), 28],
  ['Memory Foam Slippers',       'Warm, non-slip slippers that cushion every step.',                         899, 'more', img('slippers', 37), 40],
  ['Long-Handled Shoe Horn',     'Extra-long horn to slip on shoes without bending down.',                   399, 'more', img('shoes', 38), 35],
  ['Sock Aid',                   'Helps pull on socks comfortably without straining your back.',             549, 'more', img('socks,laundry', 39), 25],
  ['Button Hook & Zipper Pull',  'Makes fastening buttons and zips simple with one hand.',                   349, 'more', img('buttons,clothing', 40), 30],
  ['Dressing Stick',             'Reach-and-pull stick that makes getting dressed easier.',                  499, 'more', img('stick,wood', 41), 20],
  ['Handheld Magnifier',         'Crisp 3x lens for reading labels, menus and fine print.',                  649, 'more', img('magnifier,glass', 42), 40],
  ['Large-Print Playing Cards',  'Easy-to-see cards with big, bold numbers and suits.',                      299, 'more', img('playing,cards', 43), 50],
  ['Large-Button Remote',        'Universal remote with big, clearly labelled buttons.',                     999, 'more', img('remote,control', 44), 30],
  ['Talking Alarm Clock',        'Announces the time and alarm at the press of a button.',                   899, 'more', img('alarm,clock', 45), 25],
  ['Day-of-the-Week Clock',      'Shows the day, date and time in clear, large letters.',                   1599, 'more', img('clock,wall', 46), 18],
  ['Automatic Soap Dispenser',   'Touch-free dispenser for hygienic, effortless hand washing.',             1199, 'more', img('soap,dispenser', 47), 30],
  ['Foldable Walker',            'Sturdy, lightweight walking frame that folds away neatly.',               3499, 'more', img('walker,mobility', 48), 12],
  ['Walker Tray Attachment',     'Clip-on tray to carry meals and drinks with your walker.',                 899, 'more', img('tray,kitchen', 49), 20],
  ['Ergonomic Can Opener',       'Comfort-grip opener that turns lids with very little effort.',             549, 'more', img('can,opener', 50), 35],
  ['Two-Handled Mug',            'Stable mug with two handles for a secure, steady hold.',                   449, 'more', img('mug,cup', 51), 40],
  ['Spill-Proof Cup',            'Lidded cup that prevents spills and is easy to sip from.',                 399, 'more', img('cup,drink', 52), 45],
  ['Weighted Utensil Set',       'Balanced, easy-grip cutlery that steadies unsteady hands.',               1299, 'more', img('cutlery,spoon', 53), 25],
  ['Non-Slip Dinner Plate',      'Stays put on the table and has a raised edge for easy scooping.',          599, 'more', img('plate,dish', 54), 30],
  ['Cordless Electric Kettle',   'Lightweight kettle with auto shut-off for safe, quick boiling.',          1899, 'more', img('kettle', 55), 22],
  ['Automatic Pill Dispenser',   'Locks and alarms to dispense the right pills at the right time.',         2999, 'more', img('pills,box', 56), 15],
  ['Pill Crusher',               'Crushes tablets into easy-to-swallow powder with a simple twist.',         399, 'more', img('pills,medicine', 57), 30],
  ['Eye Drop Guide',             'Steadies the bottle so drops go in cleanly, every time.',                  349, 'more', img('eye,drops', 58), 25],
  ['Wrist Blood Pressure Monitor','Compact monitor with a large display and memory storage.',               2299, 'more', img('blood,pressure', 59), 20],
  ['Portable Nebulizer',         'Quiet, handheld nebuliser for easy breathing treatments at home.',        3499, 'more', img('medical,health', 60), 10],
  ['TENS Muscle Massager',       'Gentle electric pulses to ease everyday aches and stiffness.',            1799, 'more', img('massage,therapy', 61), 18],
  ['Shiatsu Foot Massager',      'Soothing kneading massage for tired, achy feet.',                         3999, 'more', img('foot,massage', 62), 10],
  ['Neck & Shoulder Heat Wrap',  'Cordless heated wrap that melts away tension.',                           1499, 'more', img('neck,spa', 63), 20],
  ['Cervical Orthopedic Pillow', 'Contoured pillow that supports the neck for restful sleep.',              1299, 'more', img('pillow,sleep', 64), 25],
  ['Bedside Storage Caddy',      'Hangs by the bed to keep glasses, phone and remote close at hand.',        599, 'more', img('organizer,storage', 65), 35],
  ['Overbed Table',              'Height-adjustable table for meals, reading and hobbies in bed.',          2799, 'more', img('table,furniture', 66), 12],
  ['Lift Recliner Cushion',      'Spring-assisted cushion that helps you rise from a chair with ease.',     2499, 'more', img('cushion,chair', 67), 14],
  ['Anti-Slip Stair Treads',     'Self-adhesive grips that make every step safer.',                          899, 'more', img('stairs,steps', 68), 30],
  ['Motion Sensor Night Light',  'Lights the way automatically for safe night-time trips.',                  499, 'more', img('night,light', 69), 50],
  ['Emergency Alert Pendant',    'Wearable button that calls for help at the press of a finger.',           2999, 'more', img('pendant,necklace', 70), 16],
  ['Reacher with Magnet',        'Long-reach grabber with a magnetic tip for dropped keys and coins.',       749, 'more', img('tool,grabber', 71), 28],
  ['Adjustable Bed Rail',        'Provides a steady handhold for getting safely in and out of bed.',        2199, 'more', img('bed,rail', 72), 15],
  ['Shower Grab Handle',         'Ergonomic handle for confident, balanced showering.',                      999, 'more', img('shower,bathroom', 73), 25],
  ['Lap Blanket with Pockets',   'Soft fleece blanket with handy pockets to keep warm and cosy.',            899, 'more', img('blanket,fleece', 74), 30],
  ['Magnifying Floor Lamp',      'Bright floor lamp with a large lens for reading and crafts.',             3299, 'more', img('lamp,floor', 75), 12],
];

// Department (shop subcategory) for each product, keyed by name.
const DEPARTMENT = {
  // Mobility
  'Adjustable Walking Cane': 'Mobility', 'Reacher Grabber Tool': 'Mobility',
  'Foldable Walker': 'Mobility', 'Walker Tray Attachment': 'Mobility', 'Reacher with Magnet': 'Mobility',
  // Bathroom
  'Adjustable Shower Stool': 'Bathroom', 'Anti-Slip Bath Mat': 'Bathroom',
  'Raised Toilet Seat': 'Bathroom', 'Suction Grab Bar': 'Bathroom',
  'Automatic Soap Dispenser': 'Bathroom', 'Shower Grab Handle': 'Bathroom',
  // Kitchen & Dining
  'Easy Jar Opener': 'Kitchen & Dining', 'Foam Grip Cutlery Set': 'Kitchen & Dining',
  'Ergonomic Can Opener': 'Kitchen & Dining', 'Two-Handled Mug': 'Kitchen & Dining',
  'Spill-Proof Cup': 'Kitchen & Dining', 'Weighted Utensil Set': 'Kitchen & Dining',
  'Non-Slip Dinner Plate': 'Kitchen & Dining', 'Cordless Electric Kettle': 'Kitchen & Dining',
  // Health
  'Weekly Pill Organizer': 'Health', 'Soft Heating Pad': 'Health', 'Blood Pressure Monitor': 'Health',
  'Compression Socks': 'Health', 'Digital Thermometer': 'Health', 'Fingertip Pulse Oximeter': 'Health',
  'Hot Water Bottle': 'Health', 'Knee Support Brace': 'Health', 'Wrist Support Brace': 'Health',
  'Automatic Pill Dispenser': 'Health', 'Pill Crusher': 'Health', 'Eye Drop Guide': 'Health',
  'Wrist Blood Pressure Monitor': 'Health', 'Portable Nebulizer': 'Health', 'TENS Muscle Massager': 'Health',
  'Shiatsu Foot Massager': 'Health', 'Neck & Shoulder Heat Wrap': 'Health',
  // Comfort & Bedroom
  'Support Bed Rail': 'Comfort & Bedroom', 'Bed Wedge Pillow': 'Comfort & Bedroom',
  'Orthopedic Seat Cushion': 'Comfort & Bedroom', 'Cervical Orthopedic Pillow': 'Comfort & Bedroom',
  'Bedside Storage Caddy': 'Comfort & Bedroom', 'Overbed Table': 'Comfort & Bedroom',
  'Lift Recliner Cushion': 'Comfort & Bedroom', 'Adjustable Bed Rail': 'Comfort & Bedroom',
  'Lap Blanket with Pockets': 'Comfort & Bedroom',
  // Safety & Home
  'Wireless Call Button': 'Safety & Home', 'Anti-Slip Stair Treads': 'Safety & Home',
  'Motion Sensor Night Light': 'Safety & Home', 'Emergency Alert Pendant': 'Safety & Home',
  // Daily Living (default for everything else)
};

const insertProduct = db.prepare(
  'INSERT INTO products (name, description, price, category, image, stock, department) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
const insertMany = db.transaction((rows) => {
  for (const r of rows) insertProduct.run(...r, DEPARTMENT[r[0]] || 'Daily Living');
});
insertMany(products);
console.log(`  + ${products.length} products across ${new Set(Object.values(DEPARTMENT)).size + 1} departments`);

// --- Demo user ---
const hash = bcrypt.hashSync('password123', 10);
const userInfo = db.prepare(
  'INSERT INTO users (name, email, password_hash, phone, address, is_admin) VALUES (?, ?, ?, ?, ?, ?)'
).run('Margaret Thompson', 'margaret@example.com', hash, '(555) 123-4567', '42 Maple Street, Springfield', 1);
const userId = userInfo.lastInsertRowid;
console.log('  + demo user (admin): margaret@example.com / password123');

// --- Past orders for the demo user (explicit dates so the history looks real) ---
const insertOrder = db.prepare(
  'INSERT INTO orders (user_id, total, status, created_at) VALUES (?, ?, ?, ?)'
);
const insertOrderItem = db.prepare(
  'INSERT INTO order_items (order_id, name, price, quantity) VALUES (?, ?, ?, ?)'
);

// [ status, created_at, items: [name, price, qty] ]
const sampleOrders = [
  ['Delivered',  '2026-01-12 10:24:00', [['Easy-Read Glasses', 1499, 1]]],
  ['Delivered',  '2026-02-03 16:40:00', [['Big-Button Phone', 2799, 1], ['Non-Slip Grip Socks', 799, 2]]],
  ['Delivered',  '2026-03-21 09:05:00', [['Weekly Pill Organizer', 999, 2]]],
  ['Delivered',  '2026-04-09 14:18:00', [['LED Magnifier Lamp', 1799, 1]]],
  ['Shipped',    '2026-05-27 11:52:00', [['Blood Pressure Monitor', 2999, 1], ['Easy Jar Opener', 699, 1]]],
  ['Processing', '2026-06-15 18:30:00', [['Adjustable Walking Cane', 1899, 1], ['Soft Heating Pad', 2199, 1]]],
  ['Processing', '2026-06-19 08:12:00', [['Support Bed Rail', 2699, 1]]],
];

for (const [status, createdAt, items] of sampleOrders) {
  const total = items.reduce((sum, [, price, qty]) => sum + price * qty, 0);
  const orderId = insertOrder.run(userId, total, status, createdAt).lastInsertRowid;
  for (const [name, price, qty] of items) insertOrderItem.run(orderId, name, price, qty);
}

console.log(`  + ${sampleOrders.length} sample orders`);
console.log('Done.');
