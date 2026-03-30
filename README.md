# SEO Research Tool

This repository includes a focused SERP MVP flow with:

- keyword input
- engine/domain selector:
  - `Google.com`
  - `Google.co.uk`
  - `Bing.com`
  - `Bing.co.uk`
- normalized top-10 organic results:
  - `position`
  - `title`
  - `url`

Existing project features remain available.

## New MVP Architecture

### Backend

- Route: `backend/routes/search.js`
- Service: `backend/search/searchService.js`
- Provider abstraction:
  - `backend/search/providers/googleProvider.js`
  - `backend/search/providers/bingProvider.js`
- Prompt template:
  - `backend/search/buildSerpPrompt.js`
- Target config:
  - `backend/search/config.js`
- Result normalization:
  - `backend/search/normalizeSearchResults.js`

### Frontend

- Page: `frontend/src/pages/SimpleSerpSearch.tsx`
- Prompt template: `frontend/src/lib/buildSerpPrompt.ts`
- Target dropdown config: `frontend/src/lib/serpTargets.ts`
- API call: `frontend/src/services/api.js` (`searchFirstPage`)

## API Contract

### `POST /api/search`

Request:

```json
{
  "keyword": "auto",
  "engine": "google",
  "domain": "co.uk",
  "location": "London",
  "highAccuracyMode": true,
  "providerId": "searchapi",
  "strictMode": true,
  "verifyUrls": true,
  "debug": true
}
```

Response:

```json
{
  "keyword": "auto",
  "engine": "google",
  "domain": "co.uk",
  "location": "London",
  "meta": {
    "highAccuracyMode": true,
    "strictMode": true,
    "providerLock": "searchapi",
    "selectedProviderId": "searchapi",
    "selectedProviderName": "SearchAPI",
    "redirectsVerified": true
  },
  "results": [
    {
      "position": 1,
      "title": "Example",
      "url": "https://example.com",
      "websiteTitle": "Example Home"
    }
  ]
}
```

### `GET /api/search/providers`

Returns configured providers that can be used with `providerId` lock.

## Local Setup

### 1. Install dependencies

```bash
npm install
npm --prefix backend install
npm --prefix frontend install
```

### 2. Start backend

```bash
npm --prefix backend run dev
```

Backend default URL: `http://localhost:3001`

### 3. Start frontend

```bash
npm --prefix frontend run dev
```

Frontend default URL: `http://localhost:5173`

## Notes

- Duplicate exact URLs are removed after normalization.
- Keyword input is trimmed/sanitized before search.
- Keyword is sent exactly as entered; location is sent as a separate location signal.
- High Accuracy Mode can lock one provider, enforce strict geo params, verify redirects, and return debug attempts.
- To add more targets, extend:
  - `backend/search/config.js`
  - `frontend/src/lib/serpTargets.ts`
