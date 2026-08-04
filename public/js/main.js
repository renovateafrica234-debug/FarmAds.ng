/* FarmAds.ng — Main JS + AI Agent Brain */

// ── CURSOR ───────────────────────────────
const cursorGlow = document.getElementById('cursorGlow');
document.addEventListener('mousemove', (e) => {
  cursorGlow.style.left = e.clientX + 'px';
  cursorGlow.style.top  = e.clientY + 'px';
});

// ── NAVBAR SCROLL ────────────────────────
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 60);
});

// ── MOBILE MENU ──────────────────────────
const burger = document.getElementById('burger');
const mobileMenu = document.getElementById('mobileMenu');
burger.addEventListener('click', () => mobileMenu.classList.toggle('open'));
mobileMenu.querySelectorAll('a').forEach(l => l.addEventListener('click', () => mobileMenu.classList.remove('open')));

// ── REVEAL ON SCROLL ─────────────────────
const revealObs = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); revealObs.unobserve(e.target); } });
}, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
document.querySelectorAll('.reveal').forEach(el => revealObs.observe(el));

// ── COUNTERS ─────────────────────────────
function animCounter(el, target, duration = 1800) {
  const start = performance.now();
  const update = (now) => {
    const p = Math.min((now - start) / duration, 1);
    el.textContent = Math.round(target * (1 - Math.pow(2, -10 * p)));
    if (p < 1) requestAnimationFrame(update);
  };
  requestAnimationFrame(update);
}
const cObs = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) { animCounter(e.target, parseInt(e.target.dataset.target)); cObs.unobserve(e.target); } });
}, { threshold: 0.5 });
document.querySelectorAll('.counter, .hero-stat__num[data-target]').forEach(el => cObs.observe(el));

// ── SMOOTH SCROLL ────────────────────────
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', function(e) {
    const t = document.querySelector(this.getAttribute('href'));
    if (t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
});

// ── REGISTER FORM ────────────────────────
function handleRegister(e) {
  e.preventDefault();
  const name = document.getElementById('ctaName')?.value.trim();
  const email = document.getElementById('ctaEmail')?.value.trim();
  const role  = document.getElementById('ctaRole')?.value;
  if (!name || !email || !role) {
    const form = document.getElementById('ctaForm');
    form.style.animation = 'shake .4s ease';
    setTimeout(() => form.style.animation = '', 400);
    return;
  }
  document.getElementById('ctaForm').classList.add('hidden');
  document.getElementById('ctaSuccess').classList.remove('hidden');
}

// ── CONTACT FORM ─────────────────────────
function handleContact(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.textContent = '✓ Message Sent!';
  btn.style.background = 'var(--green-600)';
  btn.disabled = true;
  setTimeout(() => { e.target.reset(); btn.textContent = 'Send Message'; btn.style.background = ''; btn.disabled = false; }, 3000);
}

// ── PARALLAX HERO ORBS ───────────────────
document.addEventListener('mousemove', (e) => {
  const x = (e.clientX / window.innerWidth - 0.5) * 0.04;
  const y = (e.clientY / window.innerHeight - 0.5) * 0.04;
  const o1 = document.querySelector('.hero__orb--1');
  const o2 = document.querySelector('.hero__orb--2');
  if (o1) o1.style.transform = `translate(${x * 30}px, ${y * 30}px)`;
  if (o2) o2.style.transform = `translate(${-x * 20}px, ${-y * 20}px)`;
});

// ═══════════════════════════════════════════════════════════
// AI AGENT BRAIN — FarmAds Swarm Orchestration
// Uses Gemini free tier (same as Sparkam)
// Set GOOGLE_API_KEY in Vercel env variables
// ═══════════════════════════════════════════════════════════

let taskCount = 0;
let isThinking = false;

// Map queries to specialist agents
const AGENT_ROUTING = {
  'market':    ['price', 'market', 'sell', 'buy', 'demand', 'rate', 'cost', 'value', 'buyer', 'sesame', 'groundnut', 'maize', 'soybean'],
  'weather':   ['weather', 'rain', 'climate', 'forecast', 'temperature', 'season', 'plant', 'planting', 'harvest time'],
  'logistics': ['ship', 'export', 'logistics', 'transport', 'freight', 'deliver', 'customs', 'port'],
  'escrow':    ['escrow', 'payment', 'secure', 'money', 'fund', 'pay', 'transfer', 'safe'],
};

function detectAgents(message) {
  const lower = message.toLowerCase();
  const active = [];
  for (const [agent, keywords] of Object.entries(AGENT_ROUTING)) {
    if (keywords.some(kw => lower.includes(kw))) active.push(agent);
  }
  return active.length ? active : ['market'];
}

function setAgentStatus(agentId, status, label) {
  const el = document.getElementById(`status-${agentId}`);
  if (!el) return;
  el.textContent = label;
  el.className = 'swarm-agent__status' + (status === 'working' ? ' swarm-agent__status--working' : status === 'active' ? ' swarm-agent__status--active' : '');
}

function activateAgents(agents) {
  agents.forEach(a => setAgentStatus(a, 'working', 'Working...'));
}

function resetAgents(agents) {
  agents.forEach(a => setAgentStatus(a, '', 'Standby'));
}

function appendMessage(role, content, agentsUsed = []) {
  const messages = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = `msg msg--${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'msg__avatar';
  avatar.textContent = role === 'user' ? '👤' : '🧠';

  const bubble = document.createElement('div');
  bubble.className = 'msg__bubble';

  if (role === 'agent' && agentsUsed.length) {
    const tag = document.createElement('div');
    tag.className = 'agent-tag';
    const icons = { market:'📈', logistics:'🚢', weather:'🌦️', escrow:'🔒', core:'🧠' };
    tag.innerHTML = agentsUsed.map(a => `${icons[a] || '🤖'} ${a.charAt(0).toUpperCase() + a.slice(1)} Agent`).join(' · ');
    bubble.appendChild(tag);
  }

  const p = document.createElement('p');
  p.textContent = content;
  bubble.appendChild(p);
  div.appendChild(avatar);
  div.appendChild(bubble);
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return div;
}

function showTyping() {
  const messages = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'msg msg--agent';
  div.id = 'typingMsg';
  div.innerHTML = `
    <div class="msg__avatar">🧠</div>
    <div class="msg__bubble">
      <div class="typing-indicator"><span></span><span></span><span></span></div>
    </div>`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function hideTyping() {
  const el = document.getElementById('typingMsg');
  if (el) el.remove();
}

function updateTaskCount() {
  taskCount++;
  const el = document.getElementById('taskCount');
  if (el) el.textContent = taskCount;
}

// Build the FarmAds system prompt for the AI brain
function buildSystemPrompt(agents) {
  const agentContext = {
    market:    'You have access to market pricing data for Nigerian agricultural exports. Provide realistic price ranges in Naira and USD for common crops like sesame, groundnuts, soybeans, maize.',
    logistics: 'You have knowledge of Nigerian export logistics, port procedures at Apapa/Tin Can, freight costs, and common export documentation requirements.',
    weather:   'You have access to Nigerian agricultural weather patterns, rainy seasons by region (North: April-Sept, South: March-Nov), and crop-specific planting recommendations.',
    escrow:    'You understand FarmAds escrow system: funds are locked on order placement, verified on delivery, released to farmer within 48hrs. Multi-currency support including USD, EUR, CNY, NGN.'
  };

  const activeContext = agents.map(a => agentContext[a] || '').filter(Boolean).join('\n');

  return `You are the FarmAds AI Brain — a swarm of intelligent agricultural agents serving Nigerian farmers and global buyers. You are part of FarmAds.ng, Nigeria's AI-powered farm marketplace built by Renovate Africa.

Active agents this request: ${agents.join(', ')}

${activeContext}

Your role:
- Give practical, actionable farming and trade advice
- Be specific to Nigerian agricultural context (regions: Kano, Kaduna, Borno, Rivers, Ogun, etc.)
- Mention FarmAds features where relevant (AI Brokers, Escrow, Pre-harvest orders)
- Keep responses concise (3-5 sentences) but informative
- Use Naira (₦) for local prices, USD for export prices
- Be warm and farmer-friendly in tone
- Never hallucinate specific real-time data — frame it as estimates or guidance

Always end with one actionable next step the farmer can take on FarmAds.ng.`;
}

async function callAgentAPI(userMessage, agents) {
  const systemPrompt = buildSystemPrompt(agents);

  try {
    // Call Vercel API route which proxies to Gemini
    const response = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: userMessage, systemPrompt, agents })
    });

    if (!response.ok) {
      // Fallback: intelligent rule-based responses if API unavailable
      return getFallbackResponse(userMessage, agents);
    }

    const data = await response.json();
    return data.response || getFallbackResponse(userMessage, agents);

  } catch (err) {
    console.warn('Agent API unavailable, using fallback:', err);
    return getFallbackResponse(userMessage, agents);
  }
}

// Smart fallback responses when API is not yet configured
function getFallbackResponse(message, agents) {
  const lower = message.toLowerCase();

  if (lower.includes('sesame') || lower.includes('price') || lower.includes('market')) {
    return `📈 Market Agent: Sesame seed export prices are currently ranging ₦350,000–₦420,000/tonne for premium grade, with strong EU and Chinese demand this season. Your AI Broker on FarmAds can lock in a pre-harvest order at these rates before prices shift. Next step: List your upcoming sesame harvest on FarmAds to attract verified international buyers now.`;
  }
  if (lower.includes('weather') || lower.includes('rain') || lower.includes('plant')) {
    return `🌦️ Weather Agent: For northern Nigeria (Kano/Kaduna belt), the main planting window opens mid-May as rains establish. Sesame and groundnuts do best with first planting by June 1st. FarmAds precision farming module will send you personalised alerts for your specific region. Next step: Register your farm location on FarmAds to receive real-time weather-based planting alerts.`;
  }
  if (lower.includes('escrow') || lower.includes('payment') || lower.includes('secure')) {
    return `🔒 Escrow Agent: FarmAds escrow works like this — when a buyer places an order, their funds are locked in a protected account immediately. Funds are only released to you after delivery confirmation, protecting both sides. You'll receive payment within 48 hours of confirmed delivery. Next step: Register on FarmAds to access our escrow-protected payment system for your next sale.`;
  }
  if (lower.includes('export') || lower.includes('logistics') || lower.includes('ship')) {
    return `🚢 Logistics Agent: Exporting from Nigeria typically requires a phytosanitary certificate, NAFDAC clearance for food products, and a Form M for foreign exchange. FarmAds AI Brokers handle all documentation automatically. Freight from Lagos to Rotterdam is approximately $80–$120/tonne for consolidated loads. Next step: Use FarmAds AI Broker to get a full logistics quote for your specific crop and quantity.`;
  }
  if (lower.includes('groundnut') || lower.includes('peanut')) {
    return `📈 Market Agent: Nigerian groundnuts are in strong demand in European confectionery markets. Current export price ranges ₦280,000–₦340,000/tonne FOB Lagos. Shelled groundnuts command a 40% premium over unshelled. FarmAds has pre-qualified buyers in Germany, Netherlands and UAE actively sourcing. Next step: List your groundnut harvest on FarmAds to connect with these buyers directly.`;
  }
  if (lower.includes('buyer') || lower.includes('find') || lower.includes('sell')) {
    return `📈 Market Agent: FarmAds currently has over 50 pre-qualified international buyers actively sourcing Nigerian produce — from Germany, China, UAE, India and the UK. Our AI Broker matches your crop type, quantity and harvest date to buyers with active purchase mandates. Deals are escrow-protected from day one. Next step: Register your farm and current crop inventory on FarmAds to get buyer matches within 24 hours.`;
  }

  // Generic helpful response
  return `🧠 FarmAds AI: Great question! Our swarm of specialist agents (Market, Logistics, Weather, Escrow) is ready to help you trade smarter. FarmAds connects Nigerian farmers directly to international buyers in Europe, China and Asia — with AI brokers handling export compliance, and escrow protecting every payment. Next step: Register on FarmAds.ng to activate your personal AI Broker and start receiving international purchase offers.`;
}

// Send message
async function sendAgentMessage() {
  if (isThinking) return;
  const input = document.getElementById('agentInput');
  const sendBtn = document.getElementById('agentSend');
  const message = input.value.trim();
  if (!message) return;

  isThinking = true;
  input.value = '';
  sendBtn.disabled = true;
  document.getElementById('sendIcon').textContent = '⏳';

  // Add user message
  appendMessage('user', message);

  // Detect which agents to activate
  const agents = detectAgents(message);
  activateAgents(agents);
  setAgentStatus('core', 'active', 'Processing...');

  // Show typing
  showTyping();

  // Call AI
  const response = await callAgentAPI(message, agents);

  hideTyping();
  resetAgents(agents);
  setAgentStatus('core', 'active', 'Online');
  updateTaskCount();

  appendMessage('agent', response, agents);

  isThinking = false;
  sendBtn.disabled = false;
  document.getElementById('sendIcon').textContent = '→';
  input.focus();
}

// Chip click handler
function sendChip(btn) {
  const input = document.getElementById('agentInput');
  input.value = btn.textContent.replace(/^[^\s]+\s/, ''); // strip emoji
  // Remove chips after first use to keep UI clean
  const chips = document.querySelector('.msg__chips');
  if (chips) chips.style.display = 'none';
  sendAgentMessage();
}

// Enter key to send
document.getElementById('agentInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAgentMessage(); }
});

// Shake keyframe
const styleEl = document.createElement('style');
styleEl.textContent = `@keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-8px)}40%{transform:translateX(8px)}60%{transform:translateX(-5px)}80%{transform:translateX(5px)}}`;
document.head.appendChild(styleEl);

console.log('%c🌿 FarmAds.ng', 'color:#C8F542;font-size:1.5rem;font-weight:bold');
console.log('%cAI Agent Brain — Swarm Active', 'color:#9DC4A0;font-size:0.9rem');
