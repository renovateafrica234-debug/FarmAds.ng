document.addEventListener('DOMContentLoaded', () => {
  // Navbar blur on scroll
  const navbar = document.querySelector('.navbar');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
      navbar.style.backdropFilter = 'blur(12px)';
      navbar.style.background = 'rgba(10, 61, 46, 0.95)';
    } else {
      navbar.style.backdropFilter = 'none';
      navbar.style.background = 'var(--pulse-green)';
    }
  });

  // Smooth scroll for anchor links
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute('href'));
      if (target) target.scrollIntoView({ behavior: 'smooth' });
    });
  });

  console.log('Farmads.ng loaded 🌾');
});

