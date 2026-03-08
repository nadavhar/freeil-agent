/* ══════════════════════════════════════════════════════════════
   Utilities — pure helpers with no side-effects.
   Depends on: state.js (currentLang), translations.js (t)
══════════════════════════════════════════════════════════════ */

/* Safely escape a string for insertion into innerHTML */
function escHtml(str) {
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(str || ''));
    return d.innerHTML;
}

/* Format a YYYY-MM-DD date string to Hebrew locale */
function formatDateHe(dateStr) {
    if (!dateStr) return '';
    try {
        const d = new Date(dateStr + 'T12:00:00');
        return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch { return dateStr; }
}

/* Toast notification — creates element on first use */
let _toastTimer;
function showToast(msg) {
    let el = document.getElementById('main-toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'main-toast';
        el.style.cssText = [
            'position:fixed', 'bottom:80px', 'left:50%',
            'transform:translateX(-50%)',
            'background:#1a1a2e', 'color:#fff',
            'padding:12px 24px', 'border-radius:12px',
            'font-size:0.95rem', 'font-weight:600',
            'z-index:9999', 'box-shadow:0 4px 20px rgba(0,0,0,0.3)',
            'transition:opacity 0.3s', 'pointer-events:none'
        ].join(';');
        document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 3000);
}

/* Return a safe http/https URL or null — blocks javascript:, data:, etc. */
function getSafeLink(event) {
    let url = event.url || event.link || event.source;
    if (!url) return null;

    const lower = url.toLowerCase().trim();
    if (!lower.startsWith('http://') && !lower.startsWith('https://') && !lower.startsWith('//')) {
        if (lower.includes('.') && !lower.includes(':')) {
            url = `https://${url}`;
        } else {
            return null; // block javascript:, data:, etc.
        }
    }
    if (url.startsWith('//')) url = `https:${url}`;
    return url;
}

/* WhatsApp share */
function shareToWhatsApp(event) {
    const title     = event.title || t('noTitle');
    const date      = event.date_display || event.date || '';
    const location  = event.location || '';
    const sourceUrl = getSafeLink(event) || '';
    const siteUrl   = window.location.href;

    let message = `🎉 *${title}*\n\n`;
    if (date)      message += `📅 ${date}\n`;
    if (location)  message += `📍 ${location}\n`;
    message += `💰 ${t('free')}!\n\n`;
    if (sourceUrl) message += `🔗 ${sourceUrl}\n\n`;
    message += `${t('foundOnFreeIL')}\n${siteUrl}`;

    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
}

/* Waze navigation */
function navigateToLocation(lat, lng) {
    window.open(`https://waze.com/ul?ll=${lat},${lng}&navigate=yes`, '_blank');
}

/* Update the header event counter chip */
function updateEventCounter(count) {
    const el = document.getElementById('event-counter');
    if (el) el.textContent = t('eventCounter').replace('{count}', count);
}
