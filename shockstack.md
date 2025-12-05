# 🎙️ **Guía completa para automatizar videos estilo PODCAST con Shotstack**

# 🎙️ Automating Podcast-Style Video Generation with Shotstack

### *Dynamic durations · Variable titles · Scene overlays · Full automation-ready*

---

## 📌 Overview

This guide explains how to **automatically generate podcast-style video episodes** with:

* Variable number of scenes
* Unknown video durations
* Dynamic titles per block
* Consistent overlays
* No intro/outro (optional to add later)
* No background music
* Zero manual tweaking


1. **Receive generated video clips** (scene1.mp4, scene2.mp4, …)
2. **Receive metadata** (scene titles)
3. **Calculate start times dynamically**
4. **Insert them into a Shotstack JSON template**
5. Render the full episode

---

## 🎯 Output Style: PODCAST Look (not TV News)

We aim for a **clean, modern podcast aesthetic**, including:

* Minimalist lower thirds
* Episode / segment titles
* Subtle frame/border
* Branding badge (optional)
* Soft vignette overlay
* No ticker, no LIVE badge, no news colors

---

# 🧱 System Architecture

```
When receiving generated scenes from wavespeed
↓
    - Fetch all scene.mp4 durations and save them to Supabase
    - Build dynamic start times
    - Build Shotstack JSON
↓
Shotstack Render API → Final MP4
```

---

# 🔢 Step 1 — Gather Required Inputs

Your workflow needs:

```json
{
  "scenes": [
    {
      "video_url": "https://...",
      "title": "Market Outlook Explained"
    },
    {
      "video_url": "https://...",
      "title": "Why Tech Stocks Are Up"
    }
  ]
}
```

Each scene has:

* `video_url` → URL to generated clip
* `title` → Block title for overlay

---

# ⏱️ Step 2 — Fetch Each Video Duration

Shotstack doesn’t auto-calculate timeline sequencing.
You MUST compute:

```
start(scene[i]) = sum(duration(scene[0..i-1]))
```

Example pseudocode:

```js
let start = 0;
for (let i=0; i<scenes.length; i++) {
    scenes[i].start = start;
    start += scenes[i].duration;
}
```


---

# 🎛️ Step 3 — Build the JSON Template

Here’s the **automation-ready JSON skeleton**
⛔ *NO HARDCODED STARTS*
⛔ *NO FIXED DURATIONS*
⛔ *PURE VARIABLES*

---

## 📦 Shotstack Template (Podcast-Style)

```json
{
  "timeline": {
    "background": "#000000",
    "tracks": [
      {
        "clips": [
          {{#each scenes}}
          {
            "asset": {
              "type": "video",
              "src": "{{this.video_url}}"
            },
            "start": {{this.start}},
            "length": "auto",
            "transition": {
              "in": "fade",
              "out": "fade"
            }
          }{{#unless @last}},{{/unless}}
          {{/each}}
        ]
      },
      {
        "clips": [
          {{#each scenes}}
          {
            "asset": {
              "type": "html",
              "html": "<div style='width:100%;height:100%;display:flex;align-items:flex-end;'><div style='margin:0 auto 40px auto;max-width:70%;padding:14px 24px;background:rgba(0,0,0,0.65);border-radius:12px;font-family:Inter,Arial,sans-serif;'><div style='font-size:26px;font-weight:600;color:#ffffff;'>{{this.title}}</div></div></div>"
            },
            "start": {{this.start}},
            "length": {{this.duration}},
            "transition": {
              "in": "fade",
              "out": "fade"
            }
          }{{#unless @last}},{{/unless}}
          {{/each}}
        ]
      },
      {
        "clips": [
          {
            "asset": {
              "type": "html",
              "html": "<div style='width:100%;height:100%;display:flex;justify-content:center;align-items:center;pointer-events:none;'><div style='width:95%;height:95%;border-radius:20px;border:4px solid rgba(255,255,255,0.12);box-shadow:0 0 20px rgba(0,0,0,0.6);'></div></div>"
            },
            "start": 0,
            "length": 99999
          }
        ]
      },
      {
        "clips": [
          {
            "asset": {
              "type": "html",
              "html": "<div style='width:100%;height:100%;background:radial-gradient(circle at center, rgba(0,0,0,0) 60%, rgba(0,0,0,0.35) 100%);'></div>"
            },
            "start": 0,
            "length": 99999
          }
        ]
      }
    ]
  },
  "output": {
    "format": "mp4",
    "fps": 25,
    "size": {
      "width": 1920,
      "height": 1080
    }
  }
}
```

---

# 🎨 Visual Style Notes (PODCAST aesthetic)

Instead of bright colors and banners (TV news), use:

* Soft black overlays
* Rounded corners
* Frosted glass style (`rgba(0,0,0,0.65)`)
* Inter / SF Pro or similar fonts
* Fade transitions only
* No ticker, no red, no urgency

**Goal:** clean, premium, Spotify-podcast-meets-video look.

---

# ⚙️ Step 4 — Automated Assembly Logic

### Inputs

* scene video URLs
* scene titles

### Outputs

* Shotstack-ready JSON

### Automation Steps

1. Fetch scene metadata (titles, urls)
2. Probe video durations
3. Compute cumulative start times
4. Replace template variables
5. Send to Shotstack render API


---

# 🔁 Step 5 — Output Flow

Shotstack returns:

```json
{
  "id": "render-123",
  "status": "queued",
  "url": "https://shotstack-output/episode-final.mp4"
}
```

Your workflow can:

* Store the URL un Supabase
* Send it back to your news generation pipeline
* Allow user to publish video in Youtube
---


# 🧪 Testing Checklist

Before automating end-to-end, check:

* ✓ Videos appear in the correct order
* ✓ No overlaps
* ✓ Lower thirds match each scene
* ✓ Borders + vignette apply correctly
* ✓ Template handles any number of scenes
* ✓ Videos of any duration work