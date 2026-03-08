/* ══════════════════════════════════════════════════════════════
   Onboarding — 4-step overlay shown once to first-time visitors.
   No external dependencies — runs immediately on parse.
══════════════════════════════════════════════════════════════ */
// Safe no-ops for returning visitors (IIFE returns early, these get overwritten for new visitors)
window.obNext = window.obFinish = window.obRequestLocation = function () {};

(function () {
    const OB_KEY = 'freeil-ob-done';
    if (localStorage.getItem(OB_KEY)) return; // already seen

    let obStep = 0;
    const TOTAL   = 4;
    const overlay = document.getElementById('ob-overlay');
    const slides  = document.getElementById('ob-slides');
    const dots    = document.getElementById('ob-dots').children;
    const nextBtn = document.getElementById('ob-next-btn');

    overlay.classList.remove('ob-hidden');

    function goTo(step) {
        obStep = Math.max(0, Math.min(step, TOTAL - 1));
        slides.style.transform = `translateX(calc(${-obStep} * 100vw))`;
        Array.from(dots).forEach((d, i) => d.classList.toggle('active', i === obStep));
        const isLast = obStep === TOTAL - 1;
        nextBtn.innerHTML = isLast
            ? 'בואו נתחיל <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>'
            : 'הבא <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
        nextBtn.classList.toggle('ob-last', isLast);
    }

    window.obNext    = () => obStep < TOTAL - 1 ? goTo(obStep + 1) : obFinish();
    window.obFinish  = () => { localStorage.setItem(OB_KEY, '1'); overlay.classList.add('ob-hidden'); };
    window.obRequestLocation = () => {
        if (navigator.geolocation) navigator.geolocation.getCurrentPosition(() => {}, () => {});
    };

    // Swipe support
    let startX = 0;
    overlay.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
    overlay.addEventListener('touchend',   e => {
        const dx = e.changedTouches[0].clientX - startX;
        if (Math.abs(dx) > 50) dx < 0 ? obNext() : goTo(obStep - 1);
    }, { passive: true });

    goTo(0);
})();
