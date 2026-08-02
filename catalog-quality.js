const SUPABASE_URL = 'https://vtnucevhyhfvymppjbfa.supabase.co';
const SUPABASE_KEY = 'sb_publishable_-5iiF1Qgq--BKgXLHREINA_nPC7yVVY';

function validHttpUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch (_) {
    return null;
  }
}

function removeFalseZeroFacts(root = document) {
  root.querySelectorAll('.property-facts span').forEach((node) => {
    const text = node.textContent.replace(/\s+/g, ' ').trim();
    if (/^[▣⌗]\s*0(?:[.,]0+)?\s*(?:м²|сот\.)$/u.test(text)) node.remove();
  });

  root.querySelectorAll('.dialog-list > div').forEach((row) => {
    const term = row.querySelector('dt')?.textContent.trim();
    const value = row.querySelector('dd')?.textContent.replace(/\s+/g, ' ').trim();
    if (['Площа', 'Ділянка'].includes(term) && /^0(?:[.,]0+)?\s*(?:м²|сот\.)$/u.test(value || '')) row.remove();
  });
}

async function loadUnitBySource(sourceUrl) {
  const query = new URLSearchParams({
    select: 'id,title,photo_urls,photo_count,source_url',
    source_url: `eq.${sourceUrl}`,
    limit: '1',
  });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/site_units?${query}`, {
    headers: { apikey: SUPABASE_KEY, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`gallery_fetch_${response.status}`);
  const rows = await response.json();
  return rows[0] || null;
}

function createPhotoLink(url, title, className) {
  const link = document.createElement('a');
  link.className = className;
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer nofollow';
  link.title = 'Відкрити фото у повному розмірі';

  const image = document.createElement('img');
  image.src = url;
  image.alt = title ? `Фото: ${title}` : 'Фото об’єкта';
  image.loading = 'lazy';
  image.decoding = 'async';
  image.referrerPolicy = 'no-referrer';
  image.addEventListener('error', () => link.remove(), { once: true });
  link.append(image);
  return link;
}

function renderGallery(media, item) {
  const urls = [...new Set((Array.isArray(item.photo_urls) ? item.photo_urls : [])
    .map(validHttpUrl)
    .filter(Boolean))];
  if (!urls.length) return;

  const gallery = document.createElement('div');
  gallery.className = 'quality-gallery';
  const main = createPhotoLink(urls[0], item.title, 'quality-gallery-main');
  gallery.append(main);

  if (urls.length > 1) {
    const thumbs = document.createElement('div');
    thumbs.className = 'quality-gallery-thumbs';
    urls.forEach((url, index) => {
      const thumb = createPhotoLink(url, item.title, `quality-gallery-thumb${index === 0 ? ' active' : ''}`);
      thumb.addEventListener('click', (event) => {
        event.preventDefault();
        const mainImage = main.querySelector('img');
        main.href = url;
        mainImage.src = url;
        thumbs.querySelectorAll('.quality-gallery-thumb').forEach((node) => node.classList.toggle('active', node === thumb));
      });
      thumb.addEventListener('dblclick', () => window.open(url, '_blank', 'noopener,noreferrer'));
      thumbs.append(thumb);
    });
    gallery.append(thumbs);
  }

  const caption = document.createElement('p');
  caption.className = 'quality-gallery-caption';
  caption.textContent = `Фото з оголошення: ${urls.length}. Натисніть основне фото, щоб відкрити файл.`;
  gallery.append(caption);
  media.replaceChildren(gallery);
}

let galleryRequest = 0;
async function enhanceOpenDialog() {
  const dialog = document.getElementById('detailDialog');
  if (!dialog?.open) return;
  removeFalseZeroFacts(dialog);

  const sourceUrl = validHttpUrl(dialog.querySelector('.source-link[href^="http"]')?.href);
  const media = dialog.querySelector('.dialog-media');
  if (!sourceUrl || !media || media.dataset.gallerySource === sourceUrl) return;
  media.dataset.gallerySource = sourceUrl;
  const request = ++galleryRequest;

  try {
    const item = await loadUnitBySource(sourceUrl);
    if (request !== galleryRequest || !dialog.open || !item) return;
    renderGallery(media, item);
  } catch (error) {
    console.warn('catalog_gallery_unavailable', error.message);
  }
}

const observer = new MutationObserver(() => {
  removeFalseZeroFacts();
  void enhanceOpenDialog();
});
observer.observe(document.body, { childList: true, subtree: true });
removeFalseZeroFacts();
document.addEventListener('click', () => setTimeout(() => void enhanceOpenDialog(), 0));
