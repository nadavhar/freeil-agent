/* ══════════════════════════════════════════════════════════════
   Filters — date helpers, filter chip builders, applyFilter.
   Depends on: state.js, translations.js, utils.js
══════════════════════════════════════════════════════════════ */

// ── Region → city mapping ──
const regionCities = {
    north:     ['Haifa', 'Krayot', 'Tiberias', 'Nazareth', 'Safed', 'Akko'],
    center:    ['Tel Aviv', 'Petah Tikva', 'Rishon LeZion', 'Holon', 'Bat Yam', 'Herzliya', 'Hod HaSharon', 'Kfar Saba'],
    south:     ['Beer Sheva', 'Eilat', 'Ashdod'],
    jerusalem: ['Jerusalem']
};

function getCitiesForRegion(region) {
    return region === 'all' ? null : (regionCities[region] || null);
}

// ── Date helpers (Israel timezone) ──
const ISRAEL_TZ = 'Asia/Jerusalem';

function getDateInIsrael(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: ISRAEL_TZ, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(date);
}

function getIsraelDayOfWeek() {
    const israelDateStr = new Intl.DateTimeFormat('en-US', {
        timeZone: ISRAEL_TZ, weekday: 'short'
    }).format(new Date());
    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return dayMap[israelDateStr] ?? -1;
}

function isToday(dateStr, recurringDays = null) {
    if (recurringDays && Array.isArray(recurringDays) && recurringDays.length > 0) {
        return recurringDays.includes(getIsraelDayOfWeek());
    }
    if (!dateStr) return false;
    const eventDate = new Date(dateStr.includes('T') ? dateStr : dateStr + 'T12:00:00');
    return getDateInIsrael(new Date()) === getDateInIsrael(eventDate);
}

function isThisWeek(dateStr) {
    if (!dateStr) return false;
    const now  = new Date();
    const end  = new Date(now); end.setDate(now.getDate() + 7);
    const ev   = getDateInIsrael(new Date(dateStr.includes('T') ? dateStr : dateStr + 'T12:00:00'));
    return ev >= getDateInIsrael(now) && ev < getDateInIsrael(end);
}

function isThisMonth(dateStr) {
    if (!dateStr) return false;
    const now  = new Date();
    const end  = new Date(now); end.setDate(now.getDate() + 30);
    const ev   = getDateInIsrael(new Date(dateStr.includes('T') ? dateStr : dateStr + 'T12:00:00'));
    return ev >= getDateInIsrael(now) && ev < getDateInIsrael(end);
}

// ── Search ──
function normalizeSearchText(text) {
    return text ? text.toLowerCase().trim() : '';
}

function matchesSearch(event, query) {
    if (!query) return true;
    const q = normalizeSearchText(query);
    return normalizeSearchText(event.title || '').includes(q) ||
           normalizeSearchText(event.description || '').includes(q) ||
           normalizeSearchText(event.city || '').includes(q) ||
           normalizeSearchText(getCityLabel(event.city) || '').includes(q);
}

function handleSearchInput(e) {
    const value = e.target.value;
    document.getElementById('search-clear').classList.toggle('visible', value.length > 0);
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
        searchQuery = value.trim();
        applyFilter();
    }, 300);
}

function clearSearch() {
    const input = document.getElementById('search-input');
    input.value = '';
    document.getElementById('search-clear').classList.remove('visible');
    searchQuery = '';
    applyFilter();
    input.focus();
}

// ── Favorite categories ──
function toggleFavoriteCategory(type) {
    const idx = favoriteCategories.indexOf(type);
    if (idx > -1) favoriteCategories.splice(idx, 1);
    else          favoriteCategories.push(type);
    localStorage.setItem('freeil-fav-categories', JSON.stringify(favoriteCategories));
    buildCategoryFilters();
}

function getSortedCategories(types) {
    const favs    = types.filter(c => favoriteCategories.includes(c));
    const nonFavs = types.filter(c => !favoriteCategories.includes(c));
    favs.sort((a, b) => favoriteCategories.indexOf(a) - favoriteCategories.indexOf(b));
    return [...favs, ...nonFavs];
}

// ── Filter builders ──
function buildFilters() {
    // Date chips
    const dateBar = document.getElementById('date-filters');
    dateBar.innerHTML = '';
    [
        { key: 'all',   label: t('filterAll') },
        { key: 'today', label: t('filterToday') },
        { key: 'week',  label: t('filterWeek') },
        { key: 'month', label: t('filterMonth') }
    ].forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'filter-chip date-chip' + (activeDateFilter === opt.key ? ' active' : '');
        btn.dataset.date = opt.key;
        btn.textContent = opt.label;
        btn.onclick = () => { activeDateFilter = opt.key; applyFilter(); };
        dateBar.appendChild(btn);
    });

    // Region chips
    const regionBar = document.getElementById('region-filters');
    regionBar.innerHTML = '';
    [
        { key: 'all',       label: t('filterAll') },
        { key: 'north',     label: t('regionNorth') },
        { key: 'center',    label: t('regionCenter') },
        { key: 'jerusalem', label: t('regionJerusalem') },
        { key: 'south',     label: t('regionSouth') }
    ].forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'filter-chip region-chip' + (activeRegionFilter === opt.key ? ' active' : '');
        btn.dataset.region = opt.key;
        btn.textContent = opt.label;
        btn.onclick = () => {
            activeRegionFilter = opt.key;
            activeCityFilter   = 'all';
            buildCityFilters();
            applyFilter();
        };
        regionBar.appendChild(btn);
    });

    buildCityFilters();
}

function buildCityFilters() {
    const knownCities  = Object.keys(translations.he.cities).filter(c => c !== 'Other');
    const eventCities  = allEvents.map(e => e.city).filter(Boolean);
    let   cities       = [...new Set([...knownCities, ...eventCities])];
    const regionList   = getCitiesForRegion(activeRegionFilter);
    if (regionList) cities = cities.filter(c => regionList.includes(c));

    const cityBar = document.getElementById('city-filters');
    cityBar.innerHTML = '';

    const allBtn = document.createElement('button');
    allBtn.className = 'filter-chip city-chip' + (activeCityFilter === 'all' ? ' active' : '');
    allBtn.dataset.city = 'all';
    allBtn.textContent = t('filterAll');
    allBtn.onclick = () => { activeCityFilter = 'all'; applyFilter(); };
    cityBar.appendChild(allBtn);

    cities.forEach(c => {
        const btn = document.createElement('button');
        btn.className = 'filter-chip city-chip' + (activeCityFilter === c ? ' active' : '');
        btn.dataset.city = c;
        btn.textContent = getCityLabel(c);
        btn.onclick = () => { activeCityFilter = c; applyFilter(); };
        cityBar.appendChild(btn);
    });

    buildCategoryFilters();
}

function buildCategoryFilters() {
    const knownTypes  = Object.keys(translations.he.types);
    const eventTypes  = allEvents.map(e => e.event_type).filter(Boolean);
    const types       = [...new Set([...knownTypes, ...eventTypes])];
    const sortedTypes = getSortedCategories(types);

    const typeBar = document.getElementById('type-filters');
    typeBar.innerHTML = '';

    const allBtn = document.createElement('button');
    allBtn.className = 'filter-chip' + (activeTypeFilter === 'all' ? ' active' : '');
    allBtn.dataset.type = 'all';
    allBtn.textContent = t('filterAll');
    allBtn.onclick = () => { activeTypeFilter = 'all'; applyFilter(); };
    typeBar.appendChild(allBtn);

    sortedTypes.forEach(type => {
        const isFav    = favoriteCategories.includes(type);
        const isActive = activeTypeFilter === type;
        const btn      = document.createElement('button');
        btn.className  = 'filter-chip' + (isActive ? ' active' : '') + (isFav ? ' favorited' : '');
        btn.dataset.type = type;

        const icon      = typeIcons[type] || '📌';
        const starClass = isFav ? 'fav-star active' : 'fav-star';
        btn.innerHTML   = `<span class="${starClass}" data-type="${type}">★</span><span class="chip-icon">${icon}</span>${escHtml(getTypeLabel(type))}`;

        btn.onclick = (e) => {
            if (e.target.classList.contains('fav-star')) return;
            activeTypeFilter = type;
            applyFilter();
        };
        btn.querySelector('.fav-star').onclick = (e) => {
            e.stopPropagation();
            toggleFavoriteCategory(type);
        };

        typeBar.appendChild(btn);
    });
}

// ── Apply & reset ──
function updateResetButton() {
    const isFiltered = activeDateFilter !== 'all' || activeRegionFilter !== 'all' ||
                       activeCityFilter !== 'all' || activeTypeFilter !== 'all' || searchQuery !== '';
    document.getElementById('reset-filters').classList.toggle('visible', isFiltered);
}

function applyFilter() {
    // Sync active state on chips
    document.querySelectorAll('#date-filters .filter-chip').forEach(b =>
        b.classList.toggle('active', (b.dataset.date || 'all') === activeDateFilter));
    document.querySelectorAll('#region-filters .filter-chip').forEach(b =>
        b.classList.toggle('active', (b.dataset.region || 'all') === activeRegionFilter));
    document.querySelectorAll('#city-filters .filter-chip').forEach(b =>
        b.classList.toggle('active', (b.dataset.city || 'all') === activeCityFilter));
    document.querySelectorAll('#type-filters .filter-chip').forEach(b =>
        b.classList.toggle('active', (b.dataset.type || 'all') === activeTypeFilter));
    updateResetButton();

    let filtered = allEvents;

    if (activeDateFilter === 'today') {
        filtered = filtered.filter(e => isToday(e.date, e.recurringDays));
    } else if (activeDateFilter === 'week') {
        filtered = filtered.filter(e => isThisWeek(e.date));
    } else if (activeDateFilter === 'month') {
        filtered = filtered.filter(e => isThisMonth(e.date));
    }

    if (activeRegionFilter !== 'all' && activeCityFilter === 'all') {
        const regionList = getCitiesForRegion(activeRegionFilter);
        if (regionList) filtered = filtered.filter(e => regionList.includes(e.city));
    }
    if (activeCityFilter !== 'all') {
        filtered = filtered.filter(e => e.city === activeCityFilter);
    }
    if (activeTypeFilter !== 'all') {
        filtered = filtered.filter(e => e.event_type === activeTypeFilter);
    }
    if (searchQuery) {
        filtered = filtered.filter(e => matchesSearch(e, searchQuery));
    }

    renderEvents(filtered);
}

function resetAllFilters() {
    activeDateFilter = activeCityFilter = activeRegionFilter = activeTypeFilter = 'all';
    searchQuery = '';
    const input = document.getElementById('search-input');
    if (input) input.value = '';
    document.getElementById('search-clear')?.classList.remove('visible');
    buildCityFilters();
    applyFilter();
}
