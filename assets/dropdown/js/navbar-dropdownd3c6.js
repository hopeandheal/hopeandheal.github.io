/**
 * navbar-dropdown.js — Hope & Heal Navigation Controller
 * Handles mobile collapse, auto-closing on item click, and accurate smooth scrolling.
 */
!function() {
    // 1. Helper to close mobile menu
    function closeMobileNav() {
        const collapseEl = document.querySelector('#navbarSupportedContent');
        if (collapseEl && collapseEl.classList.contains('show')) {
            try {
                if (window.bootstrap && bootstrap.Collapse) {
                    const bsCollapse = bootstrap.Collapse.getInstance(collapseEl) || new bootstrap.Collapse(collapseEl, { toggle: false });
                    bsCollapse.hide();
                } else {
                    collapseEl.classList.remove('show');
                }
            } catch (err) {
                collapseEl.classList.remove('show');
            }
        }
        document.body.classList.remove('navbar-dropdown-open');
        document.querySelectorAll('.navbar-dropdown, .navbar').forEach(nav => {
            nav.classList.remove('opened');
        });
        document.querySelectorAll('.navbar-toggler').forEach(toggler => {
            toggler.setAttribute('aria-expanded', 'false');
            toggler.classList.add('collapsed');
        });
    }

    // 3. Throttle scroll/resize events
    let timeout;
    ['scroll', 'resize'].forEach(evt => {
        document.addEventListener(evt, e => {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                if (e.type === 'resize' && window.innerWidth > 991) {
                    closeMobileNav();
                }
                const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
                document.querySelectorAll('.navbar-dropdown, .navbar').forEach(nav => {
                    if (nav.classList.contains('navbar-fixed-top') || nav.classList.contains('navbar')) {
                        if (scrollTop > 10) {
                            nav.classList.add('navbar-short');
                        } else {
                            nav.classList.remove('navbar-short');
                        }
                    }
                });
            }, 10);
        });
    });

    // 4. Listen to Bootstrap collapse events
    ['show.bs.collapse', 'hide.bs.collapse', 'shown.bs.collapse', 'hidden.bs.collapse'].forEach(evt => {
        document.addEventListener(evt, ({ target }) => {
            const nav = target.closest('.navbar-dropdown') || target.closest('.navbar');
            if (evt === 'show.bs.collapse') {
                document.body.classList.add('navbar-dropdown-open');
                if (nav) nav.classList.add('opened');
            } else if (evt === 'hide.bs.collapse' || evt === 'hidden.bs.collapse') {
                if (!target.classList.contains('show')) {
                    document.body.classList.remove('navbar-dropdown-open');
                    if (nav) nav.classList.remove('opened');
                }
            }
        });
    });

    // 5. Click handler for mobile nav items & accurate scrolling
    document.addEventListener('click', function(e) {
        const link = e.target.closest('#navbarSupportedContent a, .navbar a');
        if (!link) return;

        const href = link.getAttribute('href') || '';
        const isMobile = window.matchMedia('(max-width: 991px)').matches;
        const collapseEl = document.querySelector('#navbarSupportedContent');
        const isMenuOpen = collapseEl && collapseEl.classList.contains('show');

        // Check if this is an on-page link on the current page
        const isHome = window.location.pathname === '/' || window.location.pathname === '/index.html' || window.location.pathname === '';
        
        let targetHash = '';
        if (href.startsWith('#')) {
            targetHash = href;
        } else if (href.startsWith('/#') && isHome) {
            targetHash = href.substring(1); // e.g. '#about'
        }

        // Always close mobile menu on item click
        if (isMobile && isMenuOpen) {
            closeMobileNav();
        }

        // Handle on-page smooth scroll with navbar offset
        if (isHome && (targetHash || href === '/' || href === '/#')) {
            if (href === '/' || href === '/#') {
                e.preventDefault();
                window.scrollTo({ top: 0, behavior: 'smooth' });
                if (window.history && window.history.pushState) {
                    window.history.pushState(null, '', '/');
                }
                return;
            }

            const targetId = targetHash.replace('#', '');
            const targetEl = document.getElementById(targetId) || document.querySelector(targetHash);
            if (targetEl) {
                e.preventDefault();
                const offset = 85; // Fixed floating navbar height + margins
                const rect = targetEl.getBoundingClientRect();
                const targetTop = rect.top + window.pageYOffset - offset;

                window.scrollTo({
                    top: Math.max(0, targetTop),
                    behavior: 'smooth'
                });

                if (window.history && window.history.pushState) {
                    window.history.pushState(null, '', targetHash);
                }
            }
        }
    });

    // 6. Handle initial hash on page load (e.g. arriving from /order to /#about)
    function handleInitialHash() {
        if (window.location.hash) {
            const targetEl = document.getElementById(window.location.hash.substring(1)) || document.querySelector(window.location.hash);
            if (targetEl) {
                setTimeout(() => {
                    const offset = 85;
                    const rect = targetEl.getBoundingClientRect();
                    const targetTop = rect.top + window.pageYOffset - offset;
                    window.scrollTo({
                        top: Math.max(0, targetTop),
                        behavior: 'smooth'
                    });
                }, 150);
            }
        }
    }

    if (document.readyState === 'complete') {
        handleInitialHash();
    } else {
        window.addEventListener('load', handleInitialHash);
    }

    // 7. Dropdown submenus if any
    document.querySelectorAll('.nav-link.dropdown-toggle').forEach(el => {
        el.addEventListener('click', e => {
            e.preventDefault();
            e.target.parentNode.classList.toggle('open');
        });
    });
}();