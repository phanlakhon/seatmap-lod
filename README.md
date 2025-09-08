# Interactive Seat Map (Next.js + PixiJS)

## Overview

This project demonstrates an interactive seat map with zoom, pan, and Level of Detail (LOD) switching between zones, rows, and seats. It is built using Next.js, React, PixiJS, and pixi-viewport.

## Features

- Zoom & pan with mouse and touch controls.
- Level of Detail switching: Zones → Rows → Seats.
- Seat statuses (Available, Hold, Sold) represented with different colors.
- Click to select and deselect seats.
- Mock real-time updates that randomly change seat statuses.
- Buttons to reset view and zoom to selected seats.

## Getting Started

Install dependencies and run the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to view the app.

## File Structure

- `components/SeatMapLOD.tsx` – Main component implementing the PixiJS canvas, viewport, rendering logic, and LOD functionality.
- `app/page.tsx` – Loads the SeatMapLOD component with server-side rendering disabled.

## How It Works

- Zones, rows, and seats are generated using mock data.
- PixiJS viewport manages the camera with drag, pinch, and wheel zoom interactions.
- Different zoom levels toggle visibility of layers:
  - Low zoom (< 0.35): show zones.
  - Mid zoom (0.35 – 0.49): show rows.
  - High zoom (≥ 0.50): show seats.
- Seats are rendered only if visible within the viewport using bounding box culling for performance.
- A timed interval simulates real-time updates by randomly toggling seat statuses.

## Next Steps / Improvements

- Replace mock data with API-driven seat and zone information.
- Add WebSocket or Server-Sent Events for true real-time updates.
- Implement tiling or quadtree spatial indexing for large venue support.
- Improve accessibility with keyboard navigation and ARIA labels.

## License

MIT (or specify as needed).
