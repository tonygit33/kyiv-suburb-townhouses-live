import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  'https://vtnucevhyhfvymppjbfa.supabase.co',
  'sb_publishable_-5iiF1Qgq--BKgXLHREINA_nPC7yVVY',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
);

const $ = (id) => document.getElementById(id);
const leadLabels = {
  new: 'Нова',
  contacted: 'Зв’язались',
  viewing: 'Перегляд',
  negotiation: 'Переговори',
  won: 'Успішно',
  lost: 'Втрачено'
};

let account = null;
let leads = [];
let leadFilter = 'all';
let loadingAccount = false;

function text(tag, value, className = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value ?? '';
  return node;
}

function money(item) {
  if (item.price === null || item.price === undefined || item.price === '') return 'Ціна уточнюється';
  const symbol = { USD: '$', EUR: '€', UAH: '₴' }[item.currency] || item.currency || '$';
  return `${new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 }).format(Number(item.price))} ${symbol}`;
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ''), location.href);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function friendlyError(error) {
  const code = String(error?.message || error || '');
  const labels = {
    authentication_required: 'Спочатку увійдіть до акаунта.',
    invite_not_found: 'Запрошення не знайдено або код неправильний.',
    invite_not_pending: 'Це запрошення вже використане або відкликане.',
    invite_expired: 'Строк дії запрошення завершився.',
    invite_email_mismatch: 'Запрошення створене для іншої email-адреси.',
    invite_token_required: 'Введіть код запрошення.',
    unit_not_claimed: 'Це оголошення не прив’язане до вашого акаунта.',
    invalid_status: 'Вибрано недопустимий статус.'
  };
  return labels[code] || code || 'Сталася помилка. Повторіть дію.';
}

function setStatus(node, message, type = '') {
  node.className = type;
  node.textContent = message;
}

function makeListingCard(item, mode) {
  const article = document.createElement('article');
  article.className = 'card';

  const photoUrl = safeHttpUrl(item.cover_photo_url);
  if (photoUrl) {
    const image = document.createElement('img');
    image.src = photoUrl;
    image.alt = item.title || item.location_name || 'Фото будинку';
    image.loading = 'lazy';
    article.append(image);
  } else {
    article.append(text('div', '⌂', 'placeholder'));
  }

  const body = document.createElement('div');
  body.className = 'card-body';
  body.append(
    text('h3', item.title || item.location_name || 'Будинок'),
    text('p', [item.location_name, item.address].filter(Boolean).join(' · ')),
    text('div', money(item), 'price')
  );

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const open = document.createElement('a');
  open.href = `./?unit=${encodeURIComponent(item.id)}`;
  open.textContent = 'Відкрити';
  actions.append(open);

  if (mode === 'favorite') {
    const remove = text('button', 'Видалити');
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      const { error } = await supabase.from('user_favorites').delete().eq('unit_id', item.id);
      if (error) {
        remove.disabled = false;
        alert(friendlyError(error));
        return;
      }
      await loadFavorites();
    });
    actions.append(remove);
  } else {
    actions.append(text('span', 'Підтверджено', 'badge'));
  }

  body.append(actions);

  if (mode === 'seller') {
    const form = document.createElement('form');
    form.className = 'seller-edit';

    const priceLabel = text('label', '');
    priceLabel.append(text('span', 'Ціна'));
    const price = document.createElement('input');
    price.name = 'price';
    price.type = 'number';
    price.min = '0';
    price.value = String(item.price || 0);
    priceLabel.append(price);

    const statusLabel = text('label', '');
    statusLabel.append(text('span', 'Статус'));
    const status = document.createElement('select');
    status.name = 'status';
    [
      ['available', 'У продажу'],
      ['reserved', 'Резерв'],
      ['sold', 'Продано'],
      ['inactive', 'Неактивне']
    ].forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      status.append(option);
    });
    status.value = ['available', 'reserved', 'sold', 'inactive'].includes(item.status) ? item.status : 'available';
    statusLabel.append(status);

    const countLabel = text('label', '');
    countLabel.append(text('span', 'Доступно'));
    const count = document.createElement('input');
    count.name = 'count';
    count.type = 'number';
    count.min = '0';
    count.value = String(item.available_count || 0);
    countLabel.append(count);

    const save = text('button', 'Зберегти');
    save.type = 'submit';
    const saveStatus = text('span', '', 'save-status');

    form.append(priceLabel, statusLabel, countLabel, save, saveStatus);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      save.disabled = true;
      setStatus(saveStatus, 'Збереження…');
      const { error } = await supabase.rpc('seller_update_my_unit', {
        p_unit_id: item.id,
        p_price: Number(price.value),
        p_status: status.value,
        p_available_count: Number(count.value)
      });
      save.disabled = false;
      if (error) {
        setStatus(saveStatus, friendlyError(error), 'error');
        return;
      }
      setStatus(saveStatus, 'Збережено ✓', 'success');
      await Promise.all([loadSeller(), loadSellerStats()]);
    });

    body.append(form);
  }

  article.append(body);
  return article;
}

function makeLeadCard(lead) {
  const article = document.createElement('article');
  article.className = 'lead-card';

  const head = document.createElement('div');
  head.className = 'lead-card-head';
  const copy = document.createElement('div');
  copy.append(
    text('h3', lead.customer_name || 'Клієнт'),
    text('p', [lead.unit_title || 'Об’єкт', lead.location_name].filter(Boolean).join(' · '))
  );
  const badge = text('span', leadLabels[lead.status] || lead.status, `lead-badge status-${lead.status}`);
  head.append(copy, badge);
  article.append(head);

  const contact = document.createElement('div');
  contact.className = 'lead-contact';
  if (lead.phone) {
    const phone = document.createElement('a');
    phone.href = `tel:${String(lead.phone).replace(/[^+0-9]/g, '')}`;
    phone.textContent = lead.phone;
    contact.append(phone);
  }
  if (lead.email) {
    const email = document.createElement('a');
    email.href = `mailto:${encodeURIComponent(lead.email)}`;
    email.textContent = lead.email;
    contact.append(email);
  }
  if (!contact.children.length) contact.append(text('span', 'Контакт не вказано'));
  article.append(contact);

  if (lead.message) article.append(text('p', lead.message, 'lead-message'));

  const foot = document.createElement('div');
  foot.className = 'lead-card-foot';
  const time = document.createElement('time');
  time.dateTime = lead.created_at || '';
  time.textContent = lead.created_at ? new Date(lead.created_at).toLocaleString('uk-UA') : '';

  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Статус заявки');
  Object.entries(leadLabels).forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.selected = value === lead.status;
    select.append(option);
  });
  select.addEventListener('change', async () => {
    select.disabled = true;
    const { error } = await supabase.rpc('seller_update_lead_status', {
      p_lead_id: lead.id,
      p_status: select.value
    });
    select.disabled = false;
    if (error) {
      alert(friendlyError(error));
      select.value = lead.status;
      return;
    }
    await loadLeads();
  });

  foot.append(time, select);
  article.append(foot);
  return article;
}

function renderRoleChips() {
  const container = $('roleChips');
  container.replaceChildren();
  if (account?.can_buy) container.append(text('span', '✓ Покупець', 'role-chip'));
  if (account?.can_sell) container.append(text('span', '✓ Продавець', 'role-chip'));
  if (account?.is_admin) container.append(text('span', '✓ Адміністратор', 'role-chip admin'));
}

function applyCapabilities() {
  document.querySelectorAll('[data-role="seller"]').forEach((node) => {
    node.hidden = !account?.can_sell;
  });
  $('adminLink').hidden = !account?.is_admin;
  $('sellerRole').textContent = account?.can_sell ? 'Продавець активний' : 'Потрібне запрошення';
  renderRoleChips();
}

async function loadAccount() {
  const { data, error } = await supabase.rpc('current_user_account');
  if (error) throw error;
  account = data;
  $('profileName').textContent = account?.display_name || 'Особистий кабінет';
  $('profileEmail').textContent = account?.email || '';
  $('displayName').value = account?.display_name || '';
  $('profilePhone').value = account?.phone || '';
  $('accountEmail').value = account?.email || '';
  applyCapabilities();
}

async function load() {
  if (loadingAccount) return;
  loadingAccount = true;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    $('authCard').hidden = Boolean(session);
    $('cabinet').hidden = !session;
    if (!session) {
      account = null;
      return;
    }

    await loadAccount();

    const tasks = [loadFavorites()];
    if (account?.can_sell) tasks.push(loadSeller(), loadSellerStats(), loadLeads());
    else {
      $('sellerCount').textContent = '0';
      $('leadCount').textContent = '0';
    }
    await Promise.all(tasks);

    const token = new URLSearchParams(location.search).get('invite');
    if (token) {
      $('inviteToken').value = token;
      activate('invite');
    } else if (location.hash === '#settings') {
      activate('settings');
    }
  } catch (error) {
    $('cabinet').hidden = true;
    $('authCard').hidden = false;
    setStatus($('authStatus'), friendlyError(error), 'error');
  } finally {
    loadingAccount = false;
  }
}

async function loadFavorites() {
  const { data: favorites, error } = await supabase
    .from('user_favorites')
    .select('unit_id,created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;

  const ids = (favorites || []).map((row) => row.unit_id);
  $('favoriteCount').textContent = String(ids.length);
  const grid = $('favoriteGrid');
  grid.replaceChildren();
  $('favoritesEmpty').hidden = ids.length > 0;
  if (!ids.length) return;

  const { data: items, error: itemError } = await supabase.from('site_units').select('*').in('id', ids);
  if (itemError) throw itemError;

  const byId = new Map((items || []).map((item) => [item.id, item]));
  ids.forEach((id) => {
    const item = byId.get(id);
    if (item) grid.append(makeListingCard(item, 'favorite'));
  });
}

async function loadSellerStats() {
  if (!account?.can_sell) return;
  const { data, error } = await supabase.rpc('seller_dashboard_stats');
  if (error) throw error;
  const value = data || {};
  $('sellerStatTotal').textContent = value.total || 0;
  $('sellerStatAvailable').textContent = value.available || 0;
  $('sellerStatReserved').textContent = value.reserved || 0;
  $('sellerStatSold').textContent = value.sold || 0;
  $('sellerStatFavorites').textContent = value.favorites || 0;
}

async function loadSeller() {
  if (!account?.can_sell) return;
  const { data, error } = await supabase.rpc('my_seller_units');
  if (error) throw error;
  const items = data || [];
  $('sellerCount').textContent = String(items.length);
  const grid = $('sellerGrid');
  grid.replaceChildren();
  $('sellerEmpty').hidden = items.length > 0;
  items.forEach((item) => grid.append(makeListingCard(item, 'seller')));
}

function renderLeads() {
  const query = $('leadSearch').value.trim().toLowerCase();
  const selectedStatus = $('leadStatusFilter').value;
  const filtered = leads.filter((lead) => {
    const matchesQuick = leadFilter === 'all' || lead.status === leadFilter;
    const matchesSelect = selectedStatus === 'all' || lead.status === selectedStatus;
    const matchesQuery = !query || [lead.customer_name, lead.phone, lead.email, lead.unit_title, lead.location_name]
      .some((value) => String(value || '').toLowerCase().includes(query));
    return matchesQuick && matchesSelect && matchesQuery;
  });

  const list = $('leadList');
  list.replaceChildren();
  $('leadsEmpty').hidden = filtered.length > 0;
  filtered.forEach((lead) => list.append(makeLeadCard(lead)));
}

function updateLeadSummary() {
  const count = (status) => leads.filter((lead) => status === 'all' || lead.status === status).length;
  $('leadAll').textContent = count('all');
  $('leadNew').textContent = count('new');
  $('leadContacted').textContent = count('contacted');
  $('leadViewing').textContent = count('viewing');
  $('leadNegotiation').textContent = count('negotiation');
  $('leadCount').textContent = count('new');
}

async function loadLeads() {
  if (!account?.can_sell) return;
  const { data, error } = await supabase.rpc('seller_my_leads');
  if (error) throw error;
  leads = data || [];
  updateLeadSummary();
  renderLeads();
}

function activate(name) {
  const target = $(`${name}Panel`);
  if (!target) return;
  if (target.closest('[data-role="seller"]')?.hidden || (['seller', 'leads'].includes(name) && !account?.can_sell)) {
    name = 'invite';
  }
  document.querySelectorAll('.tabs button').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === name);
  });
  document.querySelectorAll('.panel').forEach((panel) => panel.classList.remove('active'));
  $(`${name}Panel`).classList.add('active');
  if (name === 'leads' && account?.can_sell) loadLeads().catch((error) => alert(friendlyError(error)));
  history.replaceState(null, '', name === 'settings' ? '#settings' : location.pathname + location.search);
}

document.querySelectorAll('.tabs button').forEach((button) => {
  button.addEventListener('click', () => activate(button.dataset.tab));
});

document.querySelectorAll('[data-lead-filter]').forEach((button) => {
  button.addEventListener('click', () => {
    leadFilter = button.dataset.leadFilter;
    document.querySelectorAll('[data-lead-filter]').forEach((item) => item.classList.toggle('active', item === button));
    renderLeads();
  });
});

$('leadSearch').addEventListener('input', renderLeads);
$('leadStatusFilter').addEventListener('change', renderLeads);
$('refreshLeads').addEventListener('click', () => loadLeads().catch((error) => alert(friendlyError(error))));

$('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  setStatus($('authStatus'), 'Надсилання…');
  const { error } = await supabase.auth.signInWithOtp({
    email: $('email').value.trim(),
    options: { emailRedirectTo: location.href }
  });
  button.disabled = false;
  setStatus(
    $('authStatus'),
    error ? friendlyError(error) : 'Посилання надіслано. Відкрийте email на цьому пристрої.',
    error ? 'error' : 'success'
  );
});

$('logout').addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.href = './cabinet.html';
});

$('inviteForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  setStatus($('inviteStatus'), 'Перевірка…');
  const { data, error } = await supabase.rpc('accept_seller_invite', {
    p_token: $('inviteToken').value.trim()
  });
  button.disabled = false;
  if (error) {
    setStatus($('inviteStatus'), friendlyError(error), 'error');
    return;
  }
  setStatus($('inviteStatus'), `Готово: прийнято ${data?.units || 0} оголошень. Режим продавця активовано.`, 'success');
  const url = new URL(location.href);
  url.searchParams.delete('invite');
  history.replaceState(null, '', url);
  await loadAccount();
  await Promise.all([loadSeller(), loadSellerStats(), loadLeads()]);
  activate('seller');
});

$('profileForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  setStatus($('profileStatus'), 'Збереження…');
  const { data, error } = await supabase.rpc('update_my_profile', {
    p_display_name: $('displayName').value.trim(),
    p_phone: $('profilePhone').value.trim()
  });
  button.disabled = false;
  if (error) {
    setStatus($('profileStatus'), friendlyError(error), 'error');
    return;
  }
  account = data;
  $('profileName').textContent = account?.display_name || 'Особистий кабінет';
  $('profilePhone').value = account?.phone || '';
  renderRoleChips();
  setStatus($('profileStatus'), 'Профіль збережено ✓', 'success');
});

supabase.auth.onAuthStateChange(() => {
  load().catch((error) => setStatus($('authStatus'), friendlyError(error), 'error'));
});

load();
