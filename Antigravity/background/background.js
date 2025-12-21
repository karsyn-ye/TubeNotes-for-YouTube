// Background service worker for TubeNotes Chrome extension
// Minimal background script for future message handling

// Listen for messages from content scripts (for future use)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('TubeNotes: Received message from content script:', message);

    // Handle any messages from content scripts here if needed
    if (message.type === 'TUBENOTES_READY') {
        console.log('TubeNotes: Content script is ready in tab', sender.tab?.id);
    }

    sendResponse({ received: true });
    return true; // Keep the message channel open for async response
});
