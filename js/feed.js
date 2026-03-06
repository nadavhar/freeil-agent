/* ══════════════════════════════════════════════════════════════
   Social Feed — loads and renders the community activity stream.
   Depends on: state.js, translations.js, utils.js
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

async function loadSocialFeed() {
    const feedEl = document.getElementById('social-feed');
    feedEl.innerHTML = '<p class="social-loading">טוען פיד...</p>';

    try {
        const [{ data: regs }, { data: newEvs }] = await Promise.all([
            sb.from('event_registrations')
                .select('created_at, user_events(title, city)')
                .order('created_at', { ascending: false })
                .limit(30),
            sb.from('user_events')
                .select('title, city, created_at, emoji')
                .eq('status', 'published')
                .order('created_at', { ascending: false })
                .limit(20),
        ]);

        const items = [];
        (regs || []).forEach(r => {
            if (r.user_events) items.push({
                type:  'reg',
                time:  r.created_at,
                title: r.user_events.title,
                city:  r.user_events.city
            });
        });
        (newEvs || []).forEach(e => {
            items.push({ type: 'event', time: e.created_at, title: e.title, city: e.city, emoji: e.emoji || '📅' });
        });
        items.sort((a, b) => new Date(b.time) - new Date(a.time));

        if (!items.length) {
            feedEl.innerHTML = '<p class="social-empty">אין פעילות עדיין</p>';
            return;
        }

        feedEl.innerHTML = items.map(item => {
            const ago       = escHtml(formatTimeAgo(item.time));
            const cityLabel = item.city ? ' · ' + escHtml(getCityLabel(item.city)) : '';

            if (item.type === 'reg') return `
                <div class="social-item">
                    <div class="social-icon reg-icon">👥</div>
                    <div class="social-content">
                        <p>מישהו נרשם לאירוע <strong>"${escHtml(item.title)}"</strong></p>
                        <span class="social-time">${ago}${cityLabel}</span>
                    </div>
                </div>`;
            return `
                <div class="social-item">
                    <div class="social-icon new-icon">${escHtml(item.emoji)}</div>
                    <div class="social-content">
                        <p>אירוע חדש: <strong>"${escHtml(item.title)}"</strong></p>
                        <span class="social-time">${ago}${cityLabel}</span>
                    </div>
                </div>`;
        }).join('');

    } catch (e) {
        feedEl.innerHTML = '<p class="social-empty">שגיאה בטעינת הפיד</p>';
    }
}
