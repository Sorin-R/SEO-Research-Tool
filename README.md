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
  "location": "London"
}
```

Response:

```json
{
  "keyword": "auto",
  "engine": "google",
  "domain": "co.uk",
  "location": "London",
  "results": [
    {
      "position": 1,
      "title": "Example",
      "url": "https://example.com"
    }
  ]
}
```

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
- To add more targets, extend:
  - `backend/search/config.js`
  - `frontend/src/lib/serpTargets.ts`
