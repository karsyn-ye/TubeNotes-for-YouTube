// Content script for TubeNotes Chrome extension
// Injects side panel into YouTube video pages

(function () {
  'use strict';

  // Debug: Log that script is loading
  console.log('%c TubeNotes: NEW ANALYTICS VERSION LOADED ', 'background: #000; color: #00ff00; font-size: 16px; font-weight: bold;');
  console.log('TubeNotes: Content script loaded on', window.location.href);

  // Prevent duplicate initialization if script is injected multiple times
  if (window.tubeNotesInitialized) {
    console.log('TubeNotes: Already initialized, skipping duplicate injection');
    return;
  }
  window.tubeNotesInitialized = true;

  let sidePanel = null;
  let isPanelOpen = false;
  let eventListenersAttached = false;
  let navigationObserver = null;
  let lastVideoId = '';
  let checkInterval = null;
  let navigationEventListenersSet = false;
  let domObserver = null; // Observer to detect when YouTube removes our panel
  let waitingForNavigation = false; // Flag to prevent premature injection during navigation
  let userClosed = false; // Flag to prevent re-injection after user closes panel

  // Firebase Configuration
  const firebaseConfig = {
    apiKey: "AIzaSyDbypybuQ9JuPhGNKnY_N6fzIVROGyKs8Y",
    authDomain: "tubenotes-71232.firebaseapp.com",
    projectId: "tubenotes-71232",
    storageBucket: "tubenotes-71232.firebasestorage.app",
    messagingSenderId: "816541802008",
    appId: "1:816541802008:web:f8aec607ee2e6164dd2d6d"
  };

  // Analytics State - Proxy to Background
  const analytics = {
    logEvent: (eventName, params = {}) => {
      try {
        // Only attempt to send if extension context is valid
        if (chrome.runtime?.id) {
          console.log('TubeNotes: Proxying event to background:', eventName);
          chrome.runtime.sendMessage({
            type: 'ANALYTICS_EVENT',
            eventName,
            params
          }).catch(() => {
            // Background script might be waking up or unreachable
          });
        }
      } catch (e) {
        // Silently fail to avoid console noise
      }
    }
  };
  let sessionStartTime = 0;

  // Initialize Firebase (Required for Auth)
  try {
    if (typeof firebase !== 'undefined') {
      if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
      }
      // Note: Analytics is handled via proxy to background script
    }
  } catch (e) {
    console.error('TubeNotes: Firebase init failed', e);
  }

  // Check if we're on a YouTube watch page
  function isYouTubeWatchPage() {
    return window.location.pathname === '/watch' && window.location.search.includes('v=');
  }

  // Function to update toggle switch state
  function updateButtonState(isActive) {
    const toggleBtn = document.querySelector('#tubenotes-toggle-btn');
    if (!toggleBtn) return;

    const track = toggleBtn.querySelector('#tubenotes-toggle-track');
    const thumb = toggleBtn.querySelector('#tubenotes-toggle-thumb');
    const icon = toggleBtn.querySelector('#tubenotes-toggle-icon');

    if (track && thumb && icon) {
      if (isActive) {
        // Slide to right (52px track - 20px thumb - 4px padding = 28px)
        thumb.style.left = '28px';
        track.style.background = 'rgba(255, 255, 255, 0.7)';
        icon.style.filter = 'none';
        toggleBtn.setAttribute('aria-label', 'TubeNotes is on');
        toggleBtn.setAttribute('title', 'TubeNotes is on');
      } else {
        // Slide to left
        thumb.style.left = '4px';
        track.style.background = 'rgba(255, 255, 255, 0.35)';
        icon.style.filter = 'grayscale(100%)';
        toggleBtn.setAttribute('aria-label', 'TubeNotes is off');
        toggleBtn.setAttribute('title', 'TubeNotes is off');
      }
    }
  }

  // Check login status (Delegated to Background Script)
  function checkLoginStatus() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'AUTH_CHECK' }, (response) => {
        if (chrome.runtime.lastError) {
          // Background might not be listening yet or context invalidated
          // Fallback to false
          resolve(false);
        } else {
          resolve(response && response.isAuthenticated);
        }
      });
    });
  }

  // Create side panel HTML

  // Create side panel HTML
  function createSidePanel() {
    const panel = document.createElement('div');
    panel.id = 'tubenotes-side-panel';
    panel.innerHTML = '<div style="padding: 20px; text-align: center; color: #aaa;">Loading...</div>';

    // Analytics: Open App
    if (analytics) {
      analytics.logEvent('open_app', { screen_name: 'SidePanel' });
      sessionStartTime = Date.now();
    }

    sidePanel = panel;
    eventListenersAttached = false;

    // Default to main interface (Guest Mode)
    // Auth is now optional and accessed via the Account icon
    renderMainInterface(panel);

    return panel;
  }

  // Render panel content helper (legacy support if needed)
  function renderPanelContent(panel, isLoggedIn) {
    if (isLoggedIn) renderMainInterface(panel);
    else renderLoginInterface(panel);
  }

  // Render the Login/Signup Interface
  function renderLoginInterface(panel) {
    let isSignUp = false; // Toggle state

    // Analytics: See Login
    if (analytics) analytics.logEvent('see_login');

    const renderForm = () => {
      // Safety check: if panel was removed, stop
      if (!panel) return;

      panel.innerHTML = `
        <div class="tubenotes-header">
          <h2>TubeNotes</h2>
          <div class="tubenotes-header-actions">
            <button id="tubenotes-close-btn" class="tubenotes-close-btn" aria-label="Close" title="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6 6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="tubenotes-login-container" style="
          padding: 40px 24px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: calc(100% - 60px);
          text-align: center;
        ">
          <h3 style="margin: 0 0 32px 0; font-size: 20px; color: white; font-weight: 500;">${isSignUp ? 'Create Account' : 'User Login'}</h3>


          <div style="width: 100%; margin-bottom: 12px;">
            <input type="email" id="tubenotes-email" placeholder="Email address" style="
              width: 100%;
              padding: 12px;
              background: rgba(255, 255, 255, 0.05);
              border: 1px solid rgba(255, 255, 255, 0.3);
              border-radius: 8px;
              color: white;
              font-size: 14px;
              box-sizing: border-box;
              font-family: inherit;
              outline: none;
            ">
          </div>

          <div style="width: 100%; margin-bottom: 8px;">
            <input type="password" id="tubenotes-password" placeholder="Password" style="
              width: 100%;
              padding: 12px;
              background: rgba(255, 255, 255, 0.05);
              border: 1px solid rgba(255, 255, 255, 0.3);
              border-radius: 8px;
              color: white;
              font-size: 14px;
              box-sizing: border-box;
              font-family: inherit;
              outline: none;
            ">
          </div>

          ${isSignUp ? `
          <label class="tubenotes-privacy-wrapper">
            <input type="checkbox" id="tubenotes-privacy-check">
            <div class="tubenotes-checkbox-visual">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" style="display: block;">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
            <div class="tubenotes-privacy-label">
              I have read and accept the <a href="https://docs.google.com/document/d/1iAK27f3kbzE5jAP0GtygHFRY_-NyNN4-r4o4djpe6dA/edit?usp=sharing" target="_blank">Privacy Policy</a>.
            </div>
          </label>
          ` : ''}

          <div id="tubenotes-auth-error" style="color: #ff4444; font-size: 12px; display: none; margin-bottom: 0; text-align: left; width: 100%; box-sizing: border-box; padding: 0 12px;"></div>

          <button id="tubenotes-auth-btn" style="
            width: 100%;
            margin-top: 24px;
            padding: 12px;
            background: #ffffff;
            color: black;
            border: none;
            border-radius: 8px;
            font-weight: 500;
            font-size: 14px;
            cursor: pointer;
            transition: background 0.2s;
            margin-bottom: 16px;
            font-family: inherit;
          ">
            ${isSignUp ? 'Sign Up' : 'Log In'}
          </button>
          
          <div style="font-size: 13px; color: #aaa;">
            ${isSignUp ? 'Already have an account?' : 'Not yet a user?'} 
            <button id="tubenotes-toggle-auth" style="
              background: none; 
              border: none; 
              color: #ffffff; 
              cursor: pointer; 
              font-weight: 500; 
              padding: 0; 
              margin-left: 4px; 
              text-decoration: underline;
              font-size: 13px;
              font-family: inherit;
            ">
              ${isSignUp ? 'Log In' : 'Sign Up'}
            </button>
            ${!isSignUp ? '<div style="font-size: 11px; color: #888; margin-top: 4px;">It\'s FREE and takes less than 1 minute!</div>' : ''}
          </div>
        </div>
      `;

      // Attach Listeners
      const emailInput = panel.querySelector('#tubenotes-email');
      const passInput = panel.querySelector('#tubenotes-password');
      const authBtn = panel.querySelector('#tubenotes-auth-btn');
      const toggleBtn = panel.querySelector('#tubenotes-toggle-auth');
      const closeBtn = panel.querySelector('#tubenotes-close-btn');
      const errorMsg = panel.querySelector('#tubenotes-auth-error');

      // Toggle Mode
      toggleBtn.addEventListener('click', () => {
        isSignUp = !isSignUp;
        // Analytics: Click Signup
        if (isSignUp && analytics) analytics.logEvent('click_signup');
        renderForm();
      });

      // Submit
      authBtn.addEventListener('click', () => {
        const email = emailInput.value.trim();
        const password = passInput.value;

        if (!email || !password) {
          errorMsg.textContent = "* Please enter email and password.";
          errorMsg.style.display = 'block';
          return;
        }

        if (isSignUp) {
          if (password.length < 6) {
            errorMsg.textContent = "* Min. 6 characters.";
            errorMsg.style.display = 'block';
            return;
          }

          const privacyCheck = panel.querySelector('#tubenotes-privacy-check');
          if (privacyCheck && !privacyCheck.checked) {
            errorMsg.textContent = "* Please accept the Privacy Policy.";
            errorMsg.style.display = 'block';
            return;
          }
        }

        authBtn.textContent = "Processing...";
        authBtn.disabled = true;
        errorMsg.style.display = 'none';

        const msgType = isSignUp ? 'AUTH_SIGNUP' : 'AUTH_LOGIN';

        chrome.runtime.sendMessage({ type: msgType, email, password }, (response) => {
          if (chrome.runtime.lastError) {
            console.error("Auth error:", chrome.runtime.lastError);
            errorMsg.textContent = "* Connection error. Please reload the page.";
            errorMsg.style.display = 'block';
            authBtn.textContent = isSignUp ? 'Sign Up' : 'Log In';
            authBtn.disabled = false;
            return;
          }

          if (response && response.success) {
            // Analytics: Sign Up / Login Success
            if (analytics) {
              analytics.logEvent(isSignUp ? 'sign_up' : 'login', { method: 'password' });
            }
            renderMainInterface(panel);
          } else {
            let msg = response.error || "Authentication failed.";
            if (response.code === 'auth/wrong-password' || response.code === 'auth/user-not-found' || response.code === 'auth/invalid-credential') {
              msg = "Incorrect email or password.";
            }
            if (response.code === 'auth/email-already-in-use') msg = "Email already in use.";
            if (response.code === 'auth/weak-password') msg = "Min. 6 characters.";

            errorMsg.textContent = "* " + msg;
            errorMsg.style.display = 'block';
            authBtn.textContent = isSignUp ? 'Sign Up' : 'Log In';
            authBtn.disabled = false;
          }
        });
      });

      // Close
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          // Analytics: Auth Abandon
          if (analytics) analytics.logEvent('auth_abandon');
          userClosed = true;
          cleanupPanel(true);
          updateButtonState(false);
        });
      }
    };

    renderForm();
  }

  // Render the Main Interface (Pins, Buttons, etc.)
  function renderMainInterface(panel) {
    // Add Sign Out SVG icon (a door with arrow)
    panel.innerHTML = `
      <div class="tubenotes-header">
        <h2>TubeNotes</h2>
        <div class="tubenotes-header-actions">

          <button id="tubenotes-export-html-btn" class="tubenotes-export-btn" aria-label="Download" title="Download">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
            </svg>
          </button>
          <button id="tubenotes-cloud-btn" class="tubenotes-cloud-btn" aria-label="Save to Cloud" title="Save to Cloud (Coming Soon)" style="cursor: default; opacity: 0.5;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/>
              <path d="M12 12v9"/>
              <path d="m8 17 4 4 4-4"/>
            </svg>
          </button>
          <button id="tubenotes-account-btn" class="tubenotes-account-btn" aria-label="Account" title="Account (Coming Soon)" style="cursor: default; opacity: 0.5;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          </button>
          <button id="tubenotes-close-btn" class="tubenotes-close-btn" aria-label="Close" title="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="tubenotes-controls">
        <button id="tubenotes-pin-screenshot-btn" class="tubenotes-pin-btn tubenotes-pin-screenshot">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="pin-icon">
            <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
            <circle cx="9" cy="9" r="2"/>
            <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
          </svg>
          Pin Screenshot
        </button>
        <button id="tubenotes-pin-video-btn" class="tubenotes-pin-btn tubenotes-pin-video">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="pin-icon">
            <rect width="14" height="14" x="2" y="5" rx="2" ry="2"/>
            <path d="m22 8-6 4 6 4V8z"/>
          </svg>

          Pin Video Clip
        </button>
      </div>
      <div class="tubenotes-pinned-list" id="tubenotes-pinned-list">
        <div class="tubenotes-empty-state">Learning something great?<br>Pin it and add your quick note!</div>
      </div>
    `;

    // Re-attach listeners for the main interface
    // Re-attach listeners for the main interface
    eventListenersAttached = false; // Force re-attach since we replaced innerHTML
    setupEventListeners();
    loadPinnedItems();

    // Attach Sign Out Listener
    const signOutBtn = panel.querySelector('#tubenotes-signout-btn');
    if (signOutBtn && typeof auth !== 'undefined') {
      signOutBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to sign out?')) {
          auth.signOut().then(() => {
            // onAuthStateChanged will handle the UI switch to Login
          }).catch(e => console.error('Sign out error:', e));
        }
      });
    }

    // Attach Account Button Listener
    const accountBtn = panel.querySelector('#tubenotes-account-btn');
    if (accountBtn) {
      // Disabled for now
      // accountBtn.addEventListener('click', () => {
      //   renderLoginInterface(panel);
      // });
    }
  }

  // Check and show onboarding popup
  function checkAndShowOnboarding() {
    chrome.storage.local.get(['hasSeenOnboarding'], (result) => {
      if (!result.hasSeenOnboarding) {
        showOnboardingPopup();
      }
    });
  }

  // Show onboarding popup
  function showOnboardingPopup() {
    // Check if valid URL
    let imageUrl;
    try {
      imageUrl = chrome.runtime.getURL('assets/onboarding-guide.png');
    } catch (e) {
      console.warn('TubeNotes: Extension context invalidated, skipping onboarding.');
      return;
    }

    // Check if popup already exists
    if (document.getElementById('tubenotes-onboarding-popup')) return;

    const popup = document.createElement('div');
    popup.id = 'tubenotes-onboarding-popup';
    popup.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.7);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 0.3s ease;
    `;

    popup.innerHTML = `
      <div style="
        background: #1f1f1f;
        padding: 24px;
        border-radius: 16px;
        max-width: 90%;
        width: 600px;
        text-align: center;
        box-shadow: 0 10px 40px rgba(0,0,0,0.5);
        border: 1px solid rgba(255,255,255,0.1);
        position: relative;
        transform: scale(0.9);
        transition: transform 0.3s ease;
      ">
        <button id="tubenotes-onboarding-close" style="
          position: absolute;
          top: 16px;
          right: 16px;
          background: none;
          border: none;
          color: #aaa;
          cursor: pointer;
          padding: 4px;
        ">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6 6 18M6 6l12 12"/>
          </svg>
        </button>
        
        <h2 style="color: white; margin: 0 0 16px 0; font-size: 24px;">Welcome to TubeNotes!</h2>
        <p style="color: #ccc; margin-bottom: 24px; font-size: 16px;">Get started by clicking the toggle button in the player controls :) </p>
        
        <div style="
          margin-bottom: 24px;
          border-radius: 8px;
          overflow: hidden;
          border: 1px solid rgba(255,255,255,0.1);
        ">
          <img src="${imageUrl}" style="width: 100%; display: block;" alt="TubeNotes Onboarding Guide">
        </div>
        
        <button id="tubenotes-onboarding-got-it" style="
          background: #ffffff;
          color: black;
          border: none;
          padding: 10px 24px;
          border-radius: 20px;
          font-weight: 600;
          font-size: 14px;
          cursor: pointer;
          transition: background 0.2s;
        ">Got it!</button>
      </div>
    `;

    document.body.appendChild(popup);

    // Animate in
    requestAnimationFrame(() => {
      popup.style.opacity = '1';
      popup.querySelector('div').style.transform = 'scale(1)';
    });

    const closePopup = () => {
      popup.style.opacity = '0';
      popup.querySelector('div').style.transform = 'scale(0.9)';
      setTimeout(() => {
        popup.remove();
        chrome.storage.local.set({ hasSeenOnboarding: true });
      }, 300);
    };

    popup.querySelector('#tubenotes-onboarding-close').addEventListener('click', closePopup);
    popup.querySelector('#tubenotes-onboarding-got-it').addEventListener('click', closePopup);
    popup.addEventListener('click', (e) => {
      if (e.target === popup) closePopup();
    });
  }


  // Create toggle button to show/hide panel
  function createToggleButton() {
    // Check if button already exists
    if (document.querySelector('#tubenotes-toggle-btn')) {
      console.log('TubeNotes: Toggle button already exists');
      return;
    }

    // Find YouTube's controls container (left side near timeline)
    const controls = document.querySelector('.ytp-left-controls');
    if (!controls) {
      console.log('TubeNotes: Controls container not found, retrying...');
      setTimeout(createToggleButton, 500);
      return;
    }

    // Create toggle button
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'tubenotes-toggle-btn';
    toggleBtn.className = 'ytp-button';
    toggleBtn.setAttribute('aria-label', 'TubeNotes is off');
    toggleBtn.setAttribute('title', 'TubeNotes is off');

    // Create sliding toggle switch
    let iconUrl;
    try {
      iconUrl = chrome.runtime.getURL('icons/icon128.png');
    } catch (e) {
      console.warn('TubeNotes: Extension context invalidated, stopping UI creation.');
      return;
    }

    toggleBtn.innerHTML = `
    <div id="tubenotes-toggle-track" style="
      width: 52px!important;
      height: 28px!important;
      background: rgba(255, 255, 255, 0.35);
      border-radius: 14px!important;
      position: relative!important;
      transition: background 0.3s ease;
      overflow: hidden!important;
      display: block!important;
    ">
      <div id="tubenotes-toggle-thumb" style="
        width: 20px!important;
        height: 20px!important;
        background: black!important;
        border-radius: 10px!important;
        position: absolute!important;
        top: 4px!important;
        left: 4px!important;
        transition: left 0.3s ease!important;
        display: flex!important;
        align-items: center!important;
        justify-content: center!important;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3)!important;
        overflow: hidden!important;
      ">
        <img id="tubenotes-toggle-icon" src="${iconUrl}" style="
          width: 14px!important;
          height: 14px!important;
          filter: grayscale(100%);
          transition: filter 0.3s ease;
          object-fit: contain!important;
          display: block!important;
          transform: scale(1.6);
        ">
      </div>
    </div>
    `;
    toggleBtn.style.cssText = 'cursor: pointer; padding: 4px; display: flex; align-items: center; justify-content: center; width: 60px !important; min-width: 60px !important; height: auto !important;';


    // Add click handler
    toggleBtn.addEventListener('click', () => {
      if (sidePanel && sidePanel.parentNode) {
        // Panel exists, remove it
        console.log('TubeNotes: Toggling panel OFF');
        cleanupPanel(true); // Keep button when manually toggling off
        userClosed = true;
        updateButtonState(false);
      } else {
        // Panel doesn't exist, create it
        console.log('TubeNotes: Toggling panel ON');
        userClosed = false;
        injectSidePanelIntoYouTube();
        updateButtonState(true);
      }
    });

    // Set initial state (off/left position)
    updateButtonState(false);

    // Insert button into left controls (after play button and volume)
    controls.appendChild(toggleBtn);
    console.log('TubeNotes: Toggle button created in left controls');

    // Show onboarding popup if first time
    checkAndShowOnboarding();
  }

  // Inject panel into YouTube's container (not independent)
  function injectSidePanelIntoYouTube() {
    const targetContainer = document.querySelector('#related') || document.querySelector('#secondary');

    if (!targetContainer) {
      console.log('TubeNotes: YouTube container not found');
      return;
    }

    // Remove any existing panel
    const existingPanel = targetContainer.querySelector('#tubenotes-side-panel');
    if (existingPanel) {
      existingPanel.remove();
    }

    // Create and inject panel
    const panel = createSidePanel();
    targetContainer.insertBefore(panel, targetContainer.firstChild);
    sidePanel = panel;
    isPanelOpen = true;
    eventListenersAttached = false;

    console.log('TubeNotes: Panel injected into YouTube container');

    // Set up event listeners - handled by renderMainInterface after checkLoginStatus
    // setTimeout(() => {
    //   setupEventListeners();
    //   loadPinnedItems();
    // }, 150);
  }

  // Inject side panel into page (DISABLED - now using toggle button)
  function injectSidePanel(force = false) {
    console.log('TubeNotes: injectSidePanel called but disabled - use toggle button instead');
    return; // Disabled in favor of manual toggle

    console.log('TubeNotes: injectSidePanel called, force:', force);

    if (!isYouTubeWatchPage()) {
      console.log('TubeNotes: Not on watch page, aborting injection');
      return;
    }

    // Get current video ID
    const currentVideoId = new URLSearchParams(location.search).get('v') || '';
    console.log('TubeNotes: Current video ID:', currentVideoId);

    // Check if panel already exists and is in the DOM for the same video
    if (!force && sidePanel && sidePanel.parentNode && lastVideoId === currentVideoId) {
      console.log('TubeNotes: Panel already exists for this video, refreshing content');
      // Just refresh the content for current video
      loadPinnedItems();
      return;
    }

    // If video changed or force recreate, clean up old panel
    if (lastVideoId !== currentVideoId || force) {
      console.log('TubeNotes: Cleaning up old panel (video changed or forced)');
      cleanupPanel();
      lastVideoId = currentVideoId;
    }

    // Remove any orphaned panel references and listeners
    if (sidePanel && !sidePanel.parentNode) {
      console.log('TubeNotes: Removing orphaned panel reference');
      removeEventListeners();
      sidePanel = null;
    }

    // Instead of injecting into YouTube's containers (which they control),
    // create our own fixed-position container
    let targetContainer = document.querySelector('#tubenotes-container');

    if (!targetContainer) {
      // Find YouTube's recommendation container to get its position
      const relatedContainer = document.querySelector('#related');
      const secondaryContainer = document.querySelector('#secondary');
      const referenceContainer = relatedContainer || secondaryContainer;

      let containerStyles = '';

      if (referenceContainer) {
        // Get the exact position and size of YouTube's sidebar
        const rect = referenceContainer.getBoundingClientRect();
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

        // Try to get video player height for better sizing
        const videoPlayer = document.querySelector('#player');
        const playerHeight = videoPlayer ? videoPlayer.getBoundingClientRect().height : 600;

        containerStyles = `
  position: absolute;
  top: ${rect.top + scrollTop}px;
  left: ${rect.left}px;
  width: ${rect.width}px;
  height: ${playerHeight}px;
  max-height: 800px;
  overflow-y: auto;
  z-index: 2000;
  pointer-events: auto;
  background: #0f0f0f;
  `;
        console.log('TubeNotes: Positioning to overlay recommendations, height:', playerHeight);
      } else {
        // Fallback to fixed position if we can't find the reference
        containerStyles = `
  position: fixed;
  top: 64px;
  right: 0;
  width: 402px;
  height: calc(100vh - 64px);
  z-index: 2000;
  pointer-events: auto;
  background: #0f0f0f;
  `;
        console.log('TubeNotes: Using fallback fixed positioning');
      }

      // Create our own container
      targetContainer = document.createElement('div');
      targetContainer.id = 'tubenotes-container';
      targetContainer.style.cssText = containerStyles;
      document.body.appendChild(targetContainer);
      console.log('TubeNotes: Created independent container');
    }

    console.log('TubeNotes: Target container (independent):', targetContainer ? 'FOUND' : 'NOT FOUND');

    if (targetContainer) {
      // Remove any existing panel from container (cleanup)
      const existingPanel = targetContainer.querySelector('#tubenotes-side-panel');
      if (existingPanel) {
        console.log('TubeNotes: Removing existing panel from DOM');
        removeEventListeners();
        existingPanel.remove();
        sidePanel = null;
      }

      // Create new panel
      console.log('TubeNotes: Creating and injecting new panel');
      const panel = createSidePanel();
      targetContainer.appendChild(panel);
      isPanelOpen = true;
      eventListenersAttached = false; // Reset flag for new panel

      // Reset retry counter on successful injection
      window.tubeNotesRetryCount = 0;

      console.log('TubeNotes: Panel injected successfully into independent container!');

      // Verify panel is in DOM and visible
      setTimeout(() => {
        const panelInDom = document.querySelector('#tubenotes-side-panel');
        if (panelInDom) {
          const styles = window.getComputedStyle(panelInDom);
          const parent = panelInDom.parentElement;
          console.log('TubeNotes: Panel verification:', {
            inDOM: true,
            display: styles.display,
            visibility: styles.visibility,
            opacity: styles.opacity,
            parentElement: parent?.tagName,
            parentId: parent?.id,
            parentClass: parent?.className,
            hasParent: !!parent,
            isFirstChild: parent?.firstChild === panelInDom,
            siblingCount: parent?.children.length
          });
        } else {
          console.error('TubeNotes: Panel NOT found in DOM after injection!');
        }
      }, 200);

      // Temporarily disabled: DOM observer causes re-injection loop with YouTube's SPA navigation
      // setupDOMObserver();

      // Wait a moment for DOM to settle, then set up event listeners
      setTimeout(() => {
        setupEventListeners();
        // Load saved pins (after event listeners are set up)
        loadPinnedItems();
      }, 150);
    } else {
      console.error('TubeNotes: Could not create independent container');
    }
  }

  // Extract current transcript from YouTube
  function getCurrentTranscript() {
    // Method 1: Check for visible captions in the video player (most reliable)
    const captionSegments = document.querySelectorAll('.ytp-caption-segment');
    if (captionSegments.length > 0) {
      const captionText = Array.from(captionSegments)
        .map(cap => cap.textContent.trim())
        .filter(text => text.length > 0)
        .join(' ');
      if (captionText) {
        return captionText;
      }
    }

    // Method 2: Check YouTube's transcript panel (if open)
    const activeSegment = document.querySelector('ytd-transcript-segment-renderer[aria-current="true"] .segment-text');
    if (activeSegment) {
      return activeSegment.textContent.trim();
    }

    // Method 3: Try to find any active transcript segment
    const transcriptItems = document.querySelectorAll('#segments-container ytd-transcript-segment-renderer');
    if (transcriptItems.length > 0) {
      // Find the currently active/highlighted transcript segment
      for (const item of transcriptItems) {
        const activeIndicator = item.querySelector('[aria-current="true"]');
        if (activeIndicator) {
          const text = item.querySelector('.segment-text');
          if (text) {
            return text.textContent.trim();
          }
        }
      }

      // Fallback: Find segment near current time
      const video = document.querySelector('video');
      if (video) {
        const currentTime = video.currentTime;
        // Try to find a segment that matches the current time (approximate)
        for (const item of transcriptItems) {
          const timestampEl = item.querySelector('.segment-timestamp');
          if (timestampEl) {
            const timestampText = timestampEl.textContent.trim();
            // Simple check - if timestamp is close to current time
            // YouTube timestamps are in format like "0:12" or "1:23"
            const parts = timestampText.split(':');
            if (parts.length === 2) {
              const segmentTime = parseInt(parts[0]) * 60 + parseInt(parts[1]);
              if (Math.abs(segmentTime - currentTime) < 2) {
                const text = item.querySelector('.segment-text');
                if (text) {
                  return text.textContent.trim();
                }
              }
            }
          }
        }
      }
    }

    return '';
  }

  // Get transcript for a specific time range (for video clips)
  function getTranscriptForTimeRange(startTime, endTime) {
    const transcriptItems = document.querySelectorAll('#segments-container ytd-transcript-segment-renderer');

    if (transcriptItems.length === 0) {
      // No transcript panel available, try to get from visible captions
      // This is less accurate for time ranges
      return getCurrentTranscript();
    }

    const transcriptSegments = [];

    for (const item of transcriptItems) {
      const timestampEl = item.querySelector('.segment-timestamp');
      const textEl = item.querySelector('.segment-text');

      if (timestampEl && textEl) {
        const timestampText = timestampEl.textContent.trim();
        const parts = timestampText.split(':');

        if (parts.length === 2) {
          const segmentTime = parseInt(parts[0]) * 60 + parseInt(parts[1]);

          // Include segments that fall within or start near the time range
          // Use a 5-second buffer to catch longer transcript segments
          if (segmentTime >= Math.floor(startTime) - 1 && segmentTime <= Math.ceil(endTime) + 5) {
            transcriptSegments.push({
              time: segmentTime,
              text: textEl.textContent.trim()
            });
          }
        } else if (parts.length === 3) {
          // Handle timestamps like "1:23:45" (hours:minutes:seconds)
          const segmentTime = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);

          if (segmentTime >= Math.floor(startTime) - 1 && segmentTime <= Math.ceil(endTime) + 5) {
            transcriptSegments.push({
              time: segmentTime,
              text: textEl.textContent.trim()
            });
          }
        }
      }
    }

    // Sort by time and join
    transcriptSegments.sort((a, b) => a.time - b.time);
    const transcriptText = transcriptSegments.map(seg => seg.text).join(' ');
    console.log(`TubeNotes: Captured ${transcriptSegments.length} segments for range ${startTime.toFixed(1)}s - ${endTime.toFixed(1)} s`);

    return transcriptText || getCurrentTranscript(); // Fallback to current if no range found
  }

  // Get current video timestamp
  function getCurrentTimestamp() {
    const video = document.querySelector('video');
    if (video) {
      return Math.floor(video.currentTime);
    }
    return 0;
  }

  // Format timestamp as MM:SS
  function formatTimestamp(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')} `;
  }

  // Compress image data URL
  function compressImage(dataUrl, maxWidth = 320, quality = 0.7) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // Calculate new dimensions maintaining aspect ratio
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Convert to JPEG with compression
        const compressed = canvas.toDataURL('image/jpeg', quality);
        resolve(compressed);
      };
      img.onerror = () => resolve(dataUrl); // Return original if compression fails
      img.src = dataUrl;
    });
  }

  // Capture video clip from video player
  // Capture screenshot from video player
  async function captureScreenshot() {
    try {
      // Get video element
      const video = document.querySelector('video');

      if (!video) {
        throw new Error('Video element not found');
      }

      // Ensure video is ready
      if (video.readyState < 2) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (video.readyState < 2) {
          return '';
        }
      }

      // Use smaller dimensions for screenshot
      const maxWidth = 480;
      let width = video.videoWidth || video.offsetWidth || 640;
      let height = video.videoHeight || video.offsetHeight || 360;

      // Calculate dimensions maintaining aspect ratio
      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }

      // If dimensions are invalid, use defaults
      if (width === 0 || height === 0) {
        width = 480;
        height = 270;
      }

      // Create canvas for capturing frame
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      // Draw current video frame to canvas
      ctx.drawImage(video, 0, 0, width, height);

      // Convert canvas to base64 image
      const screenshotDataUrl = canvas.toDataURL('image/jpeg', 0.8);

      console.log('TubeNotes: Screenshot captured successfully');
      return screenshotDataUrl;
    } catch (error) {
      console.error('TubeNotes: Error capturing screenshot:', error);
      return '';
    }
  }


  async function captureVideoClip(duration = 5, startTime = null) {

    try {
      // Get video element
      const video = document.querySelector('video');

      if (!video) {
        throw new Error('Video element not found');
      }

      // Ensure video is ready
      if (video.readyState < 2) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (video.readyState < 2) {
          return '';
        }
      }

      // Use smaller dimensions for video clip
      const maxWidth = 480;
      let width = video.videoWidth || video.offsetWidth || 640;
      let height = video.videoHeight || video.offsetHeight || 360;

      // Calculate dimensions maintaining aspect ratio
      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }

      // If dimensions are invalid, use defaults
      if (width === 0 || height === 0) {
        width = 480;
        height = 270;
      }

      // Create canvas for capturing frames
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      // Store original playback state
      const wasPlaying = !video.paused;
      const originalTime = video.currentTime;

      // If startTime is provided, rewind to that point
      if (startTime !== null) {
        video.currentTime = startTime;
        // Wait for seek to complete
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      // Ensure video is playing for recording (needed to capture motion)
      if (video.paused) {
        await video.play();
        // Wait a moment for playback to start
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Get canvas stream for video
      const canvasStream = canvas.captureStream(30); // 30 fps

      // Get audio stream from video element
      let audioStream = null;
      try {
        // Try to capture audio from video element
        if (video.captureStream) {
          // Modern approach: capture stream directly from video element
          audioStream = video.captureStream();
        } else if (video.mozCaptureStream) {
          // Firefox fallback
          audioStream = video.mozCaptureStream();
        }
      } catch (e) {
        console.warn('Could not capture audio stream:', e);
      }

      // Combine video and audio streams
      const combinedStream = new MediaStream();

      // Add video track from canvas
      canvasStream.getVideoTracks().forEach(track => {
        combinedStream.addTrack(track);
      });

      // Add audio track from video element if available
      if (audioStream) {
        audioStream.getAudioTracks().forEach(track => {
          combinedStream.addTrack(track);
        });
      }

      // Create MediaRecorder with video and audio codec
      let options = {};
      let mimeType = 'video/webm';
      if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')) {
        options.mimeType = 'video/webm;codecs=vp9,opus';
      } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')) {
        options.mimeType = 'video/webm;codecs=vp8,opus';
      } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
        options.mimeType = 'video/webm;codecs=vp9';
      } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) {
        options.mimeType = 'video/webm;codecs=vp8';
      } else if (MediaRecorder.isTypeSupported('video/webm')) {
        options.mimeType = 'video/webm';
      } else {
        throw new Error('Video recording not supported');
      }

      const mediaRecorder = new MediaRecorder(combinedStream, options);
      const chunks = [];

      return new Promise((resolve, reject) => {
        let animationFrameId;

        mediaRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            chunks.push(event.data);
          }
        };

        mediaRecorder.onstop = () => {
          // Restore original playback state
          if (!wasPlaying) {
            video.pause();
            video.currentTime = originalTime; // Return to original position
          }

          // Convert chunks to blob
          const videoBlob = new Blob(chunks, { type: mimeType });

          if (videoBlob.size === 0) {
            reject(new Error('No video data recorded'));
            return;
          }

          // Convert blob to base64 data URL
          const reader = new FileReader();
          reader.onloadend = () => {
            resolve(reader.result);
          };
          reader.onerror = () => {
            reject(new Error('Error reading video blob'));
          };
          reader.readAsDataURL(videoBlob);
        };

        mediaRecorder.onerror = (event) => {
          if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
          }
          combinedStream.getTracks().forEach(track => track.stop());
          if (audioStream) {
            audioStream.getTracks().forEach(track => track.stop());
          }
          canvasStream.getTracks().forEach(track => track.stop());
          if (!wasPlaying) {
            video.pause();
            video.currentTime = originalTime;
          }
          reject(new Error('MediaRecorder error'));
        };

        // Start recording
        mediaRecorder.start(100); // Collect data every 100ms

        // Record frames for the specified duration using requestAnimationFrame
        const endTime = Date.now() + (duration * 1000);

        const drawFrame = () => {
          const now = Date.now();
          if (now >= endTime) {
            mediaRecorder.stop();
            combinedStream.getTracks().forEach(track => track.stop());
            if (audioStream) {
              audioStream.getTracks().forEach(track => track.stop());
            }
            canvasStream.getTracks().forEach(track => track.stop());
            if (animationFrameId) {
              cancelAnimationFrame(animationFrameId);
            }
            return;
          }

          // Draw current video frame to canvas
          try {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          } catch (e) {
            console.error('Error drawing video frame:', e);
          }

          // Continue with next frame
          animationFrameId = requestAnimationFrame(drawFrame);
        };

        // Start drawing frames
        animationFrameId = requestAnimationFrame(drawFrame);
      });
    } catch (error) {
      console.error('Error capturing video clip:', error);
      // Return empty string on error (transcript will still be saved)
      return '';
    }
  }

  // Clean up old pins to free up storage (keep max 500 pins)
  async function cleanupOldPins(maxPins = 500) {
    try {
      const result = await chrome.storage.local.get(['tubenotes_pins']);
      const pins = result.tubenotes_pins || [];

      if (pins.length <= maxPins) {
        return pins;
      }

      // Sort by date (oldest first) and keep only the newest maxPins
      pins.sort((a, b) => new Date(a.date) - new Date(b.date));
      const cleanedPins = pins.slice(-maxPins);

      await chrome.storage.local.set({ tubenotes_pins: cleanedPins });
      return cleanedPins;
    } catch (error) {
      console.error('Error cleaning up pins:', error);
      return [];
    }
  }

  // Save pinned item
  async function savePinnedItem(transcript, videoClip, timestamp, videoId, videoTitle, screenshot = '') {
    const pinData = {
      id: Date.now().toString(),
      timestamp: timestamp,
      transcript: transcript,
      videoClip: videoClip, // 4-second video clip (or empty if screenshot)
      screenshot: screenshot, // Screenshot image (or empty if video)
      videoId: videoId,
      videoTitle: videoTitle,
      notes: '', // User notes (empty by default)
      audio: [], // Audio recordings (array)
      date: new Date().toISOString()
    };

    try {
      // Clean up old pins first to make room
      const cleanedPins = await cleanupOldPins(500);

      // Add new pin
      cleanedPins.push(pinData);

      // Save back to storage
      await chrome.storage.local.set({ tubenotes_pins: cleanedPins });

      return pinData;
    } catch (error) {
      // If quota exceeded, try to clean up more aggressively
      if (error.message && error.message.includes('quota')) {
        try {
          const cleanedPins = await cleanupOldPins(100); // Keep only 100 most recent
          cleanedPins.push(pinData);
          await chrome.storage.local.set({ tubenotes_pins: cleanedPins });
          return pinData;
        } catch (retryError) {
          // If still failing, save without video clip
          const pinDataNoClip = { ...pinData, videoClip: '' };
          const result = await chrome.storage.local.get(['tubenotes_pins']);
          const pins = (result.tubenotes_pins || []).slice(-100); // Keep last 100
          pins.push(pinDataNoClip);
          await chrome.storage.local.set({ tubenotes_pins: pins });
          return pinDataNoClip;
        }
      }
      throw error;
    }
  }

  // Get current video info
  function getVideoInfo() {
    const videoId = new URLSearchParams(window.location.search).get('v') || '';
    const titleElement = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, h1 yt-formatted-string');
    const videoTitle = titleElement ? titleElement.textContent.trim() : 'Untitled Video';

    return { videoId, videoTitle };
  }

  // Handle pin button click
  // Handle screenshot pin button click
  async function handlePinScreenshotClick() {
    const pinBtn = document.getElementById('tubenotes-pin-screenshot-btn');
    if (!pinBtn) return;
    console.log('TubeNotes: Pin Screenshot button clicked');

    // Analytics: Pin Screenshot - Log immediately
    if (analytics) analytics.logEvent('pin_screenshot');

    // Validate we're on a YouTube watch page
    if (!isYouTubeWatchPage()) {
      alert('Please navigate to a YouTube video first.');
      return;
    }

    // Check if video element exists
    const video = document.querySelector('video');
    if (!video) {
      alert('Video not ready yet. Please wait a moment and try again.');
      return;
    }

    // Disable button temporarily
    pinBtn.disabled = true;
    const screenshotIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="pin-icon"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>';
    pinBtn.innerHTML = `${screenshotIcon} Capturing...`;

    try {
      // Get current video info
      const { videoId, videoTitle } = getVideoInfo();

      if (!videoId) {
        throw new Error('Could not determine video ID');
      }

      // Get current timestamp
      const clickTimestamp = getCurrentTimestamp();


      // Capture screenshot (no transcript for screenshots)
      pinBtn.innerHTML = `${screenshotIcon} Taking screenshot...`;
      const screenshot = await captureScreenshot();

      // Graphics logic...

      // Save pinned item with screenshot only (no transcript)
      const pinData = await savePinnedItem('', '', clickTimestamp, videoId, videoTitle, screenshot);

      // Refresh pinned list
      await loadPinnedItems();

      // Show success feedback
      pinBtn.innerHTML = `${screenshotIcon} Captured!`;
      setTimeout(() => {
        pinBtn.innerHTML = `${screenshotIcon} Pin Screenshot`;
        pinBtn.disabled = false;
      }, 1000);
    } catch (error) {
      console.error('Error capturing screenshot:', error);
      pinBtn.innerHTML = `${screenshotIcon} Pin Screenshot`;
      pinBtn.disabled = false;

      // Handle quota exceeded error specifically
      if (error.message && error.message.includes('quota')) {
        alert('Storage quota exceeded. Some old pins have been removed. Please try again.');
        setTimeout(() => loadPinnedItems(), 500);
      } else {
        alert('Error capturing screenshot. Please try again.');
      }
    }
  }


  async function handlePinVideoClick() {

    const pinBtn = document.getElementById('tubenotes-pin-video-btn');
    if (!pinBtn) return;
    console.log('TubeNotes: Pin Video button clicked');

    // Analytics: Pin Video - Log immediately
    if (analytics) analytics.logEvent('pin_video');

    // Validate we're on a YouTube watch page
    if (!isYouTubeWatchPage()) {
      alert('Please navigate to a YouTube video first.');
      return;
    }

    // Check if video element exists
    const video = document.querySelector('video');
    if (!video) {
      alert('Video not ready yet. Please wait a moment and try again.');
      return;
    }

    // Check if video is ready (even at the end)
    if (video.readyState < 2) {
      // Wait a moment for video to load
      await new Promise(resolve => setTimeout(resolve, 200));
      if (video.readyState < 2) {
        alert('Video is still loading. Please wait a moment and try again.');
        return;
      }
    }

    // Disable button temporarily
    pinBtn.disabled = true;
    const videoIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="pin-icon"><rect width="14" height="14" x="2" y="5" rx="2" ry="2"/><path d="m22 8-6 4 6 4V8z"/></svg>';
    pinBtn.innerHTML = `${videoIcon} Pinning...`;

    try {
      // Get current video info
      const { videoId, videoTitle } = getVideoInfo();

      if (!videoId) {
        throw new Error('Could not determine video ID');
      }

      // Get transcript and timestamp
      const clickTimestamp = getCurrentTimestamp();



      // Capture 4-second video clip from current time forward
      pinBtn.innerHTML = `${videoIcon} Recording clip...`;
      const videoClip = await captureVideoClip(4);

      // Now capture transcript for the time range we just recorded
      pinBtn.innerHTML = `${videoIcon} Getting transcript...`;
      const transcriptStartTime = clickTimestamp;
      const transcriptEndTime = clickTimestamp + 4;
      const transcript = getTranscriptForTimeRange(transcriptStartTime, transcriptEndTime);

      // Analytics logic moved to top

      // Save pinned item
      const pinData = await savePinnedItem(transcript, videoClip, clickTimestamp, videoId, videoTitle);

      // Refresh pinned list
      await loadPinnedItems();

      // Show success feedback
      pinBtn.innerHTML = `${videoIcon} Captured!`;
      setTimeout(() => {
        pinBtn.innerHTML = `${videoIcon} Pin Video Clip`;
        pinBtn.disabled = false;
      }, 1000);
    } catch (error) {
      console.error('Error pinning:', error);
      pinBtn.innerHTML = `${videoIcon} Pin Video Clip`;
      pinBtn.disabled = false;

      // Handle quota exceeded error specifically
      if (error.message && error.message.includes('quota')) {
        alert('Storage quota exceeded. Some old pins have been removed. Please try again.');
        // Try to refresh the list after cleanup
        setTimeout(() => loadPinnedItems(), 500);
      } else if (error.message && !error.message.includes('not ready') && !error.message.includes('still loading')) {
        alert('Error pinning moment. Please try again.');
      }
    }
  }

  // Load and display pinned items
  async function loadPinnedItems() {
    const pinnedList = document.getElementById('tubenotes-pinned-list');
    if (!pinnedList) return;

    const result = await chrome.storage.local.get(['tubenotes_pins']);
    const pins = result.tubenotes_pins || [];

    // Filter pins for current video
    const currentVideoId = new URLSearchParams(window.location.search).get('v') || '';
    const currentVideoPins = pins.filter(pin => pin.videoId === currentVideoId);

    if (currentVideoPins.length === 0) {
      pinnedList.innerHTML = '<div class="tubenotes-empty-state">Learning something great?<br>Pin it and add your quick note!</div>';
      return;
    }

    // Sort by timestamp (newest-first by default)
    currentVideoPins.sort((a, b) => b.timestamp - a.timestamp);

    // Render pinned items
    pinnedList.innerHTML = currentVideoPins.map(pin => `
    <div class="tubenotes-pinned-item" data-id="${pin.id}">
      <div class="tubenotes-pinned-header">
        <span class="tubenotes-timestamp">${formatTimestamp(pin.timestamp)}</span>
        <div class="tubenotes-item-actions">
          <button class="tubenotes-edit-btn" data-id="${pin.id}" aria-label="Edit notes" title="Add/edit notes">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
          </button>
          <button class="tubenotes-record-btn" data-id="${pin.id}" aria-label="Record audio" title="Record audio note">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8" />
            </svg>
          </button>
          <button class="tubenotes-delete-btn" data-id="${pin.id}" aria-label="Delete">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />
            </svg>
          </button>
        </div>
      </div>
        ${pin.videoClip ? `
          <video class="tubenotes-video-clip" controls preload="metadata">
            <source src="${pin.videoClip}" type="video/webm">
            Your browser does not support the video element.
          </video>
        ` : pin.screenshot ? `
          <img src="${pin.screenshot}" alt="Video frame at ${formatTimestamp(pin.timestamp)}" class="tubenotes-screenshot" />
        ` : ''
      }
        ${pin.transcript ? `<div class="tubenotes-transcript">${pin.transcript}</div>` : ''}
        ${pin.notes ? `<div class="tubenotes-notes-display">${pin.notes}</div>` : ''}
        ${(Array.isArray(pin.audio) ? pin.audio : (pin.audio ? [pin.audio] : [])).map((audioSrc, index) => `
          <div class="tubenotes-audio-display" data-id="${pin.id}" data-index="${index}">
            <audio controls class="tubenotes-audio-player">
              <source src="${audioSrc}" type="audio/webm">
              <source src="${audioSrc}" type="audio/mp4">
              Your browser does not support the audio element.
            </audio>
            <button class="tubenotes-audio-delete" data-id="${pin.id}" data-index="${index}" aria-label="Delete audio" title="Delete audio">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6 6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        `).join('')}
        <div class="tubenotes-recorder" data-id="${pin.id}" style="display: none;">
          <div class="tubenotes-recorder-status">
            <span class="tubenotes-recorder-indicator"></span>
            <span class="tubenotes-recorder-text">Recording...</span>
          </div>
          <div class="tubenotes-recorder-actions">
            <button class="tubenotes-recorder-stop" data-id="${pin.id}">Stop</button>
            <button class="tubenotes-recorder-cancel" data-id="${pin.id}">Cancel</button>
          </div>
        </div>
        <div class="tubenotes-notes-editor" data-id="${pin.id}" style="display: none;">
          <textarea class="tubenotes-notes-textarea" placeholder="Add your notes here..." rows="2">${pin.notes || ''}</textarea>
          <div class="tubenotes-notes-actions">
            <button class="tubenotes-notes-save" data-id="${pin.id}">Save</button>
            <button class="tubenotes-notes-cancel" data-id="${pin.id}">Cancel</button>
          </div>
        </div>
      </div >
    `).join('');

    // Add click handlers for edit buttons
    pinnedList.querySelectorAll('.tubenotes-edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const pinId = e.currentTarget.getAttribute('data-id');
        const pinItem = e.target.closest('.tubenotes-pinned-item');
        const notesEditor = pinItem.querySelector('.tubenotes-notes-editor');
        const notesDisplay = pinItem.querySelector('.tubenotes-notes-display');

        // Show editor, hide display
        if (notesEditor) {
          notesEditor.style.display = 'block';
          const textarea = notesEditor.querySelector('.tubenotes-notes-textarea');
          if (textarea) {
            textarea.focus();
            textarea.select();
          }
        }
        if (notesDisplay) {
          notesDisplay.style.display = 'none';
        }
      });
    });

    // Add click handlers for save notes
    pinnedList.querySelectorAll('.tubenotes-notes-save').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const pinId = e.currentTarget.getAttribute('data-id');
        const pinItem = e.target.closest('.tubenotes-pinned-item');
        const textarea = pinItem.querySelector('.tubenotes-notes-textarea');
        const notesEditor = pinItem.querySelector('.tubenotes-notes-editor');

        if (textarea) {
          const notes = textarea.value.trim();
          await savePinnedNotes(pinId, notes);

          // Analytics: Add Text Note
          if (analytics && notes) analytics.logEvent('add_text_note');

          // Hide editor, show display (if notes exist)
          if (notesEditor) {
            notesEditor.style.display = 'none';
          }

          // Reload to show updated notes
          await loadPinnedItems();
        }
      });
    });

    // Add click handlers for cancel notes
    pinnedList.querySelectorAll('.tubenotes-notes-cancel').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const pinId = e.currentTarget.getAttribute('data-id');
        const pinItem = e.target.closest('.tubenotes-pinned-item');
        const notesEditor = pinItem.querySelector('.tubenotes-notes-editor');
        const notesDisplay = pinItem.querySelector('.tubenotes-notes-display');

        // Hide editor, show display
        if (notesEditor) {
          notesEditor.style.display = 'none';
          // Reset textarea to original value
          const currentPin = currentVideoPins.find(p => p.id === pinId);
          if (currentPin) {
            const textarea = notesEditor.querySelector('.tubenotes-notes-textarea');
            if (textarea) {
              textarea.value = currentPin.notes || '';
            }
          }
        }
        if (notesDisplay) {
          notesDisplay.style.display = notesDisplay.textContent.trim() ? 'block' : 'none';
        }
      });
    });

    // Add click handlers for record buttons
    pinnedList.querySelectorAll('.tubenotes-record-btn').forEach(btn => {
      if (!btn.hasAttribute('data-listener-attached')) {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const pinId = btn.getAttribute('data-id') || btn.closest('.tubenotes-pinned-item')?.getAttribute('data-id');
          if (pinId) {
            // Update button state immediately
            btn.classList.add('recording');
            await startRecording(pinId);
          }
        });
        btn.setAttribute('data-listener-attached', 'true');
      }
    });

    // Add click handlers for stop recording
    pinnedList.querySelectorAll('.tubenotes-recorder-stop').forEach(btn => {
      if (!btn.hasAttribute('data-listener-attached')) {
        btn.addEventListener('click', async (e) => {
          const pinId = e.currentTarget.getAttribute('data-id');
          await stopRecording(pinId);
        });
        btn.setAttribute('data-listener-attached', 'true');
      }
    });

    // Add click handlers for cancel recording
    pinnedList.querySelectorAll('.tubenotes-recorder-cancel').forEach(btn => {
      if (!btn.hasAttribute('data-listener-attached')) {
        btn.addEventListener('click', async (e) => {
          const pinId = e.currentTarget.getAttribute('data-id');
          cancelRecording(pinId);
        });
        btn.setAttribute('data-listener-attached', 'true');
      }
    });

    // Add click handlers for delete audio buttons
    pinnedList.querySelectorAll('.tubenotes-audio-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const pinId = e.currentTarget.getAttribute('data-id');
        const indexStr = e.currentTarget.getAttribute('data-index');
        const index = parseInt(indexStr, 10);

        if (confirm('Delete this audio note?')) {
          await deleteAudio(pinId, index);
        }
      });
    });

    // Add click handlers for delete buttons
    pinnedList.querySelectorAll('.tubenotes-delete-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const pinId = e.currentTarget.getAttribute('data-id');
        await deletePinnedItem(pinId);
      });
    });

    // Add click handlers for timestamp (seek to that time)
    pinnedList.querySelectorAll('.tubenotes-timestamp').forEach(timestamp => {
      timestamp.style.cursor = 'pointer';
      timestamp.addEventListener('click', (e) => {
        const pinItem = e.target.closest('.tubenotes-pinned-item');
        const pinId = pinItem.getAttribute('data-id');
        const pin = currentVideoPins.find(p => p.id === pinId);
        if (pin && pin.timestamp !== undefined) {
          const video = document.querySelector('video');
          if (video) {
            video.currentTime = pin.timestamp;
          }
        }
      });
    });

    // Update sort button icon to reflect current sort order
    updateSortButtonIcon();

    // If any recordings are active, make sure their recorder UI is visible
    activeRecorders.forEach((recorderData, pinId) => {
      if (recorderData.mediaRecorder && recorderData.mediaRecorder.state !== 'inactive') {
        showRecorder(pinId);
      }
    });
  }

  // Audio recording state
  let activeRecorders = new Map(); // pinId -> { mediaRecorder, chunks, stream }

  // Start audio recording
  async function startRecording(pinId) {
    try {
      // Check if already recording
      if (activeRecorders.has(pinId)) {
        return;
      }

      // Pause the video when recording starts
      const video = document.querySelector('video');
      let wasPlaying = false;
      if (video && !video.paused) {
        video.pause();
        wasPlaying = true;
      }

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Create MediaRecorder with fallback for mimeType
      let options = {};
      let mimeType = 'audio/webm';
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        options.mimeType = 'audio/webm;codecs=opus';
        mimeType = 'audio/webm';
      } else if (MediaRecorder.isTypeSupported('audio/webm')) {
        options.mimeType = 'audio/webm';
        mimeType = 'audio/webm';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        options.mimeType = 'audio/mp4';
        mimeType = 'audio/mp4';
      }

      const mediaRecorder = new MediaRecorder(stream, options);
      const chunks = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Convert chunks to blob
        const audioBlob = new Blob(chunks, { type: mimeType });

        // Convert blob to base64 data URL
        const reader = new FileReader();
        reader.onloadend = async () => {
          const audioDataUrl = reader.result;
          await savePinnedAudio(pinId, audioDataUrl);

          // Analytics: Add Audio Note
          if (analytics) analytics.logEvent('add_audio_note');

          // Stop all tracks
          stream.getTracks().forEach(track => track.stop());

          // Remove from active recorders
          activeRecorders.delete(pinId);

          // Reload to show audio player
          await loadPinnedItems();
        };
        reader.onerror = () => {
          console.error('Error reading audio blob');
          alert('Error processing audio. Please try again.');
          stream.getTracks().forEach(track => track.stop());
          activeRecorders.delete(pinId);
          hideRecorder(pinId);
        };
        reader.readAsDataURL(audioBlob);
      };

      mediaRecorder.onerror = (event) => {
        console.error('Recording error:', event.error);
        alert('Error recording audio. Please try again.');
        stream.getTracks().forEach(track => track.stop());
        activeRecorders.delete(pinId);
        hideRecorder(pinId);
      };

      // Store recorder state (remember if video was playing)
      activeRecorders.set(pinId, {
        mediaRecorder,
        chunks,
        stream,
        wasPlaying: wasPlaying
      });

      // Show recorder UI BEFORE starting recording to ensure it's visible
      showRecorder(pinId);

      // Wait a moment to ensure UI is rendered and event listeners are attached
      await new Promise(resolve => setTimeout(resolve, 100));

      // Double-check recorder UI is visible before starting
      const pinItem = document.querySelector(`.tubenotes-pinned-item[data-id="${pinId}"]`);
      if (pinItem) {
        const recorder = pinItem.querySelector('.tubenotes-recorder');
        if (recorder && recorder.style.display === 'none') {
          recorder.style.display = 'block';
        }
      }

      // Start recording
      mediaRecorder.start();

      // Verify recording started and UI is visible
      if (mediaRecorder.state === 'recording') {
        showRecorder(pinId); // Ensure UI is visible one more time
      }

    } catch (error) {
      console.error('Error starting recording:', error);
      // Clean up on error
      if (activeRecorders.has(pinId)) {
        const recorderData = activeRecorders.get(pinId);
        if (recorderData && recorderData.stream) {
          recorderData.stream.getTracks().forEach(track => track.stop());
        }
        activeRecorders.delete(pinId);
      }
      hideRecorder(pinId);

      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        alert('Microphone access denied. Please allow microphone access and try again.');
      } else {
        alert('Error starting recording. Please try again.');
      }
    }
  }

  // Stop recording
  async function stopRecording(pinId) {
    const recorderData = activeRecorders.get(pinId);
    if (recorderData) {
      try {
        if (recorderData.mediaRecorder && recorderData.mediaRecorder.state === 'recording') {
          recorderData.mediaRecorder.stop();
        } else if (recorderData.mediaRecorder && recorderData.mediaRecorder.state === 'paused') {
          recorderData.mediaRecorder.stop();
        }
      } catch (error) {
        console.error('Error stopping recorder:', error);
        // Force stop the stream if recorder fails
        if (recorderData.stream) {
          recorderData.stream.getTracks().forEach(track => track.stop());
        }
        activeRecorders.delete(pinId);
        hideRecorder(pinId);
      }
      hideRecorder(pinId);

      // Remove recording class from button
      const pinItem = document.querySelector(`.tubenotes-pinned-item[data-id="${pinId}"]`);
      if (pinItem) {
        const recordBtn = pinItem.querySelector('.tubenotes-record-btn');
        if (recordBtn) {
          recordBtn.classList.remove('recording');
        }
      }
    } else {
      // If no recorder data but recording might be active, force cleanup
      hideRecorder(pinId);
    }
  }

  // Cancel recording
  function cancelRecording(pinId) {
    const recorderData = activeRecorders.get(pinId);
    if (recorderData) {
      try {
        if (recorderData.mediaRecorder && recorderData.mediaRecorder.state !== 'inactive') {
          recorderData.mediaRecorder.stop();
        }
      } catch (error) {
        console.error('Error canceling recorder:', error);
      }

      if (recorderData.stream) {
        recorderData.stream.getTracks().forEach(track => {
          try {
            track.stop();
          } catch (error) {
            console.error('Error stopping track:', error);
          }
        });
      }
      activeRecorders.delete(pinId);
    }
    hideRecorder(pinId);

    // Remove recording class from button
    const pinItem = document.querySelector(`.tubenotes-pinned-item[data-id="${pinId}"]`);
    if (pinItem) {
      const recordBtn = pinItem.querySelector('.tubenotes-record-btn');
      if (recordBtn) {
        recordBtn.classList.remove('recording');
      }
    }

    // Video remains paused after cancel - user can manually resume
  }

  // Show recorder UI
  function showRecorder(pinId) {
    const pinItem = document.querySelector(`.tubenotes-pinned-item[data-id="${pinId}"]`);
    if (pinItem) {
      const recorder = pinItem.querySelector('.tubenotes-recorder');
      if (recorder) {
        recorder.style.display = 'block';
        const indicator = recorder.querySelector('.tubenotes-recorder-indicator');
        if (indicator) {
          indicator.classList.add('recording');
        }

        // Ensure event listeners are attached to stop/cancel buttons
        const stopBtn = recorder.querySelector('.tubenotes-recorder-stop');
        const cancelBtn = recorder.querySelector('.tubenotes-recorder-cancel');

        // Remove existing listeners if any to prevent duplicates
        if (stopBtn) {
          const newStopBtn = stopBtn.cloneNode(true);
          stopBtn.parentNode.replaceChild(newStopBtn, stopBtn);
          newStopBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await stopRecording(pinId);
          });
        }

        if (cancelBtn) {
          const newCancelBtn = cancelBtn.cloneNode(true);
          cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
          newCancelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            cancelRecording(pinId);
          });
        }
      } else {
        // If recorder element doesn't exist, it means the item was removed or reloaded
        // Try to reload and show recorder
        console.warn('Recorder element not found for pinId:', pinId);
        setTimeout(() => {
          loadPinnedItems().then(() => {
            showRecorder(pinId);
          });
        }, 200);
      }
    } else {
      // Pin item doesn't exist - might need to reload
      console.warn('Pin item not found for pinId:', pinId);
    }
  }

  // Hide recorder UI
  function hideRecorder(pinId) {
    const pinItem = document.querySelector(`.tubenotes-pinned-item[data-id="${pinId}"]`);
    if (pinItem) {
      const recorder = pinItem.querySelector('.tubenotes-recorder');
      if (recorder) {
        recorder.style.display = 'none';
        const indicator = recorder.querySelector('.tubenotes-recorder-indicator');
        if (indicator) {
          indicator.classList.remove('recording');
        }
      }
    }
  }

  // Save audio for a pinned item
  async function savePinnedAudio(pinId, audioDataUrl) {
    try {
      const result = await chrome.storage.local.get(['tubenotes_pins']);
      const pins = result.tubenotes_pins || [];

      // Find and update the pin
      const pinIndex = pins.findIndex(pin => pin.id === pinId);
      if (pinIndex !== -1) {
        // Migration: Ensure audio is an array
        let currentAudio = pins[pinIndex].audio;
        if (!Array.isArray(currentAudio)) {
          // If it was a string and not empty, convert to array
          currentAudio = currentAudio ? [currentAudio] : [];
        }

        // Add new audio to the list
        currentAudio.push(audioDataUrl);
        pins[pinIndex].audio = currentAudio;

        await chrome.storage.local.set({ tubenotes_pins: pins });
      }
    } catch (error) {
      console.error('Error saving audio:', error);
      throw error;
    }
  }

  // Delete audio for a pinned item
  async function deleteAudio(pinId, audioIndex) {
    try {
      const result = await chrome.storage.local.get(['tubenotes_pins']);
      const pins = result.tubenotes_pins || [];

      // Find and update the pin
      const pinIndex = pins.findIndex(pin => pin.id === pinId);
      if (pinIndex !== -1) {
        let currentAudio = pins[pinIndex].audio;

        // Migration check
        if (!Array.isArray(currentAudio)) {
          if (typeof currentAudio === 'string' && currentAudio) {
            currentAudio = [currentAudio];
          } else {
            return; // Nothing to delete
          }
        }

        // Remove specific index
        if (audioIndex >= 0 && audioIndex < currentAudio.length) {
          currentAudio.splice(audioIndex, 1);
        }

        pins[pinIndex].audio = currentAudio;
        await chrome.storage.local.set({ tubenotes_pins: pins });
        await loadPinnedItems();
      }
    } catch (error) {
      console.error('Error deleting audio:', error);
    }
  }

  // Save notes for a pinned item
  async function savePinnedNotes(pinId, notes) {
    try {
      const result = await chrome.storage.local.get(['tubenotes_pins']);
      const pins = result.tubenotes_pins || [];

      // Find and update the pin
      const pinIndex = pins.findIndex(pin => pin.id === pinId);
      if (pinIndex !== -1) {
        pins[pinIndex].notes = notes;
        await chrome.storage.local.set({ tubenotes_pins: pins });
      }
    } catch (error) {
      console.error('Error saving notes:', error);
      throw error;
    }
  }

  // Delete pinned item
  async function deletePinnedItem(pinId) {
    const result = await chrome.storage.local.get(['tubenotes_pins']);
    const pins = result.tubenotes_pins || [];
    const filteredPins = pins.filter(pin => pin.id !== pinId);
    await chrome.storage.local.set({ tubenotes_pins: filteredPins });
    await loadPinnedItems();
  }

  // Export all notes to HTML file
  async function exportToHTML() {
    try {
      // Get current video ID
      const currentVideoId = new URLSearchParams(window.location.search).get('v') || '';
      if (!currentVideoId) {
        alert('Please navigate to a YouTube video first.');
        return;
      }

      // Analytics: Share (Export)
      if (analytics) analytics.logEvent('share', { content_type: 'html_export' });

      const result = await chrome.storage.local.get(['tubenotes_pins', 'tubenotes_export_count', 'tubenotes_is_registered']);
      const pins = result.tubenotes_pins || [];
      const currentCount = result.tubenotes_export_count || 0;
      const isRegistered = result.tubenotes_is_registered || false;

      // Filter pins to only include current video
      const currentVideoPins = pins.filter(pin => pin.videoId === currentVideoId);

      if (currentVideoPins.length === 0) {
        alert('No notes to export for this video. Pin some moments first!');
        return;
      }

      // Check limits
      if (currentCount >= 3 && !isRegistered) {
        const userChoice = await showRegistrationModal();
        if (userChoice === 'cancel') {
          return;
        } else if (userChoice === 'registered') {
          performExport(currentVideoPins, false);
          await chrome.storage.local.set({ tubenotes_export_count: currentCount + 1 });
        } else if (userChoice === 'limited') {
          performExport(currentVideoPins, true);
          await chrome.storage.local.set({ tubenotes_export_count: currentCount + 1 });
        }
      } else {
        performExport(currentVideoPins, false);
        await chrome.storage.local.set({ tubenotes_export_count: currentCount + 1 });
      }

    } catch (error) {
      console.error('Error exporting to HTML:', error);
      alert('Error exporting notes. Please try again.');
    }
  }

  // Show registration modal
  function showRegistrationModal() {
    return new Promise((resolve) => {
      // Create modal container
      const modalOverlay = document.createElement('div');
      modalOverlay.style.cssText = `
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.8);
  z-index: 10000;
  display: flex;
  justify-content: center;
  align-items: center;
  font-family: Roboto, Arial, sans-serif;
  `;

      const modalContent = document.createElement('div');
      modalContent.style.cssText = `
  background: #0f0f0f;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 24px;
  width: 400px;
  max-width: 90%;
  color: white;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  `;

      modalContent.innerHTML = `
    <h2 style="margin: 0 0 16px 0; font-size: 20px;">Export Limit Reached</h2>
        <p style="margin: 0 0 20px 0; color: #aaa; line-height: 1.5;">
          You've used your 3 free full exports. To continue exporting with full notes and transcripts, please register (it's free!).
        </p>
        
        <div style="margin-bottom: 20px;">
          <label style="display: block; margin-bottom: 8px; font-size: 14px; color: #ccc;">Email Address</label>
          <input type="email" id="tubenotes-reg-email" placeholder="your@email.com" style="
            width: 100%;
            padding: 10px;
            background: #222;
            border: 1px solid #333;
            border-radius: 6px;
            color: white;
            font-size: 14px;
            box-sizing: border-box;
          ">
          <div id="tubenotes-reg-error" style="color: #ff4e45; font-size: 12px; margin-top: 5px; display: none;">Please enter a valid email</div>
        </div>

        <button id="tubenotes-reg-btn" style="
          width: 100%;
          padding: 10px;
          background: #3ea6ff;
          color: black;
          border: none;
          border-radius: 6px;
          font-weight: 500;
          cursor: pointer;
          margin-bottom: 12px;
        ">
          Register & Export Full Notes
        </button>

        <button id="tubenotes-limit-btn" style="
          width: 100%;
          padding: 10px;
          background: transparent;
          color: #aaa;
          border: 1px solid #333;
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
        ">
          Continue with Limited Export (No text/audio notes)
        </button>

        <div style="text-align: center; margin-top: 12px;">
          <button id="tubenotes-cancel-btn" style="
            background: none;
            border: none;
            color: #666;
            cursor: pointer;
            font-size: 12px;
            text-decoration: underline;
          ">Cancel</button>
        </div>
  `;

      modalOverlay.appendChild(modalContent);
      document.body.appendChild(modalOverlay);

      const emailInput = modalContent.querySelector('#tubenotes-reg-email');
      const regBtn = modalContent.querySelector('#tubenotes-reg-btn');
      const limitBtn = modalContent.querySelector('#tubenotes-limit-btn');
      const cancelBtn = modalContent.querySelector('#tubenotes-cancel-btn');
      const errorMsg = modalContent.querySelector('#tubenotes-reg-error');

      // Helper to close modal
      const closeModal = () => {
        document.body.removeChild(modalOverlay);
      };

      // Register handler
      regBtn.addEventListener('click', async () => {
        const email = emailInput.value.trim();
        if (!email || !email.includes('@')) {
          errorMsg.style.display = 'block';
          return;
        }

        // Mock registration: Save valid email and set registered flag
        await chrome.storage.local.set({
          tubenotes_is_registered: true,
          tubenotes_user_email: email
        });

        closeModal();
        resolve('registered');
      });

      // Limited export handler
      limitBtn.addEventListener('click', () => {
        closeModal();
        resolve('limited');
      });

      // Cancel handler
      cancelBtn.addEventListener('click', () => {
        closeModal();
        resolve('cancel');
      });
    });
  }

  // Helper to actually perform export
  function performExport(currentVideoPins, isRestricted) {
    // Group pins by video (should only be one video now, but keeping structure for consistency)
    const pinsByVideo = {};
    currentVideoPins.forEach(pin => {
      if (!pinsByVideo[pin.videoId]) {
        pinsByVideo[pin.videoId] = {
          videoId: pin.videoId,
          videoTitle: pin.videoTitle,
          pins: []
        };
      }
      pinsByVideo[pin.videoId].pins.push(pin);
    });

    // Sort pins within each video by timestamp
    Object.values(pinsByVideo).forEach(video => {
      video.pins.sort((a, b) => a.timestamp - b.timestamp);
    });

    // Generate HTML content
    const htmlContent = generateHTMLExport(pinsByVideo, isRestricted);

    // Create download
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tubenotes-export-${isRestricted ? 'limited-' : ''}${new Date().toISOString().split('T')[0]}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    if (isRestricted) {
      alert(`Exported ${currentVideoPins.length} items(Limited Mode: Screen / Video only).`);
    } else {
      alert(`Exported ${currentVideoPins.length} notes to HTML file!`);
    }
  }

  // Generate HTML content for export
  function generateHTMLExport(pinsByVideo, isRestricted = false) {
    const exportDate = new Date().toLocaleString();
    let html = `<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>TubeNotes Export</title>
            <style>
              html {
                overflow-x: hidden;
    }
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
              margin: 0;
              padding: 0;
              background: #0f0f0f;
              color: #ffffff;
              line-height: 1.6;
              width: 100vw;
              min-height: 100vh;
    }
              .content-wrapper {
                max-width: 1200px;
              margin: 0 auto;
              padding: 40px 20px;
              transform: scale(0.85);
              transform-origin: top center;
              display: flex;
              flex-direction: column;
              align-items: center;
    }
    .content-wrapper > * {
                width: 100%;
              max-width: 1200px;
    }
              h1 {
                color: #ffffff;
              border-bottom: 2px solid rgba(255, 255, 255, 0.3);
              padding-bottom: 10px;
    }
              .video-section {
                margin: 40px 0;
              padding: 20px;
              background: rgba(255, 255, 255, 0.05);
              border-radius: 8px;
              border-left: 4px solid rgba(255, 255, 255, 0.3);
    }
              .video-title {
                font-size: 24px;
              font-weight: 600;
              margin-bottom: 10px;
              color: #ffffff;
    }
              .video-link {
                color: rgba(255, 255, 255, 0.8);
              text-decoration: none;
              font-size: 14px;
    }
              .video-link:hover {
                text-decoration: underline;
    }
              .pin-item {
                margin: 20px 0;
              padding: 15px;
              background: rgba(255, 255, 255, 0.03);
              border-radius: 6px;
              border-left: 3px solid rgba(255, 255, 255, 0.3);
    }
              .pin-header {
                display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 10px;
    }
              .pin-timestamp {
                background: rgba(62, 166, 255, 0.2);
              color: #3ea6ff;
              padding: 4px 12px;
              border-radius: 4px;
              font-weight: 500;
              font-size: 14px;
              text-decoration: none;
              display: inline-block;
              transition: all 0.2s;
    }
              .pin-timestamp:hover {
                background: rgba(62, 166, 255, 0.4);
              color: #5cb3ff;
              cursor: pointer;
    }
              .pin-date {
                color: rgba(255, 255, 255, 0.5);
              font-size: 12px;
    }
              .pin-screenshot {
                max-width: 600px;
              width: 100%;

              border-radius: 6px;
              margin: 10px 0;
              box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    }
              .pin-screenshot-container {
                margin: 10px 0;
              display: flex;
              flex-direction: column;
              align-items: flex-start;
              width: 100%;
              max-width: 600px;
              box-sizing: border-box;
    }
              .pin-video-container {
                margin: 10px 0;
              display: flex;
              flex-direction: column;
              align-items: flex-start;
              width: 100%;
              max-width: 600px;
              box-sizing: border-box;
    }
              .pin-video-clip {
                max-width: 600px;
              width: 100%;
              border-radius: 6px;
              margin: 10px 0;
              box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
              background: #000;
              max-height: 338px;
              display: block;
              box-sizing: border-box;
    }
              .pin-transcript {
                background: rgba(255, 255, 255, 0.05);
              padding: 12px;
              border-radius: 4px;
              margin: 10px 0;
              font-style: italic;
              color: rgba(255, 255, 255, 0.9);
    }
              .pin-notes {
                background: rgba(255, 255, 255, 0.08);
              padding: 8px 24px 12px 24px;
              border-radius: 6px;
              margin: 10px 0;
              border-left: 3px solid rgba(255, 255, 255, 0.2);
              white-space: pre-wrap;
              font-size: 16px;
              line-height: 1.5;
              max-width: 600px;
              width: 100%;
              box-sizing: border-box;
              text-align: left;
              color: rgba(255, 255, 255, 0.95);
    }
              .pin-notes strong {
                font - size: 14px;
              display: block;
              margin-bottom: 6px;
              margin-top: 0;
              padding: 0;
              font-weight: 600;
              text-align: left;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              color: rgba(255, 255, 255, 0.7);
              line-height: 1.5;
    }
              .pin-notes-content {
                display: block;
              margin-top: 0;
              padding-top: 0;
              white-space: pre-wrap;
    }
              .pin-audio {
                margin: 10px 0;
    }
              .pin-audio strong {
                display: block;
              margin-bottom: 3px;
    }
              .pin-audio audio {
                width: 100%;
              max-width: 350px;
              height: 32px;
    }
              .export-info {
                color: rgba(255, 255, 255, 0.6);
              font-size: 14px;
              margin-bottom: 30px;
              padding: 10px;
              background: rgba(255, 255, 255, 0.05);
              border-radius: 4px;
    }
              .restricted-notice {
                background: rgba(255, 204, 0, 0.1);
              border: 1px solid rgba(255, 204, 0, 0.3);
              color: #ffcc00;
              padding: 12px;
              border-radius: 6px;
              margin-bottom: 20px;
              text-align: center;
    }
            </style>
          </head>
          <body>
            <div class="content-wrapper">
              <h1>TubeNotes Export</h1>
              <div class="export-info">
                Exported on: ${exportDate}<br>
                  Total notes: ${Object.values(pinsByVideo).reduce((sum, v) => sum + v.pins.length, 0)}
              </div>
              `;

    // Generate content for each video
    Object.values(pinsByVideo).forEach(video => {
      html += `
  <div class="video-section">
    <div class="video-title">${escapeHtml(video.videoTitle)}</div>
    <a href="https://www.youtube.com/watch?v=${video.videoId}" target="_blank" class="video-link">
      Watch on YouTube →
    </a>`;

      video.pins.forEach(pin => {
        const pinDate = new Date(pin.date).toLocaleString();
        const videoUrlWithTimestamp = `https://www.youtube.com/watch?v=${video.videoId}&t=${pin.timestamp}s`;
        html += `
              <div class="pin-item">
                <div class="pin-header">
                  <a href="${videoUrlWithTimestamp}" target="_blank" class="pin-timestamp">${formatTimestamp(pin.timestamp)}</a>
                  <span class="pin-date">${pinDate}</span>
                </div>`;

        if (pin.videoClip) {
          html += `
      <div class="pin-video-container">
        <strong>Video Clip:</strong><br>
        <video class="pin-video-clip" controls preload="metadata">
          <source src="${pin.videoClip}" type="video/webm">
          Your browser does not support the video element.
        </video>
      </div>`;
        } else if (pin.screenshot) {
          html += `
      <div class="pin-screenshot-container">
        <strong>Screenshot:</strong><br>
        <img src="${pin.screenshot}" alt="Screenshot at ${formatTimestamp(pin.timestamp)}" class="pin-screenshot" />
      </div>`;
        }

        // CONDITIONAL RENDERING FOR RESTRICTED MODE
        if (!isRestricted) {
          if (pin.transcript) {
            html += `
          <div class="pin-transcript">
            <strong>Transcript:</strong> ${escapeHtml(pin.transcript)}
          </div>`;
          }

          if (pin.notes) {
            const trimmedNotes = pin.notes.trim();
            html += `<div class="pin-notes"><strong>Notes:</strong><span class="pin-notes-content">${escapeHtml(trimmedNotes)}</span></div>`;
          }

          if (pin.audio) {
            const audioClips = Array.isArray(pin.audio) ? pin.audio : (pin.audio ? [pin.audio] : []);
            if (audioClips.length > 0) {
              html += `<div class="pin-audio">
              <strong>Audio Note(s):</strong>`;

              audioClips.forEach((audioSrc) => {
                // Ensure valid src
                if (audioSrc && typeof audioSrc === 'string' && audioSrc.length > 100) {
                  html += `
                   <div style="margin-bottom: 8px;">
                     <audio controls style="width: 100%; max-width: 350px;">
                       <source src="${audioSrc}" type="audio/webm">
                       <source src="${audioSrc}" type="audio/mp4">
                       Your browser does not support the audio element.
                     </audio>
                   </div>`;
                }
              });

              html += `</div>`;
            }
          }
        }

        html += `
              </div>`;
      });

      html += `
            </div>`;
    });

    html += `
          </div>
        </body>
    </html>`;

    return html;
  };



  // Escape HTML to prevent XSS
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }


  // Toggle sort order
  async function toggleSortOrder() {
    const result = await chrome.storage.local.get(['tubenotes_sort_order']);
    const currentOrder = result.tubenotes_sort_order || 'newest-first';
    const newOrder = currentOrder === 'newest-first' ? 'oldest-first' : 'newest-first';

    await chrome.storage.local.set({ tubenotes_sort_order: newOrder });
    await loadPinnedItems();
    updateSortButtonIcon();
  }

  // Update sort button icon to reflect current sort order
  async function updateSortButtonIcon() {
    const sortBtn = document.getElementById('tubenotes-sort-btn');
    if (!sortBtn) return;

    sortBtn.setAttribute('aria-label', 'Sort');
  }

  // Store bound event handlers
  let closeBtnHandler = null;

  // Set up event listeners
  function setupEventListeners() {
    // Only set up once per panel instance
    if (eventListenersAttached) {
      return;
    }

    const context = sidePanel || document;
    const pinScreenshotBtn = context.querySelector('#tubenotes-pin-screenshot-btn');
    const pinVideoBtn = context.querySelector('#tubenotes-pin-video-btn');
    const closeBtn = context.querySelector('#tubenotes-close-btn');
    const sortBtn = context.querySelector('#tubenotes-sort-btn');
    const exportHtmlBtn = context.querySelector('#tubenotes-export-html-btn');

    if (pinScreenshotBtn && !pinScreenshotBtn.hasAttribute('data-listener-attached')) {
      pinScreenshotBtn.addEventListener('click', handlePinScreenshotClick);
      pinScreenshotBtn.setAttribute('data-listener-attached', 'true');
    }

    if (pinVideoBtn && !pinVideoBtn.hasAttribute('data-listener-attached')) {
      pinVideoBtn.addEventListener('click', handlePinVideoClick);
      pinVideoBtn.setAttribute('data-listener-attached', 'true');
    }

    if (closeBtn && !closeBtn.hasAttribute('data-listener-attached')) {
      closeBtnHandler = () => {
        console.log('TubeNotes: Close button clicked, cleaning up panel');
        userClosed = true; // Prevent auto re-injection
        cleanupPanel(true);
        updateButtonState(false);
      };
      closeBtn.addEventListener('click', closeBtnHandler);
      closeBtn.setAttribute('data-listener-attached', 'true');
    }

    if (sortBtn && !sortBtn.hasAttribute('data-listener-attached')) {
      sortBtn.addEventListener('click', toggleSortOrder);
      sortBtn.setAttribute('data-listener-attached', 'true');
      // Initialize sort button icon
      updateSortButtonIcon();
    }

    if (exportHtmlBtn && !exportHtmlBtn.hasAttribute('data-listener-attached')) {
      exportHtmlBtn.addEventListener('click', exportToHTML);
      exportHtmlBtn.setAttribute('data-listener-attached', 'true');
    }

    eventListenersAttached = true;
  }

  // Remove event listeners (cleanup before panel removal)
  function removeEventListeners() {
    const pinScreenshotBtn = document.getElementById('tubenotes-pin-screenshot-btn');
    const pinVideoBtn = document.getElementById('tubenotes-pin-video-btn');
    const closeBtn = document.getElementById('tubenotes-close-btn');
    const sortBtn = document.getElementById('tubenotes-sort-btn');

    if (pinScreenshotBtn && pinScreenshotBtn.hasAttribute('data-listener-attached')) {
      pinScreenshotBtn.removeEventListener('click', handlePinScreenshotClick);
      pinScreenshotBtn.removeAttribute('data-listener-attached');
    }

    if (pinVideoBtn && pinVideoBtn.hasAttribute('data-listener-attached')) {
      pinVideoBtn.removeEventListener('click', handlePinVideoClick);
      pinVideoBtn.removeAttribute('data-listener-attached');
    }

    if (closeBtn && closeBtn.hasAttribute('data-listener-attached') && closeBtnHandler) {
      closeBtn.removeEventListener('click', closeBtnHandler);
      closeBtn.removeAttribute('data-listener-attached');
      closeBtnHandler = null;
    }

    if (sortBtn && sortBtn.hasAttribute('data-listener-attached')) {
      sortBtn.removeEventListener('click', toggleSortOrder);
      sortBtn.removeAttribute('data-listener-attached');
    }

    eventListenersAttached = false;
  }

  // Clean up panel and listeners
  function cleanupPanel(keepButton = false) {
    // Analytics: Session End
    if (sessionStartTime > 0) {
      const duration = (Date.now() - sessionStartTime) / 1000;
      if (analytics) analytics.logEvent('session_end', { duration_seconds: duration });
      sessionStartTime = 0;
    }

    if (sidePanel && sidePanel.parentNode) {
      removeEventListeners();
      sidePanel.remove();
    }
    sidePanel = null;
    isPanelOpen = false;
    eventListenersAttached = false;

    // Disconnect DOM observer
    if (domObserver) {
      domObserver.disconnect();
      domObserver = null;
    }

    // Remove the container so it can be recreated with correct positioning
    const container = document.querySelector('#tubenotes-container');
    if (container) {
      container.remove();
      console.log('TubeNotes: Removed container for cleanup');
    }

    // Remove toggle button so it can be recreated on new video
    if (!keepButton) {
      const toggleBtn = document.querySelector('#tubenotes-toggle-btn');
      if (toggleBtn) {
        toggleBtn.remove();
        console.log('TubeNotes: Removed toggle button for cleanup');
      }
    }
  }

  // Setup DOM observer to detect when YouTube removes our panel
  function setupDOMObserver() {
    // Disconnect existing observer if any
    if (domObserver) {
      domObserver.disconnect();
    }

    const targetContainer = document.querySelector('#secondary');
    if (!targetContainer) {
      console.log('TubeNotes: Cannot setup DOM observer, #secondary not found');
      return;
    }

    console.log('TubeNotes: Setting up DOM observer to watch for panel removal');

    domObserver = new MutationObserver((mutations) => {
      // Check if our panel still exists in the DOM
      if (sidePanel && !document.contains(sidePanel)) {
        console.log('TubeNotes: Panel was removed by YouTube, re-injecting...');
        sidePanel = null;
        // Re-inject after a short delay to let YouTube finish its DOM updates
        setTimeout(() => {
          if (isYouTubeWatchPage()) {
            injectSidePanel(true);
          }
        }, 100);
      }
    });

    // Observe the secondary container for child list changes
    domObserver.observe(targetContainer, {
      childList: true,
      subtree: false
    });
  }

  // Setup navigation listeners (call once)
  function setupNavigationListeners() {
    if (navigationEventListenersSet) return;

    console.log('TubeNotes: Setting up navigation listeners and interval check');

    // Listen for YouTube navigation events (may not always fire, so we have fallback)
    try {
      document.addEventListener('yt-navigate-start', handleNavigationStart);
      document.addEventListener('yt-navigate-finish', handleNavigationFinish);
      console.log('TubeNotes: YouTube navigation events registered');
    } catch (e) {
      // Events might not be available, that's okay
      console.log('TubeNotes: YouTube navigation events not available');
    }

    // Listen to popstate for back/forward navigation
    window.addEventListener('popstate', handlePopState);

    // Setup interval check for video ID changes (primary method)
    if (checkInterval) {
      clearInterval(checkInterval);
    }

    checkInterval = setInterval(checkVideoChange, 300);
    console.log('TubeNotes: Interval check started (every 300ms)');

    navigationEventListenersSet = true;
  }

  // Handle navigation start
  function handleNavigationStart() {
    cleanupPanel();
  }

  // Handle navigation finish
  function handleNavigationFinish() {
    if (isYouTubeWatchPage()) {
      setTimeout(() => {
        const currentVideoId = new URLSearchParams(location.search).get('v') || '';
        if (currentVideoId && lastVideoId !== currentVideoId) {
          lastVideoId = currentVideoId;
          injectSidePanel(true);
        } else if (!sidePanel) {
          injectSidePanel(true);
        }
      }, 800);
    }
  }

  // Handle popstate (back/forward)
  function handlePopState() {
    cleanupPanel();
    setTimeout(() => {
      if (isYouTubeWatchPage()) {
        injectSidePanel(true);
      }
    }, 800);
  }

  // Check for video ID changes
  function checkVideoChange() {
    if (!isYouTubeWatchPage()) {
      if (sidePanel) {
        console.log('TubeNotes: Left watch page, cleaning up panel');
        cleanupPanel();
      }
      waitingForNavigation = false;
      return;
    }

    const currentVideoId = new URLSearchParams(location.search).get('v') || '';

    if (currentVideoId && currentVideoId !== lastVideoId) {
      console.log(`TubeNotes: Video changed from ${lastVideoId} to ${currentVideoId} `);
      lastVideoId = currentVideoId;
      cleanupPanel();
      waitingForNavigation = true;
      userClosed = false; // Reset on video change

      // Wait for YouTube to finish navigation, then create toggle button
      setTimeout(() => {
        waitingForNavigation = false;
        if (isYouTubeWatchPage()) {
          console.log('TubeNotes: Creating toggle button for new video');
          createToggleButton();
        }
      }, 1000);
    }
  }

  // Initialize when page loads
  function init() {
    console.log('TubeNotes: Initializing...', 'readyState:', document.readyState, 'URL:', window.location.href);

    // Reset retry counter for fresh page load
    window.tubeNotesRetryCount = 0;

    // Initialize last video ID
    lastVideoId = new URLSearchParams(location.search).get('v') || '';

    // Always set up navigation listeners
    setupNavigationListeners();

    // Create toggle button instead of auto-injecting panel
    if (isYouTubeWatchPage()) {
      console.log('TubeNotes: On watch page, creating toggle button');
      createToggleButton();
    }
  }

  // Start initialization
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

