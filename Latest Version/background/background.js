// Background service worker for TubeNotes Chrome extension
// Handles extension lifecycle events

// Handle extension installation or update
chrome.runtime.onInstalled.addListener(async (details) => {
    console.log('TubeNotes: Extension installed/updated', details.reason);

    // Note: Auto-injection of content scripts into existing tabs is disabled 
    // to minimize permissions (removed "scripting" permission).
    // Users will need to refresh existing YouTube tabs to use the extension.
});

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('TubeNotes: Received message from content script:', message);

    if (message.type === 'TUBENOTES_READY') {
        console.log('TubeNotes: Content script is ready in tab', sender.tab?.id);
    }

    sendResponse({ received: true });
    return true; // Keep the message channel open for async response
});
