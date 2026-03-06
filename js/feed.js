/* ══════════════════════════════════════════════════════════════
   Social Feed — rich cards with personalized recommendations.
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

function buildFeedCard(ev, isRecommended, timeAgo) {
    const icon  = (typeIcons && typeIcons[ev.event_type]) || ev.emoji || '📅';
    const thumb = ev.thumbnail_url
        ? `<img class="feed-card-thumb" src="${escHtml(ev.thumbnail_url)}" alt="" loading="lazy" onerror="this.style.display='none'">`
        : `<div class="feed-card-thumb-placeholder">${icon}</div>`;
    const badge = isRecommended ? '<span class="badge-recommended">⭐ מומלץ עבורך</span>' : '';
    const city  = ev.city ? `<span>📍 ${escHtml(getCityLabel(ev.city))}</span>` : '';
    const date  = ev.date ? `<span>📅 ${escHtml(ev.date)}</span>` : '';
    const ago   = timeAgo ? `<span class="feed-card-ago">${escHtml(timeAgo)}</span>` : '';
    return `
        <div class="feed-card">
            ${thumb}
            <div class="feed-card-body">
                ${badge}
                <div class="feed-card-title">${escHtml(ev.title || '')}</div>
                <div class="feed-card-meta">${date}${city}</div>
                ${ago}
            </div>
        </div>`;
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
                .select('id, title, city, date, event_type, description, thumbnail_url, emoji, created_at')
                .eq('status', 'published')
                .order('created_at', { ascending: false })
                .limit(30),
        ]);

        const searches = JSON.parse(localStorage.getItem('freeil-searches') || '[]');
        const evArr    = (events || []).map(ev => ({ ...ev, _score: feedRelevanceScore(ev, searches) }));

        const recommended = evArr.filter(e => e._score > 0).sort((a, b) => b._score - a._score);
        const recent      = evArr.filter(e => e._score === 0);

        const regHtml = (regs || [])
            .filter(r => r.user_events)
            .map(r => `
                <div class="social-item">
                    <div class="social-icon reg-icon">👥</div>
                    <div class="social-content">
                        <p>מישהו נרשם ל<strong>"${escHtml(r.user_events.title)}"</strong></p>
                        <span class="social-time">${escHtml(formatTimeAgo(r.created_at))}${r.user_events.city ? ' · ' + escHtml(getCityLabel(r.user_events.city)) : ''}</span>
                    </div>
                </div>`).join('');

        let html = '';

        if (recommended.length) {
            html += `<div class="feed-section-title">⭐ מומלץ עבורך</div>`;
            html += recommended.map(ev => buildFeedCard(ev, true, null)).join('');
        }

        if (regHtml) {
            html += `<div class="feed-section-title">🔔 פעילות אחרונה</div>${regHtml}`;
        }

        if (recent.length) {
            html += `<div class="feed-section-title">🆕 אירועים חדשים</div>`;
            html += recent.map(ev => buildFeedCard(ev, false, formatTimeAgo(ev.created_at))).join('');
        }

        feedEl.innerHTML = html || '<p class="social-empty">אין פעילות עדיין</p>';

    } catch (e) {
        feedEl.innerHTML = '<p class="social-empty">שגיאה בטעינת הפיד</p>';
    }
}
