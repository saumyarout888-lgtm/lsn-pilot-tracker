# LSN Pilot Operations Tracker

## Project Overview
A mobile-first single-file React web app for LSN's EV delivery pilot operations.
Drivers use it daily to sign in/out with GPS geofencing. Admins manage hub locations, vehicle registry, and driver roster.

## GitHub Repo
`https://github.com/saumyarout888-lgtm/lsn-pilot-tracker`

## Hosting
Netlify — connect repo `lsn-pilot-tracker` via Netlify dashboard (Build: `npm run build`, Publish: `dist`).

## Tech Stack
- React 18 + Vite
- Tailwind CSS
- No external icon library — all SVGs are inline inside `Ico` object in `src/DmartTracker.jsx`
- `localStorage` for data persistence (no backend yet)
- Google Apps Script optional webhook for live Google Sheets logging (`SHEET_URL` constant)

## Key File
**`src/DmartTracker.jsx`** — entire app lives here (single file). Edit this file for all changes.

## Admin Config (top of DmartTracker.jsx)
```js
const ADMIN_PIN = "0000";          // Change before going live
const SHEET_URL = "PASTE_...";     // Google Apps Script webhook URL
const VH_CFG = { ... }             // Vehicle fleet config — type, MG targets, DA requirement
```

## App Structure

### Two roles — selected on landing screen
| Role | Access |
|------|--------|
| Driver / DA | Geofenced sign-in → parcel entry → sign-out |
| Admin (PIN: 0000) | 4 tabs: Hubs · Daily Log · Vehicles · Roster |

### Admin Tabs
| Tab | Purpose |
|-----|---------|
| **Hubs** | Set per-vehicle GPS hub location + radius. "Use My Location" auto-fills coords. Links to Google Maps for verification. |
| **Daily Log** | View all driver shift entries. Add/edit/delete rows. Auto-computes MG Met. |
| **Vehicles** | Edit VH-01–VH-05 registry (reg no., driver, DA, status). |
| **Roster** | Manage 10 members (DRV-01–05, DA-01–04, BUF-01). Add new members. |

### Driver Flow
1. Select Vehicle ID → type + vendor + MG target + assigned hub shown
2. Enter Driver Name (+ DA Name for VH-04/VH-05)
3. Sign In → GPS checked against vehicle's admin-set hub (Haversine formula)
4. Active shift screen with shift start time
5. Sign Out → GPS re-checked
6. Enter parcels delivered + charging toggle
7. Success card shows full log entry; auto-saves to admin Daily Log

## Vehicle Fleet
| ID | Type | Vendor | MG Target | DA Required |
|----|------|--------|-----------|-------------|
| VH-01 | e3W | Wikilabs | 650 | No |
| VH-02 | e3W | Wikilabs | 650 | No |
| VH-03 | e4W | Gentari | 800 | No |
| VH-04 | e4W | Gentari | 850 | Yes |
| VH-05 | e4W | Gentari | 850 | Yes |

## Data Storage
All data persisted in `localStorage` under these keys:
- `lsn_ops_log` — daily shift log entries
- `lsn_vehicles` — vehicle registry
- `lsn_roster` — driver/DA roster
- `lsn_hubs` — per-vehicle hub GPS configs

## Google Sheets Integration (optional)
Apps Script `doPost` function appends a row on each sign-in and sign-out.
Fields sent: `vid, type, driver, da, start, end, parcels, charging, status, date`.
Set `SHEET_URL` constant to the deployed Web App URL to activate.

## Dev Setup
```bash
git clone https://github.com/saumyarout888-lgtm/lsn-pilot-tracker
cd lsn-pilot-tracker
npm install
npm run dev        # runs on http://localhost:5175
```

## Deploy
```bash
npm run build      # outputs to dist/
# drag dist/ to netlify.com/drop  OR  push to main branch (Netlify auto-deploys)
```

## Pending / Next Steps
- [ ] Replace localStorage with a real backend (Supabase / Firebase) for cross-device data sync
- [ ] Add escalation log tab (matches Escalation Log sheet in Excel tracker)
- [ ] Add monthly MG summary view
- [ ] PWA manifest so drivers can install as home screen app
- [ ] Push notification when driver hasn't signed in by shift start time
