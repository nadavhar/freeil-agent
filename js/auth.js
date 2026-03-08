/* ══════════════════════════════════════════════════════════════
   Auth — header UI, dropdown, sign-out, auth state listener.
   Depends on: state.js, config.js (sb)
══════════════════════════════════════════════════════════════ */

function setAuthUI(user) {
    const loggedOut    = document.getElementById('auth-logged-out');
    const loggedIn     = document.getElementById('auth-logged-in');
    const postLogin    = document.getElementById('post-login-section');

    if (!user) {
        loggedOut.style.display    = 'flex';
        loggedIn.style.display     = 'none';
        postLogin.style.display    = 'none';
        return;
    }

    loggedOut.style.display = 'none';
    loggedIn.style.display  = 'flex';
    postLogin.style.display = 'block';

    const name      = user.user_metadata?.full_name || user.email || '';
    const firstName = name.split(' ')[0] || '';
    const initials  = name.trim()
        ? name.trim().split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
        : '?';

    document.getElementById('user-avatar-initials').textContent = initials;
    document.getElementById('user-name-short').textContent      = firstName;
    document.getElementById('user-dropdown-email').textContent  = user.email || '';
    document.getElementById('post-login-name').textContent      = firstName;
}

function toggleUserDropdown(e) {
    e.stopPropagation();
    document.getElementById('user-dropdown').classList.toggle('open');
}

async function signOut() {
    try { await sb.auth.signOut(); } catch (e) { /* ignore */ }
    window.location.href = '/';
}

// Close dropdown when clicking anywhere else
document.addEventListener('click', () => {
    document.getElementById('user-dropdown')?.classList.remove('open');
});

// Initial session check + live auth state listener
sb.auth.getSession().then(({ data: { session } }) => {
    setAuthUI(session?.user || null);
});

sb.auth.onAuthStateChange((_event, session) => {
    setAuthUI(session?.user || null);
    if (typeof window.onAuthRefreshPrivate === 'function') {
        window.onAuthRefreshPrivate();
    }
});
