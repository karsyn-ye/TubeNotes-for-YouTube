// Content script for TubeNotes Chrome extension
// Injects side panel into YouTube video pages

(function() {
  'use strict';

  let sidePanel = null;
  let isPanelOpen = false;
  let eventListenersAttached = false;
  let navigationObserver = null;
  let lastVideoId = '';
  let checkInterval = null;
  let navigationEventListenersSet = false;

  // Check if we're on a YouTube watch page
  function isYouTubeWatchPage() {
    return window.location.pathname === '/watch' && window.location.search.includes('v=');
  }

  // Create side panel HTML
  function createSidePanel() {
    // Always create a fresh panel (don't reuse)
    // Create new panel
    const panel = document.createElement('div');
    panel.id = 'tubenotes-side-panel';
    panel.innerHTML = `
      <div class="tubenotes-header">
        <h2>TubeNotes</h2>
        <div class="tubenotes-header-actions">
          <button id="tubenotes-sort-btn" class="tubenotes-sort-btn" aria-label="Toggle sort order" title="Toggle sort order">⇅</button>
          <button id="tubenotes-export-html-btn" class="tubenotes-export-btn" aria-label="Export to HTML" title="Export to HTML file">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="3" y="8" width="10" height="5" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/>
              <path d="M8 3V11M8 3L5.5 5.5M8 3L10.5 5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <button id="tubenotes-close-btn" class="tubenotes-close-btn" aria-label="Close panel">×</button>
        </div>
      </div>
      <div class="tubenotes-controls">
        <button id="tubenotes-pin-btn" class="tubenotes-pin-btn">
          <span class="pin-icon">✨</span> Pin
        </button>
      </div>
      <div class="tubenotes-pinned-list" id="tubenotes-pinned-list">
        <div class="tubenotes-empty-state">Learn something great?<br>Pin it and take your quick note!</div>
      </div>
    `;

    sidePanel = panel;
    eventListenersAttached = false; // Reset flag when creating new panel
    return panel;
  }

  // Inject side panel into page
  function injectSidePanel(force = false) {
    if (!isYouTubeWatchPage()) return;
    
    // Get current video ID
    const currentVideoId = new URLSearchParams(location.search).get('v') || '';
    
    // Check if panel already exists and is in the DOM for the same video
    if (!force && sidePanel && sidePanel.parentNode && lastVideoId === currentVideoId) {
      // Just refresh the content for current video
      loadPinnedItems();
      return;
    }

    // If video changed or force recreate, clean up old panel
    if (lastVideoId !== currentVideoId || force) {
      cleanupPanel();
      lastVideoId = currentVideoId;
    }

    // Remove any orphaned panel references and listeners
    if (sidePanel && !sidePanel.parentNode) {
      removeEventListeners();
      sidePanel = null;
    }

    const targetContainer = document.querySelector('#secondary');
    
    if (targetContainer) {
      // Remove any existing panel from container (cleanup)
      const existingPanel = targetContainer.querySelector('#tubenotes-side-panel');
      if (existingPanel) {
        removeEventListeners();
        existingPanel.remove();
        sidePanel = null;
      }
      
      // Create new panel
      const panel = createSidePanel();
      targetContainer.insertBefore(panel, targetContainer.firstChild);
      isPanelOpen = true;
      eventListenersAttached = false; // Reset flag for new panel
      
      // Wait a moment for DOM to settle, then set up event listeners
      setTimeout(() => {
        setupEventListeners();
        // Load saved pins (after event listeners are set up)
        loadPinnedItems();
      }, 150);
    } else {
      // Wait for YouTube to load
      setTimeout(() => injectSidePanel(force), 500);
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
    return `${mins}:${secs.toString().padStart(2, '0')}`;
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

  // Capture 5-second video clip from video player
  async function captureVideoClip(duration = 5) {
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
      const startTime = video.currentTime;
      
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
            video.currentTime = startTime; // Return to original position
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
            video.currentTime = startTime;
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
  async function savePinnedItem(transcript, videoClip, timestamp, videoId, videoTitle) {
    const pinData = {
      id: Date.now().toString(),
      timestamp: timestamp,
      transcript: transcript,
      videoClip: videoClip, // 5-second video clip (replaces screenshot)
      videoId: videoId,
      videoTitle: videoTitle,
      notes: '', // User notes (empty by default)
      audio: '', // Audio recording (empty by default)
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
  async function handlePinClick() {
    const pinBtn = document.getElementById('tubenotes-pin-btn');
    if (!pinBtn) return;

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
      pinBtn.innerHTML = '<span class="pin-icon">✨</span> Pinning...';

    try {
      // Get current video info
      const { videoId, videoTitle } = getVideoInfo();
      
      if (!videoId) {
        throw new Error('Could not determine video ID');
      }
      
      // Get transcript and timestamp
      const transcript = getCurrentTranscript();
      const timestamp = getCurrentTimestamp();
      
      // Capture 5-second video clip (will return empty if video not ready, that's okay)
      pinBtn.innerHTML = '<span class="pin-icon">✨</span> Recording clip...';
      const videoClip = await captureVideoClip(5);
      
      // Save pinned item
      const pinData = await savePinnedItem(transcript, videoClip, timestamp, videoId, videoTitle);
      
      // Refresh pinned list
      await loadPinnedItems();
      
      // Show success feedback
      pinBtn.innerHTML = '<span class="pin-icon">✨</span> Pinned!';
      setTimeout(() => {
        pinBtn.innerHTML = '<span class="pin-icon">✨</span> Pin';
        pinBtn.disabled = false;
      }, 1000);
    } catch (error) {
      console.error('Error pinning:', error);
      pinBtn.innerHTML = '<span class="pin-icon">✨</span> Pin';
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
      pinnedList.innerHTML = '<div class="tubenotes-empty-state">Learn something great?<br>Pin it and take your quick note!</div>';
      return;
    }

    // Get sort order preference (default: newest-first)
    const sortResult = await chrome.storage.local.get(['tubenotes_sort_order']);
    const sortOrder = sortResult.tubenotes_sort_order || 'newest-first';
    
    // Sort by timestamp based on preference
    if (sortOrder === 'newest-first') {
      currentVideoPins.sort((a, b) => b.timestamp - a.timestamp);
    } else {
      currentVideoPins.sort((a, b) => a.timestamp - b.timestamp);
    }

    // Render pinned items
    pinnedList.innerHTML = currentVideoPins.map(pin => `
      <div class="tubenotes-pinned-item" data-id="${pin.id}">
        <div class="tubenotes-pinned-header">
          <span class="tubenotes-timestamp">${formatTimestamp(pin.timestamp)}</span>
          <div class="tubenotes-item-actions">
            <button class="tubenotes-edit-btn" data-id="${pin.id}" aria-label="Edit notes" title="Add/edit notes">✎</button>
            <button class="tubenotes-record-btn" data-id="${pin.id}" aria-label="Record audio" title="Record audio note">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <ellipse cx="8" cy="3.5" rx="2.5" ry="4.5" fill="currentColor"/>
                <path d="M4 8 Q4 9.5 8 10.5 Q12 9.5 12 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/>
                <rect x="7.25" y="10.5" width="1.5" height="3.5" rx="0.75" fill="currentColor"/>
                <rect x="5.5" y="14" width="5" height="1" rx="0.5" fill="currentColor"/>
              </svg>
            </button>
            <button class="tubenotes-delete-btn" data-id="${pin.id}" aria-label="Delete">×</button>
          </div>
        </div>
        ${pin.videoClip ? `
          <video class="tubenotes-video-clip" controls preload="metadata">
            <source src="${pin.videoClip}" type="video/webm">
            Your browser does not support the video element.
          </video>
        ` : pin.screenshot ? `
          <img src="${pin.screenshot}" alt="Video frame at ${formatTimestamp(pin.timestamp)}" class="tubenotes-screenshot" />
        ` : ''}
        <div class="tubenotes-transcript">${pin.transcript || 'No transcript available'}</div>
        ${pin.notes ? `<div class="tubenotes-notes-display">${pin.notes}</div>` : ''}
        ${pin.audio ? `
          <div class="tubenotes-audio-display" data-id="${pin.id}">
            <audio controls class="tubenotes-audio-player">
              <source src="${pin.audio}" type="audio/webm">
              <source src="${pin.audio}" type="audio/mp4">
              Your browser does not support the audio element.
            </audio>
            <button class="tubenotes-audio-delete" data-id="${pin.id}" aria-label="Delete audio" title="Delete audio">×</button>
          </div>
        ` : ''}
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
      </div>
    `).join('');

    // Add click handlers for edit buttons
    pinnedList.querySelectorAll('.tubenotes-edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const pinId = e.target.getAttribute('data-id');
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
        const pinId = e.target.getAttribute('data-id');
        const pinItem = e.target.closest('.tubenotes-pinned-item');
        const textarea = pinItem.querySelector('.tubenotes-notes-textarea');
        const notesEditor = pinItem.querySelector('.tubenotes-notes-editor');
        
        if (textarea) {
          const notes = textarea.value.trim();
          await savePinnedNotes(pinId, notes);
          
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
        const pinId = e.target.getAttribute('data-id');
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
          const pinId = e.target.getAttribute('data-id');
          await stopRecording(pinId);
        });
        btn.setAttribute('data-listener-attached', 'true');
      }
    });

    // Add click handlers for cancel recording
    pinnedList.querySelectorAll('.tubenotes-recorder-cancel').forEach(btn => {
      if (!btn.hasAttribute('data-listener-attached')) {
        btn.addEventListener('click', async (e) => {
          const pinId = e.target.getAttribute('data-id');
          cancelRecording(pinId);
        });
        btn.setAttribute('data-listener-attached', 'true');
      }
    });

    // Add click handlers for delete audio
    pinnedList.querySelectorAll('.tubenotes-audio-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const pinId = e.target.getAttribute('data-id');
        await deleteAudio(pinId);
      });
    });

    // Add click handlers for delete buttons
    pinnedList.querySelectorAll('.tubenotes-delete-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const pinId = e.target.getAttribute('data-id');
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
        pins[pinIndex].audio = audioDataUrl;
        await chrome.storage.local.set({ tubenotes_pins: pins });
      }
    } catch (error) {
      console.error('Error saving audio:', error);
      throw error;
    }
  }

  // Delete audio for a pinned item
  async function deleteAudio(pinId) {
    try {
      const result = await chrome.storage.local.get(['tubenotes_pins']);
      const pins = result.tubenotes_pins || [];
      
      // Find and update the pin
      const pinIndex = pins.findIndex(pin => pin.id === pinId);
      if (pinIndex !== -1) {
        pins[pinIndex].audio = '';
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
      const result = await chrome.storage.local.get(['tubenotes_pins']);
      const pins = result.tubenotes_pins || [];
      
      if (pins.length === 0) {
        alert('No notes to export. Pin some moments first!');
        return;
      }

      // Group pins by video
      const pinsByVideo = {};
      pins.forEach(pin => {
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
      const htmlContent = generateHTMLExport(pinsByVideo);
      
      // Create download
      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tubenotes-export-${new Date().toISOString().split('T')[0]}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      alert(`Exported ${pins.length} notes to HTML file!`);
    } catch (error) {
      console.error('Error exporting to HTML:', error);
      alert('Error exporting notes. Please try again.');
    }
  }

  // Generate HTML content for export
  function generateHTMLExport(pinsByVideo) {
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
      max-width: 1600px;
      margin: 0 auto;
      padding: 27px;
      transform: scale(0.75);
      transform-origin: top center;
      width: 133.333%;
      margin-bottom: -25%;
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
      max-width: 100%;
      border-radius: 6px;
      margin: 10px 0;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
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
      font-size: 14px;
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
          // Backward compatibility: show screenshot if video clip not available
          html += `
      <img src="${pin.screenshot}" alt="Screenshot at ${formatTimestamp(pin.timestamp)}" class="pin-screenshot" />`;
        }

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
          html += `
      <div class="pin-audio">
        <strong>Audio Note:</strong>
        <audio controls>
          <source src="${pin.audio}" type="audio/webm">
          <source src="${pin.audio}" type="audio/mp4">
          Your browser does not support the audio element.
        </audio>
      </div>`;
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
  }

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
    
    const result = await chrome.storage.local.get(['tubenotes_sort_order']);
    const sortOrder = result.tubenotes_sort_order || 'newest-first';
    
    // Update tooltip based on sort order (icon stays the same)
    if (sortOrder === 'newest-first') {
      sortBtn.title = 'Newest first (click to sort oldest first)';
    } else {
      sortBtn.title = 'Oldest first (click to sort newest first)';
    }
  }

  // Store bound event handlers
  let closeBtnHandler = null;

  // Set up event listeners
  function setupEventListeners() {
    // Only set up once per panel instance
    if (eventListenersAttached) {
      return;
    }

    const pinBtn = document.getElementById('tubenotes-pin-btn');
    const closeBtn = document.getElementById('tubenotes-close-btn');
    const sortBtn = document.getElementById('tubenotes-sort-btn');
    const exportHtmlBtn = document.getElementById('tubenotes-export-html-btn');

    if (pinBtn && !pinBtn.hasAttribute('data-listener-attached')) {
      pinBtn.addEventListener('click', handlePinClick);
      pinBtn.setAttribute('data-listener-attached', 'true');
    }

    if (closeBtn && !closeBtn.hasAttribute('data-listener-attached')) {
      closeBtnHandler = () => {
        if (sidePanel) {
          sidePanel.style.display = 'none';
          isPanelOpen = false;
        }
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
    const pinBtn = document.getElementById('tubenotes-pin-btn');
    const closeBtn = document.getElementById('tubenotes-close-btn');
    const sortBtn = document.getElementById('tubenotes-sort-btn');

    if (pinBtn && pinBtn.hasAttribute('data-listener-attached')) {
      pinBtn.removeEventListener('click', handlePinClick);
      pinBtn.removeAttribute('data-listener-attached');
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
  function cleanupPanel() {
    if (sidePanel && sidePanel.parentNode) {
      removeEventListeners();
      sidePanel.remove();
    }
    sidePanel = null;
    isPanelOpen = false;
    eventListenersAttached = false;
  }

  // Setup navigation listeners (call once)
  function setupNavigationListeners() {
    if (navigationEventListenersSet) return;
    
    // Listen for YouTube navigation events (may not always fire, so we have fallback)
    try {
      document.addEventListener('yt-navigate-start', handleNavigationStart);
      document.addEventListener('yt-navigate-finish', handleNavigationFinish);
    } catch (e) {
      // Events might not be available, that's okay
    }
    
    // Listen to popstate for back/forward navigation
    window.addEventListener('popstate', handlePopState);
    
    // Setup interval check for video ID changes (primary method)
    if (checkInterval) {
      clearInterval(checkInterval);
    }
    
    checkInterval = setInterval(checkVideoChange, 300);
    
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
        cleanupPanel();
      }
      return;
    }
    
    const currentVideoId = new URLSearchParams(location.search).get('v') || '';
    
    if (currentVideoId && currentVideoId !== lastVideoId) {
      lastVideoId = currentVideoId;
      cleanupPanel();
      
      // Wait for YouTube to finish navigation
      setTimeout(() => {
        if (isYouTubeWatchPage()) {
          injectSidePanel(true);
        }
      }, 1000);
    } else if (!sidePanel && currentVideoId) {
      // Panel doesn't exist but we're on a video page - inject it
      injectSidePanel(true);
    }
  }

  // Initialize when page loads
  function init() {
    // Initialize last video ID
    lastVideoId = new URLSearchParams(location.search).get('v') || '';
    
    if (isYouTubeWatchPage()) {
      // Setup navigation listeners first
      setupNavigationListeners();
      
      // Wait for YouTube to fully load, then inject panel
      setTimeout(() => {
        if (isYouTubeWatchPage()) {
          injectSidePanel(true);
        }
      }, 1000);
    }
  }

  // Start initialization
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

