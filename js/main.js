/* ══════════════════════════════════════════════════════════════
   Main — app init, tab switching, language, data load.
   Loaded last — depends on every other module.
══════════════════════════════════════════════════════════════ */

// ── Language ──
function updateUI() {
    document.title = t('pageTitle');
    document.getElementById('tagline').textContent                  = t('tagline');
    document.getElementById('lang-text').textContent               = currentLang === 'he' ? 'EN' : 'עב';
    document.getElementById('filter-title').textContent            = t('filterTitle');
    document.getElementById('reset-text').textContent              = t('resetFilters');
    document.getElementById('date-filter-label').textContent       = t('filterDate');
    document.getElementById('region-filter-label').textContent     = t('filterRegion');
    document.getElementById('city-filter-label').textContent       = t('filterCity');
    document.getElementById('type-filter-label').textContent       = t('filterCategory');
    document.getElementById('search-input').placeholder           = t('searchPlaceholder');
    updateEventCounter(allEvents.length);
    buildFilters();
    applyFilter();
}

function setLanguage(lang) {
    currentLang = lang;
    localStorage.setItem('freeil-lang', lang);
    document.documentElement.lang = lang;
    document.documentElement.dir  = lang === 'he' ? 'rtl' : 'ltr';
    updateUI();
}

// ── Tab switching ──
function switchTab(tab) {
    activeTab = tab;
    window.scrollTo(0, 0);

    document.querySelectorAll('.dtab, .bnav-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tab);
    });

    const showFilters = tab === 'public' || tab === 'private';
    document.querySelector('.filters-container').style.display = showFilters      ? 'block' : 'none';
    document.getElementById('view-events').style.display       = showFilters      ? 'block' : 'none';
    document.getElementById('view-social').style.display       = tab === 'social' ? 'block' : 'none';
    document.getElementById('view-map').style.display          = tab === 'map'    ? 'block' : 'none';

    if (showFilters) {
        allEvents = tab === 'private' ? privateEvents : publicEvents;
        activeDateFilters.clear(); activeCityFilters.clear();
        activeTypeFilters.clear(); activeRegionFilters.clear();
        searchQuery = '';
        const si = document.getElementById('search-input');
        if (si) si.value = '';
        buildFilters();
        applyFilter();
    } else if (tab === 'social') {
        loadSocialFeed();
    } else if (tab === 'map') {
        initMap();
    }
}

// ── Called by auth.js when login/logout changes ──
window.onAuthRefreshPrivate = async function () {
    privateEvents = await fetchPrivateEvents();
    if (activeTab === 'private') {
        allEvents = privateEvents;
        buildFilters();
        applyFilter();
    }
};

// ── Scroll to top on page load and hash/param changes ──
window.scrollTo(0, 0);
window.addEventListener('hashchange', () => window.scrollTo(0, 0));

// ── Bootstrap ──
(function init() {
    // Apply language immediately (DOM already parsed at this point)
    document.documentElement.lang = currentLang;
    document.documentElement.dir  = currentLang === 'he' ? 'rtl' : 'ltr';
    document.title                 = t('pageTitle');
    document.getElementById('tagline').textContent              = t('tagline');
    document.getElementById('lang-text').textContent           = currentLang === 'he' ? 'EN' : 'עב';
    document.getElementById('filter-title').textContent        = t('filterTitle');
    document.getElementById('reset-text').textContent          = t('resetFilters');
    document.getElementById('date-filter-label').textContent   = t('filterDate');
    document.getElementById('region-filter-label').textContent = t('filterRegion');
    document.getElementById('city-filter-label').textContent   = t('filterCity');
    document.getElementById('type-filter-label').textContent   = t('filterCategory');
    document.getElementById('loading').textContent             = t('loading');

    // Handle ?tab= param from other pages' bottom nav
    const tabParam = new URLSearchParams(location.search).get('tab');
    if (tabParam && ['private', 'social', 'map'].includes(tabParam)) {
        switchTab(tabParam);
    }

    // Wire up search input
    document.getElementById('search-input')?.addEventListener('input', handleSearchInput);

    // Load events
    Promise.all([
        fetch('events.json').then(r => r.ok ? r.json() : []).catch(() => []),
        fetchPrivateEvents(),
    ]).then(([scraped, userEvents]) => {
        publicEvents  = scraped;
        privateEvents = userEvents;
        allEvents     = publicEvents; // default tab = public
        updateEventCounter(allEvents.length);
        buildFilters();
        renderEvents(allEvents);

        // Footer count
        const footerCount = document.getElementById('event-count-footer');
        if (footerCount && allEvents.length) {
            footerCount.textContent = allEvents.length + ' אירועים חינם במאגר';
        }
    }).catch(err => {
        document.getElementById('event-list').innerHTML = `
            <p style="padding:1rem;color:#c0392b">
                ${t('errorLoad')}<br>
                <code>${t('errorHint')}</code>
            </p>`;
        console.error(err);
    });

    // Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js');
    }
})();
