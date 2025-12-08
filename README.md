# TubeNotes

A Chrome extension to help people take notes while watching YouTube videos with screenshot and transcript capture.

## Description

TubeNotes allows users to seamlessly capture moments from YouTube videos by pinning screenshots along with the transcript/subtitle text at that specific timestamp. The side panel opens automatically when watching videos, similar to YouTube's transcript panel.

## Features

- 📌 **Pin Moments**: Capture screenshots and transcripts at specific timestamps
- 📝 **Transcript Capture**: Automatically saves subtitle/transcript text when pinning
- 🖼️ **Video Screenshots**: Captures the current video frame
- ⏱️ **Timestamp Navigation**: Click timestamps to jump to that moment in the video
- 💾 **Local Storage**: All pinned moments are saved locally per video
- 🗑️ **Easy Management**: Delete individual pinned moments

## Installation

### Load as Unpacked Extension (Development)

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the `TubeNotes` folder
6. The extension should now be installed!

## Usage

1. Navigate to any YouTube video (watch page)
2. The TubeNotes side panel will automatically appear on the right side
3. While watching the video, click the "📌 Pin" button to capture:
   - Current video frame (screenshot)
   - Current transcript/subtitle text
   - Current timestamp
4. Click on any timestamp in your pinned moments to jump to that point in the video
5. Click the × button to delete unwanted pinned moments

## Development

### Project Structure

```
TubeNotes/
├── manifest.json          # Extension configuration
├── content/
│   └── content.js        # Main content script (injected into YouTube)
├── styles/
│   └── sidePanel.css     # Side panel styling
├── popup/
│   └── popup.html        # Extension popup
├── icons/                # Extension icons
└── scripts/
    └── generate-icons.py # Icon generation script
```

### Regenerating Icons

If you want to regenerate the extension icons:

```bash
pip3 install Pillow
python3 scripts/generate-icons.py
```

### Testing

1. Load the extension in Chrome (see Installation)
2. Open any YouTube video (e.g., `https://www.youtube.com/watch?v=...`)
3. The side panel should appear automatically
4. Test the Pin functionality with videos that have transcripts/subtitles enabled

## License

(To be determined)

