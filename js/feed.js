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
    const calendarIcon    = `<svg class="meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
    const locationIcon    = `<svg class="meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
    const whatsappIcon    = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>`;

    const cityTag  = ev.city       ? `<span class="tag tag-city">${escHtml(getCityLabel(ev.city))}</span>` : '';
    const typeTag  = ev.event_type ? `<span class="tag tag-type">${escHtml(getTypeLabel(ev.event_type))}</span>` : '';
    const recBadge = isRecommended ? '<div class="badge-recommended">⭐ מומלץ עבורך</div>' : '';
    const regBtn   = showRegBtn
        ? `<button class="btn-register${isReg ? ' registered' : ''}">${isReg ? '✓ נרשמת' : 'הרשמה'}</button>` : '';

    const thumbHtml = ev.thumbnail_url
        ? `<img class="card-thumb" src="${escHtml(ev.thumbnail_url)}" alt="${escHtml(ev.title || '')}" loading="lazy" onerror="this.style.display='none'">`
        : '';

    const card = document.createElement('div');
    card.className = 'event-card' + (ev.thumbnail_url ? ' has-thumb' : '');
    card.innerHTML = `
        ${recBadge}
        ${thumbHtml}
        <div class="card-body">
            <div class="card-tags">${typeTag}${cityTag}</div>
            <div class="card-title-row">
                <h3>${escHtml(ev.title || '')}</h3>
                <span class="badge-free">חינם</span>
            </div>
            <div class="card-meta">
                <div class="meta-item">${calendarIcon}<span>${escHtml(ev.date || '')}</span></div>
                <div class="meta-item">${locationIcon}<span>${escHtml(ev.location || '')}</span></div>
            </div>
            <div class="card-desc">${escHtml(ev.description || '')}</div>
            <div class="card-footer">
                <button class="favorite-btn${isFavorite ? ' active' : ''}">${isFavorite ? '♥' : '♡'}</button>
                ${regBtn}
                <span class="participants-badge" id="pcount-feed-${rawId}">👥 ${ev.registrations_count || 0}</span>
                <span class="footer-spacer"></span>
                <button class="action-btn comment-toggle-btn" title="תגובות">💬 <span class="comment-count">0</span></button>
                <button class="action-btn share">${shareIcon}</button>
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
        toggleFavorite(eventId, card.querySelector('.favorite-btn'));
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

async function loadSocialFeed() {
    const feedEl = document.getElementById('social-feed');
    feedEl.innerHTML = '<p class="social-loading">טוען פיד...</p>';

    try {
        const [{ data: regs }, { data: events }] = await Promise.all([
            sb.from('event_registrations')
                .select('created_at, user_events(title, city)')
                .order('created_at', { ascending: false })
                .limit(10),
            sb.from('user_events')
                .select('*')
                .eq('status', 'published')
                .order('created_at', { ascending: false })
                .limit(30),
        ]);

        const searches    = JSON.parse(localStorage.getItem('freeil-searches') || '[]');
        const evArr       = (events || []).map(ev => ({ ...ev, _score: feedRelevanceScore(ev, searches) }));
        const recommended = evArr.filter(e => e._score > 0).sort((a, b) => b._score - a._score);
        const recent      = evArr.filter(e => e._score === 0);

        feedEl.innerHTML = '';

        // Recommended section
        if (recommended.length) {
            feedEl.appendChild(feedSectionEl('⭐ מומלץ עבורך'));
            recommended.forEach(ev => feedEl.appendChild(buildFeedEventCard(ev, true)));
        }

        // Recent registrations (compact)
        const regItems = (regs || []).filter(r => r.user_events);
        if (regItems.length) {
            feedEl.appendChild(feedSectionEl('🔔 פעילות אחרונה'));
            regItems.forEach(r => {
                const el = document.createElement('div');
                el.className = 'social-item';
                el.innerHTML = `
                    <div class="social-icon reg-icon">👥</div>
                    <div class="social-content">
                        <p>מישהו נרשם ל<strong>"${escHtml(r.user_events.title)}"</strong></p>
                        <span class="social-time">${escHtml(formatTimeAgo(r.created_at))}${r.user_events.city ? ' · ' + escHtml(getCityLabel(r.user_events.city)) : ''}</span>
                    </div>`;
                feedEl.appendChild(el);
            });
        }

        // New events section
        if (recent.length) {
            feedEl.appendChild(feedSectionEl('🆕 אירועים חדשים'));
            recent.forEach(ev => feedEl.appendChild(buildFeedEventCard(ev, false)));
        }

        if (!feedEl.children.length) {
            feedEl.innerHTML = '<p class="social-empty">אין פעילות עדיין</p>';
        }

    } catch (e) {
        feedEl.innerHTML = '<p class="social-empty">שגיאה בטעינת הפיד</p>';
    }
}
