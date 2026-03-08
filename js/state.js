/* ══════════════════════════════════════════════════════════════
   Global state — single source of truth for runtime data.
   All other modules read/write these vars.
══════════════════════════════════════════════════════════════ */

// ── Event data ──
let allEvents     = [];
let publicEvents  = [];
let privateEvents = [];
let activeTab     = 'public';

// ── Filter state ──
let activeTypeFilter   = 'all';
let activeCityFilter   = 'all';
let activeDateFilter   = 'all';
let activeRegionFilter = 'all';
let searchQuery        = '';
let searchDebounceTimer = null;

// ── User preferences ──
let favoriteCategories = JSON.parse(localStorage.getItem('freeil-fav-categories') || '[]');

// ── Map state ──
let mapInstance     = null;
let mapRadiusCircle = null;
let mapMarkers      = [];
let mapRadius       = 5;
let userLatLng      = null;

// ── Language ──
let currentLang = localStorage.getItem('freeil-lang') || 'he';
