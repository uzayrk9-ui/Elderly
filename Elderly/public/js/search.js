// Live autocomplete for the header search box
(function () {
  const input = document.getElementById('search-input');
  const list = document.getElementById('search-suggestions');
  if (!input || !list) return;

  let items = [];      // current suggestion data
  let active = -1;     // highlighted index
  let timer = null;
  let lastQuery = '';

  const money = (n) => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

  function close() {
    list.hidden = true;
    list.innerHTML = '';
    items = [];
    active = -1;
  }

  function render() {
    if (!items.length) { close(); return; }
    list.innerHTML = items.map((p, i) =>
      `<li role="option" class="suggestion${i === active ? ' active' : ''}" data-id="${p.id}">` +
      `<img class="s-thumb" alt="" />` +
      `<span class="s-name"></span><span class="s-price">${money(p.price)}</span></li>`
    ).join('');
    // Set names + image src via DOM API to avoid HTML injection
    list.querySelectorAll('.s-name').forEach((el, i) => { el.textContent = items[i].name; });
    list.querySelectorAll('.s-thumb').forEach((el, i) => {
      if (items[i].image) el.src = items[i].image;
    });
    list.hidden = false;

    list.querySelectorAll('.suggestion').forEach((li, i) => {
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        window.location.href = '/product/' + items[i].id;
      });
      li.addEventListener('mouseenter', () => { active = i; highlight(); });
    });
  }

  function highlight() {
    list.querySelectorAll('.suggestion').forEach((li, i) => {
      li.classList.toggle('active', i === active);
    });
  }

  async function fetchSuggestions(q) {
    try {
      const res = await fetch('/api/suggest?q=' + encodeURIComponent(q));
      if (!res.ok) return;
      // Ignore stale responses
      if (q !== input.value.trim()) return;
      items = await res.json();
      active = -1;
      render();
    } catch (_) { /* network hiccup — silently ignore */ }
  }

  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (q === lastQuery) return;
    lastQuery = q;
    clearTimeout(timer);
    if (q.length < 1) { close(); return; }
    timer = setTimeout(() => fetchSuggestions(q), 150);
  });

  input.addEventListener('keydown', (e) => {
    if (list.hidden || !items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      active = (active + 1) % items.length;
      highlight();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active - 1 + items.length) % items.length;
      highlight();
    } else if (e.key === 'Enter') {
      if (active >= 0) {
        e.preventDefault();
        window.location.href = '/product/' + items[active].id;
      }
      // otherwise let the form submit normally (full search)
    } else if (e.key === 'Escape') {
      close();
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-form')) close();
  });
})();
