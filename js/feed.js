/* ══════════════════════════════════════════════════════════════
   Social Feed — full event cards + comments + personalization.
   Depends on: state.js, translations.js, utils.js, events.js
══════════════════════════════════════════════════════════════ */

function formatTimeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 2)  return 'עכשיו';
    if (mins < 60) return `לפני ${mins} דקות`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `לפני ${hrs} שעות`;
    return `לפני ${Math.floor(hrs / 24)} ימים`;
}

function feedRelevanceScore(ev, searches) {
    if (!searches.length) return 0;
    const haystack = [ev.title, ev.city, ev.event_type, ev.description]
        .filter(Boolean).join(' ').toLowerCase();
    return searches.reduce((n, term) => n + (haystack.includes(term.toLowerCase()) ? 1 : 0), 0);
}

// ── Comments — Supabase with localStorage fallback ──
function localCommentsKey(rawId) { return `freeil-comments-${rawId}`; }

function getLocalComments(rawId) {
    return JSON.parse(localStorage.getItem(localCommentsKey(rawId)) || '[]');
}

function saveLocalComment(rawId, body, name) {
    const list = getLocalComments(rawId);
    list.push({ id: 'local-' + Date.now(), body, user_name: name, created_at: new Date().toISOString() });
    localStorage.setItem(localCommentsKey(rawId), JSON.stringify(list));
}

function renderCommentList(comments, listEl) {
    if (!comments.length) {
        listEl.innerHTML = '<p class="comment-empty">אין תגובות עדיין. היה הראשון!</p>';
        return;
    }
    listEl.innerHTML = comments.map(c => {
        const initials = (c.user_name || '?').trim().split(' ')
            .map(w => w[0]).slice(0, 2).join('').toUpperCase();
        return `
            <div class="comment-item">
                <div class="comment-avatar">${escHtml(initials)}</div>
                <div class="comment-body-wrap">
                    <span class="comment-author">${escHtml(c.user_name || 'אורח')}</span>
                    <p class="comment-text">${escHtml(c.body)}</p>
                    <span class="comment-time">${escHtml(formatTimeAgo(c.created_at))}</span>
                </div>
            </div>`;
    }).join('');
}

async function loadComments(rawId, listEl) {
    listEl.innerHTML = '<p class="comment-loading">טוען תגובות...</p>';

    let remote = [];
    try {
        const { data } = await sb.from('event_comments')
            .select('id, body, user_name, created_at')
            .eq('event_id', rawId)
            .order('created_at', { ascending: true });
        remote = data || [];
    } catch (_) {}

    // Merge remote + local (local fills gap when table missing/insert failed)
    const local  = getLocalComments(rawId);
    const remoteIds = new Set(remote.map(c => c.id));
    const merged = [...remote, ...local.filter(c => !remoteIds.has(c.id))]
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    renderCommentList(merged, listEl);
}

async function submitComment(rawId, body, listEl, inputEl, countEl) {
    if (!body.trim()) return;

    inputEl.disabled = true;
    const { data: { user } } = await sb.auth.getUser().catch(() => ({ data: { user: null } }));
    const name = user
        ? (user.user_metadata?.full_name || user.email || 'משתמש')
        : 'אורח';

    // Try Supabase; fall back to localStorage silently
    const row = { event_id: rawId, body: body.trim(), user_name: name };
    if (user) row.user_id = user.id;
    const { error } = await sb.from('event_comments').insert(row);
    if (error) saveLocalComment(rawId, body.trim(), name);

    inputEl.disabled = false;
    inputEl.value = '';
    countEl.textContent = (parseInt(countEl.textContent) || 0) + 1;
    await loadComments(rawId, listEl);
}

// ── Full feed card (mirrors renderEvents HTML) + comment section ──
function buildFeedEventCard(ev, isRecommended) {
    const rawId   = ev.id;
    const eventId = btoa(encodeURIComponent((ev.title || '') + (ev.date || ''))).replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);

    const isFavorite  = getUserActions(eventId).favorite;
    const isReg       = localStorage.getItem('reg-' + rawId) === '1';
    const showRegBtn  = ev.registration_enabled !== false;

    const shareIcon       = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`;
    const calPlusIcon     = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="15" x2="12" y2="19"/><line x1="10" y1="17" x2="14" y2="17"/></svg>`;
    const navigateIcon    = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>`;
    const heartOutline    = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
    const heartFilled     = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
    const usersIcon       = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;flex-shrink:0"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
    const calendarIcon    = `<svg class="meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
    const locationIcon    = `<svg class="meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
    const whatsappIcon    = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>`;

    const cityTag  = ev.city       ? `<span class="tag tag-city">${escHtml(getCityLabel(ev.city))}</span>` : '';
    const typeTag  = ev.event_type ? `<span class="tag tag-type">${escHtml(getTypeLabel(ev.event_type))}</span>` : '';
    const recBadge = isRecommended ? '<div class="badge-recommended">⭐ מומלץ עבורך</div>' : '';
    const regBtn   = showRegBtn
        ? `<button class="btn-register${isReg ? ' registered' : ''}">${isReg ? '✓ נרשמת' : 'הרשמה'}</button>` : '';

    const hasAddress = ev.location || ev.city;

    const card = document.createElement('div');
    card.className = 'event-card private-card' + (ev.thumbnail_url ? ' has-thumb' : '');
    card.innerHTML = `
        ${recBadge}
        ${ev.thumbnail_url ? `<div class="card-img-wrap"><img class="card-thumb" src="${escHtml(ev.thumbnail_url)}" alt="${escHtml(ev.title || '')}" loading="lazy" onerror="this.style.display='none'"><span class="badge-free-img">חינם</span><div class="card-top-left"><button class="favorite-btn fav-overlay${isFavorite ? ' active' : ''}">${isFavorite ? heartFilled : heartOutline}</button><span class="participants-badge pcount-overlay" id="pcount-feed-${rawId}">${usersIcon} ${ev.registrations_count || 0}</span></div></div>` : `<div class="card-top-left"><button class="favorite-btn fav-overlay${isFavorite ? ' active' : ''}">${isFavorite ? heartFilled : heartOutline}</button><span class="participants-badge pcount-overlay" id="pcount-feed-${rawId}">${usersIcon} ${ev.registrations_count || 0}</span></div>`}
        <div class="card-body">
            <div class="card-tags">${typeTag}${cityTag}</div>
            <h3 class="private-card-title">${escHtml(ev.title || '')}</h3>
            <div class="card-meta">
                <div class="meta-item">${calendarIcon}<span>${escHtml((() => { if (!ev.date) return ''; const [y,m,d] = ev.date.split('-'); const f = `${d}/${m}`; return ev.time ? `${f} · ${ev.time}` : f; })())}</span></div>
                <div class="meta-item location-meta">
                    ${locationIcon}<span>${escHtml(ev.location || '')}</span>
                </div>
            </div>
            <div class="card-desc">${escHtml(ev.description || '')}</div>
            <div class="card-footer private-footer">
                <div class="action-group">
                    <button class="action-btn add-cal" title="הוספה ליומן">${calPlusIcon}</button>
                    <button class="action-btn share" title="שתף">${shareIcon}</button>
                    ${hasAddress ? `<button class="action-btn navigate" title="ניווט">${navigateIcon}</button>` : ''}
                    <button class="action-btn comment-toggle-btn" title="תגובות">💬 <span class="comment-count">0</span></button>
                </div>
                ${regBtn}
            </div>
        </div>
        <div class="comment-section" style="display:none">
            <div class="comment-list"></div>
            <div class="comment-input-row">
                <input class="comment-input" type="text" placeholder="כתוב תגובה..." maxlength="300">
                <button class="comment-submit-btn">שלח</button>
            </div>
        </div>`;

    // Wire up favorites
    card.querySelector('.favorite-btn').addEventListener('click', e => {
        e.stopPropagation();
        const btn = card.querySelector('.favorite-btn');
        toggleFavorite(eventId, btn);
        btn.innerHTML = getUserActions(eventId).favorite ? heartFilled : heartOutline;
    });

    // Wire up register
    if (showRegBtn && !isReg) {
        card.querySelector('.btn-register')?.addEventListener('click', e => {
            e.stopPropagation();
            const mapped = { ...ev, id: 'user-' + rawId, _rawId: rawId, source: 'user', registration_enabled: true };
            handleRegister(mapped, card.querySelector('.btn-register'));
        });
    }

    // Wire up share
    card.querySelector('.action-btn.share').addEventListener('click', e => {
        e.stopPropagation();
        shareToWhatsApp(ev);
    });

    // Wire up add to calendar
    card.querySelector('.action-btn.add-cal').addEventListener('click', e => {
        e.stopPropagation();
        addToGoogleCalendar({ ...ev, _rawId: rawId });
    });

    // Wire up navigate
    card.querySelector('.action-btn.navigate')?.addEventListener('click', e => {
        e.stopPropagation();
        const query = encodeURIComponent((ev.location || '') + (ev.city ? ' ' + ev.city : ''));
        window.open(`https://www.google.com/maps/search/?api=1&query=${query}`, '_blank', 'noopener');
    });

    // Wire up comments toggle
    const commentSection = card.querySelector('.comment-section');
    const commentList    = card.querySelector('.comment-list');
    const countEl        = card.querySelector('.comment-count');
    const inputEl        = card.querySelector('.comment-input');
    let loaded = false;

    // Load comment count (silently skip if table doesn't exist yet)
    sb.from('event_comments').select('id', { count: 'exact', head: true }).eq('event_id', rawId)
        .then(({ count }) => { if (count) countEl.textContent = count; })
        .catch(() => {});

    card.querySelector('.comment-toggle-btn').addEventListener('click', e => {
        e.stopPropagation();
        const open = commentSection.style.display === 'none';
        commentSection.style.display = open ? 'block' : 'none';
        if (open && !loaded) { loaded = true; loadComments(rawId, commentList); }
    });

    card.querySelector('.comment-submit-btn').addEventListener('click', e => {
        e.stopPropagation();
        submitComment(rawId, inputEl.value, commentList, inputEl, countEl);
    });
    inputEl.addEventListener('keydown', e => {
        if (e.key === 'Enter') submitComment(rawId, inputEl.value, commentList, inputEl, countEl);
    });

    return card;
}

// ── Section heading helper ──
function feedSectionEl(label) {
    const el = document.createElement('div');
    el.className = 'feed-section-title';
    el.textContent = label;
    return el;
}

// ── Render the unfiltered sectioned feed ──
function renderFeedSections() {
    const feedEl  = document.getElementById('social-feed');
    const searches = JSON.parse(localStorage.getItem('freeil-searches') || '[]');
    const scored   = allFeedEvents.map(ev => ({ ...ev, _score: feedRelevanceScore(ev, searches) }));
    const recommended = scored.filter(e => e._score > 0).sort((a, b) => b._score - a._score);
    const recent      = scored.filter(e => e._score === 0);

    feedEl.innerHTML = '';

    if (recommended.length) {
        feedEl.appendChild(feedSectionEl('⭐ מומלץ עבורך'));
        recommended.forEach(ev => feedEl.appendChild(buildFeedEventCard(ev, true)));
    }

    if (feedComments.length) {
        feedEl.appendChild(feedSectionEl('🔔 פעילות אחרונה'));
        feedComments.forEach(c => {
            const ev  = allFeedEvents.find(e => e.id === c.event_id);
            const el  = document.createElement('div');
            el.className = 'social-item social-item-clickable';
            el.innerHTML = `
                <div class="social-icon comment-icon">💬</div>
                <div class="social-content">
                    <p><strong>${escHtml(c.user_name || 'אורח')}</strong> הגיב/ה על <strong>"${escHtml(c.user_events?.title || '')}"</strong></p>
                    <p class="social-comment-preview">${escHtml(c.body)}</p>
                    <span class="social-time">${escHtml(formatTimeAgo(c.created_at))}${c.user_events?.city ? ' · ' + escHtml(getCityLabel(c.user_events.city)) : ''}</span>
                </div>`;
            if (ev) {
                el.addEventListener('click', () => {
                    const card = document.getElementById(`pcount-feed-${ev.id}`)?.closest('.event-card');
                    if (card) {
                        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        card.querySelector('.comment-toggle-btn')?.click();
                    }
                });
            }
            feedEl.appendChild(el);
        });
    }

    if (recent.length) {
        feedEl.appendChild(feedSectionEl('🆕 אירועים חדשים'));
        recent.forEach(ev => feedEl.appendChild(buildFeedEventCard(ev, false)));
    }

    if (!feedEl.children.length) {
        feedEl.innerHTML = '<p class="social-empty">אין פעילות עדיין</p>';
    }

    const liveCounter = document.getElementById('live-counter');
    liveCounter.textContent = t('statsFormat').replace('{count}', allFeedEvents.length);
}

// ── Render filtered community events (called by applyFilter when on social tab) ──
function renderFeedFiltered(events) {
    const feedEl      = document.getElementById('social-feed');
    const liveCounter = document.getElementById('live-counter');
    const hasFilters  = activeDateFilters.size > 0 || activeCityFilters.size > 0 ||
                        activeTypeFilters.size > 0  || activeRegionFilters.size > 0 || searchQuery;

    liveCounter.textContent = t('statsFormat').replace('{count}', hasFilters ? events.length : allFeedEvents.length);
    liveCounter.classList.remove('pulse');
    void liveCounter.offsetWidth;
    liveCounter.classList.add('pulse');

    if (!hasFilters) {
        renderFeedSections();
        return;
    }

    feedEl.innerHTML = '';
    if (!events.length) {
        feedEl.innerHTML = '<p class="social-empty">לא נמצאו אירועים תואמים</p>';
        return;
    }
    events.forEach(ev => feedEl.appendChild(buildFeedEventCard(ev, false)));
}

async function loadSocialFeed() {
    const feedEl = document.getElementById('social-feed');
    feedEl.innerHTML = '<p class="social-loading">טוען קהילה...</p>';

    try {
        const [{ data: comments }, { data: events }] = await Promise.all([
            sb.from('event_comments')
                .select('id, body, user_name, created_at, event_id, user_events(id, title, city)')
                .order('created_at', { ascending: false })
                .limit(3),
            sb.from('user_events')
                .select('*')
                .eq('status', 'published')
                .order('created_at', { ascending: false })
                .limit(30),
        ]);

        allFeedEvents = (events || []);
        feedComments  = (comments || []).filter(c => c.user_events);
        allEvents     = allFeedEvents;  // so buildFilters uses community cities/types

        buildFilters();
        renderFeedSections();

    } catch (e) {
        feedEl.innerHTML = '<p class="social-empty">שגיאה בטעינת הקהילה</p>';
    }
}
