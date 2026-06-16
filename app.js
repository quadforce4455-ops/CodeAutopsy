import { initializeApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, setPersistence, inMemoryPersistence, signInAnonymously, sendEmailVerification, sendPasswordResetEmail } from "firebase/auth";
import { getAnalytics } from "firebase/analytics";
import { getFirestore, doc, setDoc, getDoc, updateDoc, increment } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCvQPs63jwvQkkw_UZlavJjWd3b_xKTuCA",
  authDomain: "ai-code-review-a74bd.firebaseapp.com",
  projectId: "ai-code-review-a74bd",
  storageBucket: "ai-code-review-a74bd.firebasestorage.app",
  messagingSenderId: "1020052525974",
  appId: "1:1020052525974:web:f62f00a4a1c168610503b7",
  measurementId: "G-ZZCEHCJ2FS"
};

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getFirestore(app);
const auth = getAuth(app);

if (window.self !== window.top) {
  setPersistence(auth, inMemoryPersistence).catch(console.error);
}

// ── Auth readiness gate ───────────────────────────────────────────────────
// auth.currentUser is null for a brief instant on every page load while
// Firebase restores a persisted session. Any code that checks
// auth.currentUser synchronously during that window will incorrectly think
// "no user" and may trigger an anonymous sign-in even for an already
// logged-in user. authReady resolves once the *first* onAuthStateChanged
// callback has fired, guaranteeing auth.currentUser reflects the real,
// restored session (or is genuinely null if no session exists).
let resolveAuthReady;
const authReady = new Promise(resolve => { resolveAuthReady = resolve; });
let authReadyResolved = false;
onAuthStateChanged(auth, () => {
  if (!authReadyResolved) {
    authReadyResolved = true;
    resolveAuthReady();
  }
});

// ── Admin config ─────────────────────────────────────────────────────────
const ADMIN_EMAILS = ['quadforce4455@gmail.com']; // 🔧 Replace with your admin email
const isAdmin = () => {
  const u = auth.currentUser;
  return u && !u.isAnonymous && ADMIN_EMAILS.includes(u.email);
};

// ── Usage limits ─────────────────────────────────────────────────────────
const FREE_LIMIT  = 10;  // logged-in users: runs per day
const GUEST_LIMIT = 3;   // anonymous users: runs per day

// Resets at 2:45 PM IST (09:15 UTC) daily — aligned with Gemini quota reset
function getUsagePeriodKey() {
  const shifted = new Date(Date.now() - (9 * 60 + 15) * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

async function checkAndIncrementUsage() {
  try {
    // Wait for Firebase to finish restoring any persisted session before
    // checking auth.currentUser — otherwise a logged-in user can be
    // mistaken for a guest during the brief restore window and get signed
    // in anonymously instead, creating a throwaway account.
    await authReady;

    if (isAdmin()) return { allowed: true };

    // Ensure we have a Firebase uid — sign in anonymously only if there is
    // truly no session (real or anonymous) after auth has finished resolving.
    if (!auth.currentUser) {
      await signInAnonymously(auth);
    }

    const user = auth.currentUser;
    // If still no user (e.g. anonymous auth disabled), allow the run
    if (!user) return { allowed: true };

    const isGuest    = user.isAnonymous;
    // Registered accounts only get the higher limit once their email is
    // verified — prevents abuse via throwaway/fake email addresses.
    const isVerified = !isGuest && !!user.emailVerified;
    const limit      = isGuest ? GUEST_LIMIT : (isVerified ? FREE_LIMIT : GUEST_LIMIT);
    const periodKey  = getUsagePeriodKey();

    const ref  = doc(db, 'usage', user.uid);
    const snap = await getDoc(ref);
    const data = snap.exists() ? snap.data() : {};
    const count = data[periodKey] || 0;

    if (count >= limit) return { allowed: false, count, limit, guest: isGuest, verified: isVerified };

    await setDoc(ref, { [periodKey]: count + 1 }, { merge: true });
    return { allowed: true, count: count + 1, limit, guest: isGuest, verified: isVerified };
  } catch (e) {
    // If usage check fails for any reason, don't block the user
    console.warn('Usage check error:', e);
    return { allowed: true };
  }
}

// ── Read-only usage check (for popup display, no increment) ──────────────
async function getCurrentUsage() {
  try {
    await authReady;

    if (isAdmin()) return { admin: true };

    if (!auth.currentUser) {
      await signInAnonymously(auth);
    }

    const user = auth.currentUser;
    if (!user) return null;

    const isGuest    = user.isAnonymous;
    const isVerified = !isGuest && !!user.emailVerified;
    const limit      = isGuest ? GUEST_LIMIT : (isVerified ? FREE_LIMIT : GUEST_LIMIT);
    const periodKey  = getUsagePeriodKey();

    const ref  = doc(db, 'usage', user.uid);
    const snap = await getDoc(ref);
    const data = snap.exists() ? snap.data() : {};
    const count = data[periodKey] || 0;

    return { count, limit, guest: isGuest, verified: isVerified, admin: false };
  } catch (e) {
    console.warn('getCurrentUsage error:', e);
    return null;
  }
}

// ── Friendly Firebase auth error messages ────────────────────────────────
function friendlyAuthError(error) {
  switch (error.code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':      return 'Incorrect email or password. Please try again.';
    case 'auth/user-not-found':      return 'No account found with this email. Please sign up first.';
    case 'auth/email-already-in-use':return 'An account with this email already exists. Try signing in.';
    case 'auth/weak-password':       return 'Password is too weak. Use at least 6 characters.';
    case 'auth/invalid-email':       return 'Please enter a valid email address.';
    case 'auth/too-many-requests':   return 'Too many failed attempts. Please wait a few minutes and try again.';
    case 'auth/user-disabled':       return 'This account has been disabled. Please contact support.';
    case 'auth/network-request-failed': return 'Network error. Check your connection and try again.';
    case 'auth/missing-email':       return 'Please enter your email address.';
    case 'auth/expired-action-code': return 'This reset link has expired. Please request a new one.';
    case 'auth/invalid-action-code': return 'This reset link is invalid or has already been used.';
    default:                         return 'Something went wrong. Please try again.';
  }
}


document.addEventListener('DOMContentLoaded', () => {

  // ── Auth Nav ──────────────────────────────────────────────────────────
  const navLinksList = document.querySelector('.nav-links');
  if (navLinksList && !document.getElementById('auth-nav-item')) {
    const li = document.createElement('li');
    li.id = 'auth-nav-item';
    navLinksList.appendChild(li);
  }
  const authNavItem = document.getElementById('auth-nav-item');
  
  function updateAuthNav() {
    if (!authNavItem) return;
    
    const firebaseUser = auth.currentUser;
    const githubSessionId = localStorage.getItem('github_session_id');
    const githubUser = githubSessionId ? JSON.parse(localStorage.getItem('github_user') || '{}') : null;
    
    // Anonymous users are not "signed in" from user's perspective — show Sign In
    const isRealUser = (firebaseUser && !firebaseUser.isAnonymous) || githubUser;

    if (isRealUser) {
      const displayName = firebaseUser?.displayName || firebaseUser?.email || githubUser?.login || 'User';
      const isGithub = !firebaseUser && githubUser;
      
      authNavItem.innerHTML = `
        <span style="font-family:var(--font-mono);font-size:0.75rem;color:var(--text-muted);margin-right:1rem;">${isGithub ? '🐙 ' : ''}[${displayName}]</span>
        <button id="logout-btn" class="btn-secondary" style="padding:0.4rem 0.8rem;border-radius:4px;font-size:0.75rem;cursor:pointer;position:relative;z-index:100;">Logout</button>`;
      
      document.getElementById('logout-btn').addEventListener('click', async () => {
        if (firebaseUser) {
          // Carry over today's usage count to the anonymous session after logout
          // so users cannot bypass daily limits by logging out
          const periodKey = getUsagePeriodKey();
          let usageCount = 0;
          try {
            const snap = await getDoc(doc(db, 'usage', firebaseUser.uid));
            if (snap.exists()) usageCount = snap.data()[periodKey] || 0;
          } catch(e) {}

          await signOut(auth);

          try {
            const anonCred = await signInAnonymously(auth);
            if (usageCount > 0) {
              await setDoc(doc(db, 'usage', anonCred.user.uid), { [periodKey]: usageCount }, { merge: true });
            }
          } catch(e) {}
        }
        if (githubSessionId) {
          await fetch('/api/github/logout', {
            method: 'POST',
            headers: { 'x-github-session': githubSessionId }
          });
          localStorage.removeItem('github_session_id');
          localStorage.removeItem('github_user');
        }
        window.location.reload();
      });
    } else {
      authNavItem.innerHTML = `<a href="/auth.html" class="btn-secondary" style="padding:0.4rem 0.8rem;border-radius:4px;font-size:0.75rem;">Sign In</a>`;
    }

    // ── Homepage CTA: swap "Create Account" for logged-in users ──────────
    const ctaSecondaryBtn = document.getElementById('cta-secondary-btn');
    if (ctaSecondaryBtn) {
      if (isRealUser) {
        ctaSecondaryBtn.href = '/history.html';
        ctaSecondaryBtn.textContent = 'View History';
      } else {
        ctaSecondaryBtn.href = '/auth.html';
        ctaSecondaryBtn.textContent = 'Create Account';
      }
    }
  }
  
  // Update on Firebase auth change
  let authResolved = false;
  onAuthStateChanged(auth, () => {
    updateAuthNav();
    renderUsageBadge();
    renderVerifyBanner();
    if (!authResolved) {
      authResolved = true;
      if (authNavItem) authNavItem.style.visibility = 'visible';
    }
  });
  
  // Hide until first auth state resolves (avoids "Sign In" flash before "Logout")
  if (authNavItem) authNavItem.style.visibility = 'hidden';
  updateAuthNav();

  // ── Usage Badge — "reviews left today", shown only to signed-in users ────
  (function injectUsageBadge() {
    if (document.getElementById('usage-badge')) return;
    const navBrand = document.querySelector('.nav-brand');
    if (!navBrand) return;
    const badge = document.createElement('div');
    badge.id = 'usage-badge';
    badge.className = 'usage-badge';
    badge.innerHTML = `
      <span id="usage-badge-text" class="usage-badge-text">10/10 left</span>
      <div class="usage-badge-bar"><div id="usage-badge-fill" class="usage-badge-fill" style="width:100%;"></div></div>
    `;
    navBrand.insertAdjacentElement('afterend', badge);
  })();

  function updateUsageBadgeDisplay(count, limit) {
    const badge = document.getElementById('usage-badge');
    const text = document.getElementById('usage-badge-text');
    const fill = document.getElementById('usage-badge-fill');
    if (!badge || !text || !fill) return;
    const remaining = Math.max(limit - count, 0);
    const pct = limit > 0 ? Math.min((remaining / limit) * 100, 100) : 0;
    text.textContent = `${remaining}/${limit} left`;
    fill.style.width = pct + '%';
    badge.style.display = 'flex';
  }

  async function renderUsageBadge() {
    const badge = document.getElementById('usage-badge');
    if (!badge) return;

    // Only show for signed-in (non-anonymous) users — and avoid
    // triggering an anonymous Firebase sign-in just to render this badge.
    const user = auth.currentUser;
    if (!user || user.isAnonymous) {
      badge.style.display = 'none';
      return;
    }

    // Admins have unlimited reviews — show an "Unlimited" badge instead of hiding it
    if (isAdmin()) {
      const text = document.getElementById('usage-badge-text');
      const fill = document.getElementById('usage-badge-fill');
      if (text) text.textContent = '∞ Unlimited';
      if (fill) fill.style.width = '100%';
      badge.style.display = 'flex';
      return;
    }

    const usage = await getCurrentUsage();
    if (!usage || usage.admin || usage.guest || usage.limit == null) {
      badge.style.display = 'none';
      return;
    }

    updateUsageBadgeDisplay(usage.count, usage.limit);
  }

  renderUsageBadge();

  // ── Verify-Email Banner — nudges unverified signups to confirm their email ──
  function removeVerifyBanner() {
    const b = document.getElementById('verify-banner');
    if (b) b.remove();
  }

  function showVerifyBanner() {
    if (document.getElementById('verify-banner')) return;
    const nav = document.querySelector('.navbar');
    if (!nav) return;

    const banner = document.createElement('div');
    banner.id = 'verify-banner';
    banner.style.cssText = 'display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:0.75rem;padding:0.6rem 1rem;background:rgba(255,49,49,0.08);border-bottom:1px solid var(--card-border);font-family:var(--font-mono);font-size:0.75rem;color:var(--text-main);text-align:center;position:relative;z-index:90;';
    banner.innerHTML = `
      <span>Verify your email to unlock <strong>${FREE_LIMIT} reviews/day</strong> (currently limited to <strong>${GUEST_LIMIT}/day</strong>).</span>
      <button id="verify-resend-btn" class="btn-secondary" style="padding:0.3rem 0.7rem;border-radius:4px;font-size:0.7rem;cursor:pointer;">Resend Email</button>
      <button id="verify-refresh-btn" class="btn-secondary" style="padding:0.3rem 0.7rem;border-radius:4px;font-size:0.7rem;cursor:pointer;">I've Verified</button>
      <button id="verify-dismiss-btn" aria-label="Dismiss" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:1rem;line-height:1;padding:0 0.25rem;">&times;</button>
    `;
    nav.insertAdjacentElement('afterend', banner);

    document.getElementById('verify-resend-btn').addEventListener('click', async () => {
      const btn = document.getElementById('verify-resend-btn');
      try {
        await sendEmailVerification(auth.currentUser);
        btn.innerText = 'Sent!';
        setTimeout(() => { btn.innerText = 'Resend Email'; }, 4000);
      } catch (e) {
        btn.innerText = 'Try again later';
        setTimeout(() => { btn.innerText = 'Resend Email'; }, 4000);
      }
    });

    document.getElementById('verify-refresh-btn').addEventListener('click', async () => {
      const btn = document.getElementById('verify-refresh-btn');
      try {
        await auth.currentUser.reload();
        if (auth.currentUser.emailVerified) {
          removeVerifyBanner();
          renderUsageBadge();
        } else {
          btn.innerText = 'Not yet verified';
          setTimeout(() => { btn.innerText = "I've Verified"; }, 3000);
        }
      } catch (e) {}
    });

    document.getElementById('verify-dismiss-btn').addEventListener('click', () => {
      removeVerifyBanner();
      try { sessionStorage.setItem('verify_banner_dismissed', '1'); } catch (e) {}
    });
  }

  async function renderVerifyBanner() {
    const user = auth.currentUser;
    if (!user || user.isAnonymous || isAdmin() || user.emailVerified) {
      removeVerifyBanner();
      return;
    }
    try {
      if (sessionStorage.getItem('verify_banner_dismissed') === '1') return;
    } catch (e) {}
    showVerifyBanner();
  }

  renderVerifyBanner();

  // ── Auth Page Logic ───────────────────────────────────────────────────
  const loginForm = document.getElementById('login-form');
  const signupForm = document.getElementById('signup-form');
  const tabLogin = document.getElementById('tab-login');
  const tabSignup = document.getElementById('tab-signup');

  // GitHub login from auth page (works for both login and signup forms)
  const setupGithubAuthButton = () => {
    const githubBtns = document.querySelectorAll('.github-login-btn-auth');
    githubBtns.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
          const response = await fetch('/api/github/oauth-url');
          const data = await response.json();
          
          if (data.error) {
            alert('GitHub OAuth not configured: ' + data.error);
            return;
          }

          const width = 500, height = 600;
          const left = window.screenX + (window.outerWidth - width) / 2;
          const top = window.screenY + (window.outerHeight - height) / 2;
          
          const popup = window.open(
            data.authUrl,
            'github_auth',
            `width=${width},height=${height},left=${left},top=${top}`
          );

          const pollInterval = setInterval(() => {
            if (popup.closed) {
              clearInterval(pollInterval);
              const sessionId = localStorage.getItem('github_session_id');
              if (sessionId) {
                window.location.href = '/tool.html';
              }
            }
          }, 500);
        } catch (error) {
          console.error('GitHub login error:', error);
          alert('Failed to initiate GitHub login');
        }
      });
    });
  };
  
  setupGithubAuthButton();

  if (tabLogin && tabSignup) {
    tabLogin.addEventListener('click', () => {
      tabLogin.classList.add('active'); tabLogin.style.color='var(--accent-white)'; tabLogin.style.borderBottomColor='var(--accent-red)';
      tabSignup.classList.remove('active'); tabSignup.style.color='var(--text-muted)'; tabSignup.style.borderBottomColor='transparent';
      loginForm.style.display='block'; signupForm.style.display='none';
      document.getElementById('login-error').style.display='none';
    });
    tabSignup.addEventListener('click', () => {
      tabSignup.classList.add('active'); tabSignup.style.color='var(--accent-white)'; tabSignup.style.borderBottomColor='var(--accent-red)';
      tabLogin.classList.remove('active'); tabLogin.style.color='var(--text-muted)'; tabLogin.style.borderBottomColor='transparent';
      signupForm.style.display='block'; loginForm.style.display='none';
      document.getElementById('signup-error').style.display='none';
    });
  }

  if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('signup-name').value.trim();
      const email = document.getElementById('signup-email').value.trim();
      const password = document.getElementById('signup-password').value;
      const errEl = document.getElementById('signup-error');
      const submitBtn = signupForm.querySelector('button[type="submit"]');
      const orig = submitBtn.innerText;
      submitBtn.innerText = 'Initializing...'; submitBtn.disabled = true;
      try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName: name });
        try { await sendEmailVerification(cred.user); } catch (verifyErr) { console.warn('Verification email error:', verifyErr); }
        window.location.href = '/tool.html';
      } catch (error) {
        errEl.innerText = friendlyAuthError(error); errEl.style.display = 'block';
        submitBtn.innerText = orig; submitBtn.disabled = false;
      }
    });
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      const errEl = document.getElementById('login-error');
      const submitBtn = loginForm.querySelector('button[type="submit"]');
      const orig = submitBtn.innerText;
      submitBtn.innerText = 'Authenticating...'; submitBtn.disabled = true;
      try {
        await signInWithEmailAndPassword(auth, email, password);
        window.location.href = '/tool.html';
      } catch (error) {
        errEl.innerText = friendlyAuthError(error); errEl.style.display = 'block';
        submitBtn.innerText = orig; submitBtn.disabled = false;
      }
    });
  }

  // ── Forgot Password ──────────────────────────────────────────────────
  const forgotLink = document.getElementById('forgot-password-link');
  const resetModal = document.getElementById('reset-modal');
  const resetForm = document.getElementById('reset-form');
  const resetCancel = document.getElementById('reset-cancel');
  const resetEmailInput = document.getElementById('reset-email');
  const resetMessage = document.getElementById('reset-message');

  if (forgotLink && resetModal) {
    forgotLink.addEventListener('click', () => {
      const loginEmail = document.getElementById('login-email')?.value.trim();
      if (loginEmail) resetEmailInput.value = loginEmail;
      resetMessage.style.display = 'none';
      resetModal.style.display = 'flex';
    });

    resetCancel.addEventListener('click', () => {
      resetModal.style.display = 'none';
      resetForm.reset();
      resetMessage.style.display = 'none';
    });

    resetModal.addEventListener('click', (e) => {
      if (e.target === resetModal) {
        resetModal.style.display = 'none';
        resetForm.reset();
        resetMessage.style.display = 'none';
      }
    });

    resetForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = resetEmailInput.value.trim();
      const submitBtn = document.getElementById('reset-submit');
      const orig = submitBtn.innerText;
      submitBtn.innerText = 'Sending...'; submitBtn.disabled = true;
      try {
        await sendPasswordResetEmail(auth, email);
        resetMessage.style.color = '#4ade80';
        resetMessage.innerText = `Reset link sent! Check ${email} for instructions.`;
        resetMessage.style.display = 'block';
        submitBtn.innerText = 'Sent ✓';
        setTimeout(() => {
          resetModal.style.display = 'none';
          resetForm.reset();
          resetMessage.style.display = 'none';
          submitBtn.innerText = orig; submitBtn.disabled = false;
        }, 2500);
      } catch (error) {
        resetMessage.style.color = 'var(--accent-red)';
        resetMessage.innerText = friendlyAuthError(error);
        resetMessage.style.display = 'block';
        submitBtn.innerText = orig; submitBtn.disabled = false;
      }
    });
  }

  // ── Navbar Active / Mobile ────────────────────────────────────────────
  const currentPath = window.location.pathname;
  document.querySelectorAll('.nav-links a').forEach(link => {
    if (link.getAttribute('href') === currentPath || (currentPath === '/' && link.getAttribute('href') === '/index.html'))
      link.classList.add('active');
  });
  const menuToggle = document.querySelector('.menu-toggle');
  const navLinksContainer = document.querySelector('.nav-links');
  if (menuToggle) menuToggle.addEventListener('click', () => navLinksContainer.classList.toggle('show'));

  // ── Mobile: Features mega-menu toggle ────────────────────────────────
  const navFeaturesItem = document.querySelector('.nav-features-item');
  const navFeaturesTrigger = document.querySelector('.nav-features-trigger');
  if (navFeaturesTrigger && navFeaturesItem) {
    navFeaturesTrigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      navFeaturesItem.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (!navFeaturesItem.contains(e.target)) navFeaturesItem.classList.remove('open');
    });
  }

  // ── Scroll Fade-in ────────────────────────────────────────────────────
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => { if (entry.isIntersecting) entry.target.classList.add('visible'); });
  }, { threshold: 0.1 });
  document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));

  // ── Timeline animation ────────────────────────────────────────────────
  const timelineLine = document.querySelector('.timeline-line');
  if (timelineLine) {
    const timeline = document.querySelector('.timeline');
    window.addEventListener('scroll', () => {
      const rect = timeline.getBoundingClientRect();
      const viewportMid = window.innerHeight / 2;
      if (rect.top < viewportMid && rect.bottom > 0) {
        const progress = (viewportMid - rect.top) / rect.height;
        timelineLine.style.height = `${Math.max(0, Math.min(100, progress * 100))}%`;
      }
    });
  }

  // ── Counter Animation ─────────────────────────────────────────────────
  const stats = document.querySelectorAll('.counter');
  if (stats.length > 0) {
    const counterObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !entry.target.classList.contains('counted')) {
          entry.target.classList.add('counted');
          const target = +entry.target.dataset.target;
          const start = performance.now();
          const formatNumber = (num, original) => {
            if (original.includes('.')) return num.toFixed(1);
            if (original.includes('+')) return Math.floor(num) + '+';
            return Math.floor(num).toLocaleString();
          };
          const animate = (time) => {
            const progress = Math.min((time - start) / 2000, 1);
            const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
            entry.target.innerText = formatNumber(eased * target, entry.target.innerText);
            if (progress < 1) requestAnimationFrame(animate);
            else entry.target.innerText = entry.target.dataset.targetText;
          };
          requestAnimationFrame(animate);
        }
      });
    }, { threshold: 0.5 });
    stats.forEach(stat => counterObserver.observe(stat));
  }

  // ── Tool Page ─────────────────────────────────────────────────────────
  const codeArea = document.getElementById('code-input');
  if (!codeArea) return;

  const linesElem = document.getElementById('line-numbers');
  const runBtn = document.getElementById('run-btn');
  const clearBtn = document.getElementById('clear-btn');
  const outputContent = document.getElementById('output-content');
  const shareBtn = document.getElementById('share-btn');
  const exportBtn = document.getElementById('export-btn');
  const diffToggleBtn = document.getElementById('diff-toggle-btn');
  const outputTitle = document.getElementById('output-title');
  const modeAutopsyBtn = null;
  const modeExplainBtn = null;

  // ── Read mode from URL param ──────────────────────────────────────────
  const urlParams = new URLSearchParams(window.location.search);
  const urlMode = urlParams.get('mode') || 'autopsy';
  let currentMode = urlMode; // 'autopsy' | 'explain' | 'smell'

  // Set initial button text and output title based on mode
  if (runBtn) {
    if (currentMode === 'explain') runBtn.innerText = 'Explain Code';
    else if (currentMode === 'smell') runBtn.innerText = 'Detect Smells';
    else runBtn.innerText = 'Run Autopsy';
  }
  if (outputTitle) {
    if (currentMode === 'explain') outputTitle.innerText = 'Code Explanation';
    else if (currentMode === 'smell') outputTitle.innerText = 'Smell Report';
    else outputTitle.innerText = 'Diagnostic Output';
  }

  // ── Quota info popup — shown whenever a feature page loads ────────────
  (async function showQuotaModal() {
    const modal = document.getElementById('quota-modal');
    const body = document.getElementById('quota-modal-body');
    const closeBtn = document.getElementById('quota-modal-close');
    if (!modal || !body) return;

    // Wait for Firebase to restore the real session before checking usage —
    // otherwise we'd briefly see "no user" and trigger an anonymous sign-in,
    // which can interfere with a just-completed real sign-in.
    await authReady;

    const usage = await getCurrentUsage();
    if (!usage || usage.admin) return; // don't show for admins or on error

    const remaining = Math.max(usage.limit - usage.count, 0);

    if (usage.guest) {
      body.innerHTML = `You're using CodeAutopsy as a guest — <strong>${usage.limit} free reviews per day</strong>. <a href="/auth.html" style="color:var(--accent-red);text-decoration:underline;">Sign in</a> to get <strong>${FREE_LIMIT} reviews per day</strong> and access your review history.`;
    } else {
      const pct = Math.min((usage.count / usage.limit) * 100, 100);
      const verifyNote = (usage.verified === false)
        ? `<div style="margin-top:0.75rem;font-size:0.75rem;color:var(--text-muted);">Verify your email to raise this limit to <strong>${FREE_LIMIT} reviews/day</strong>.</div>`
        : '';
      body.innerHTML = `
        <div style="margin-bottom:0.75rem;">You have <strong>${remaining} of ${usage.limit}</strong> code reviews remaining today. Resets daily at <strong>2:45 PM IST</strong>.</div>
        <div style="width:100%;height:6px;background:var(--card-border);border-radius:3px;overflow:hidden;">
          <div style="width:${pct}%;height:100%;background:var(--accent-red);border-radius:3px;transition:width 0.3s ease;"></div>
        </div>
        ${verifyNote}`;
    }

    modal.style.display = 'flex';
    const close = () => { modal.style.display = 'none'; };
    if (closeBtn) closeBtn.addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  })();

  // ── Re-run from history: paste code + language before anything else ──
  const unsubRerun = onAuthStateChanged(auth, () => {
    unsubRerun();
    (async function applyRerun() {
      try {
        const rerunId = new URLSearchParams(window.location.search).get('rerun');
        if (!rerunId) return;
        let history = [];
        const user = auth.currentUser;
        if (user) {
          const snap = await getDoc(doc(db, 'history', user.uid));
          history = snap.exists() ? (snap.data().entries || []) : [];
        } else {
          history = JSON.parse(localStorage.getItem('autopsy_history') || '[]');
        }
        const entry = history.find(h => String(h.id) === rerunId);
        if (entry && entry.code) {
          codeArea.value = entry.code;
          codeArea.dispatchEvent(new Event('input'));
          if (entry.language) {
            const sel = document.getElementById('language-select');
            if (sel && [...sel.options].find(o => o.value === entry.language)) sel.value = entry.language;
          }
          const url = new URL(window.location);
          url.searchParams.delete('rerun');
          window.history.replaceState({}, '', url);
        }
      } catch (e) { console.error('Rerun error:', e); }
    })();
  });

  // GitHub OAuth elements
  const importGithubBtn = document.getElementById('import-github-btn');
  
  // Early exit if not on tool page
  if (!importGithubBtn) return;
  
  const githubModal = document.getElementById('github-modal');
  const githubModalClose = document.getElementById('github-modal-close');
  const githubModalCancel = document.getElementById('github-modal-cancel');
  const githubLoginBtn = document.getElementById('github-login-btn');
  const githubAuthSection = document.getElementById('github-auth-section');
  const githubReposSection = document.getElementById('github-repos-section');
  const githubFilesSection = document.getElementById('github-files-section');
  const githubLoading = document.getElementById('github-loading');
  const githubError = document.getElementById('github-error');
  const githubRepoSearch = document.getElementById('github-repo-search');
  const githubReposList = document.getElementById('github-repos-list');
  const githubFilesList = document.getElementById('github-files-list');
  const githubBackBtn = document.getElementById('github-back-btn');
  const githubCurrentPathElem = document.getElementById('github-current-path');

  // ── Update mode indicator bar ────────────────────────────────────────
  const modeIndicatorText = document.getElementById('mode-indicator-text');
  const modeIndicatorIcon = document.getElementById('mode-indicator-icon');
  const modeIndicator = document.getElementById('mode-indicator');

  function updateModeIndicator() {
    if (!modeIndicatorText) return;
    if (currentMode === 'explain') {
      modeIndicatorText.innerText = 'Code Explainer';
      modeIndicator.style.background = 'rgba(0,170,255,0.06)';
      modeIndicator.style.color = '#00aaff';
      modeIndicatorIcon.innerHTML = '<path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke-linecap="round" stroke-linejoin="round"/>';
      modeIndicator.style.borderBottomColor = 'rgba(0,170,255,0.2)';
    } else if (currentMode === 'smell') {
      modeIndicatorText.innerText = 'Code Smell';
      modeIndicator.style.background = 'rgba(255,165,0,0.06)';
      modeIndicator.style.color = '#ffa500';
      modeIndicatorIcon.innerHTML = '<path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" stroke-linecap="round" stroke-linejoin="round"/>';
      modeIndicator.style.borderBottomColor = 'rgba(255,165,0,0.2)';
    } else if (currentMode === 'pr') {
      modeIndicatorText.innerText = 'PR Review';
      modeIndicator.style.background = 'rgba(139,92,246,0.06)';
      modeIndicator.style.color = '#8b5cf6';
      modeIndicatorIcon.innerHTML = '<path d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" stroke-linecap="round" stroke-linejoin="round"/>';
      modeIndicator.style.borderBottomColor = 'rgba(139,92,246,0.2)';
    } else {
      modeIndicatorText.innerText = 'Code Autopsy';
      modeIndicator.style.background = 'rgba(255,49,49,0.06)';
      modeIndicator.style.color = 'var(--accent-red)';
      modeIndicatorIcon.innerHTML = '<path d="M12 2C8.686 2 6 4.418 6 7.4c0 1.942 1.114 3.652 2.766 4.67l-2.029 4.618a1 1 0 0 0 .916 1.403h8.694a1 1 0 0 0 .916-1.403l-2.029-4.618C16.886 11.052 18 9.342 18 7.4 18 4.418 15.314 2 12 2z" stroke-linecap="round"/>';
      modeIndicator.style.borderBottomColor = 'rgba(255,49,49,0.15)';
    }
  }
  updateModeIndicator();

  // ── PR Mode: show/hide correct panels ────────────────────────────────
  const prInputPanel = document.getElementById('pr-input-panel');
  const codeAreaDiv = document.querySelector('.code-area');
  const panelHeaderDiv = document.querySelector('.panel-header');

  if (currentMode === 'pr') {
    if (prInputPanel) prInputPanel.style.display = 'flex';
    const dz = document.getElementById('drop-zone');
    if (dz) dz.style.display = 'none';
    if (codeAreaDiv) codeAreaDiv.style.display = 'none';
    if (panelHeaderDiv) panelHeaderDiv.style.display = 'none';
    if (runBtn) runBtn.innerText = 'Review PR';
    if (outputTitle) outputTitle.innerText = 'PR Review';
    // Hide login notice by default — only shown on private repo error
    const prLoginNotice = document.getElementById('pr-login-notice');
    if (prLoginNotice) prLoginNotice.style.display = 'none';

    // Hide example URLs when user starts typing
    const prUrlInput = document.getElementById('pr-url-input');
    const prExamplesBox = document.getElementById('pr-examples-box');
    if (prUrlInput && prExamplesBox) {
      prUrlInput.addEventListener('input', () => {
        prExamplesBox.style.display = prUrlInput.value.trim() ? 'none' : 'block';
      });
    }
  }

  let githubSessionId = null;
  let githubCurrentRepo = null;
  let githubCurrentPath = '';
  let githubAllRepos = [];

  // ── GitHub OAuth Modal ─────────────────────────────────────────────────

  importGithubBtn.addEventListener('click', () => {
    githubModal.style.display = 'flex';
    // Check if already logged in
    githubSessionId = localStorage.getItem('github_session_id');
    if (githubSessionId) {
      showGithubRepos();
    } else {
      showGithubAuth();
    }
  });

  githubModalClose.addEventListener('click', closeGithubModal);
  githubModalCancel.addEventListener('click', closeGithubModal);

  function closeGithubModal() {
    githubModal.style.display = 'none';
  }

  githubModal.addEventListener('click', (e) => {
    if (e.target === githubModal) closeGithubModal();
  });

  function showGithubAuth() {
    githubAuthSection.style.display = 'flex';
    githubReposSection.style.display = 'none';
    githubFilesSection.style.display = 'none';
    githubLoading.style.display = 'none';
    githubError.style.display = 'none';
  }

  function showGithubRepos() {
    githubAuthSection.style.display = 'none';
    githubReposSection.style.display = 'block';
    githubFilesSection.style.display = 'none';
    githubLoading.style.display = 'none';
    githubError.style.display = 'none';
    loadGithubRepos();
  }

  function showGithubError(message) {
    githubLoading.style.display = 'none';
    githubError.style.display = 'block';
    githubError.innerText = message;
  }

  function showGithubLoading() {
    githubLoading.style.display = 'block';
    githubError.style.display = 'none';
  }

  // GitHub Login
  githubLoginBtn.addEventListener('click', async () => {
    try {
      showGithubLoading();
      const response = await fetch('/api/github/oauth-url');
      const data = await response.json();
      
      if (data.error) {
        showGithubError(data.error);
        return;
      }

      // Open GitHub OAuth URL in popup
      const width = 500, height = 600;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      
      const popup = window.open(
        data.authUrl,
        'github_auth',
        `width=${width},height=${height},left=${left},top=${top}`
      );

      // Poll for auth completion
      const pollInterval = setInterval(async () => {
        if (popup.closed) {
          clearInterval(pollInterval);
          // Check if we got a session
          const sessionId = localStorage.getItem('github_session_id');
          if (sessionId) {
            githubSessionId = sessionId;
            showGithubRepos();
          } else {
            showGithubAuth();
          }
        }
      }, 500);
    } catch (error) {
      console.error('GitHub login error:', error);
      showGithubError('Failed to initiate GitHub login.');
    }
  });

  // Load repos
  async function loadGithubRepos() {
    try {
      showGithubLoading();
      const response = await fetch('/api/github/repos', {
        headers: { 'x-github-session': githubSessionId },
      });

      if (!response.ok) {
        if (response.status === 401) {
          localStorage.removeItem('github_session_id');
          githubSessionId = null;
          showGithubAuth();
          return;
        }
        throw new Error('Failed to fetch repos');
      }

      githubAllRepos = await response.json();
      renderGithubRepos(githubAllRepos);
      githubReposSection.style.display = 'block';
      githubLoading.style.display = 'none';
    } catch (error) {
      console.error('Load repos error:', error);
      showGithubError('Failed to load repositories.');
    }
  }

  function renderGithubRepos(repos) {
    githubReposList.innerHTML = repos.map(repo => `
      <div style="padding:0.75rem;border-bottom:1px solid var(--card-border);cursor:pointer;transition:background 0.2s;" 
           onmouseover="this.style.background='var(--card-hover)'" 
           onmouseout="this.style.background='transparent'"
           onclick="window.selectGithubRepo('${repo.owner.login}', '${repo.name}')">
        <div style="font-family:var(--font-mono);font-size:0.85rem;color:var(--accent-white);">${repo.name}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.25rem;">${repo.description || 'No description'}</div>
      </div>
    `).join('');
  }

  // Search repos
  githubRepoSearch.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    const filtered = githubAllRepos.filter(r => r.name.toLowerCase().includes(query));
    renderGithubRepos(filtered);
  });

  window.selectGithubRepo = async (owner, repo) => {
    githubCurrentRepo = { owner, repo };
    githubCurrentPath = '';
    await browsePath('');
  };

  // Browse files
  async function browsePath(path) {
    try {
      showGithubLoading();
      const response = await fetch('/api/github/browse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-github-session': githubSessionId,
        },
        body: JSON.stringify({
          owner: githubCurrentRepo.owner,
          repo: githubCurrentRepo.repo,
          path,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to browse');
      }

      const items = await response.json();
      githubCurrentPath = path;
      renderGithubFiles(items, path);
      githubReposSection.style.display = 'none';
      githubFilesSection.style.display = 'block';
      githubLoading.style.display = 'none';
      githubCurrentPathElem.innerText = (path ? path + '/' : 'root') + '/';
    } catch (error) {
      console.error('Browse path error:', error);
      showGithubError('Failed to browse directory.');
    }
  }

  function renderGithubFiles(items, path) {
    // Sort: directories first, then files
    const sorted = items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    githubFilesList.innerHTML = sorted.map(item => {
      const icon = item.type === 'dir' ? '📁' : '📄';
      const onclick = item.type === 'dir'
        ? `window.browsePath('${item.path}')`
        : `window.loadGithubFile('${githubCurrentRepo.owner}', '${githubCurrentRepo.repo}', '${item.path}')`;
      
      return `
        <div style="padding:0.75rem;border-bottom:1px solid var(--card-border);cursor:pointer;transition:background 0.2s;" 
             onmouseover="this.style.background='var(--card-hover)'" 
             onmouseout="this.style.background='transparent'"
             onclick="${onclick}">
          <div style="display:flex;align-items:center;gap:0.5rem;">
            <span style="font-size:1rem;">${icon}</span>
            <span style="font-family:var(--font-mono);font-size:0.85rem;color:var(--accent-white);">${item.name}</span>
            ${item.type === 'file' && item.size ? `<span style="font-size:0.7rem;color:var(--text-muted);margin-left:auto;">${(item.size / 1024).toFixed(1)}KB</span>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  githubBackBtn.addEventListener('click', () => {
    if (githubCurrentPath === '') {
      githubFilesSection.style.display = 'none';
      githubReposSection.style.display = 'block';
    } else {
      const parts = githubCurrentPath.split('/').filter(p => p);
      parts.pop();
      browsePath(parts.join('/'));
    }
  });

  window.browsePath = browsePath;

  window.loadGithubFile = async (owner, repo, filePath) => {
    try {
      showGithubLoading();
      const response = await fetch('/api/github/file', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-github-session': githubSessionId,
        },
        body: JSON.stringify({ owner, repo, path: filePath }),
      });

      if (!response.ok) {
        throw new Error('Failed to load file');
      }

      const data = await response.json();
      const content = data.content;

      // Determine language from file extension
      const ext = filePath.split('.').pop().toLowerCase();
      const langMap = {
        js: 'javascript', html:'html', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
        py: 'python', java: 'java', go: 'go', rs: 'rust',
        c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
        html: 'html', css: 'css', php: 'php', rb: 'ruby',
        swift: 'swift', kt: 'kotlin', cs: 'csharp'
      };

      const language = langMap[ext] || 'javascript';
      document.getElementById('language-select').value = language;

      codeArea.value = content;
      updateLineNumbers();
      closeGithubModal();
      showToast(`Loaded ${filePath}`);
      githubLoading.style.display = 'none';
    } catch (error) {
      console.error('Load file error:', error);
      showGithubError('Failed to load file.');
    }
  };

  // ── Mode Toggle removed — mode set via URL param from Features menu ──

  function resetOutput() {
    outputContent.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-illustration">
          <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="60" cy="60" r="50" stroke="rgba(255,49,49,0.15)" stroke-width="1" stroke-dasharray="4 4"/>
            <circle cx="60" cy="60" r="35" stroke="rgba(255,49,49,0.1)" stroke-width="1"/>
            <path d="M40 60 C40 48 48 40 60 40 C72 40 80 48 80 60" stroke="rgba(255,49,49,0.3)" stroke-width="1.5" stroke-linecap="round"/>
            <circle cx="60" cy="60" r="4" fill="rgba(255,49,49,0.2)" stroke="rgba(255,49,49,0.4)" stroke-width="1"/>
            <path d="M60 56 L60 44" stroke="rgba(255,49,49,0.3)" stroke-width="1" stroke-dasharray="2 2"/>
            <path d="M45 75 L75 75" stroke="rgba(255,49,49,0.15)" stroke-width="1"/>
            <path d="M50 80 L70 80" stroke="rgba(255,49,49,0.1)" stroke-width="1"/>
          </svg>
        </div>
        <p style="font-family:var(--font-mono);font-size:0.85rem;margin-top:0.5rem;">Awaiting ${currentMode === 'autopsy' ? 'diagnosis' : currentMode === 'smell' ? 'smell report' : 'explanation'}...</p>
      </div>`;
    [shareBtn, exportBtn, diffToggleBtn].forEach(b => b && (b.style.display = 'none'));
  }

  // ── File Upload ───────────────────────────────────────────────────────
  const LANG_MAP = {
    js:'javascript',jsx:'javascript',ts:'typescript',tsx:'typescript',
    py:'python',java:'java',go:'go',rs:'rust',
    c:'c',cpp:'cpp',h:'c',hpp:'cpp',
    html:'html',css:'css',php:'php',rb:'ruby',swift:'swift',kt:'kotlin',cs:'csharp'
  };

  function loadFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const reader = new FileReader();
    reader.onload = (e) => {
      codeArea.value = e.target.result;
      updateLineNumbers();
      const detected = LANG_MAP[ext];
      if (detected) {
        const sel = document.getElementById('language-select');
        if ([...sel.options].find(o => o.value === detected)) sel.value = detected;
      }
    };
    reader.readAsText(file);
  }

  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.classList.remove('drag-over'); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) loadFile(fileInput.files[0]); });

  // ── Language Auto-detect on paste ─────────────────────────────────────
  function detectLanguage(code) {
    const scores = {};
    function score(lang, pts) { scores[lang] = (scores[lang] || 0) + pts; }

    // HTML
    if (/<!DOCTYPE\s+html/i.test(code))        score('html', 10);
    if (/<html[\s>]/i.test(code))              score('html', 8);
    if (/<\/(div|span|p|a|ul|li|head|body|section|header|footer|nav|main)>/i.test(code)) score('html', 6);
    if (/<(div|span|p|img|input|button|form|table|tr|td|th)\s/i.test(code)) score('html', 5);
    if (/class="[^"]*"|id="[^"]*"/.test(code)) score('html', 3);
    if (/<meta\s|<link\s|<script[\s>]|<style[\s>]/.test(code)) score('html', 4);

    // CSS
    if (/[a-z-]+\s*:\s*[^;{]+;/.test(code) && /[.#]?\w+\s*\{/.test(code)) score('css', 5);
    if (/@media\s*\(|@keyframes\s+\w+/.test(code)) score('css', 6);
    if (/display\s*:\s*(flex|grid|block)|margin\s*:|padding\s*:/.test(code)) score('css', 4);

    // C / C++
    if (/#include\s*</.test(code))           { score('c', 3); score('cpp', 3); }
    if (/cout\s*<<|cin\s*>>/.test(code))      score('cpp', 5);
    if (/std::|::\w+|new\s+\w+\s*\(/.test(code)) score('cpp', 3);
    if (/class\s+\w+\s*(\{|:)/.test(code) && /#include/.test(code)) score('cpp', 4);
    if (/printf\s*\(|scanf\s*\(|malloc\s*\(/.test(code)) score('c', 4);
    if (/void\s+\w+\s*\(|int\s+main\s*\(/.test(code) && /#include/.test(code)) score('c', 3);

    // Java
    if (/public\s+(static\s+)?void\s+main/.test(code)) score('java', 6);
    if (/System\.(out|in|err)\./.test(code))  score('java', 5);
    if (/import\s+java\.|import\s+javax\./.test(code)) score('java', 6);
    if (/@Override|@Annotation|@interface/.test(code)) score('java', 4);
    if (/public\s+class\s+\w+/.test(code))    score('java', 4);
    if (/ArrayList|HashMap|LinkedList/.test(code)) score('java', 3);

    // Python
    if (/def\s+\w+\s*\(/.test(code))         score('python', 5);
    if (/print\s*\(/.test(code))              score('python', 3);
    if (/import\s+\w+|from\s+\w+\s+import/.test(code) && !/require|from\s+['"]/.test(code)) score('python', 3);
    if (/:\s*\n\s+(if|for|while|return|pass)/.test(code)) score('python', 4);
    if (/__init__|__main__|__name__/.test(code)) score('python', 5);
    if (/elif\s+|lambda\s+\w+/.test(code))    score('python', 4);
    if (/self\.\w+/.test(code))               score('python', 4);

    // JavaScript
    if (/const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=/.test(code)) score('javascript', 3);
    if (/=>\s*(\{|[^{])/.test(code))          score('javascript', 3);
    if (/console\.(log|error|warn)/.test(code)) score('javascript', 4);
    if (/document\.|window\.|addEventListener/.test(code)) score('javascript', 5);
    if (/require\s*\(|module\.exports/.test(code)) score('javascript', 5);
    if (/\.then\s*\(|\.catch\s*\(|async\s+function|await\s+/.test(code)) score('javascript', 3);
    if (/import\s+\w+\s+from\s+['"]/.test(code)) score('javascript', 3);

    // TypeScript
    if (/:\s*(string|number|boolean|any|void|never|unknown)\b/.test(code)) score('typescript', 5);
    if (/interface\s+\w+|type\s+\w+\s*=/.test(code)) score('typescript', 5);
    if (/<\w+(\[\])?>\s*[({]/.test(code))     score('typescript', 4);
    if (/as\s+\w+|keyof\s+\w+|Partial<|Record</.test(code)) score('typescript', 5);
    if (/:\s*\w+\[\]|Array<\w+>/.test(code))  score('typescript', 3);

    // Go
    if (/^package\s+\w+/m.test(code))         score('go', 6);
    if (/func\s+\w+\s*\(/.test(code) && /^package/.test(code)) score('go', 5);
    if (/fmt\.(Print|Println|Sprintf)/.test(code)) score('go', 5);
    if (/:=\s*/.test(code))                   score('go', 4);
    if (/import\s+\([\s\S]*?\)/.test(code))   score('go', 3);
    if (/goroutine|go\s+func|chan\s+/.test(code)) score('go', 5);

    // Rust
    if (/fn\s+main\s*\(\s*\)/.test(code))     score('rust', 6);
    if (/let\s+(mut\s+)?\w+\s*[:=]/.test(code) && /fn\s+/.test(code)) score('rust', 4);
    if (/println!\s*\(|print!\s*\(/.test(code)) score('rust', 5);
    if (/use\s+std::|impl\s+\w+/.test(code))  score('rust', 5);
    if (/match\s+\w+\s*\{|Some\(|None|Ok\(|Err\(/.test(code)) score('rust', 4);
    if (/->\s*\w+\s*\{|&mut\s+|&str\b/.test(code)) score('rust', 4);

    // PHP
    if (/<\?php/.test(code))                  score('php', 8);
    if (/\$\w+\s*=/.test(code))               score('php', 4);
    if (/echo\s+["']|echo\s+\$/.test(code))   score('php', 4);
    if (/->/.test(code) && /\$this/.test(code)) score('php', 4);

    // Ruby
    if (/def\s+\w+\n|end\s*$/.test(code))     score('ruby', 5);
    if (/puts\s+|p\s+["']/.test(code))        score('ruby', 4);
    if (/\.each\s+do|\.map\s*\{/.test(code))  score('ruby', 4);
    if (/attr_accessor|require_relative/.test(code)) score('ruby', 5);

    // Swift
    if (/func\s+\w+.*->/.test(code) && /var\s+\w+\s*:/.test(code)) score('swift', 5);
    if (/let\s+\w+\s*:\s*\w+/.test(code) && /import\s+Foundation|import\s+UIKit/.test(code)) score('swift', 6);
    if (/print\s*\(.*\)/.test(code) && /var\s+\w+\s*=/.test(code) && /import/.test(code)) score('swift', 3);
    if (/guard\s+let|if\s+let\s+\w+/.test(code)) score('swift', 5);

    // C#
    if (/using\s+System/.test(code))          score('csharp', 5);
    if (/Console\.(Write|Read|WriteLine)/.test(code)) score('csharp', 5);
    if (/namespace\s+\w+/.test(code))         score('csharp', 5);
    if (/static\s+void\s+Main/.test(code))    score('csharp', 6);
    if (/List<\w+>|Dictionary</.test(code) && /using/.test(code)) score('csharp', 4);

    // Kotlin
    if (/fun\s+main\s*\(/.test(code))         score('kotlin', 6);
    if (/println\s*\(/.test(code) && /fun\s+/.test(code)) score('kotlin', 5);
    if (/val\s+\w+\s*=|var\s+\w+\s*:/.test(code) && /fun\s+/.test(code)) score('kotlin', 4);
    if (/data\s+class\s+\w+/.test(code))      score('kotlin', 5);

    // if typescript scored, boost it over javascript
    if ((scores['typescript'] || 0) > 0) {
      scores['javascript'] = (scores['javascript'] || 0) - 2;
    }
    // if cpp scored, reduce c
    if ((scores['cpp'] || 0) > (scores['c'] || 0)) {
      scores['c'] = 0;
    }

    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    return best && best[1] > 0 ? best[0] : null;
  }

  codeArea.addEventListener('paste', (e) => {
    setTimeout(() => {
      const code = codeArea.value;
      const sel = document.getElementById('language-select');
      const detected = detectLanguage(code);
      if (detected && [...sel.options].find(o => o.value === detected)) {
        sel.value = detected;
      }
    }, 50);
  });

  // ── Load shared result from URL ───────────────────────────────────────
  (function loadSharedResult() {
    try {
      const params = new URLSearchParams(window.location.search);
      const encoded = params.get('share');
      if (!encoded) return;
      const payload = JSON.parse(decodeURIComponent(atob(encoded)));
      if (payload.code) { codeArea.value = payload.code; updateLineNumbers(); }
      if (payload.language) document.getElementById('language-select').value = payload.language;
      if (payload.result) setTimeout(() => { renderAutopsy(payload.result); [shareBtn, exportBtn, diffToggleBtn].forEach(b => b && (b.style.display = 'inline-block')); }, 200);
    } catch(e) { console.error("saveToHistory error:", e); }
  })();

  // ── Toast ─────────────────────────────────────────────────────────────
  function showToast(msg) {
    let toast = document.getElementById('share-toast');
    if (!toast) { toast = document.createElement('div'); toast.id = 'share-toast'; toast.className = 'share-toast'; document.body.appendChild(toast); }
    toast.innerText = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
  }

  // ── Line Numbers ──────────────────────────────────────────────────────
  const updateLineNumbers = () => {
    const lines = codeArea.value.split('\n').length;
    linesElem.innerHTML = Array.from({length: Math.max(10, lines)}, (_, i) => `<div>${i + 1}</div>`).join('');
  };
  codeArea.addEventListener('input', updateLineNumbers);
  codeArea.addEventListener('scroll', () => { linesElem.scrollTop = codeArea.scrollTop; });
  updateLineNumbers();

  clearBtn.addEventListener('click', () => { codeArea.value = ''; updateLineNumbers(); });

  // ── Navbar progress bar (shown during a run) ──────────────────────────
  let navProgressInterval = null;
  function startNavProgress() {
    const container = document.getElementById('run-progress-container');
    const bar = document.getElementById('run-progress-bar');
    const text = document.getElementById('run-progress-text');
    if (!container || !bar || !text) return;

    container.style.display = 'flex';
    let pct = 0;
    bar.style.width = '0%';
    text.innerText = '0%';

    clearInterval(navProgressInterval);
    navProgressInterval = setInterval(() => {
      if (pct < 90) {
        pct += Math.max(0.5, (90 - pct) * 0.04);
        bar.style.width = pct.toFixed(0) + '%';
        text.innerText = pct.toFixed(0) + '%';
      }
    }, 200);
  }

  function finishNavProgress() {
    const container = document.getElementById('run-progress-container');
    const bar = document.getElementById('run-progress-bar');
    const text = document.getElementById('run-progress-text');
    clearInterval(navProgressInterval);
    if (!container || !bar || !text) return;

    bar.style.width = '100%';
    text.innerText = '100%';
    setTimeout(() => {
      container.style.display = 'none';
      bar.style.width = '0%';
      text.innerText = '0%';
    }, 500);
  }

  // ── Run Button ────────────────────────────────────────────────────────
  runBtn.addEventListener('click', async () => {
    // ── Usage limit check ──────────────────────────────────────────────
    const usage = await checkAndIncrementUsage();
    if (!usage.allowed) {
      const isGuest = usage.guest;
      const limitMsg = isGuest
        ? 'You\'ve used all ' + usage.limit + ' guest runs. Create a free account to get ' + FREE_LIMIT + ' reviews every day.'
        : 'You\'ve used all ' + usage.limit + ' free reviews today. Come back after 2:45 PM IST!';
      const limitAction = isGuest
        ? '<a href="/auth.html" style="display:inline-block;background:var(--accent-red);color:#fff;border:none;padding:0.5rem 1.5rem;font-family:var(--font-mono);font-size:0.8rem;cursor:pointer;border-radius:3px;text-decoration:none;">CREATE FREE ACCOUNT</a>'
        : '<p style="font-size:0.75rem;color:var(--text-muted);">Resets daily at 2:45 PM IST</p>';
      outputContent.innerHTML = `
        <div class="empty-state" style="padding:2rem;border:1px dashed var(--card-border);max-width:450px;margin:auto;text-align:center;">
          <svg style="width:48px;height:48px;stroke:#f59e0b;margin-bottom:1rem;" viewBox="0 0 24 24" fill="none" stroke-width="1.5">
            <path d="M12 9v3m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <h4 style="color:#f59e0b;margin-bottom:0.5rem;font-family:var(--font-mono);">${isGuest ? 'SIGN UP TO CONTINUE' : 'DAILY LIMIT REACHED'}</h4>
          <p style="font-size:0.85rem;color:var(--text-main);margin-bottom:1rem;">${limitMsg}</p>
          ${limitAction}
        </div>`;
      return;
    }

    // Reflect the new usage count in the navbar badge immediately
    if (usage.limit != null && !usage.guest) {
      updateUsageBadgeDisplay(usage.count, usage.limit);
    }

    // PR mode — use URL input instead of code area
    if (currentMode === 'pr') {
      const prUrl = document.getElementById('pr-url-input')?.value.trim();
      if (!prUrl) return alert('Please paste a GitHub PR URL first.');
      if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(prUrl)) {
        return alert('Invalid GitHub PR URL. Expected format: https://github.com/owner/repo/pull/123');
      }

      runBtn.classList.add('running-pulse');
      runBtn.innerText = 'Fetching PR...';

      startNavProgress();

      const loadingMsgs = ['Fetching PR diff...', 'Parsing changed files...', 'Analyzing each file...', 'Detecting issues...', 'Building report...'];
      outputContent.innerHTML = `
        <div class="empty-state">
          <div class="loading-spinner"></div>
          <p id="loading-msg" style="font-family:var(--font-mono);color:#8b5cf6;margin-top:1rem;">${loadingMsgs[0]}</p>
        </div>`;

      const msgElem = document.getElementById('loading-msg');
      let msgIdx = 0;
      const msgInterval = setInterval(() => {
        if (!msgElem) return;
        msgIdx = (msgIdx + 1) % loadingMsgs.length;
        msgElem.style.opacity = '0';
        setTimeout(() => { if (msgElem) { msgElem.innerText = loadingMsgs[msgIdx]; msgElem.style.opacity = '1'; } }, 200);
      }, 3000);

      try {
        const sessionId = localStorage.getItem('github_session_id');
        const data = await runPRReview(prUrl, sessionId);
        clearInterval(msgInterval);
        renderPRReview(data, prUrl);
      } catch (err) {
        clearInterval(msgInterval);
        const errMsg = err.message || 'Unknown error';
        // Show login notice if it looks like a private repo issue
        if (errMsg.includes('private') || errMsg.includes('not found') || errMsg.includes('404') || errMsg.includes('403')) {
          const prLoginNotice = document.getElementById('pr-login-notice');
          if (prLoginNotice) prLoginNotice.style.display = 'flex';
        }
        outputContent.innerHTML = `
          <div class="empty-state" style="padding:2rem;border:1px dashed var(--card-border);max-width:450px;margin:auto;">
            <svg style="width:48px;height:48px;stroke:#8b5cf6;margin-bottom:1rem;" viewBox="0 0 24 24" fill="none" stroke-width="1.5">
              <path d="M12 9v3m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <h4 style="color:#8b5cf6;margin-bottom:0.5rem;font-family:var(--font-mono);">PR FETCH FAILED</h4>
            <p style="font-size:0.85rem;color:var(--text-main);margin-bottom:1rem;">${errMsg}</p>
            <p style="font-size:0.75rem;color:var(--text-muted);line-height:1.4;border-top:1px solid var(--card-border);padding-top:1rem;text-align:left;"><strong>Tips:</strong> Make sure the PR URL is correct. For private repos, connect your GitHub account first.</p>
          </div>`;
      } finally {
        finishNavProgress();
        runBtn.classList.remove('running-pulse');
        runBtn.innerText = 'Review PR';
      }
      return;
    }

    const code = codeArea.value.trim();
    const language = document.getElementById('language-select').value;
    if (!code) return alert('Please paste some code first.');

    runBtn.classList.add('running-pulse');
    runBtn.innerText = currentMode === 'autopsy' ? 'Diagnosing...' : currentMode === 'smell' ? 'Sniffing...' : 'Explaining...';

    startNavProgress();

    const loadingMsgs = currentMode === 'autopsy'
      ? ["Running semantic analysis...", "Checking security vulnerabilities...", "Analyzing complexity...", "Synthesizing fixes...", "Almost finished..."]
      : currentMode === 'smell'
      ? ["Sniffing your code...", "Detecting anti-patterns...", "Measuring complexity...", "Checking duplication...", "Almost done..."]
      : ["Reading your code...", "Mapping line by line...", "Building explanation...", "Generating suggestions...", "Almost done..."];

    outputContent.innerHTML = `
      <div class="empty-state">
        <div class="loading-spinner"></div>
        <p id="loading-msg" style="font-family:var(--font-mono);color:var(--accent-red);margin-top:1rem;">${loadingMsgs[0]}</p>
      </div>`;

    const msgElem = document.getElementById('loading-msg');
    let msgIdx = 0;
    const msgInterval = setInterval(() => {
      if (!msgElem) return;
      msgIdx = (msgIdx + 1) % loadingMsgs.length;
      msgElem.style.opacity = '0';
      setTimeout(() => { if (msgElem) { msgElem.innerText = loadingMsgs[msgIdx]; msgElem.style.opacity = '1'; } }, 200);
    }, 3000);

    try {
      if (currentMode === 'autopsy') {
        const data = await runAutopsy(code, language);
        clearInterval(msgInterval);
        renderAutopsy(data);
      } else if (currentMode === 'smell') {
        const data = await runSmell(code, language);
        clearInterval(msgInterval);
        renderSmell(data);
      } else {
        const data = await runExplain(code, language);
        clearInterval(msgInterval);
        renderExplanation(data);
      }
      if (window.innerWidth < 1024) setTimeout(() => outputContent.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch (err) {
      clearInterval(msgInterval);
      const errMsg = err.message || 'Unknown error';
      const isRateLimit = errMsg.includes('quota') || errMsg.includes('429');
      const isOverload  = errMsg.includes('demand') || errMsg.includes('503');
      const userTitle   = isRateLimit ? 'SERVICE BUSY' : 'ANALYSIS UNAVAILABLE';
      const userMsg     = isRateLimit
        ? 'Our analysis service is temporarily at capacity. Please wait a moment and try again.'
        : isOverload
        ? 'High demand right now. Please retry in a few seconds.'
        : 'Something went wrong while analysing your code. Please try again.';
      const adminBlock  = isAdmin() ? `
        <details style="margin-top:1rem;border-top:1px solid var(--card-border);padding-top:1rem;">
          <summary style="font-size:0.7rem;color:var(--accent-red);cursor:pointer;font-family:var(--font-mono);">⚙ ADMIN: Raw Error</summary>
          <pre style="font-size:0.65rem;color:var(--text-muted);white-space:pre-wrap;word-break:break-all;margin-top:0.5rem;">${errMsg}</pre>
        </details>` : '';
      outputContent.innerHTML = `
        <div class="empty-state" style="padding:2rem;border:1px dashed var(--card-border);max-width:450px;margin:auto;">
          <svg style="width:48px;height:48px;stroke:var(--accent-red);margin-bottom:1rem;" viewBox="0 0 24 24" fill="none" stroke-width="1.5">
            <path d="M12 9v3m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <h4 style="color:var(--accent-red);margin-bottom:0.5rem;font-family:var(--font-mono);">${userTitle}</h4>
          <p style="font-size:0.85rem;color:var(--text-main);margin-bottom:0;">${userMsg}</p>
          ${adminBlock}
        </div>`;
    } finally {
      finishNavProgress();
      runBtn.classList.remove('running-pulse');
      if (currentMode === 'autopsy') runBtn.innerText = 'Run Autopsy';
      else if (currentMode === 'smell') runBtn.innerText = 'Detect Smells';
      else if (currentMode === 'pr') runBtn.innerText = 'Review PR';
      else runBtn.innerText = 'Explain Code';
    }
  });

  // ── Jump to Line ──────────────────────────────────────────────────────
  function jumpToLine(lineNumber) {
    const lines = codeArea.value.split('\n');
    let charIndex = 0;
    for (let i = 0; i < lineNumber - 1 && i < lines.length; i++) charIndex += lines[i].length + 1;
    codeArea.focus();
    codeArea.setSelectionRange(charIndex, charIndex + (lines[lineNumber - 1] || '').length);
    const lineHeight = parseInt(getComputedStyle(codeArea).lineHeight) || 22;
    codeArea.scrollTop = Math.max(0, (lineNumber - 4)) * lineHeight;
    linesElem.scrollTop = codeArea.scrollTop;
    const divs = linesElem.querySelectorAll('div');
    divs.forEach(d => { d.classList.remove('error-line'); d.style.color = ''; d.style.fontWeight = ''; });
    if (divs[lineNumber - 1]) {
      divs[lineNumber - 1].classList.add('error-line');
      divs[lineNumber - 1].style.color = 'var(--accent-red)';
      divs[lineNumber - 1].style.fontWeight = 'bold';
      setTimeout(() => { divs[lineNumber - 1].classList.remove('error-line'); divs[lineNumber - 1].style.color = ''; divs[lineNumber - 1].style.fontWeight = ''; }, 3000);
    }
  }

  function markErrorLines(bugs) {
    const divs = linesElem.querySelectorAll('div');
    divs.forEach(d => d.classList.remove('error-line'));
    bugs.forEach(bug => { const idx = (bug.line || 1) - 1; if (divs[idx]) divs[idx].classList.add('error-line'); });
  }

  // ── History ───────────────────────────────────────────────────────────
 async function saveToHistory(code, language, data, mode) {
  try {
    const entry = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      language, mode,
      code,
      preview: code.slice(0, 120).replace(/\n/g, ' '),
      score: data.score != null ? data.score : null,
      bugCount: (data.bugs || []).length
    };
    const user = auth.currentUser;
    console.log('[saveToHistory] user:', user ? { uid: user.uid, isAnonymous: user.isAnonymous, email: user.email } : null);
    if (user) {
      const ref = doc(db, 'history', user.uid);
      const snap = await getDoc(ref);
      const existing = snap.exists() ? (snap.data().entries || []) : [];
      const updated = [entry, ...existing].slice(0, 50);
      await setDoc(ref, { entries: updated });
      console.log('[saveToHistory] wrote to history/' + user.uid + ', total entries now:', updated.length);
    } else {
      // fallback to localStorage if not logged in
      console.log('[saveToHistory] no user — falling back to localStorage');
      const history = JSON.parse(localStorage.getItem('autopsy_history') || '[]');
      history.unshift(entry);
      localStorage.setItem('autopsy_history', JSON.stringify(history.slice(0, 50)));
    }
    renderHistory();
  } catch(e) { console.error("saveToHistory error:", e); }
}

  async function renderHistory() {
    const panel = document.getElementById('history-panel');
    if (!panel) return;

    // Update drawer title to reflect current mode
    const drawerTitle = document.getElementById('history-drawer-title');
    if (drawerTitle) {
      const titles = { autopsy: 'AUTOPSY HISTORY', explain: 'EXPLAINER HISTORY', smell: 'SMELL HISTORY', pr: 'PR HISTORY' };
      drawerTitle.innerText = titles[currentMode] || 'HISTORY';
    }

try {
  const user = auth.currentUser;
  let history = [];
  if (user) {
    const snap = await getDoc(doc(db, 'history', user.uid));
    history = snap.exists() ? (snap.data().entries || []) : [];
  } else {
    history = JSON.parse(localStorage.getItem('autopsy_history') || '[]');
  }
      // Filter to current mode only
      history = history.filter(h => (h.mode || 'autopsy') === currentMode);
      if (!history.length) {
        const modeLabel = { autopsy: 'autopsy', explain: 'explainer', smell: 'smell', pr: 'PR review' }[currentMode] || currentMode;
        panel.innerHTML = `<p style="color:var(--text-muted);font-size:0.72rem;padding:0.5rem 0;">No ${modeLabel} history yet.</p>`;
        return;
      }
      panel.innerHTML = history.map(h => `
        <div style="padding:0.5rem 0;border-bottom:1px solid var(--card-border);">
          <div style="display:flex;justify-content:space-between;">
            <span style="font-family:var(--font-mono);font-size:0.7rem;color:var(--accent-red);">${(h.language||'').toUpperCase()}</span>
            ${h.score != null ? `<span style="font-family:var(--font-mono);font-size:0.7rem;color:${h.score>=7?'#4ade80':h.score>=4?'#facc15':'var(--accent-red)'};">${h.score}/10</span>` : ''}
          </div>
          <div style="font-size:0.68rem;color:var(--text-muted);margin-top:0.15rem;">${h.timestamp ? new Date(h.timestamp).toLocaleDateString('en-GB') + ', ' + new Date(h.timestamp).toLocaleTimeString('en-GB') : ''}</div>
          <div style="font-size:0.68rem;color:var(--text-muted);">${h.bugCount} issue(s)</div>
        </div>`).join('');
    } catch(e) { console.error("renderHistory error:", e); }
  }
  renderHistory();

  // ── Render Autopsy Output ─────────────────────────────────────────────
  function renderAutopsy(data) {
    const score = typeof data.score === 'number' ? data.score : 0;
    const bugs = Array.isArray(data.bugs) ? data.bugs : [];
    const secIssues = Array.isArray(data.securityIssues) ? data.securityIssues : [];
    const improvedCode = typeof data.improvedCode === 'string' ? formatCode(data.improvedCode) : '';
    const timeC = data.timeComplexity || null;
    const spaceC = data.spaceComplexity || null;
    const language = document.getElementById('language-select').value;

    saveToHistory(codeArea.value, language, data, 'autopsy');

    // Score color
    const scoreColor = score >= 7 ? '#4ade80' : score >= 4 ? '#facc15' : 'var(--accent-red)';
    const scoreOffset = 251 - (251 * (score / 10));

    const bugsHtml = bugs.map(bug => {
      const typeClass = bug.severity === 'Critical' ? 'critical' : bug.severity === 'Warning' ? 'warning' : 'suggestion';
      return `
        <div class="bug-card ${typeClass}" data-line="${bug.line}" style="cursor:pointer;" title="Click to jump to line ${bug.line}">
          <div class="bug-header">
            <span class="bug-badge badge-${typeClass}">${bug.severity}</span>
            <span class="bug-line" style="text-decoration:underline;text-decoration-style:dotted;cursor:pointer;">↵ Line ${bug.line}</span>
          </div>
          <p class="bug-desc">${bug.description}</p>
          <div class="bug-fix" style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem;">
            <span style="flex:1;">${bug.fix}</span>
            <button class="copy-btn copy-fix-btn" data-fix="${(bug.fix||'').replace(/"/g,'&quot;')}" style="flex-shrink:0;font-size:0.65rem;padding:0.2rem 0.5rem;white-space:nowrap;">Copy Fix</button>
          </div>
        </div>`;
    }).join('');

    const secHtml = secIssues.length > 0 ? `
      <div class="section-block fade-in visible">
        <h4 style="font-family:var(--font-mono);font-size:0.85rem;color:var(--accent-red);margin-bottom:0.75rem;display:flex;align-items:center;gap:0.5rem;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke-linecap="round" stroke-linejoin="round"/></svg>
          SECURITY ISSUES (${secIssues.length})
        </h4>
        ${secIssues.map(s => {
          const cls = s.severity === 'Critical' ? 'critical' : s.severity === 'Warning' ? 'warning' : 'suggestion';
          return `<div class="bug-card ${cls}" style="margin-bottom:0.75rem;">
            <div class="bug-header"><span class="bug-badge badge-${cls}">${s.severity}</span></div>
            <p class="bug-desc">${s.description}</p>
            <div class="bug-fix">${s.fix}</div>
          </div>`;
        }).join('')}
      </div>` : '';

    const complexityHtml = (timeC || spaceC) ? `
      <div class="complexity-bar fade-in visible">
        ${timeC ? `<div class="complexity-item"><span class="complexity-label">Time</span><span class="complexity-value">${timeC}</span></div>` : ''}
        ${spaceC ? `<div class="complexity-item"><span class="complexity-label">Space</span><span class="complexity-value">${spaceC}</span></div>` : ''}
      </div>` : '';

    outputContent.innerHTML = `
      <div class="score-section fade-in visible">
        <div class="score-ring-wrap">
          <svg class="score-svg" viewBox="0 0 100 100">
            <circle class="score-circle-bg" cx="50" cy="50" r="40"/>
            <circle class="score-circle" cx="50" cy="50" r="40" style="stroke:${scoreColor};stroke-dashoffset:251;"/>
          </svg>
          <div class="score-text" style="color:${scoreColor};">${score}</div>
        </div>
        <div>
          <h3>Quality Score</h3>
          <p>Reflects performance, security, and maintainability.</p>
        </div>
      </div>

      ${complexityHtml}
      ${secHtml}

      <div class="section-block fade-in visible">
        <h4 style="font-family:var(--font-mono);font-size:0.85rem;color:var(--text-muted);margin-bottom:0.75rem;">BUGS & ISSUES (${bugs.length})</h4>
        <div style="display:flex;flex-direction:column;gap:1rem;">
          ${bugsHtml || '<div class="empty-state" style="border:1px dashed var(--card-border);color:#4ade80;padding:1rem;font-family:var(--font-mono);font-size:0.8rem;">No significant bugs detected.</div>'}
        </div>
      </div>

      <div class="improved-code-section fade-in visible">
        <h3 style="margin-bottom:1rem;">Recommended Implementation</h3>
        <div class="improved-code">
          <button class="copy-btn" onclick="navigator.clipboard.writeText(this.nextElementSibling.innerText);this.innerText='Copied!';setTimeout(()=>this.innerText='Copy',2000);">Copy</button>
          <pre>${improvedCode ? formatCode(improvedCode).replace(/</g,'&lt;').replace(/>/g,'&gt;') : '// Code is fully optimal'}</pre>
        </div>
      </div>`;

    // Animate score ring after render
    requestAnimationFrame(() => {
      const circle = outputContent.querySelector('.score-circle');
      if (circle) {
        circle.style.transition = 'stroke-dashoffset 1.8s cubic-bezier(0.25, 1, 0.5, 1)';
        circle.style.strokeDashoffset = String(scoreOffset);
      }
    });

    markErrorLines(bugs);
    renderAutopsy._lastData = data;
    renderAutopsy._lastCode = codeArea.value;
    [shareBtn, exportBtn, diffToggleBtn].forEach(b => b && (b.style.display = 'inline-block'));
    if (diffToggleBtn) { diffToggleBtn.classList.remove('active'); diffToggleBtn.innerText = 'Diff View'; }

    // ── Diff View ─────────────────────────────────────────────────────
    if (diffToggleBtn && !diffToggleBtn._bound) {
      diffToggleBtn._bound = true;
      let diffMode = false;
      diffToggleBtn.addEventListener('click', () => {
        diffMode = !diffMode;
        diffToggleBtn.classList.toggle('active', diffMode);
        diffToggleBtn.innerText = diffMode ? 'Normal View' : 'Diff View';
        const d = renderAutopsy._lastData;
        const original = renderAutopsy._lastCode || '';
        const improved = (d && d.improvedCode) || '';
        const section = outputContent.querySelector('.improved-code-section');
        if (!section) return;
        if (diffMode) {
          const origLines = original.split('\n');
          const impLines = improved.split('\n');
          const makeHtml = (lines, other) => lines.map((l, i) => {
            const cls = l !== (other[i] ?? '') ? (lines === origLines ? 'diff-line-remove' : 'diff-line-add') : '';
            return `<div class="diff-line ${cls}">${l.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>`;
          }).join('');
          section.innerHTML = `
            <h3 style="margin-bottom:1rem;">Recommended Implementation</h3>
            <div class="diff-view">
              <div class="diff-pane"><div class="diff-pane-header">Original</div><pre>${makeHtml(origLines, impLines)}</pre></div>
              <div class="diff-pane"><div class="diff-pane-header">Improved</div><pre>${makeHtml(impLines, origLines)}</pre></div>
            </div>`;
        } else {
          section.innerHTML = `
            <h3 style="margin-bottom:1rem;">Recommended Implementation</h3>
            <div class="improved-code">
              <button class="copy-btn" onclick="navigator.clipboard.writeText(this.nextElementSibling.innerText);this.innerText='Copied!';setTimeout(()=>this.innerText='Copy',2000);">Copy</button>
              <pre>${improved ? formatCode(improved).replace(/</g,'&lt;').replace(/>/g,'&gt;') : '// Code is fully optimal'}</pre>
            </div>`;
        }
      });
    }

    // ── Export ────────────────────────────────────────────────────────
    if (exportBtn && !exportBtn._bound) {
      exportBtn._bound = true;
      exportBtn.addEventListener('click', () => {
        const d = renderAutopsy._lastData;
        if (!d) return;
        const lang = document.getElementById('language-select').value;
        const lines = [
          `# CodeAutopsy Report`,
          `**Language:** ${lang}  |  **Quality Score:** ${d.score}/10`,
          `**Time Complexity:** ${d.timeComplexity || 'N/A'}  |  **Space Complexity:** ${d.spaceComplexity || 'N/A'}`,
          `**Generated:** ${new Date().toLocaleDateString('en-GB')}, ${new Date().toLocaleTimeString('en-GB')}`,
          ``,
          `## Security Issues (${(d.securityIssues||[]).length})`,
          ...(d.securityIssues||[]).map((s,i) => `### ${i+1}. [${s.severity}]\n${s.description}\n**Fix:** ${s.fix}\n`),
          `## Bugs Found (${(d.bugs||[]).length})`,
          ...(d.bugs||[]).map((b,i) => `### ${i+1}. [${b.severity}] Line ${b.line}\n${b.description}\n**Fix:** ${b.fix}\n`),
          `## Improved Code`,
          '```' + lang,
          d.improvedCode || '// Fully optimal',
          '```'
        ].join('\n');
        const blob = new Blob([lines], { type: 'text/markdown' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `autopsy-report-${Date.now()}.md`;
        a.click();
        URL.revokeObjectURL(a.href);
      });
    }

    // ── Share ─────────────────────────────────────────────────────────
    if (shareBtn && !shareBtn._bound) {
      shareBtn._bound = true;
      shareBtn.addEventListener('click', () => {
        const d = renderAutopsy._lastData;
        if (!d) return;
        try {
          const payload = { code: (renderAutopsy._lastCode || '').slice(0, 4000), language: document.getElementById('language-select').value, result: d };
          const url = `${location.origin}${location.pathname}?share=${btoa(encodeURIComponent(JSON.stringify(payload)))}`;
          navigator.clipboard.writeText(url).then(() => showToast('✓ Link copied to clipboard!'));
        } catch(e) { showToast('Could not generate share link.'); }
      });
    }

    // ── Click bug card → jump to line ─────────────────────────────────
    outputContent.querySelectorAll('.bug-card[data-line]').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.classList.contains('copy-fix-btn')) return;
        const line = parseInt(card.getAttribute('data-line'));
        if (line > 0) jumpToLine(line);
      });
    });
    outputContent.querySelectorAll('.copy-fix-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(btn.getAttribute('data-fix') || '').then(() => {
          btn.innerText = 'Copied!';
          setTimeout(() => btn.innerText = 'Copy Fix', 2000);
        });
      });
    });
  }

  // ── Render Explanation Output ─────────────────────────────────────────
  function renderExplanation(data) {
    const summary = data.summary || '';
    const breakdown = Array.isArray(data.breakdown) ? data.breakdown : [];
    const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
    const language = document.getElementById('language-select').value;

    saveToHistory(codeArea.value, language, { bugs: [], score: null }, 'explain');

    const suggTypeColor = { improvement: '#4ade80', 'best-practice': '#00aaff', performance: '#facc15' };
    const suggTypeLabel = { improvement: 'Improvement', 'best-practice': 'Best Practice', performance: 'Performance' };

    const breakdownHtml = breakdown.map((item, i) => `
      <div class="explain-card fade-in visible" style="animation-delay:${i * 0.05}s;">
        <div class="explain-line-badge">Line ${item.lineRange}</div>
        <p class="explain-text">${item.explanation}</p>
      </div>`).join('');

    const suggestionsHtml = suggestions.map(s => {
      const color = suggTypeColor[s.type] || '#00aaff';
      const label = suggTypeLabel[s.type] || s.type;
      return `
        <div class="suggest-card fade-in visible">
          <span class="suggest-badge" style="color:${color};border-color:${color};background:${color}18;">${label}</span>
          <p style="margin:0.5rem 0 0;font-size:0.875rem;color:var(--text-main);line-height:1.6;">${s.description}</p>
        </div>`;
    }).join('');

    outputContent.innerHTML = `
      <div class="explain-summary fade-in visible">
        <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.75rem;">
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-red)" stroke-width="2" style="width:20px;height:20px;flex-shrink:0;"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <h3 style="margin:0;font-size:0.95rem;">Summary</h3>
        </div>
        <p style="margin:0;font-size:0.875rem;color:var(--text-main);line-height:1.7;">${summary}</p>
      </div>

      <div class="section-block fade-in visible">
        <h4 style="font-family:var(--font-mono);font-size:0.85rem;color:var(--text-muted);margin-bottom:1rem;display:flex;align-items:center;gap:0.5rem;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" stroke-linecap="round" stroke-linejoin="round"/></svg>
          LINE-BY-LINE BREAKDOWN
        </h4>
        <div style="display:flex;flex-direction:column;gap:0.75rem;">
          ${breakdownHtml || '<p style="color:var(--text-muted);font-size:0.8rem;">No breakdown available.</p>'}
        </div>
      </div>

      <div class="section-block fade-in visible">
        <h4 style="font-family:var(--font-mono);font-size:0.85rem;color:var(--text-muted);margin-bottom:1rem;display:flex;align-items:center;gap:0.5rem;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke-linecap="round" stroke-linejoin="round"/></svg>
          SUGGESTIONS
        </h4>
        <div style="display:flex;flex-direction:column;gap:0.75rem;">
          ${suggestionsHtml || '<p style="color:var(--text-muted);font-size:0.8rem;">No suggestions.</p>'}
        </div>
      </div>`;

    [shareBtn, exportBtn, diffToggleBtn].forEach(b => b && (b.style.display = 'none'));
  }

  // ── Render Smell Output ───────────────────────────────────────────────
  function renderSmell(data) {
    const health = data.overallHealth || 'Unknown';
    const healthScore = typeof data.healthScore === 'number' ? data.healthScore : 0;
    const summary = data.summary || '';
    const smells = Array.isArray(data.smells) ? data.smells : [];
    const metrics = data.metrics || {};
    const refactoredCode = data.refactoredCode || '';
    const language = document.getElementById('language-select').value;

    saveToHistory(codeArea.value, language, { bugs: smells, score: Math.round(healthScore / 10) }, 'smell');

    const healthColor = health === 'Healthy' ? '#4ade80' : health === 'Needs Work' ? '#facc15' : 'var(--accent-red)';
    const healthBg = health === 'Healthy' ? 'rgba(74,222,128,0.08)' : health === 'Needs Work' ? 'rgba(250,204,21,0.08)' : 'rgba(255,49,49,0.08)';

    const severityColor = { High: 'var(--accent-red)', Medium: '#facc15', Low: '#00aaff' };
    const severityBg = { High: 'rgba(255,49,49,0.1)', Medium: 'rgba(250,204,21,0.1)', Low: 'rgba(0,170,255,0.1)' };

    const smellsHtml = smells.map((smell, i) => {
      const color = severityColor[smell.severity] || 'var(--text-muted)';
      const bg = severityBg[smell.severity] || 'transparent';
      return `
        <div class="bug-card" style="border-left:3px solid ${color};animation-delay:${i*0.06}s;cursor:pointer;" data-line="${smell.line}" title="Click to jump to line ${smell.line}">
          <div class="bug-header">
            <span class="bug-badge" style="background:${bg};color:${color};border:1px solid ${color}40;">${smell.severity}</span>
            <span style="font-family:var(--font-mono);font-size:0.7rem;color:${color};font-weight:700;">${smell.category}</span>
            <span class="bug-line" style="margin-left:auto;">↵ Line ${smell.line}</span>
          </div>
          <p class="bug-desc">${smell.description}</p>
          <div class="bug-fix" style="border-left:2px solid ${color}40;padding-left:0.75rem;">
            <strong style="font-size:0.7rem;color:${color};font-family:var(--font-mono);">REFACTOR:</strong> ${smell.refactor}
          </div>
        </div>`;
    }).join('');

    const metricsHtml = Object.keys(metrics).length ? `
      <div class="complexity-bar fade-in visible" style="flex-wrap:wrap;">
        <div class="complexity-item">
          <span class="complexity-label">Lines of Code</span>
          <span class="complexity-value" style="color:#00aaff;">${metrics.linesOfCode || '—'}</span>
        </div>
        <div class="complexity-item">
          <span class="complexity-label">Cyclomatic Complexity</span>
          <span class="complexity-value" style="color:#facc15;">${metrics.cyclomaticComplexity || '—'}</span>
        </div>
        <div class="complexity-item">
          <span class="complexity-label">Nesting Depth</span>
          <span class="complexity-value" style="color:#facc15;">${metrics.nestingDepth || '—'}</span>
        </div>
        <div class="complexity-item">
          <span class="complexity-label">Duplication Risk</span>
          <span class="complexity-value" style="color:${metrics.duplicationRisk === 'Low' ? '#4ade80' : metrics.duplicationRisk === 'High' ? 'var(--accent-red)' : '#facc15'};">${metrics.duplicationRisk || '—'}</span>
        </div>
      </div>` : '';

    outputContent.innerHTML = `
      <div class="score-section fade-in visible" style="background:${healthBg};border:1px solid ${healthColor}30;border-radius:8px;padding:1.25rem 1.5rem;">
        <div style="display:flex;flex-direction:column;align-items:center;gap:0.25rem;min-width:80px;">
          <div style="font-size:2rem;font-weight:800;font-family:var(--font-mono);color:${healthColor};">${healthScore}%</div>
          <div style="font-size:0.65rem;font-family:var(--font-mono);color:${healthColor};font-weight:700;text-transform:uppercase;letter-spacing:0.1em;">Health</div>
        </div>
        <div>
          <h3 style="color:${healthColor};margin-bottom:0.35rem;">${health}</h3>
          <p style="font-size:0.85rem;color:var(--text-muted);line-height:1.6;margin:0;">${summary}</p>
        </div>
      </div>

      ${metricsHtml}

      <div class="section-block fade-in visible">
        <h4 style="font-family:var(--font-mono);font-size:0.85rem;color:var(--text-muted);margin-bottom:0.75rem;">
          CODE SMELLS DETECTED (${smells.length})
        </h4>
        <div style="display:flex;flex-direction:column;gap:0.75rem;">
          ${smellsHtml || '<div style="border:1px dashed var(--card-border);color:#4ade80;padding:1rem;font-family:var(--font-mono);font-size:0.8rem;">No code smells detected. Clean code!</div>'}
        </div>
      </div>

      <div class="improved-code-section fade-in visible">
        <h3 style="margin-bottom:1rem;">Refactored Code</h3>
        <div class="improved-code">
          <button class="copy-btn" onclick="navigator.clipboard.writeText(this.nextElementSibling.innerText);this.innerText='Copied!';setTimeout(()=>this.innerText='Copy',2000);">Copy</button>
          <code>${refactoredCode ? formatCode(refactoredCode).replace(/</g,'&lt;').replace(/>/g,'&gt;') : '// Code is clean, no refactoring needed'}</code>
        </div>
      </div>`;

    // Click smell card → jump to line
    outputContent.querySelectorAll('.bug-card[data-line]').forEach(card => {
      card.addEventListener('click', () => {
        const line = parseInt(card.getAttribute('data-line'));
        if (line > 0) jumpToLine(line);
      });
    });

    [shareBtn, exportBtn, diffToggleBtn].forEach(b => b && (b.style.display = 'none'));
  } // ── End of main DOMContentLoaded ──────────────────────────────────────

  // ── Render PR Review Output ───────────────────────────────────────────
  function renderPRReview(data, prUrl) {
    const pr = data.pr || {};
    const files = Array.isArray(data.files) ? data.files : [];
    const score = typeof data.score === 'number' ? data.score : 0;
    const verdict = data.verdict || 'Needs Review';

    // Save to history
    const totalIssues = files.reduce((sum, f) => sum + (f.issues?.length || 0), 0);
    saveToHistory(prUrl, 'pr', { score, bugs: Array(totalIssues).fill({}) }, 'pr');

    const scoreColor = score >= 7 ? '#4ade80' : score >= 4 ? '#facc15' : 'var(--accent-red)';
    const verdictColor = verdict === 'Approved' ? '#4ade80' : verdict === 'Needs Changes' ? 'var(--accent-red)' : '#facc15';
    const verdictBg = verdict === 'Approved' ? 'rgba(74,222,128,0.08)' : verdict === 'Needs Changes' ? 'rgba(255,49,49,0.08)' : 'rgba(250,204,21,0.08)';
    const scoreOffset = 251 - (251 * (score / 10));

    const filesHtml = files.map((file, fi) => {
      const issues = Array.isArray(file.issues) ? file.issues : [];
      const issuesHtml = issues.map((issue, ii) => {
        const sevColor = issue.severity === 'Critical' ? 'var(--accent-red)' : issue.severity === 'Warning' ? '#facc15' : '#00aaff';
        const sevBg = issue.severity === 'Critical' ? 'rgba(255,49,49,0.1)' : issue.severity === 'Warning' ? 'rgba(250,204,21,0.1)' : 'rgba(0,170,255,0.1)';
        return `
          <div class="bug-card" style="border-left:3px solid ${sevColor};margin-bottom:0.6rem;" >
            <div class="bug-header">
              <span class="bug-badge" style="background:${sevBg};color:${sevColor};border:1px solid ${sevColor}40;">${issue.severity}</span>
              ${issue.line ? `<span class="bug-line">↵ Line ${issue.line}</span>` : ''}
            </div>
            <p class="bug-desc">${issue.description}</p>
            ${issue.fix ? `<div class="bug-fix"><strong style="font-size:0.7rem;color:${sevColor};font-family:var(--font-mono);">FIX:</strong> ${issue.fix}</div>` : ''}
          </div>`;
      }).join('');

      const addDel = (file.additions != null && file.deletions != null)
        ? `<span style="color:#4ade80;font-size:0.72rem;">+${file.additions}</span> <span style="color:var(--accent-red);font-size:0.72rem;">-${file.deletions}</span>`
        : '';

      return `
        <div class="section-block fade-in visible" style="animation-delay:${fi * 0.07}s;">
          <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.85rem;flex-wrap:wrap;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0;color:var(--text-muted);"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span style="font-family:var(--font-mono);font-size:0.82rem;color:var(--accent-white);font-weight:600;">${file.filename}</span>
            <span style="margin-left:auto;display:flex;gap:0.4rem;align-items:center;">${addDel}</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:0.5rem;">
            ${issuesHtml || '<div style="border:1px dashed var(--card-border);color:#4ade80;padding:0.75rem 1rem;font-family:var(--font-mono);font-size:0.78rem;border-radius:4px;">✓ No issues found in this file.</div>'}
          </div>
        </div>`;
    }).join('');

    outputContent.innerHTML = `
      <div class="score-section fade-in visible" style="background:${verdictBg};border:1px solid ${verdictColor}30;border-radius:8px;padding:1.25rem 1.5rem;margin-bottom:1rem;">
        <div class="score-ring-wrap">
          <svg class="score-svg" viewBox="0 0 100 100">
            <circle class="score-circle-bg" cx="50" cy="50" r="40"/>
            <circle class="score-circle" cx="50" cy="50" r="40" style="stroke:${scoreColor};stroke-dashoffset:251;"/>
          </svg>
          <div class="score-text" style="color:${scoreColor};">${score}</div>
        </div>
        <div>
          <h3 style="color:${verdictColor};margin-bottom:0.25rem;">${verdict}</h3>
          <p style="font-size:0.82rem;color:var(--text-muted);margin:0 0 0.5rem;">PR #${pr.number || '—'} — ${pr.title || 'Pull Request'}</p>
          <div style="display:flex;gap:1rem;flex-wrap:wrap;">
            ${pr.author ? `<span style="font-size:0.75rem;color:var(--text-muted);font-family:var(--font-mono);">by @${pr.author}</span>` : ''}
            ${pr.changedFiles != null ? `<span style="font-size:0.75rem;color:var(--text-muted);font-family:var(--font-mono);">${pr.changedFiles} file${pr.changedFiles !== 1 ? 's' : ''} changed</span>` : ''}
            ${pr.additions != null ? `<span style="font-size:0.75rem;font-family:var(--font-mono);"><span style="color:#4ade80;">+${pr.additions}</span> <span style="color:var(--accent-red);">-${pr.deletions}</span></span>` : ''}
          </div>
        </div>
      </div>

      <div class="section-block fade-in visible" style="background:var(--card-bg);border:1px solid var(--card-border);border-radius:6px;padding:0.85rem 1rem;margin-bottom:0.5rem;">
        <p style="font-size:0.85rem;color:var(--text-main);line-height:1.7;margin:0;">${data.summary || ''}</p>
      </div>

      ${filesHtml}`;

    // Animate score ring
    requestAnimationFrame(() => {
      const circle = outputContent.querySelector('.score-circle');
      if (circle) {
        circle.style.transition = 'stroke-dashoffset 1.8s cubic-bezier(0.25, 1, 0.5, 1)';
        circle.style.strokeDashoffset = String(scoreOffset);
      }
    });

    [shareBtn, exportBtn, diffToggleBtn].forEach(b => b && (b.style.display = 'none'));
  }


});


// ── History Dashboard Page Logic ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function initHistoryDashboard() {
  if (!document.getElementById('history-cards')) return; // Only runs on history.html

  const historyCards = document.getElementById('history-cards');
  const historyEmpty = document.getElementById('history-empty');
  const noResults = document.getElementById('no-results');
  const chartSection = document.getElementById('chart-section');
  const filterLang = document.getElementById('filter-language');
  const filterMode = document.getElementById('filter-mode');
  const filterScore = document.getElementById('filter-score');
  const sortOrder = document.getElementById('sort-order');
  const clearAllBtn = document.getElementById('clear-all-btn');
  const clearModal = document.getElementById('clear-modal');
  const clearConfirm = document.getElementById('clear-confirm');
  const clearCancel = document.getElementById('clear-cancel');
  const resetFiltersBtn = document.getElementById('reset-filters-btn');

async function getHistory() {
  try {
    const user = auth.currentUser;
    console.log('[getHistory] user:', user ? { uid: user.uid, isAnonymous: user.isAnonymous, email: user.email } : null);
    if (user) {
      const snap = await getDoc(doc(db, 'history', user.uid));
      console.log('[getHistory] doc exists:', snap.exists(), 'entries:', snap.exists() ? (snap.data().entries || []).length : 0);
      return snap.exists() ? (snap.data().entries || []) : [];
    }
    return JSON.parse(localStorage.getItem('autopsy_history') || '[]');
  } catch (e) {
    console.error('[getHistory] error (was previously silently swallowed):', e);
    return [];
  }
}

  // ── Populate Language Filter ─────────────────────────────────────────
  async function populateLanguageFilter() {
    const history = await getHistory();
    const langs = [...new Set(history.map(h => h.language).filter(Boolean))];
    filterLang.innerHTML = '<option value="all">All Languages</option>' +
      langs.map(l => `<option value="${l}">${l.charAt(0).toUpperCase() + l.slice(1)}</option>`).join('');
  }

  // ── Stats ────────────────────────────────────────────────────────────
  async function renderStats() {
    const history = await getHistory();
    const total = history.length;
    const scores = history.filter(h => h.score != null).map(h => h.score);
    const avgScore = scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '—';
    const totalBugs = history.reduce((s, h) => s + (h.bugCount || 0), 0);

    // Most reviewed language
    const langCounts = {};
    history.forEach(h => { if (h.language) langCounts[h.language] = (langCounts[h.language] || 0) + 1; });
    const topLang = Object.entries(langCounts).sort((a, b) => b[1] - a[1])[0];
    const topLangStr = topLang ? topLang[0].charAt(0).toUpperCase() + topLang[0].slice(1) : '—';

    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-avg-score').textContent = avgScore;
    document.getElementById('stat-top-lang').textContent = topLangStr;
    document.getElementById('stat-total-bugs').textContent = totalBugs;
  }

  // ── Score Trend Chart (Pure Canvas) ──────────────────────────────────
  async function renderChart() {
    const history = await getHistory();
    const scored = history.filter(h => h.score != null).reverse(); // chronological

    if (scored.length < 2) {
      chartSection.style.display = 'none';
      return;
    }
    chartSection.style.display = 'block';

    const canvas = document.getElementById('score-chart');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = 200 * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = '200px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const W = rect.width;
    const H = 200;
    const pad = { top: 20, right: 20, bottom: 35, left: 40 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;

    ctx.clearRect(0, 0, W, H);

    // Grid lines
    ctx.strokeStyle = 'rgba(255,49,49,0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i += 2) {
      const y = pad.top + plotH - (plotH * i / 10);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(W - pad.right, y);
      ctx.stroke();
    }

    // Y-axis labels
    ctx.fillStyle = '#9ca3af';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 10; i += 2) {
      const y = pad.top + plotH - (plotH * i / 10);
      ctx.fillText(i.toString(), pad.left - 8, y + 3);
    }

    // Data points
    const points = scored.map((h, i) => ({
      x: pad.left + (plotW * i / (scored.length - 1)),
      y: pad.top + plotH - (plotH * h.score / 10),
      score: h.score,
      date: h.timestamp
    }));

    // Gradient fill under line
    const gradient = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
    gradient.addColorStop(0, 'rgba(255,49,49,0.2)');
    gradient.addColorStop(1, 'rgba(255,49,49,0.02)');

    ctx.beginPath();
    ctx.moveTo(points[0].x, H - pad.bottom);
    points.forEach((p, i) => {
      if (i === 0) ctx.lineTo(p.x, p.y);
      else {
        const prev = points[i - 1];
        const cpx = (prev.x + p.x) / 2;
        ctx.bezierCurveTo(cpx, prev.y, cpx, p.y, p.x, p.y);
      }
    });
    ctx.lineTo(points[points.length - 1].x, H - pad.bottom);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Line
    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else {
        const prev = points[i - 1];
        const cpx = (prev.x + p.x) / 2;
        ctx.bezierCurveTo(cpx, prev.y, cpx, p.y, p.x, p.y);
      }
    });
    ctx.strokeStyle = '#ff3131';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(255,49,49,0.4)';
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Dots
    points.forEach(p => {
      const color = p.score >= 7 ? '#4ade80' : p.score >= 4 ? '#facc15' : '#ff3131';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    // X-axis date labels (show first, last, and a few in between)
    ctx.fillStyle = '#9ca3af';
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    const labelCount = Math.min(scored.length, 6);
    const step = Math.max(1, Math.floor((scored.length - 1) / (labelCount - 1)));
    for (let i = 0; i < scored.length; i += step) {
      const p = points[i];
      try {
        const d = new Date(scored[i].timestamp);
        ctx.fillText(`${d.getDate()}/${d.getMonth()+1}`, p.x, H - pad.bottom + 15);
      } catch {}
    }
    // Always show last label
    if (scored.length > 1) {
      const last = points[points.length - 1];
      try {
        const d = new Date(scored[scored.length - 1].timestamp);
        ctx.fillText(`${d.getDate()}/${d.getMonth()+1}`, last.x, H - pad.bottom + 15);
      } catch {}
    }
  }

  // ── Filter & Sort ────────────────────────────────────────────────────
  async function getFilteredHistory() {
    let history = await getHistory();

    // Filter by language
    const lang = filterLang.value;
    if (lang !== 'all') history = history.filter(h => h.language === lang);

    // Filter by mode
    const mode = filterMode.value;
    if (mode !== 'all') history = history.filter(h => (h.mode || 'autopsy') === mode);

    // Filter by score range
    const scoreRange = filterScore.value;
    if (scoreRange !== 'all') {
      const [min, max] = scoreRange.split('-').map(Number);
      history = history.filter(h => h.score != null && h.score >= min && h.score <= max);
    }

    // Sort
    const sort = sortOrder.value;
    switch (sort) {
      case 'newest':
        history.sort((a, b) => (b.id || 0) - (a.id || 0));
        break;
      case 'oldest':
        history.sort((a, b) => (a.id || 0) - (b.id || 0));
        break;
      case 'highest':
        history.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
        break;
      case 'lowest':
        history.sort((a, b) => (a.score ?? 11) - (b.score ?? 11));
        break;
    }

    return history;
  }

  // ── Render Cards ─────────────────────────────────────────────────────
  async function renderCards() {
    const history = await getHistory();
    const filtered = await getFilteredHistory();

    if (history.length === 0) {
      historyEmpty.style.display = 'block';
      noResults.style.display = 'none';
      historyCards.innerHTML = '';
      chartSection.style.display = 'none';
      document.getElementById('filter-bar').style.display = 'none';
      document.getElementById('history-stats').style.display = 'none';
      document.getElementById('clear-all-btn').style.display = 'none';
      return;
    }

    document.getElementById('filter-bar').style.display = '';
    document.getElementById('history-stats').style.display = '';
    document.getElementById('clear-all-btn').style.display = '';
    historyEmpty.style.display = 'none';

    if (filtered.length === 0) {
      noResults.style.display = 'block';
      historyCards.innerHTML = '';
      return;
    }
    noResults.style.display = 'none';

    historyCards.innerHTML = filtered.map((h, idx) => {
      const scoreClass = h.score != null ? (h.score >= 7 ? 'score-good' : h.score >= 4 ? 'score-avg' : 'score-bad') : '';
      const scoreLabel = h.score != null ? `${h.score}/10` : '—';
      const modeName = h.mode === 'smell' ? 'Code Smell' : h.mode === 'explain' ? 'Explainer' : h.mode === 'pr' ? 'PR Review' : 'Autopsy';
      const modeIcon = h.mode === 'smell'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : h.mode === 'explain'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : h.mode === 'pr'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M12 2C8.686 2 6 4.418 6 7.4c0 1.942 1.114 3.652 2.766 4.67l-2.029 4.618a1 1 0 0 0 .916 1.403h8.694a1 1 0 0 0 .916-1.403l-2.029-4.618C16.886 11.052 18 9.342 18 7.4 18 4.418 15.314 2 12 2z" stroke="currentColor" stroke-linecap="round"/></svg>';

      let dateStr = '';
      try {
        const d = new Date(h.timestamp);
        dateStr = d.toLocaleDateString('en-GB') + ', ' + d.toLocaleTimeString('en-GB');
      } catch { dateStr = h.timestamp || ''; }

      const preview = (h.preview || h.code || '').slice(0, 120);

      return `
        <div class="history-review-card" style="animation-delay:${idx * 0.03}s;">
          <div class="review-card-top">
            <span class="review-lang-badge">${(h.language || 'unknown').toUpperCase()}</span>
            ${h.score != null ? `<span class="review-score-badge ${scoreClass}">${scoreLabel}</span>` : '<span style="font-family:var(--font-mono);font-size:0.7rem;color:var(--text-muted);">No score</span>'}
          </div>
          <div class="review-card-meta">
            <div class="review-meta-item">
              ${modeIcon}
              ${modeName}
            </div>
            <div class="review-meta-item">
              <svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" stroke-linecap="round" stroke-linejoin="round"/></svg>
              ${dateStr}
            </div>
            <div class="review-meta-item">
              <svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M12 9v3m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke-linecap="round" stroke-linejoin="round"/></svg>
              ${h.bugCount || 0} bug${(h.bugCount || 0) !== 1 ? 's' : ''}
            </div>
          </div>
          <div class="review-code-preview">${preview.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
          <div class="review-card-actions">
            ${h.code ? `<a href="/tool.html?rerun=${h.id}&mode=${h.mode || 'autopsy'}" class="review-rerun-btn">
              <svg viewBox="0 0 24 24" stroke-width="2"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" stroke-linecap="round" stroke-linejoin="round"/></svg>
              Re-run
            </a>` : ''}
          </div>
        </div>`;
    }).join('');
  }

  // ── Clear All ────────────────────────────────────────────────────────
  clearAllBtn.addEventListener('click', () => {
    clearModal.style.display = 'flex';
  });

  clearCancel.addEventListener('click', () => {
    clearModal.style.display = 'none';
  });

  clearModal.addEventListener('click', (e) => {
    if (e.target === clearModal) clearModal.style.display = 'none';
  });

  clearConfirm.addEventListener('click', async () => {
    const user = auth.currentUser;
    if (user) {
      await setDoc(doc(db, 'history', user.uid), { entries: [] });
    } else {
      localStorage.removeItem('autopsy_history');
    }
    clearModal.style.display = 'none';
    refreshDashboard();
  });

  // ── Reset Filters ────────────────────────────────────────────────────
  if (resetFiltersBtn) {
    resetFiltersBtn.addEventListener('click', () => {
      filterLang.value = 'all';
      filterMode.value = 'all';
      filterScore.value = 'all';
      sortOrder.value = 'newest';
      renderCards();
    });
  }

  // ── Filter/Sort change listeners ─────────────────────────────────────
  [filterLang, filterMode, filterScore, sortOrder].forEach(el => {
    el.addEventListener('change', renderCards);
  });

  // ── Full Refresh ─────────────────────────────────────────────────────
  async function refreshDashboard() {
    await populateLanguageFilter();
    await renderStats();
    await renderChart();
    await renderCards();
  }

  // ── Resize handler for chart ─────────────────────────────────────────
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(renderChart, 200);
  });

  // Initial render — wait for Firebase Auth to restore session first
  onAuthStateChanged(auth, () => {
    refreshDashboard();
  });
});


// ── API Calls ─────────────────────────────────────────────────────────────
async function runAutopsy(code, language) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 130000);
  try {
    const res = await fetch('/api/autopsy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, language }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || 'Diagnostic failed'); }
    return await res.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') throw new Error('Analysis timed out. Please try again.');
    throw error;
  }
}

async function runExplain(code, language) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 130000);
  try {
    const res = await fetch('/api/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, language }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || 'Explanation failed'); }
    return await res.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') throw new Error('Explanation timed out. Please try again.');
    throw error;
  }
}

async function runSmell(code, language) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 130000);
  try {
    const res = await fetch('/api/smell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, language }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || 'Smell detection failed'); }
    return await res.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') throw new Error('Smell detection timed out. Please try again.');
    throw error;
  }
}

async function runPRReview(prUrl, sessionId) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 130000);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (sessionId) headers['x-github-session'] = sessionId;
    const res = await fetch('/api/pr-review', {
      method: 'POST',
      headers,
      body: JSON.stringify({ prUrl }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || 'PR review failed'); }
    return await res.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') throw new Error('PR review timed out. Please try again.');
    throw error;
  }
}

// ── Format Code ───────────────────────────────────────────
function formatCode(code) {
  if (!code || typeof code !== 'string') return code;
  const trimmed = code.trim();
  if ((trimmed.match(/\n/g) || []).length > 4) return trimmed;

  // HTML formatter
  if (/<[a-zA-Z][\s\S]*?>/.test(trimmed)) {
    let f = trimmed
      .replace(/>\s*</g, '>\n<')
      .replace(/>\s*([^<\n])/g, '>\n$1')
      .replace(/([^>\n])\s*</g, '$1\n<')
      .replace(/\n{2,}/g, '\n').trim();
    let indent = 0;
    const voidTags = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
    return f.split('\n').map(line => {
      const t = line.trim(); if (!t) return '';
      const isClosing = /^<\//.test(t);
      const tag = (t.match(/<(\w+)/) || [])[1]?.toLowerCase();
      const isSelfClosing = /\/>$/.test(t) || voidTags.has(tag);
      if (isClosing) indent = Math.max(0, indent - 1);
      const result = '  '.repeat(indent) + t;
      if (!isClosing && !isSelfClosing && /^<[a-zA-Z]/.test(t) && !/<\/\w+>$/.test(t)) indent++;
      return result;
    }).join('\n');
  }

  // JS/TS/other formatter
  let f = trimmed
    .replace(/\{(?!\s*\n)/g, '{\n')
    .replace(/(?<!\n)\s*\}/g, '\n}')
    .replace(/;(?!\s*\n)(?!\s*})/g, ';\n')
    .replace(/\s+(if|for|while|return|const|let|var|function|class|import|export|else)\s+/g, '\n$1 ')
    .replace(/\n{3,}/g, '\n\n').trim();
  let indent = 0;
  return f.split('\n').map(line => {
    const t = line.trim(); if (!t) return '';
    if (t.startsWith('}') || t.startsWith(')') || t.startsWith(']')) indent = Math.max(0, indent - 1);
    const result = '  '.repeat(indent) + t;
    if (t.endsWith('{') || t.endsWith('(') || t.endsWith('[')) indent++;
    return result;
  }).join('\n');
}

// ── Character hover color effect ──────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const heroParas = document.querySelectorAll('.hero p');
  if (heroParas && heroParas.length) {
    heroParas.forEach(para => {
      const text = para.innerText || '';
      para.innerHTML = text.split('').map(char =>
        char === ' ' ? ' ' : `<span class="hover-char">${char}</span>`
      ).join('');
    });
  }

  const hoverChars = document.querySelectorAll('.hover-char');
  if (hoverChars && hoverChars.length) {
    hoverChars.forEach(span => {
      span.addEventListener('mouseenter', () => {
        span.style.color = 'var(--accent-red)';
        span.style.transition = 'color 0.2s ease';
        setTimeout(() => { span.style.color = ''; }, 600);
      });
    });
  }
});
