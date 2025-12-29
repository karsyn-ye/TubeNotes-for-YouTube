// Background service worker for TubeNotes Chrome extension
// Handles extension lifecycle events and Authentication

// Import Firebase (Compat)
importScripts('../lib/firebase-app.js');
importScripts('../lib/firebase-auth.js');
// Note: firebase-analytics.js is NOT compatible with Service Workers (requires window)

// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyDbypybuQ9JuPhGNKnY_N6fzIVROGyKs8Y",
    authDomain: "tubenotes-71232.firebaseapp.com",
    projectId: "tubenotes-71232",
    storageBucket: "tubenotes-71232.firebasestorage.app",
    messagingSenderId: "816541802008",
    appId: "1:816541802008:web:f8aec607ee2e6164dd2d6d"
};

// Initialize Firebase
try {
    firebase.initializeApp(firebaseConfig);
} catch (e) {
    console.error("Firebase init (background):", e);
}

const auth = firebase.auth();

console.log('TubeNotes: Background script loaded (v1.1.0)');

// Handle extension installation or update
chrome.runtime.onInstalled.addListener(async (details) => {
    console.log('TubeNotes: Extension installed/updated', details.reason);

    // User Requirement: Users MUST log in again if they uninstall/reinstall.
    // 'install' reason happens on fresh install (or reinstall).
    if (details.reason === 'install') {
        console.log('TubeNotes: Fresh install detected. Clearing auth session.');
        await auth.signOut();
    }
});

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'AUTH_CHECK') {
        const checkAuth = async () => {
            // If user is already resolved, return it
            if (auth.currentUser) return { isAuthenticated: true, email: auth.currentUser.email };

            // Otherwise wait for the first auth change
            return new Promise(resolve => {
                const unsubscribe = auth.onAuthStateChanged(user => {
                    unsubscribe();
                    resolve({ isAuthenticated: !!user, email: user ? user.email : null });
                });
            });
        };

        checkAuth().then(response => sendResponse(response));
        return true; // Keep message channel open
    }

    if (message.type === 'AUTH_LOGIN') {
        auth.signInWithEmailAndPassword(message.email, message.password)
            .then(userCredential => {
                sendResponse({ success: true, email: userCredential.user.email });
            })
            .catch(error => {
                sendResponse({ success: false, error: error.message, code: error.code });
            });
        return true;
    }

    if (message.type === 'AUTH_SIGNUP') {
        auth.createUserWithEmailAndPassword(message.email, message.password)
            .then(userCredential => {
                sendResponse({ success: true, email: userCredential.user.email });
            })
            .catch(error => {
                sendResponse({ success: false, error: error.message, code: error.code });
            });
        return true;
    }

    if (message.type === 'ANALYTICS_EVENT') {
        const eventName = message.eventName;
        const params = message.params || {};

        // Google Analytics 4 Measurement Protocol
        const MEASUREMENT_ID = 'G-8PV1FYCEN4';
        const API_SECRET = 'sjHtiHwcQmuMdIBotCNf4g';

        // Get or create unique client ID
        const getClientId = async () => {
            const result = await chrome.storage.local.get('ga_client_id');
            if (result.ga_client_id) return result.ga_client_id;

            const newId = crypto.randomUUID();
            await chrome.storage.local.set({ ga_client_id: newId });
            return newId;
        };

        getClientId().then(clientId => {
            // Construct payload
            const payload = {
                client_id: clientId,
                events: [{
                    name: eventName,
                    params: {
                        ...params,
                        engagement_time_msec: "100", // Default engagement (String for consistency)
                        session_id: Date.now().toString(), // Session ID
                        debug_mode: 1 // Forces event to appear in DebugView (Number required for some clients)
                    }
                }]
            };

            // Use DEBUG endpoint to verify payload validity
            console.log('TubeNotes: Sending GA4 Event...', eventName);

            // Send to Google Analytics (Production)
            // Endpoint: https://www.google-analytics.com/mp/collect

            fetch(`https://www.google-analytics.com/mp/collect?measurement_id=${MEASUREMENT_ID}&api_secret=${API_SECRET}`, {
                method: 'POST',
                body: JSON.stringify(payload)
            })
                .then(async (response) => {
                    if (!response.ok) {
                        console.error(`GA4 Error (${response.status})`);
                    } else {
                        console.log('TubeNotes: Analytics sent to GA4 (Prod)');
                    }
                })
                .catch(e => console.error('GA4 Network Error:', e));
        });

        return false; // No response needed
    }

    // Keep channel open for other messages if needed
});
