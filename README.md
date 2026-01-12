# Aavartan

A fully offline, air-gapped single-user Visit Programme generator for local deployment.  
Designed for quick data entry, deterministic itinerary generation, and ergonomic exports. Aim to please.

## Major Features

- **Offline-first / air-gapped**: no CDN dependencies; all assets bundled locally.
- **Local data persistence**: visits are stored locally (encrypted at rest where enabled).
- **Visit Programme workflow**
  - Create a new visit, auto-generate the programme table, and iterate quickly.
  - **Past visits become read-only** (prevents accidental edits); exports remain available.
- **Visits Conducted**
  - Search, filter, and open prior visits.
  - Inline open preview on the landing page (embedded Visit Programme view).
- **Import / Export (TXT)**
  - Import visits from a TXT file and have them immediately appear in the conducted list.
  - Export to TXT for backup and portability.
- **Exports**
  - **A4 PDF export** with pagination and repeated table headers.
  - **DOCX export** matching the same tabulation intent as the PDF.
  - Export “Time” formatting: `0700-0720h` with `(XX min)` on the next line.
- **Modern UI**
  - Light/Dark themes with contrast-safe typography.
  - Geometry + Conway's Game of Life background visualizations (subtle, low-distraction).
  - Sidebar quick actions and session countdown display.

## Usage

1. Open `index.html` in a modern browser. Access it online [here](https://sageind.github.io/aavartan/) 🥷🏽✒️🖤
2. Use **Visit Programme** to create a new programme, or use **Visits Conducted** to open existing programmes.
3. Use **Import TXT** to restore previously exported data. After import refresh the `index.html` page.

## Notes

- This package is intended for offline deployment on a single workstation only client side code execution.
- If you deploy on removable media, keep the entire folder structure intact.
- Vibe coded in Jan 2026 by self. Dedicated as service to all meticulous planners, hero worshippers, uncles & aunties.
- Click New on bottom navbar if Visit Programme page loads with past visit data after viewing past visit (quirk). Send me more quirks and buy me a coffee.

