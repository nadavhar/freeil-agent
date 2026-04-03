/* ══════════════════════════════════════════════════════════════
   Global state — single source of truth for runtime data.
   All other modules read/write these vars.
══════════════════════════════════════════════════════════════ */

// ── Event data ──
let allEvents     = [];
let publicEvents  = [];
let privateEvents = [];
let allFeedEvents  = [];   // community tab — full unfiltered list
let feedComments   = [];   // community tab — recent comments for activity section
let activeTab     = 'public';

// ── Filter state (multi-select — empty Set means "all") ──
let activeDateFilters   = new Set();
let activeCityFilters   = new Set();
let activeTypeFilters   = new Set();
let activeRegionFilters = new Set();
let searchQuery         = '';
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
