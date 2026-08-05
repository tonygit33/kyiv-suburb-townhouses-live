import{createClient}from'https://esm.sh/@supabase/supabase-js@2';

const db=createClient('https://vtnucevhyhfvymppjbfa.supabase.co','sb_publishable_-5iiF1Qgq--BKgXLHREINA_nPC7yVVY');
const $=id=>document.getElementById(id);
const state={overview:null,units:[],sellers:[],city:'all',scope:'all',sort:'priority',query:'',activeId:null,workspace:null,detailTab:'summary',sellerUnitFilter:null,selectedInvite:new Set()};
const cityOrder=['Буча','Ірпінь','Гостомель','Горенка','Вишгород','Вишневе'];
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const norm=v=>String(v??'').toLowerCase().replace(/\s+/g,' ').trim();
const money=(price,currency)=>price!==null&&price!==undefined&&price!==''?new Intl.NumberFormat('uk-UA',{maximumFractionDigits:0}).format(Number(price))+' '+({USD:'$',EUR:'€',UAH:'₴'}[currency]||currency||''):'Ціна не вказана';
const date=v=>v?new Date(v).toLocaleDateString('uk-UA'):'—';
const stale=v=>!v||Date.now()-new Date(v).getTime()>14*864e5;
const badge=(text,cls='')=>`<span class="badge ${esc(cls)}">${esc(text)}</span>`;
const link=(url,label)=>url?`<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>`:'';
async function rpc(name,args={}){const{data,error}=await db.rpc(name,args);if(error)throw error;return data}

function setTab(name){
  document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active',p.id===name+'Panel'));
  if(name==='invites')loadInviteHistory();
}

async function loadAll(){
  $('syncStatus').textContent='Оновлення стану бази…';$('syncStatus').className='';
  try{
    const[overview,units,sellers]=await Promise.all([rpc('admin_catalog_overview'),rpc('admin_catalog_units'),rpc('admin_seller_directory')]);
    state.overview=overview;state.units=units||[];state.sellers=sellers||[];
    renderOverview();renderCities();renderUnits();renderDuplicates();renderSellers();renderInviteUnits();
    $('syncStatus').textContent=`Синхронізовано ${new Date().toLocaleString('uk-UA')} · ${state.units.length} записів у єдиній базі`;
    if(state.activeId&&state.units.some(x=>x.unit_id===state.activeId))await openUnit(state.activeId,false);
  }catch(e){$('syncStatus').textContent='Помилка: '+e.message;$('syncStatus').className='error'}
}

function renderOverview(){
  const t=state.overview?.totals||{};
  const cards=[['На сайті',t.on_site,''],['Published',t.published,''],['Review',t.review,'warn'],['Archive',t.archive,''],['Можливі дублі',t.duplicates,'alert'],['Недоступні',t.unavailable,'alert'],['Застарілі',t.stale,'warn'],['Джерела',t.sources,'']];
  $('kpiGrid').innerHTML=cards.map(([label,value,cls])=>`<button class="kpi ${cls}" data-kpi="${esc(label)}"><strong>${Number(value||0)}</strong><span>${esc(label)}</span></button>`).join('');
  $('catalogBadge').textContent=t.units||0;$('duplicateBadge').textContent=t.duplicates||0;$('sellerBadge').textContent=state.sellers.length;
  $('kpiGrid').querySelectorAll('[data-kpi]').forEach(b=>b.onclick=()=>{const map={'На сайті':'on_site','Published':'published','Review':'review','Archive':'archive','Можливі дублі':'duplicates','Недоступні':'unavailable','Застарілі':'stale'};const next=map[b.dataset.kpi];if(next){state.scope=next;$('scopeFilter').value=next;setTab('catalog');renderUnits()}});
}

function renderCities(){
  const rows=state.overview?.cities||[],total=state.overview?.totals?.units||0;
  const all=`<button class="city-card ${state.city==='all'?'active':''}" data-city="all"><strong>Усі міста</strong><small>${total} записів</small><div class="city-numbers"><span>${state.overview?.totals?.on_site||0} сайт</span><span>${state.overview?.totals?.review||0} review</span></div></button>`;
  $('cityStrip').innerHTML=all+rows.map(c=>`<button class="city-card ${state.city===c.city?'active':''}" data-city="${esc(c.city)}"><strong>${esc(c.city)}</strong><small>${c.total} записів</small><div class="city-numbers"><span>${c.on_site} сайт</span><span>${c.review} review</span>${c.duplicates?`<span>${c.duplicates} дуб.</span>`:''}</div></button>`).join('');
  $('cityHint').textContent=state.city==='all'?'Оберіть місто, щоб побачити його повну чергу':`Фільтр: ${state.city}`;
  $('cityStrip').querySelectorAll('[data-city]').forEach(b=>b.onclick=()=>{state.city=b.dataset.city;state.sellerUnitFilter=null;renderCities();renderUnits()});
}

function filteredUnits(){
  const q=norm(state.query);
  const priority=u=>(cityOrder.indexOf(u.city)<0?20:cityOrder.indexOf(u.city))*100+(u.publication==='review'?0:u.publication==='published'?20:40)+(u.possible_duplicate_of?-5:0);
  const rows=state.units.filter(u=>{
    if(state.city!=='all'&&u.city!==state.city)return false;
    if(state.sellerUnitFilter&&!state.sellerUnitFilter.includes(u.unit_id))return false;
    if(q&&!norm([u.title,u.city,u.address,u.developer_name,u.duplicate_reason].join(' ')).includes(q))return false;
    if(state.scope==='on_site')return u.on_site;
    if(state.scope==='published')return u.publication==='published';
    if(state.scope==='review')return u.publication==='review';
    if(state.scope==='archive')return u.publication==='archive';
    if(state.scope==='duplicates')return !!u.possible_duplicate_of;
    if(state.scope==='unavailable')return['blocked','removed'].includes(u.source_access_status);
    if(state.scope==='stale')return stale(u.source_checked_at||u.checked_at);
    if(state.scope==='no_photos')return !u.photo_count;
    if(state.scope==='no_price')return !u.price;
    return true;
  });
  rows.sort((a,b)=>{
    if(state.sort==='updated')return new Date(b.updated_at)-new Date(a.updated_at);
    if(state.sort==='price_asc')return(Number(a.price)||1e18)-(Number(b.price)||1e18);
    if(state.sort==='area_asc')return(Number(a.area_m2)||1e18)-(Number(b.area_m2)||1e18);
    if(state.sort==='sources_desc')return(b.source_count||0)-(a.source_count||0);
    return priority(a)-priority(b)||new Date(b.updated_at)-new Date(a.updated_at);
  });
  return rows;
}

function renderUnits(){
  const rows=filteredUnits();$('listCount').textContent=rows.length;$('unitEmpty').hidden=rows.length>0;
  $('listTitle').textContent=state.sellerUnitFilter?'Об’єкти продавця':state.city==='all'?'Усі записи':state.city;
  $('unitList').innerHTML=rows.map(u=>`<button class="unit-item ${state.activeId===u.unit_id?'active':''}" data-unit="${u.unit_id}">${u.cover_photo_url?`<img loading="lazy" src="${esc(u.cover_photo_url)}" alt="">`:'<span class="unit-photo-placeholder">⌂</span>'}<span><h3>${esc(u.title||'Без назви')}</h3><p>${esc(u.city)}${u.address?' · '+esc(u.address):''}</p><span class="unit-meta">${badge(u.publication,u.publication)}${u.on_site?badge('на сайті','site'):''}${u.review_status?badge(u.review_status,u.review_status):''}${u.possible_duplicate_of?badge('possible duplicate','duplicate'):''}<span class="badge">${u.photo_count||0} фото</span><span class="badge">${u.source_count||0} дж.</span><span class="badge">${u.seller_count||0} прод.</span></span></span><span class="unit-price">${money(u.price,u.currency)}<br><small>${u.area_m2?u.area_m2+' м²':''}</small></span></button>`).join('');
  $('unitList').querySelectorAll('[data-unit]').forEach(b=>b.onclick=()=>openUnit(b.dataset.unit));
}

async function openUnit(id,scroll=true){
  state.activeId=id;renderUnits();$('unitDetail').innerHTML='<div class="empty">Завантаження картки…</div>';
  try{state.workspace=await rpc('admin_unit_workspace',{p_unit_id:id});renderDetail();if(scroll&&innerWidth<850)$('unitDetail').scrollIntoView({behavior:'smooth',block:'start'})}catch(e){$('unitDetail').innerHTML=`<p class="error">${esc(e.message)}</p>`}
}

function activateDetail(name){
  state.detailTab=name;
  $('unitDetail').querySelectorAll('[data-detail]').forEach(b=>b.classList.toggle('active',b.dataset.detail===name));
  $('unitDetail').querySelectorAll('.detail-section').forEach(s=>s.classList.toggle('active',s.id==='detail'+name[0].toUpperCase()+name.slice(1)));
}
const field=(name,label,value,type='text',wide=false)=>`<label class="${wide?'wide':''}"><span>${esc(label)}</span><input name="${name}" type="${type}" value="${esc(value??'')}"></label>`;

function renderDetail(){
  const w=state.workspace,u=w?.unit;if(!u)return;
  const photos=(w.photos||[]).filter(p=>['external','ready'].includes(p.status)&&p.url),cover=photos.find(p=>p.is_cover)?.url||photos[0]?.url;
  $('unitDetail').innerHTML=`<div class="detail-hero">${cover?`<img class="detail-cover" src="${esc(cover)}" alt="">`:'<div class="detail-cover"></div>'}<div><p class="eyebrow">${esc(u.city)} · ${esc(u.publication)}</p><h2>${esc(u.title||'Без назви')}</h2><p class="detail-sub">${esc(u.address||u.development_address||'Адреса не вказана')} · ${money(u.price,u.currency)}${u.area_m2?' · '+u.area_m2+' м²':''}</p><div class="unit-meta">${badge(u.publication,u.publication)}${u.on_site?badge('видно на сайті','site'):''}${u.review_status?badge(u.review_status,u.review_status):''}${u.possible_duplicate_of?badge('можливий дубль','duplicate'):''}</div><div class="detail-actions">${link(u.source_url,'Відкрити джерело')}<a href="./" target="_blank" class="secondary">Відкрити каталог</a></div></div></div><nav class="detail-tabs"><button data-detail="summary">Дані</button><button data-detail="contacts">Продавці ${(w.contacts||[]).length}</button><button data-detail="sources">Джерела ${(w.sources||[]).length}</button><button data-detail="duplicates">Дублі</button><button data-detail="photos">Фото ${photos.length}</button></nav><section id="detailSummary" class="detail-section"></section><section id="detailContacts" class="detail-section"></section><section id="detailSources" class="detail-section"></section><section id="detailDuplicates" class="detail-section"></section><section id="detailPhotos" class="detail-section"></section>`;
  renderSummary(u);renderContacts(w);renderSources(w);renderDuplicateDetail(w);renderPhotos(w);
  $('unitDetail').querySelectorAll('[data-detail]').forEach(b=>b.onclick=()=>activateDetail(b.dataset.detail));activateDetail(state.detailTab);
}

function renderSummary(u){
  $('detailSummary').innerHTML=`<form id="unitForm"><div class="edit-grid">${field('title','Назва',u.title,'text',true)}${field('price','Ціна',u.price,'number')}${field('currency','Валюта',u.currency)}${field('area_m2','Площа, м²',u.area_m2,'number')}${field('land_area_sotka','Ділянка, сот.',u.land_area_sotka,'number')}${field('floors','Поверхи',u.floors,'number')}${field('bedrooms','Спальні',u.bedrooms,'number')}${field('address','Адреса',u.address,'text',true)}<label><span>Статус перевірки</span><select name="review_status"><option value="pending">pending</option><option value="in_progress">in_progress</option><option value="verified">verified → published</option><option value="blocked">blocked → archive</option><option value="retired">retired → archive</option></select></label><label><span>Доступність джерела</span><select name="source_access_status"><option value="not_checked">not_checked</option><option value="accessible">accessible</option><option value="search_only">search_only</option><option value="blocked">blocked</option><option value="removed">removed</option></select></label>${field('source_url','Пряме джерело',u.source_url,'url',true)}<label class="wide"><span>Невирішені поля, через кому</span><input name="unresolved" value="${esc((u.unresolved_fields||[]).join(', '))}"></label><label class="wide"><span>Опис</span><textarea name="description">${esc(u.description||'')}</textarea></label><label class="wide"><span>Внутрішні нотатки</span><textarea name="notes">${esc(u.review_notes||'')}</textarea></label></div><div class="form-actions"><button class="secondary" type="button" id="saveReview">Зберегти</button><button class="primary" type="button" id="publishReview">Підтвердити</button><button class="secondary" type="button" id="archiveReview">В архів</button></div><p id="detailStatus"></p></form>`;
  const f=$('unitForm');f.review_status.value=u.review_status||'in_progress';f.source_access_status.value=u.source_access_status||'not_checked';$('saveReview').onclick=()=>saveUnit(f.review_status.value);$('publishReview').onclick=()=>saveUnit('verified');$('archiveReview').onclick=()=>saveUnit('retired');
}

async function saveUnit(status){
  const f=$('unitForm'),st=$('detailStatus'),patch={};
  ['title','price','currency','area_m2','land_area_sotka','floors','bedrooms','address','source_url','description'].forEach(k=>patch[k]=f.elements[k].value.trim());
  const unresolved=f.unresolved.value.split(',').map(x=>x.trim()).filter(Boolean);st.textContent='Збереження…';st.className='';
  try{await rpc('admin_save_listing_review',{p_unit_id:state.activeId,p_patch:patch,p_review_status:status,p_source_access_status:f.source_access_status.value,p_unresolved_fields:unresolved,p_notes:f.notes.value});st.textContent='Збережено';st.className='success';await loadAll()}catch(e){st.textContent=e.message;st.className='error'}
}

function renderContacts(w){
  const contacts=[...(w.contacts||[]),...(w.claimed_sellers||[]).map(x=>({kind:'registered',name:x.name||x.company,phone:x.phone,email:x.email,profile_url:x.profile_url,platform:'Account',status:x.status}))];
  $('detailContacts').innerHTML=contacts.length?`<div class="contact-grid">${contacts.map((c,i)=>`<article class="contact-card"><p class="eyebrow">${esc(c.platform||c.kind||'Продавець')} · #${i+1}</p><h4>${esc(c.name||'Без імені')}</h4>${c.phone?`<p>Телефон: <a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></p>`:''}${c.email?`<p>Email: <a href="mailto:${esc(c.email)}">${esc(c.email)}</a></p>`:''}${c.price?`<p>Ціна в джерелі: ${money(c.price,c.currency)}</p>`:''}${c.observed_at?`<p>Перевірено: ${date(c.observed_at)}</p>`:''}${link(c.profile_url||c.source_url,'Відкрити профіль / оголошення')}</article>`).join('')}</div>`:'<div class="empty">Контакти продавців ще не виділені.</div>';
}

function renderSources(w){
  $('detailSources').innerHTML=(w.sources||[]).length?`<div class="source-list">${w.sources.map(s=>`<article class="source-row"><div><p class="eyebrow">${esc(s.platform||s.source_type||'Джерело')} ${s.external_id?'· '+esc(s.external_id):''}</p><h4>${esc(s.title||s.author||'Джерело')}</h4><p>${s.author?'Продавець: '+esc(s.author)+' · ':''}${s.phone?'Телефон: '+esc(s.phone)+' · ':''}${s.observed_at?'Дата: '+date(s.observed_at):''}</p>${s.summary?`<p>${esc(s.summary).slice(0,260)}</p>`:''}${link(s.url,'Відкрити джерело')}</div><div class="source-price">${s.price?money(s.price,s.currency):''}</div></article>`).join('')}</div>`:'<div class="empty">Спостережень джерел поки немає.</div>';
}

function renderDuplicateDetail(w){
  const current=w.duplicate_target,sims=w.similar_candidates||[],reverse=w.reverse_duplicates||[];
  $('detailDuplicates').innerHTML=`${current?`<div class="duplicate-box"><p class="eyebrow">Поточний можливий дубль</p><h3>${esc(current.title)}</h3><p>${esc(current.address||'')} · ${current.area_m2||'—'} м² · ${money(current.price,current.currency)}</p><p>${esc(w.unit.duplicate_reason||'Причина не вказана')}</p></div>`:''}${reverse.length?`<div class="duplicate-box"><p class="eyebrow">На цю картку посилаються</p>${reverse.map(x=>`<p><button class="secondary" data-open-related="${x.id}">${esc(x.title)}</button> — ${esc(x.reason||'')}</p>`).join('')}</div>`:''}<div class="duplicate-form"><label><span>Пов’язати з кандидатом</span><select id="duplicateTarget"><option value="">Оберіть картку</option>${sims.map(x=>`<option value="${x.id}" ${current?.id===x.id?'selected':''}>score ${x.score}: ${esc(x.title)} · ${x.area_m2||'—'} м²</option>`).join('')}</select></label><label><span>Причина</span><textarea id="duplicateReason">${esc(w.unit.duplicate_reason||'')}</textarea></label><div class="detail-actions"><button id="markDuplicate" class="primary">Позначити possible duplicate</button><button id="clearDuplicate" class="secondary">Прибрати зв’язок</button></div></div><h3 style="margin:18px 0 10px">Схожі картки</h3><div class="similar-list">${sims.map(x=>`<article class="similar-row"><div><strong>${esc(x.title)}</strong><p>${esc(x.address||'')} · ${x.area_m2||'—'} м² · ${money(x.price,x.currency)} · score ${x.score}</p></div><button class="secondary" data-open-related="${x.id}">Відкрити</button></article>`).join('')||'<div class="empty">Схожих карток не знайдено.</div>'}</div>`;
  $('detailDuplicates').querySelectorAll('[data-open-related]').forEach(b=>b.onclick=()=>openUnit(b.dataset.openRelated));
  $('markDuplicate').onclick=async()=>{const target=$('duplicateTarget').value;if(!target)return alert('Оберіть пов’язану картку');try{await rpc('admin_set_possible_duplicate',{p_unit_id:state.activeId,p_target_unit_id:target,p_reason:$('duplicateReason').value});await loadAll()}catch(e){alert(e.message)}};
  $('clearDuplicate').onclick=async()=>{try{await rpc('admin_set_possible_duplicate',{p_unit_id:state.activeId,p_target_unit_id:null,p_reason:null});await loadAll()}catch(e){alert(e.message)}};
}

function renderPhotos(w){
  $('detailPhotos').innerHTML=(w.photos||[]).length?`<div class="photo-grid">${w.photos.map(p=>p.url?`<a href="${esc(p.url)}" target="_blank" title="${esc(p.status)}${p.error?' · '+p.error:''}"><img loading="lazy" src="${esc(p.url)}" alt=""></a>`:'').join('')}</div>`:'<div class="empty">Фотографій немає.</div>';
}

function renderDuplicates(){
  const rows=state.units.filter(u=>u.possible_duplicate_of);$('duplicateEmpty').hidden=rows.length>0;$('duplicateSummary').textContent=`${rows.length} зв’язків потребують рішення`;
  $('duplicateList').innerHTML=rows.map(u=>`<article class="duplicate-row"><div><p class="eyebrow">${esc(u.city)} · ${esc(u.publication)}</p><h3>${esc(u.title)}</h3><p>${esc(u.address||'')} · ${u.area_m2||'—'} м² · ${money(u.price,u.currency)}</p></div><div class="duplicate-arrow">→</div><div><p class="eyebrow">Пов’язана картка</p><h3>${esc(u.duplicate_target_title||'Невідома')}</h3><p>${esc(u.duplicate_reason||'Причина не вказана')}</p></div><button class="secondary" data-dup-unit="${u.unit_id}">Перевірити</button></article>`).join('');
  $('duplicateList').querySelectorAll('[data-dup-unit]').forEach(b=>b.onclick=()=>{setTab('catalog');openUnit(b.dataset.dupUnit)});
}

function renderSellers(){
  const q=norm($('sellerSearch')?.value),rows=state.sellers.filter(s=>!q||norm([s.display_name,s.phone,s.email,s.platform].join(' ')).includes(q));$('sellerEmpty').hidden=rows.length>0;
  $('sellerDirectory').innerHTML=rows.map(s=>`<article class="seller-row"><p class="eyebrow">${esc(s.platform||s.contact_kind)} · ${s.contact_kind==='registered'?'акаунт':'джерело'}</p><h3>${esc(s.display_name||'Без імені')}</h3>${s.phone?`<p>Телефон: ${esc(s.phone)}</p>`:''}${s.email?`<p>Email: ${esc(s.email)}</p>`:''}<p>${s.unit_count||0} об’єктів · ${s.source_count||0} джерел${s.last_seen?' · '+date(s.last_seen):''}</p><div class="seller-links">${s.profile_url?`<a href="${esc(s.profile_url)}" target="_blank" rel="noopener">Профіль</a>`:''}${(s.unit_ids||[]).length?`<button data-seller-units="${esc((s.unit_ids||[]).join(','))}">Показати об’єкти</button>`:''}</div></article>`).join('');
  $('sellerDirectory').querySelectorAll('[data-seller-units]').forEach(b=>b.onclick=()=>{state.sellerUnitFilter=b.dataset.sellerUnits.split(',').filter(Boolean);state.city='all';state.scope='all';$('scopeFilter').value='all';setTab('catalog');renderCities();renderUnits()});
}

function renderInviteUnits(){
  const q=norm($('inviteSearch')?.value),rows=state.units.filter(u=>u.on_site&&(!q||norm([u.title,u.city,u.address].join(' ')).includes(q)));
  $('inviteUnits').innerHTML=rows.map(u=>`<label class="invite-unit"><input type="checkbox" data-invite-unit="${u.unit_id}" ${state.selectedInvite.has(u.unit_id)?'checked':''}>${u.cover_photo_url?`<img src="${esc(u.cover_photo_url)}" alt="">`:'<span></span>'}<span><strong>${esc(u.title)}</strong><br><small>${esc(u.city)} · ${esc(u.address||'')}</small></span><strong>${money(u.price,u.currency)}</strong></label>`).join('');
  $('inviteUnits').querySelectorAll('[data-invite-unit]').forEach(c=>c.onchange=()=>{c.checked?state.selectedInvite.add(c.dataset.inviteUnit):state.selectedInvite.delete(c.dataset.inviteUnit);$('selectedCount').textContent=state.selectedInvite.size});$('selectedCount').textContent=state.selectedInvite.size;
}

async function loadInviteHistory(){
  try{const rows=await rpc('admin_seller_invites');$('inviteHistory').innerHTML=(rows||[]).map(i=>`<div class="history-row"><span>${esc(i.email)}</span><span>${i.unit_count} об.</span><span>${badge(i.status,i.status)}</span><span>${date(i.created_at)}</span><span>${i.status==='pending'?`<button class="secondary" data-revoke="${i.id}">Відкликати</button>`:''}</span></div>`).join('')||'<div class="empty">Запрошень поки немає.</div>';$('inviteHistory').querySelectorAll('[data-revoke]').forEach(b=>b.onclick=async()=>{if(!confirm('Відкликати запрошення?'))return;await rpc('admin_revoke_seller_invite',{p_invite_id:b.dataset.revoke});await loadInviteHistory()})}catch(e){$('inviteHistory').innerHTML=`<p class="error">${esc(e.message)}</p>`}
}

async function createInvite(){
  const st=$('inviteStatus'),email=$('sellerEmail').value.trim();st.textContent='Створення…';
  try{const data=await rpc('admin_create_seller_invite',{p_email:email,p_unit_ids:[...state.selectedInvite],p_expires_days:Number($('days').value)||14});const url=new URL('./cabinet.html',location.href);url.searchParams.set('invite',data.token);$('inviteUrl').value=url.href;$('inviteResult').hidden=false;st.textContent=`Готово: ${data.units} оголошень`;st.className='success';await loadInviteHistory()}catch(e){st.textContent=e.message;st.className='error'}
}

document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
$('refreshAll').onclick=loadAll;
$('catalogSearch').oninput=e=>{state.query=e.target.value;renderUnits()};
$('scopeFilter').onchange=e=>{state.scope=e.target.value;state.sellerUnitFilter=null;renderUnits()};
$('sortFilter').onchange=e=>{state.sort=e.target.value;renderUnits()};
$('clearFilters').onclick=()=>{state.city='all';state.scope='all';state.sort='priority';state.query='';state.sellerUnitFilter=null;$('catalogSearch').value='';$('scopeFilter').value='all';$('sortFilter').value='priority';renderCities();renderUnits()};
$('sellerSearch').oninput=renderSellers;$('inviteSearch').oninput=renderInviteUnits;$('createInvite').onclick=createInvite;$('refreshInvites').onclick=loadInviteHistory;$('copyInvite').onclick=async()=>{await navigator.clipboard.writeText($('inviteUrl').value);$('copyInvite').textContent='Скопійовано ✓'};

$('auth').hidden=true;$('crm').hidden=false;loadAll();loadInviteHistory();
