# TubeNotes for YouTube

**Don't just binge watch YouTube videos. Interact and learn.**

A Chrome extension for taking notes without ever leaving the video. Pin screenshots or short clips, annotate them with text / voice notes, add quick text / voice notes, and export the whole session as a single self-contained HTML file.

## Features

| | |
|---|---|
| 📸 **Screenshot pins** | Capture a still frame at the current moment |
| 🎬 **Clip pins** | Record a clip of any length, with sound — up to 60 seconds |
| ⚡ **Quick notes** | Save a thought without pinning anything — type it, or say it out loud |
| 📝 **Transcript capture** | Subtitle text is saved automatically alongside clips |
| 💬 **Captions in captures** | Subtitles are baked into your screenshots and clips, so the words stay with the image |
| ✎ **Text notes** | Write and edit notes on any pinned moment |
| 🎤 **Audio notes** | Record voice notes — the video pauses while you talk |
| ⏱️ **Timestamp jump** | Click any timestamp to seek back to that moment |
| 📊 **Sorting** | Toggle newest-first / oldest-first |
| 📥 **HTML export** | One file containing every note, clip, screenshot, and recording |
| ☁️ **Cloud save** | Sync your notes to your account |
| 🔐 **Accounts** | Login and registration via Firebase Auth |
| 💾 **Local storage** | Everything is stored locally by default, with unlimited storage |
| 🎨 **Native-feeling UI** | Black-and-white minimalism that sits naturally next to YouTube |

## Install

### From the Chrome Web Store

**[→ Add TubeNotes for YouTube to Chrome](https://chromewebstore.google.com/detail/dccnheegnfkhhchmblppiijnbcpcacoi)**

One click to install, and it updates itself automatically. This is the easiest way to get started.

### From source

Only needed if you want to modify the extension or try unreleased changes.

1. Clone this repository
2. Open `chrome://extensions/`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked**
5. Select the **`Latest Version`** folder — not the repository root

## Usage

Open any YouTube watch page and the side panel appears on the right automatically.

1. **Pin a moment** — the screenshot button grabs a still frame; the video button starts recording a clip with sound and transcript, and you stop it whenever you're ready (up to 60 seconds)
2. **Add a quick note** — type straight into the note box at the top of the panel and hit save, or tap its mic to record the thought instead. No pin needed
3. **Annotate a text / voice note** — click the pen icon (✎) on any pin or click the microphone icon and grant permission when prompted; the video pauses while recording
4. **Jump back** — click a pin's timestamp to seek the video there
5. **Sort** — toggle order with the sort button, top right
6. **Export** — the export icon downloads everything as one responsive HTML file
7. **Delete** — the × on a pin removes it

## Project structure

```
.
├── Latest Version/         # current release (v3.1.1) — load this one
│   ├── manifest.json       # MV3 configuration
│   ├── background/
│   │   └── background.js   # service worker (Firebase auth)
│   ├── content/
│   │   ├── content.js      # main content script, injected into YouTube
│   │   └── sidePanel.html
│   ├── lib/                # Firebase SDK + WebM duration fix
│   ├── styles/
│   │   └── sidePanel.css
│   ├── popup/
│   │   └── popup.html
│   ├── icons/
│   ├── assets/
│   ├── scripts/
│   │   └── generate-icons.py
│   ├── privacy-policy.md
│   └── README.md
└── V1/                     # original prototype, kept for reference
```

## Permissions

The extension asks for as little as possible:

| Permission | Why |
|---|---|
| `storage`, `unlimitedStorage` | Keep pins, notes, and recordings on your machine |
| `https://www.youtube.com/*` | The side panel only runs on YouTube — no other site is touched |

See [privacy-policy.md](Latest%20Version/privacy-policy.md) for details on data handling.

## Development

### Regenerating icons

```bash
pip3 install Pillow && python3 "Latest Version/scripts/generate-icons.py"
```

### Manual test pass

Load the unpacked extension, open a video, then check:

- Screenshot pin captures the right frame
- Clip pin works on a video **with subtitles enabled** (transcript capture depends on it)
- Text note saves and reloads
- Audio note records, and the video pauses during recording
- Export produces an HTML file containing every pin, clip, screenshot, and audio note
- Panel survives YouTube's SPA navigation between videos

## Contributing

Ideas and fixes are welcome.

1. Fork the repository
2. Create a branch for your change
3. Open a pull request

All changes to `main` require review and approval by the maintainer.

## License

Not yet chosen. Until a license is added, default copyright applies and the code may not be reused or redistributed.
