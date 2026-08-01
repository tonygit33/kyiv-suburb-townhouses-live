import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CONFIG = {
  supabaseUrl: 'https://vtnucevhyhfvymppjbfa.supabase.co',
  publishableKey: 'sb_publishable_-5iiF1Qgq--BKgXLHREINA_nPC7yVVY',
  mapStyle: 'https://tiles.openfreemap.org/styles/liberty',
  pageSize: 12,
  maxRows: 500,
  refreshMs: 60_000,
};

const supabase = createClient(CONFIG.supabaseUrl, CONFIG.publishableKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const fields = [
  'id','slug','title','unit_kind','area_m2','land_area_sotka','floors','bedrooms',
  'status','completion','price','currency','price_basis','address','description',
  'source_url','checked_at','available_count','inventory_label','inventory_confidence',
  'created_at','updated_at','development_name','development_slug','development_status',
  'utilities','developer_name','developer_website','developer_phone','developer_role',
  'location_name','location_slug','settlement_slug','street','latitude','longitude',
  'cover_photo_url','photo_urls','photo_count','coordinate_precision','coordinate_source',
  'has_exact_coordinates'
].join(',');

const state = {
  items: [],
  visibleCount: CONFIG.pageSize,
  mapVisibleCount: CONFIG.pageSize,
  loading: false,
  view: 'catalog',
  map: null,
  mapLoaded: false,
  selectedId: null,
  adminSession: null,
  isAdmin: false,
  editMap: null,
  editMarker: null,
  filters: { query: '', location: '', price: '', type: '', sort: 'featured' },
};

const $ = (id) => document.getElementById(id);
const qs = (selector, root = document) => root.querySelector(selector);
const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch (_) {
    return null;
  }
}

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value, digits = 1) {
  const parsed = num(value);
  return parsed === null ? null : new Intl.NumberFormat('uk-UA', { maximumFractionDigits: digits }).format(parsed);
}

function formatPrice(item) {
  const value = num(item.price);
  if (value === null) return 'Ціна уточнюється';
  const currency = String(item.currency || 'USD').toUpperCase();
  const symbols = { USD: '$', EUR: '€', UAH: '₴' };
  const amount = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 }).format(value);
  return symbols[currency] ? `${amount} ${symbols[currency]}` : `${amount} ${currency}`;
}

function priceBasis(item) {
  return ({ per_sqm: 'за м²', total_from: 'ціна від', total: 'загальна ціна' })[item.price_basis]
    || (item.price ? 'заявлена ціна' : 'за запитом');
}

function needsReview(item) {
  const confidence = String(item.inventory_confidence || '').toLowerCase();
  const label = String(item.inventory_label || '').toLowerCase();
  return ['manual_review','conflict_review','low'].some((x) => confidence.includes(x))
    || label.includes('ручн') || label.includes('перевір');
}

function hasExactPoint(item) {
  return Boolean(item.has_exact_coordinates) || ['exact','address'].includes(item.coordinate_precision);
}

function coordinateLabel(item) {
  return hasExactPoint(item) ? 'Точна адреса' : 'Приблизна локація';
}

function itemLocation(item) {
  return item.location_name || item.address || 'Передмістя Києва';
}

function typeLabel(item) {
  if (item.unit_kind === 'project_offer') return 'Пропозиція комплексу';
  if (item.unit_kind === 'concrete') return 'Окремий об’єкт';
  return 'Нерухомість';
}

function showToast(message, kind = '') {
  const toast = $('toast');
  toast.textContent = message;
  toast.className = `toast show ${kind}`.trim();
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.className = 'toast'; }, 3200);
}

function openDialog(dialog) {
  if (!dialog.open) dialog.showModal();
  document.body.classList.add('dialog-open');
}

function closeDialog(dialog) {
  if (dialog?.open) dialog.close();
  if (!qsa('dialog[open]').length) document.body.classList.remove('dialog-open');
}

function showSkeletons() {
  $('propertyGrid').replaceChildren(...Array.from({ length: 8 }, () => el('div', 'skeleton')));
}

function setLive(text) {
  $('liveState').textContent = text;
}

async function loadCatalog({ quiet = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  $('errorMessage').hidden = true;
  if (!quiet && !state.items.length) showSkeletons();
  setLive('Оновлення даних…');

  try {
    const { data, error } = await supabase
      .from('site_units')
      .select(fields)
      .order('updated_at', { ascending: false })
      .limit(CONFIG.maxRows);
    if (error) throw error;
    state.items = Array.isArray(data) ? data : [];
    populateLocations();
    renderStats();
    renderCatalog();
    updateHero();
    if (state.mapLoaded) refreshMapData({ fit: false });
    setLive(`База онлайн · ${state.items.length} об’єктів`);
  } catch (error) {
    console.error(error);
    const message = $('errorMessage');
    message.textContent = 'Не вдалося завантажити каталог. Перевірте з’єднання і повторіть спробу.';
    message.hidden = false;
    if (!state.items.length) $('propertyGrid').replaceChildren();
    setLive('Помилка завантаження');
  } finally {
    state.loading = false;
  }
}

function populateLocations() {
  const names = [...new Set(state.items.map((x) => x.location_name).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'uk'));
  for (const id of ['locationFilter', 'mapLocationFilter']) {
    const select = $(id);
    const current = select.value;
    const label = id === 'locationFilter' ? 'Усі локації' : 'Усі локації';
    select.replaceChildren(new Option(label, ''));
    names.forEach((name) => select.add(new Option(name, name)));
    if (names.includes(current)) select.value = current;
  }
}

function renderStats() {
  const locations = new Set(state.items.map((x) => x.location_name).filter(Boolean));
  const withPhotos = state.items.filter((x) => x.cover_photo_url).length;
  const exact = state.items.filter(hasExactPoint).length;
  $('statObjects').textContent = state.items.length.toLocaleString('uk-UA');
  $('statLocations').textContent = locations.size.toLocaleString('uk-UA');
  $('statPhotos').textContent = withPhotos.toLocaleString('uk-UA');
  $('statExactMap').textContent = exact.toLocaleString('uk-UA');
  $('objectCountPill').textContent = `${state.items.length} об’єктів`;
}

function updateHero() {
  const hero = $('heroSection');
  const first = state.items.find((x) => safeUrl(x.cover_photo_url));
  if (!first) return;
  hero.style.backgroundImage = `linear-gradient(100deg,#e6e4dc 0 42%,rgba(231,231,224,.35) 58%,transparent 100%),url("${safeUrl(first.cover_photo_url)}")`;
}

function parsePriceRange(value) {
  if (!value) return [null, null];
  const [minRaw, maxRaw] = value.split('-');
  return [minRaw ? Number(minRaw) : null, maxRaw ? Number(maxRaw) : null];
}

function filteredItems() {
  const query = state.filters.query.trim().toLocaleLowerCase('uk');
  const [minPrice, maxPrice] = parsePriceRange(state.filters.price);
  const filtered = state.items.filter((item) => {
    const haystack = [item.title, item.address, item.location_name, item.development_name, item.developer_name]
      .filter(Boolean).join(' ').toLocaleLowerCase('uk');
    const price = num(item.price);
    return (!query || haystack.includes(query))
      && (!state.filters.location || item.location_name === state.filters.location)
      && (!state.filters.type || item.unit_kind === state.filters.type)
      && (minPrice === null || (price !== null && price >= minPrice))
      && (maxPrice === null || (price !== null && price <= maxPrice));
  });

  filtered.sort((a, b) => {
    if (state.filters.sort === 'price-asc') return (num(a.price) ?? Number.MAX_SAFE_INTEGER) - (num(b.price) ?? Number.MAX_SAFE_INTEGER);
    if (state.filters.sort === 'price-desc') return (num(b.price) ?? -1) - (num(a.price) ?? -1);
    if (state.filters.sort === 'area-desc') return (num(b.area_m2) ?? -1) - (num(a.area_m2) ?? -1);
    if (state.filters.sort === 'featured') {
      const photoDelta = Number(Boolean(b.cover_photo_url)) - Number(Boolean(a.cover_photo_url));
      if (photoDelta) return photoDelta;
      const pointDelta = Number(hasExactPoint(b)) - Number(hasExactPoint(a));
      if (pointDelta) return pointDelta;
    }
    return new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0);
  });
  return filtered;
}

function imageBlock(item, className = 'property-media') {
  const wrapper = el('div', className);
  const url = safeUrl(item.cover_photo_url);
  if (url) {
    const image = el('img');
    image.src = url;
    image.alt = item.title ? `Фото: ${item.title}` : 'Фото об’єкта';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => wrapper.replaceChildren(el('div', 'photo-placeholder', 'Фото тимчасово недоступне')), { once: true });
    wrapper.append(image);
  } else {
    wrapper.append(el('div', 'photo-placeholder', 'Фото ще не додано'));
  }
  return wrapper;
}

function fact(text) {
  return el('span', '', text);
}

function createCard(item) {
  const article = el('article', 'property-card');
  const media = imageBlock(item);
  const status = el('div', 'card-status');
  status.append(el('span', `status-chip ${needsReview(item) ? 'review' : 'published'}`, needsReview(item) ? 'Потрібна перевірка' : 'Опубліковано'));
  status.append(el('span', 'status-chip', typeLabel(item)));
  media.append(status);
  if (num(item.photo_count) > 0) media.append(el('span', 'photo-count', `${item.photo_count} фото`));

  const body = el('div', 'property-body');
  body.append(el('p', 'property-location', itemLocation(item)));
  body.append(el('h3', '', item.title || item.development_name || 'Об’єкт нерухомості'));
  body.append(el('p', 'property-address', item.address || 'Адреса уточнюється'));
  const facts = el('div', 'property-facts');
  if (num(item.area_m2) !== null) facts.append(fact(`▣ ${formatNumber(item.area_m2)} м²`));
  if (num(item.bedrooms) !== null) facts.append(fact(`⌑ ${formatNumber(item.bedrooms, 0)} спал.`));
  if (num(item.land_area_sotka) !== null) facts.append(fact(`⌗ ${formatNumber(item.land_area_sotka)} сот.`));
  body.append(facts);

  const bottom = el('div', 'property-bottom');
  const price = el('div', 'price', formatPrice(item));
  price.append(el('small', '', priceBasis(item)));
  bottom.append(price);
  const actions = el('div', 'card-actions');
  const details = el('button', 'details-button', 'Детальніше');
  details.type = 'button';
  details.addEventListener('click', () => openDetails(item));
  const edit = el('button', 'edit-button', 'Редагувати');
  edit.type = 'button';
  edit.addEventListener('click', () => requestEdit(item));
  const more = el('button', 'more-button', '⋮');
  more.type = 'button';
  more.title = coordinateLabel(item);
  more.addEventListener('click', () => selectOnMap(item));
  actions.append(details, edit, more);
  bottom.append(actions);
  body.append(bottom);
  article.append(media, body);
  return article;
}

function renderCatalog() {
  const items = filteredItems();
  const shown = Math.min(state.visibleCount, items.length);
  const remaining = Math.max(0, items.length - shown);
  $('resultCount').textContent = items.length ? `Показано ${shown} із ${items.length}` : 'Знайдено: 0';
  $('emptyMessage').hidden = items.length > 0;
  $('propertyGrid').replaceChildren(...items.slice(0, shown).map(createCard));
  $('catalogPagination').hidden = remaining === 0;
  if (remaining) {
    const next = Math.min(CONFIG.pageSize, remaining);
    $('paginationStatus').textContent = `Ще ${remaining} об’єктів у каталозі`;
    $('loadMoreButton').textContent = `Показати ще ${next}`;
  }
}

function readCatalogFilters() {
  state.filters.query = $('searchInput').value;
  state.filters.location = $('locationFilter').value;
  state.filters.price = $('priceFilter').value;
  state.filters.type = $('typeFilter').value;
  state.filters.sort = $('sortFilter').value;
  state.visibleCount = CONFIG.pageSize;
  renderCatalog();
  syncMapControls();
  if (state.mapLoaded) refreshMapData({ fit: true });
}

function readMapFilters() {
  state.filters.query = $('mapSearchInput').value;
  state.filters.location = $('mapLocationFilter').value;
  state.filters.price = $('mapPriceFilter').value;
  state.mapVisibleCount = CONFIG.pageSize;
  syncCatalogControls();
  renderCatalog();
  refreshMapData({ fit: true });
}

function syncMapControls() {
  $('mapSearchInput').value = state.filters.query;
  $('mapLocationFilter').value = state.filters.location;
  $('mapPriceFilter').value = state.filters.price;
}

function syncCatalogControls() {
  $('searchInput').value = state.filters.query;
  $('locationFilter').value = state.filters.location;
  $('priceFilter').value = state.filters.price;
  $('typeFilter').value = state.filters.type;
  $('sortFilter').value = state.filters.sort;
}

function clearFilters() {
  state.filters = { query: '', location: '', price: '', type: '', sort: 'featured' };
  state.visibleCount = CONFIG.pageSize;
  state.mapVisibleCount = CONFIG.pageSize;
  syncCatalogControls();
  syncMapControls();
  renderCatalog();
  if (state.mapLoaded) refreshMapData({ fit: true });
}

function switchView(view) {
  state.view = view;
  qsa('.view').forEach((node) => node.classList.toggle('active', node.id === `${view}View`));
  qsa('.nav-link').forEach((node) => node.classList.toggle('active', node.dataset.view === view));
  window.scrollTo({ top: 0, behavior: 'instant' });
  if (view === 'map') {
    syncMapControls();
    initMap();
    setTimeout(() => state.map?.resize(), 80);
  }
}

function mapGeoJSON(items) {
  return {
    type: 'FeatureCollection',
    features: items.filter((item) => num(item.longitude) !== null && num(item.latitude) !== null).map((item) => ({
      type: 'Feature',
      id: item.id,
      geometry: { type: 'Point', coordinates: [Number(item.longitude), Number(item.latitude)] },
      properties: { id: item.id, exact: hasExactPoint(item) ? 1 : 0, title: item.title || '', price: formatPrice(item), location: itemLocation(item) }
    }))
  };
}

function initMap() {
  if (state.map) {
    refreshMapData({ fit: false });
    return;
  }
  if (!window.maplibregl) {
    showToast('Карта не завантажилася', 'error');
    return;
  }
  state.map = new window.maplibregl.Map({
    container: 'map',
    style: CONFIG.mapStyle,
    center: [30.25, 50.50],
    zoom: 9,
    minZoom: 6,
    maxZoom: 19,
    attributionControl: true,
  });
  state.map.addControl(new window.maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  state.map.addControl(new window.maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false }), 'top-right');

  state.map.on('load', () => {
    state.mapLoaded = true;
    state.map.addSource('properties', { type: 'geojson', data: mapGeoJSON(filteredItems()), cluster: true, clusterMaxZoom: 15, clusterRadius: 52 });
    state.map.addLayer({ id: 'clusters', type: 'circle', source: 'properties', filter: ['has', 'point_count'], paint: { 'circle-color': '#173b2c', 'circle-radius': ['step', ['get','point_count'], 20, 10, 25, 30, 32], 'circle-stroke-width': 4, 'circle-stroke-color': 'rgba(255,255,255,.9)' } });
    state.map.addLayer({ id: 'cluster-count', type: 'symbol', source: 'properties', filter: ['has','point_count'], layout: { 'text-field': ['get','point_count_abbreviated'], 'text-size': 13 }, paint: { 'text-color': '#ffffff' } });
    state.map.addLayer({ id: 'unclustered-point', type: 'circle', source: 'properties', filter: ['!', ['has','point_count']], paint: { 'circle-color': ['case', ['==',['get','exact'],1], '#173b2c', '#c7ad74'], 'circle-radius': 9, 'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff' } });

    state.map.on('click', 'clusters', async (event) => {
      const feature = state.map.queryRenderedFeatures(event.point, { layers: ['clusters'] })[0];
      const clusterId = feature?.properties?.cluster_id;
      if (clusterId === undefined) return;
      const zoom = await state.map.getSource('properties').getClusterExpansionZoom(clusterId);
      state.map.easeTo({ center: feature.geometry.coordinates, zoom });
    });
    state.map.on('click', 'unclustered-point', (event) => {
      const id = event.features?.[0]?.properties?.id;
      const item = state.items.find((x) => x.id === id);
      if (item) showSelectedProperty(item);
    });
    for (const layer of ['clusters','unclustered-point']) {
      state.map.on('mouseenter', layer, () => { state.map.getCanvas().style.cursor = 'pointer'; });
      state.map.on('mouseleave', layer, () => { state.map.getCanvas().style.cursor = ''; });
    }
    refreshMapData({ fit: true });
  });
}

function refreshMapData({ fit = false } = {}) {
  const items = filteredItems();
  renderMapResults(items);
  $('mapResultsCount').textContent = items.length;
  if (!state.mapLoaded) return;
  const source = state.map.getSource('properties');
  if (source) source.setData(mapGeoJSON(items));
  if (fit) fitMapToItems(items);
}

function fitMapToItems(items = filteredItems()) {
  if (!state.mapLoaded) return;
  const points = items.filter((x) => num(x.longitude) !== null && num(x.latitude) !== null);
  if (!points.length) return;
  const bounds = new window.maplibregl.LngLatBounds();
  points.forEach((x) => bounds.extend([Number(x.longitude), Number(x.latitude)]));
  if (points.length === 1) state.map.easeTo({ center: bounds.getCenter(), zoom: 14 });
  else state.map.fitBounds(bounds, { padding: 70, maxZoom: 14, duration: 650 });
}

function createMapResult(item) {
  const card = el('article', `map-result-card${state.selectedId === item.id ? ' active' : ''}`);
  card.dataset.id = item.id;
  const photo = imageBlock(item, 'map-result-photo');
  const copy = el('div', 'map-result-copy');
  copy.append(el('div', 'price', formatPrice(item)));
  copy.append(el('h3', '', item.title || 'Об’єкт нерухомості'));
  copy.append(el('p', '', item.address || itemLocation(item)));
  const precision = el('span', `coordinate-label${hasExactPoint(item) ? '' : ' approx'}`, coordinateLabel(item));
  copy.append(precision);
  const actions = el('div', 'map-result-actions');
  const details = el('button', 'details-button', 'Детальніше');
  details.type = 'button';
  details.addEventListener('click', (event) => { event.stopPropagation(); openDetails(item); });
  const edit = el('button', 'edit-button', 'Редагувати');
  edit.type = 'button';
  edit.addEventListener('click', (event) => { event.stopPropagation(); requestEdit(item); });
  actions.append(details, edit);
  copy.append(actions);
  card.append(photo, copy);
  card.addEventListener('click', () => showSelectedProperty(item, { fly: true }));
  return card;
}

function renderMapResults(items = filteredItems()) {
  const shown = Math.min(state.mapVisibleCount, items.length);
  $('mapResultList').replaceChildren(...items.slice(0, shown).map(createMapResult));
  $('mapLoadMore').hidden = shown >= items.length;
  if (shown < items.length) $('mapLoadMore').textContent = `Показати ще ${Math.min(CONFIG.pageSize, items.length - shown)} об’єктів`;
}

function showSelectedProperty(item, { fly = false } = {}) {
  state.selectedId = item.id;
  const panel = $('mapSelected');
  panel.hidden = false;
  panel.replaceChildren();
  const close = el('button', 'selected-close', '×');
  close.type = 'button';
  close.addEventListener('click', () => { panel.hidden = true; state.selectedId = null; renderMapResults(); });
  panel.append(close);
  const photo = imageBlock(item, 'selected-photo');
  panel.append(photo);
  const body = el('div', 'selected-body');
  body.append(el('span', `coordinate-label${hasExactPoint(item) ? '' : ' approx'}`, coordinateLabel(item)));
  body.append(el('div', 'price', formatPrice(item)));
  body.append(el('h3', '', item.title || 'Об’єкт нерухомості'));
  body.append(el('p', '', item.address || itemLocation(item)));
  const actions = el('div', 'selected-actions');
  const view = el('button', 'details-button', 'Переглянути об’єкт');
  view.type = 'button';
  view.addEventListener('click', () => openDetails(item));
  const edit = el('button', 'edit-button', 'Редагувати');
  edit.type = 'button';
  edit.addEventListener('click', () => requestEdit(item));
  actions.append(view, edit);
  body.append(actions);
  panel.append(body);
  renderMapResults();
  if (fly && state.mapLoaded && num(item.longitude) !== null && num(item.latitude) !== null) {
    state.map.flyTo({ center: [Number(item.longitude), Number(item.latitude)], zoom: hasExactPoint(item) ? 16 : 13, essential: true });
  }
}

function selectOnMap(item) {
  switchView('map');
  setTimeout(() => showSelectedProperty(item, { fly: true }), 120);
}

function detailFact(term, value) {
  if (value === null || value === undefined || value === '') return null;
  const block = el('div');
  block.append(el('dt', '', term), el('dd', '', value));
  return block;
}

function openDetails(item) {
  const content = $('dialogContent');
  const layout = el('div', 'dialog-layout');
  const media = imageBlock(item, 'dialog-media');
  layout.append(media);
  const copy = el('div', 'dialog-copy');
  copy.append(el('p', 'property-location', itemLocation(item)));
  const rawTitle = String(item.title || '').trim();
  const technicalTitle = /^(?:ID\s*)?\d{5,}$/i.test(rawTitle);
  const placeTitle = item.location_name || item.address || 'передмісті Києва';
  const displayTitle = technicalTitle ? `Будинок у ${placeTitle}` : (rawTitle || `Будинок у ${placeTitle}`);
  copy.append(el('h2', '', displayTitle));
  copy.append(el('span', `coordinate-label${hasExactPoint(item) ? '' : ' approx'}`, coordinateLabel(item)));
  if (item.description) copy.append(el('p', 'lead', item.description));
  copy.append(el('div', 'price', formatPrice(item)));
  const list = el('dl', 'dialog-list');
  [
    detailFact('Площа', num(item.area_m2) === null ? null : `${formatNumber(item.area_m2)} м²`),
    detailFact('Ділянка', num(item.land_area_sotka) === null ? null : `${formatNumber(item.land_area_sotka)} сот.`),
    detailFact('Поверхи', num(item.floors) > 0 ? formatNumber(item.floors, 0) : null),
    detailFact('Спальні', num(item.bedrooms) > 0 ? formatNumber(item.bedrooms, 0) : null),
    detailFact('Адреса', item.address),
    detailFact('Продавець', item.developer_name),
    detailFact('Перевірено', item.checked_at ? new Intl.DateTimeFormat('uk-UA').format(new Date(`${item.checked_at}T00:00:00`)) : null),
    detailFact('Фото', num(item.photo_count) ? `${item.photo_count}` : null),
  ].filter(Boolean).forEach((node) => list.append(node));
  copy.append(list);
  const actions = el('div', 'dialog-actions');
  const source = safeUrl(item.source_url);
  if (source) {
    const link = el('a', 'source-link', 'Відкрити першоджерело');
    link.href = source; link.target = '_blank'; link.rel = 'noopener noreferrer nofollow';
    actions.append(link);
  }
  const mapButton = el('button', 'edit-button', 'Показати на карті');
  mapButton.type = 'button';
  mapButton.addEventListener('click', () => { closeDialog($('detailDialog')); selectOnMap(item); });
  const edit = el('button', 'edit-button', 'Редагувати');
  edit.type = 'button';
  edit.addEventListener('click', () => { closeDialog($('detailDialog')); requestEdit(item); });
  actions.append(mapButton, edit);
  copy.append(actions);
  layout.append(copy);
  content.replaceChildren(layout);
  openDialog($('detailDialog'));
}

async function refreshAdminState(session = null) {
  const current = session || (await supabase.auth.getSession()).data.session;
  state.adminSession = current;
  state.isAdmin = false;
  if (current) {
    const { data, error } = await supabase.rpc('is_site_admin');
    state.isAdmin = !error && data === true;
  }
  $('adminButtonLabel').textContent = state.isAdmin ? 'Адмін активний' : 'Редагувати';
  document.body.classList.toggle('is-admin', state.isAdmin);
}

async function ensureAdmin() {
  await refreshAdminState();
  if (state.isAdmin) return true;
  openDialog($('authDialog'));
  return false;
}

async function requestEdit(item) {
  if (!(await ensureAdmin())) return;
  openEditDialog(item);
}

function setValue(id, value) {
  $(id).value = value ?? '';
}

function openEditDialog(item) {
  setValue('editUnitId', item.id);
  setValue('editTitle', item.title);
  setValue('editPrice', item.price);
  setValue('editCurrency', item.currency || 'USD');
  setValue('editArea', item.area_m2);
  setValue('editLand', item.land_area_sotka);
  setValue('editFloors', item.floors);
  setValue('editBedrooms', item.bedrooms);
  setValue('editAddress', item.address);
  setValue('editPublication', 'published');
  setValue('editPrecision', item.coordinate_precision || 'settlement');
  setValue('editLatitude', item.latitude);
  setValue('editLongitude', item.longitude);
  setValue('editDescription', item.description);
  setValue('editSourceUrl', item.source_url);
  $('editStatus').textContent = '';
  openDialog($('editDialog'));
  setTimeout(() => initEditMap(item), 80);
}

function initEditMap(item) {
  const lng = num($('editLongitude').value) ?? 30.25;
  const lat = num($('editLatitude').value) ?? 50.50;
  if (!state.editMap) {
    state.editMap = new window.maplibregl.Map({ container: 'editMap', style: CONFIG.mapStyle, center: [lng, lat], zoom: hasExactPoint(item) ? 16 : 12, attributionControl: false });
    state.editMap.addControl(new window.maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    state.editMarker = new window.maplibregl.Marker({ color: '#173b2c', draggable: true }).setLngLat([lng, lat]).addTo(state.editMap);
    state.editMarker.on('dragend', () => {
      const point = state.editMarker.getLngLat();
      setValue('editLatitude', point.lat.toFixed(7));
      setValue('editLongitude', point.lng.toFixed(7));
      setValue('editPrecision', 'exact');
    });
  } else {
    state.editMap.resize();
    state.editMap.jumpTo({ center: [lng, lat], zoom: hasExactPoint(item) ? 16 : 12 });
    state.editMarker.setLngLat([lng, lat]);
  }
}

function patchFromEditForm() {
  return {
    title: $('editTitle').value,
    price: $('editPrice').value || null,
    currency: $('editCurrency').value,
    area_m2: $('editArea').value || null,
    land_area_sotka: $('editLand').value || null,
    floors: $('editFloors').value || null,
    bedrooms: $('editBedrooms').value || null,
    address: $('editAddress').value || null,
    publication: $('editPublication').value,
    coordinate_precision: $('editPrecision').value,
    latitude: $('editLatitude').value || null,
    longitude: $('editLongitude').value || null,
    description: $('editDescription').value || null,
    source_url: $('editSourceUrl').value || null,
  };
}

async function saveEdit(event) {
  event.preventDefault();
  const status = $('editStatus');
  status.className = 'form-status';
  status.textContent = 'Збереження…';
  const { data, error } = await supabase.rpc('admin_update_unit', { p_unit_id: $('editUnitId').value, p_patch: patchFromEditForm() });
  if (error) {
    status.className = 'form-status error';
    status.textContent = error.message;
    return;
  }
  status.className = 'form-status success';
  status.textContent = 'Збережено';
  showToast('Об’єкт оновлено');
  await loadCatalog({ quiet: true });
  setTimeout(() => closeDialog($('editDialog')), 450);
  return data;
}

function createAddPayload() {
  const photos = $('addPhotos').value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const payload = {
    title: $('addTitle').value.trim(),
    settlement: $('addSettlement').value.trim(),
    address: $('addAddress').value.trim() || null,
    price: $('addPrice').value || null,
    currency: $('addCurrency').value,
    area_m2: $('addArea').value || null,
    land_area_sotka: $('addLand').value || null,
    floors: $('addFloors').value || null,
    bedrooms: $('addBedrooms').value || null,
    description: $('addDescription').value.trim() || null,
    source_url: $('addSourceUrl').value.trim(),
    photo_urls: photos,
    latitude: $('addLatitude').value || null,
    longitude: $('addLongitude').value || null,
    coordinate_precision: $('addLatitude').value && $('addLongitude').value ? 'address' : 'settlement',
    coordinate_source: 'admin_form',
    publication: $('addPublication').value,
    unit_kind: 'concrete',
    developer_name: 'Продавець з оголошення',
    checked_at: new Date().toISOString().slice(0, 10),
  };
  Object.keys(payload).forEach((key) => payload[key] === null && delete payload[key]);
  return payload;
}

async function saveNewProperty(event) {
  event.preventDefault();
  const status = $('addStatus');
  status.className = 'form-status';
  status.textContent = 'Додавання…';
  const payload = createAddPayload();
  const { data, error } = await supabase.rpc('admin_ingest_property', { p: payload });
  if (error) {
    status.className = 'form-status error';
    status.textContent = error.message;
    return;
  }
  status.className = 'form-status success';
  status.textContent = data?.publication === 'published' ? 'Об’єкт опубліковано' : 'Об’єкт збережено на перевірку';
  showToast('Об’єкт додано до Supabase');
  $('addForm').reset();
  await loadCatalog({ quiet: true });
  setTimeout(() => closeDialog($('addDialog')), 650);
}

async function sendMagicLink(event) {
  event.preventDefault();
  const email = $('authEmail').value.trim();
  const status = $('authStatus');
  status.className = 'form-status';
  status.textContent = 'Надсилання…';
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
  if (error) {
    status.className = 'form-status error';
    status.textContent = error.message;
    return;
  }
  status.className = 'form-status success';
  status.textContent = 'Посилання надіслано. Відкрийте його на цьому пристрої.';
}

function bindEvents() {
  qsa('[data-view]').forEach((node) => node.addEventListener('click', () => switchView(node.dataset.view)));
  qsa('[data-view-link]').forEach((node) => node.addEventListener('click', () => switchView(node.dataset.viewLink)));
  qsa('[data-close-dialog]').forEach((node) => node.addEventListener('click', () => closeDialog($(node.dataset.closeDialog))));
  qsa('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => { if (event.target === dialog) closeDialog(dialog); }));

  $('searchButton').addEventListener('click', readCatalogFilters);
  $('searchInput').addEventListener('keydown', (event) => { if (event.key === 'Enter') readCatalogFilters(); });
  for (const id of ['locationFilter','priceFilter','typeFilter','sortFilter']) $(id).addEventListener('change', readCatalogFilters);
  $('clearFilters').addEventListener('click', clearFilters);
  $('loadMoreButton').addEventListener('click', () => { state.visibleCount += CONFIG.pageSize; renderCatalog(); });

  $('mapApplyFilters').addEventListener('click', readMapFilters);
  $('mapSearchInput').addEventListener('keydown', (event) => { if (event.key === 'Enter') readMapFilters(); });
  $('fitMapButton').addEventListener('click', () => fitMapToItems());
  $('mapLoadMore').addEventListener('click', () => { state.mapVisibleCount += CONFIG.pageSize; renderMapResults(); });

  $('adminButton').addEventListener('click', async () => {
    if (await ensureAdmin()) showToast('Адмін-режим активний');
  });
  $('addPropertyButton').addEventListener('click', async () => {
    if (!(await ensureAdmin())) return;
    $('addStatus').textContent = '';
    openDialog($('addDialog'));
  });
  $('authForm').addEventListener('submit', sendMagicLink);
  $('editForm').addEventListener('submit', saveEdit);
  $('addForm').addEventListener('submit', saveNewProperty);

  for (const id of ['editLatitude','editLongitude']) {
    $(id).addEventListener('change', () => {
      const lat = num($('editLatitude').value); const lng = num($('editLongitude').value);
      if (lat !== null && lng !== null && state.editMarker) {
        state.editMarker.setLngLat([lng, lat]);
        state.editMap.easeTo({ center: [lng, lat], zoom: 16 });
      }
    });
  }
}

async function boot() {
  bindEvents();
  const mobileFilterButton = $('mobileFilterToggle');
  if (mobileFilterButton) {
    mobileFilterButton.addEventListener('click', () => {
      const dock = document.querySelector('.search-dock');
      const open = dock.classList.toggle('filters-open');
      mobileFilterButton.setAttribute('aria-expanded', String(open));
      mobileFilterButton.setAttribute('aria-label', open ? 'Сховати фільтри' : 'Показати фільтри');
    });
  }
  const { data: { session } } = await supabase.auth.getSession();
  await refreshAdminState(session);
  supabase.auth.onAuthStateChange(async (_event, nextSession) => {
    await refreshAdminState(nextSession);
    if (state.isAdmin) {
      closeDialog($('authDialog'));
      showToast('Вхід адміністратора виконано');
    }
  });
  await loadCatalog();
  window.setInterval(() => loadCatalog({ quiet: true }), CONFIG.refreshMs);
}

boot();
