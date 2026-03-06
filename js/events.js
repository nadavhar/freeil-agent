/* ══════════════════════════════════════════════════════════════
   Events — rendering, registration, favorites, Supabase fetch.
   Depends on: state.js, translations.js, utils.js, filters.js
══════════════════════════════════════════════════════════════ */

// ── Type → emoji icon map ──
const typeIcons = {
    concert:      '🎵', festival:  '🎪', pride:    '🏳️‍🌈',
    market:       '🛍️', exhibition:'🖼️', tour:     '🚶',
    workshop:     '🔧', sport:     '⚽', community:'👥',
    culture:      '🎭', food:      '🍔', nature:   '🌿',
    nightlife:    '🌙', family:    '👨‍👩‍👧', museum:   '🏛️',
    lecture:      '📚', yoga:      '🧘', art:      '🎨',
    theater:      '🎭', dance:     '💃', film:     '🎬',
    comedy:       '😂', kids:      '👶', outdoor:  '🏕️',
    wellness:     '💆', tech:      '💻', photography:'📷',
    meditation:   '🧘', beach:     '🏖️', volunteering:'🤝',
    party:        '🎉', other:     '📌'
};

// ── Favorite (heart) helpers ──
function getUserActions(eventId) {
    return JSON.parse(localStorage.getItem(`freeil_actions_${eventId}`) || '{"favorite":false,"vote":null}');
}

function setUserAction(eventId, action, value) {
    const actions = getUserActions(eventId);
    actions[action] = value;
    localStorage.setItem(`freeil_actions_${eventId}`, JSON.stringify(actions));
}

function toggleFavorite(eventId, btn) {
    const actions  = getUserActions(eventId);
    const newValue = !actions.favorite;
    setUserAction(eventId, 'favorite', newValue);
    btn.classList.toggle('active', newValue);
    btn.innerHTML = newValue ? '♥' : '♡';
    btn.classList.remove('pop');
    void btn.offsetWidth;
    btn.classList.add('pop');
}

// ── Registration ──
async function handleRegister(ev, btn) {
    // Optimistic UI — works for everyone, logged in or not
    btn.textContent = '✓ נרשמת';
    btn.classList.add('registered');
    localStorage.setItem('reg-' + ev.id, '1');

    const badge = document.getElementById('pcount-' + ev.id) || document.getElementById('pcount-feed-' + ev._rawId);
    if (badge) {
        const current = parseInt(badge.textContent.replace(/\D/g, '')) || 0;
        badge.innerHTML = badge.innerHTML.replace(/\d+$/, current + 1);
    }
    showToast('נרשמת לאירוע בהצלחה!');

    try {
        const rawId = ev._rawId;
        await sb.rpc('increment_registrations', { event_id: rawId });

        // Also save to DB if logged in
        const { data: { user } } = await sb.auth.getUser();
        if (user) {
            await sb.from('event_registrations').insert({ user_id: user.id, event_id: rawId });
        }
    } catch (e) { /* fails gracefully */ }
}

// ── Add to Google Calendar ──
function addToGoogleCalendar(ev) {
    const title    = encodeURIComponent(ev.title || '');
    const location = encodeURIComponent(ev.location || ev.city || '');
    const details  = encodeURIComponent(ev.description || '');

    // Build date: if we have a date, use it as an all-day event (YYYYMMDD)
    let dates = '';
    if (ev.date) {
        const d = ev.date.replace(/-/g, '');
        // If time provided, build datetime; otherwise all-day
        if (ev.time) {
            const t = ev.time.replace(':', '') + '00';
            dates = `${d}T${t}/${d}T${t}`;
        } else {
            // All-day: end = next day
            const next = new Date(ev.date);
            next.setDate(next.getDate() + 1);
            const nextStr = next.toISOString().slice(0, 10).replace(/-/g, '');
            dates = `${d}/${nextStr}`;
        }
    }

    const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dates}&location=${location}&details=${details}`;
    window.open(url, '_blank', 'noopener');
}

// ── Card renderer ──
function renderEvents(events) {
    const list = document.getElementById('event-list');
    list.innerHTML = '';

    const liveCounter = document.getElementById('live-counter');
    liveCounter.textContent = t('statsFormat').replace('{count}', events.length);
    liveCounter.classList.remove('pulse');
    void liveCounter.offsetWidth;
    liveCounter.classList.add('pulse');

    if (!events.length) {
        list.innerHTML = `<p style="padding:1rem;color:#888">${t('noResults')}</p>`;
        return;
    }

    // SVG icon snippets
    const calendarIcon    = `<svg class="meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
    const locationIcon    = `<svg class="meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
    const shareIcon       = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`;
    const calPlusIcon     = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="15" x2="12" y2="19"/><line x1="10" y1="17" x2="14" y2="17"/></svg>`;
    const heartOutline    = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
    const heartFilled     = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
    const usersIcon       = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;flex-shrink:0"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
    const navigateIcon    = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>`;
    const externalLinkIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;

    events.forEach(ev => {
        const card = document.createElement('div');
        card.className = 'event-card';

        // Unique ID: title + date encoded — keeps favorite state stable per event
        const eventId = btoa(encodeURIComponent((ev.title || '') + (ev.date || ''))).replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);

        const isFavorite = getUserActions(eventId).favorite;
        const isPrivate  = ev.source === 'user';
        const isReg      = isPrivate && localStorage.getItem('reg-' + ev.id) === '1';
        const showRegBtn = isPrivate && ev.registration_enabled;
        const hasLoc     = ev.latitude && ev.longitude;
        const sourceLink = getSafeLink(ev);
        const dateStr    = ev.date_display || ev.date || '';

        const cityTag = ev.city        ? `<span class="tag tag-city">${escHtml(getCityLabel(ev.city))}</span>` : '';
        const typeTag = ev.event_type  ? `<span class="tag tag-type">${escHtml(getTypeLabel(ev.event_type))}</span>` : '';
        const regBtn  = showRegBtn
            ? `<button class="btn-register${isReg ? ' registered' : ''}" data-ev-id="${ev.id}">${isReg ? '✓ נרשמת' : 'הרשמה'}</button>`
            : '';
        const partBadge = isPrivate
            ? `<span class="participants-badge" id="pcount-${ev.id}">👥 ${ev.registrations_count || 0}</span>`
            : '';

        const hasAddress = isPrivate && (ev.location || ev.city);

        if (isPrivate) {
            // ── Private card layout ──
            if (ev.thumbnail) card.classList.add('has-thumb');
            card.innerHTML = `
                ${ev.thumbnail ? `<div class="card-img-wrap"><img class="card-thumb" src="${ev.thumbnail}" alt="${escHtml(ev.title || '')}" loading="lazy" onerror="this.style.display='none'"><span class="badge-free-img">${t('free')}</span><button class="favorite-btn fav-overlay${isFavorite ? ' active' : ''}" data-event-id="${eventId}">${isFavorite ? heartFilled : heartOutline}</button></div>` : `<button class="favorite-btn fav-overlay${isFavorite ? ' active' : ''}" data-event-id="${eventId}">${isFavorite ? heartFilled : heartOutline}</button>`}
                <div class="card-body">
                    <div class="card-tags">${typeTag}${cityTag}</div>
                    <h3 class="private-card-title">${escHtml(ev.title || t('noTitle'))}</h3>
                    <div class="card-meta">
                        <div class="meta-item">${calendarIcon}<span>${escHtml(dateStr)}</span></div>
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
                        </div>
                        ${regBtn}
                        <span class="participants-badge" id="pcount-${ev.id}">${usersIcon} ${ev.registrations_count || 0}</span>
                    </div>
                </div>
            `;
        } else {
            // ── Public card layout (unchanged) ──
            const thumbHtml = ev.thumbnail
                ? `<img class="card-thumb" src="${ev.thumbnail}" alt="${escHtml(ev.title || '')}" loading="lazy" onerror="this.style.display='none'">`
                : '';
            if (ev.thumbnail) card.classList.add('has-thumb');
            card.innerHTML = `
                ${thumbHtml}
                <div class="card-body">
                    <div class="card-tags">${typeTag}${cityTag}</div>
                    <div class="card-title-row">
                        <h3>${escHtml(ev.title || t('noTitle'))}</h3>
                        <span class="badge-free">${t('free')}</span>
                    </div>
                    <div class="card-meta">
                        <div class="meta-item">${calendarIcon}<span>${escHtml(dateStr)}</span></div>
                        <div class="meta-item">${locationIcon}<span>${escHtml(ev.location || '')}</span></div>
                    </div>
                    <div class="card-desc">${escHtml(ev.description || '')}</div>
                    <div class="card-footer">
                        <button class="favorite-btn${isFavorite ? ' active' : ''}" data-event-id="${eventId}">${isFavorite ? '♥' : '♡'}</button>
                        <span class="footer-spacer"></span>
                        <button class="action-btn share" title="שתף">${shareIcon}</button>
                        ${hasLoc ? `<button class="action-btn navigate" title="ניווט">${navigateIcon}</button>` : ''}
                        ${sourceLink ? `<a href="${sourceLink}" target="_blank" rel="noopener noreferrer" class="action-btn source" title="${t('source')}" onclick="event.stopPropagation()">${externalLinkIcon}</a>` : ''}
                    </div>
                </div>
            `;
        }

        card.querySelector('.favorite-btn').addEventListener('click', e => {
            e.stopPropagation();
            const btn = card.querySelector('.favorite-btn');
            toggleFavorite(eventId, btn);
            if (isPrivate) btn.innerHTML = getUserActions(eventId).favorite ? heartFilled : heartOutline;
        });
        card.querySelector('.action-btn.share').addEventListener('click', e => {
            e.stopPropagation();
            shareToWhatsApp(ev);
        });
        if (isPrivate) {
            card.querySelector('.action-btn.add-cal')?.addEventListener('click', e => {
                e.stopPropagation();
                addToGoogleCalendar(ev);
            });
            card.querySelector('.action-btn.navigate')?.addEventListener('click', e => {
                e.stopPropagation();
                const query = encodeURIComponent((ev.location || '') + (ev.city ? ' ' + ev.city : ''));
                window.open(`https://www.google.com/maps/search/?api=1&query=${query}`, '_blank', 'noopener');
            });
            if (showRegBtn && !isReg) {
                card.querySelector('.btn-register')?.addEventListener('click', e => {
                    e.stopPropagation();
                    handleRegister(ev, card.querySelector('.btn-register'));
                });
            }
        } else {
            if (hasLoc) {
                card.querySelector('.action-btn.navigate')?.addEventListener('click', e => {
                    e.stopPropagation();
                    navigateToLocation(ev.latitude, ev.longitude);
                });
            }
        }

        list.appendChild(card);
    });
}

// ── Supabase data mapping + fetch ──
function mapUserEventRow(row) {
    return {
        id:                   'user-' + row.id,
        _rawId:               row.id,
        title:                row.title,
        date:                 row.date        || '',
        time:                 row.time        || '',
        location:             row.location    || '',
        city:                 row.city        || '',
        description:          row.description || '',
        event_type:           row.event_type  || 'other',
        thumbnail:            row.thumbnail_url || '',
        emoji:                row.emoji       || '📅',
        source:               'user',
        registration_enabled: row.registration_enabled !== false,
        registrations_count:  row.registrations_count || 0,
    };
}

async function fetchPrivateEvents() {
    try {
        const { data } = await sb.from('user_events')
            .select('*')
            .eq('status', 'published')
            .order('created_at', { ascending: false });
        return (data || []).map(mapUserEventRow);
    } catch (e) { return []; }
}
