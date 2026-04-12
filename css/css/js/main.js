/* FarmAds.ng — Main JS */

// ── CURSOR GLOW ──────────────────────
const cursorGlow = document.getElementById('cursorGlow');
document.addEventListener('mousemove', (e) => {
  cursorGlow.style.left = e.clientX + 'px';
  cursorGlow.style.top = e.clientY + 'px';
});

// ── NAVBAR SCROLL ────────────────────
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 60);
});

// ── MOBILE MENU ──────────────────────
const burger = document.getElementById('burger');
const mobileMenu = document.getElementById('mobileMenu');
burger.addEventListener('click', () => {
  mobileMenu.classList.toggle('open');
  burger.classList.toggle('active');
});
// Close on nav link click
mobileMenu.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    mobileMenu.classList.remove('open');
    burger.classList.remove('active');
  });
});

// ── REVEAL ON SCROLL ─────────────────
const reveals = document.querySelectorAll('.reveal');
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

reveals.forEach(el => revealObserver.observe(el));

// ── COUNTER ANIMATION ────────────────
function animateCounter(el, target, duration = 1800) {
  const start = performance.now();
  const startVal = 0;
  const update = (now) => {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    // Ease out expo
    const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
    const current = Math.round(startVal + (target - startVal) * eased);
    el.textContent = current;
    if (progress < 1) requestAnimationFrame(update);
  };
  requestAnimationFrame(update);
}

const counterEls = document.querySelectorAll('.counter, .hero-stat__num[data-target]');
const counterObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const el = entry.target;
      const target = parseInt(el.dataset.target || el.closest('.stat-card')?.querySelector('.counter')?.dataset?.target || 0);
      animateCounter(el, parseInt(el.dataset.target));
      counterObserver.unobserve(el);
    }
  });
}, { threshold: 0.5 });

counterEls.forEach(el => counterObserver.observe(el));

// Also observe hero stat numbers
document.querySelectorAll('.hero-stat__num[data-target]').forEach(el => {
  counterObserver.observe(el);
});

// ── REGISTER FORM ────────────────────
function handleRegister(e) {
  e.preventDefault();
  const name = document.getElementById('ctaName').value.trim();
  const email = document.getElementById('ctaEmail').value.trim();
  const role = document.getElementById('ctaRole').value;

  if (!name || !email || !role) {
    // Shake effect
    const form = document.getElementById('ctaForm');
    form.style.animation = 'shake 0.4s ease';
    setTimeout(() => form.style.animation = '', 400);
    return;
  }

  // Show success
  document.getElementById('ctaForm').classList.add('hidden');
  document.getElementById('ctaSuccess').classList.remove('hidden');

  // Log (replace with real API call)
  console.log('Registration:', { name, email, role });
}

// ── CONTACT FORM ─────────────────────
function handleContact(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.textContent = '✓ Message Sent!';
  btn.style.background = 'var(--green-600)';
  btn.disabled = true;
  setTimeout(() => {
    e.target.reset();
    btn.textContent = 'Send Message';
    btn.style.background = '';
    btn.disabled = false;
  }, 3500);
}

// ── SMOOTH SCROLL ────────────────────
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

// ── SHAKE KEYFRAME ───────────────────
const style = document.createElement('style');
style.textContent = `
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    20%       { transform: translateX(-8px); }
    40%       { transform: translateX(8px); }
    60%       { transform: translateX(-5px); }
    80%       { transform: translateX(5px); }
  }
`;
document.head.appendChild(style);

// ── PARALLAX HERO ORBS ───────────────
document.addEventListener('mousemove', (e) => {
  const x = (e.clientX / window.innerWidth - 0.5) * 0.04;
  const y = (e.clientY / window.innerHeight - 0.5) * 0.04;
  const orb1 = document.querySelector('.hero__orb--1');
  const orb2 = document.querySelector('.hero__orb--2');
  if (orb1) orb1.style.transform = `translate(${x * 30}px, ${y * 30}px)`;
  if (orb2) orb2.style.transform = `translate(${-x * 20}px, ${-y * 20}px)`;
});

// ── PAGE LOAD ────────────────────────
window.addEventListener('load', () => {
  document.body.style.opacity = '0';
  document.body.style.transition = 'opacity 0.5s ease';
  requestAnimationFrame(() => {
    document.body.style.opacity = '1';
  });
});

console.log('%c🌿 FarmAds.ng', 'color:#C8F542;font-size:1.5rem;font-weight:bold');
console.log('%cA Renovate Africa Product · hello@farmads.ng', 'color:#9DC4A0;font-size:0.9rem');
