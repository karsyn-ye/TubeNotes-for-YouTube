# TubeNotes

A Chrome extension to help people take quick notes while watching YouTube videos. Don't just watch videos. Interact.

## Description

TubeNotes allows users to seamlessly capture and annotate moments from YouTube videos. When you pin a moment, the extension automatically captures a 4-second video clip (with sound) and saves the transcript/subtitle text at that timestamp. You can then add text notes or record audio notes for each pinned moment, and export everything as a self-contained HTML file.

## Features

- ✨ **Pin Moments**: Capture 4-second video clips with sound and transcripts at specific timestamps
- 📝 **Transcript Capture**: Automatically saves subtitle/transcript text when pinning
- 📝 **Text Notes**: Add and edit written notes for each pinned moment
- 🎤 **Audio Notes**: Record audio notes while watching (video automatically pauses during recording)
- 📊 **Sort Options**: Toggle between newest-first and oldest-first sorting
- ⏱️ **Timestamp Navigation**: Click timestamps to jump to that moment in the video
- 📥 **HTML Export**: Export all notes, video clips, and audio recordings as a self-contained HTML file
- 💾 **Local Storage**: All pinned moments are saved locally with unlimited storage
- 🗑️ **Easy Management**: Delete individual pinned moments
- 🎨 **Modern UI**: Clean black and white minimalism theme that matches YouTube's interface

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
3. While watching the video, click the "✨ Pin" button to capture:
   - A 5-second video clip with sound from the current moment
   - Current transcript/subtitle text (even if transcript panel isn't open)
   - Current timestamp
4. **Add Text Notes**: Click the pen icon (✎) next to any pinned moment to add or edit written notes
5. **Record Audio**: Click the microphone icon to record an audio note (video will automatically pause)
6. **Sort Pins**: Use the sort button in the top-right to toggle between newest-first and oldest-first
7. **Navigate**: Click on any timestamp to jump to that point in the video
8. **Export**: Click the export icon to download all your notes, video clips, and audio recordings as an HTML file
9. **Delete**: Click the × button to delete unwanted pinned moments

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
5. Test text note editing by clicking the pen icon
6. Test audio recording by clicking the microphone icon (grant microphone permission when prompted)
7. Test the export functionality to verify all notes, clips, and audio are included in the HTML file

## License

(To be determined)

