# Content Analyzer Scoring Logic

## Readability Score (5 checks)

### 1) Readability score (Flesch)
- Formula: `206.835 - 1.015*(words/sentences) - 84.6*(syllables/words)`, clamped `0..100`.
- `pass >= 60`
- `warn 50..59`
- `fail < 50`

### 2) Paragraph length
- Long paragraph = `> 150 words`.
- `pass` if `0` long paragraphs.
- `warn` if `1` long paragraph.
- `fail` if `2+` long paragraphs.

### 3) Long sentences
- Long sentence = `> 20 words`.
- `pass` if percentage is `10..25`.
- `warn` if percentage is `<= 35` but outside pass range (also includes `< 10`).
- `fail` if percentage is `> 35`.

### 4) Transition words
- Uses transition-word regex list.
- `pass >= 30%`
- `warn 20..29.9%`
- `fail < 20%`

### 5) Passive voice
- Uses passive-voice regex.
- `pass <= 10%`
- `warn <= 15%`
- `fail > 15%`

## Page Title Score (4 checks)
- `page-title-present`: `pass` if title exists, else `fail`.
- `page-title-keyword`: `pass` if focus keyword appears in title, else `fail`.
- `page-title-keyword-position`: `pass` if keyword is at start of title, else `fail`.
- `page-title-length`: `pass` if `30-60` chars, `warn` if `20-29` or `61-70`, `fail` otherwise.

## Meta Description Score (3 checks)
- `meta-description-present`: `pass` if meta description exists, else `fail`.
- `meta-description-keyword`: `pass` if focus keyword appears, else `fail`.
- `meta-description-length`: `pass` if `120-160` chars, `warn` if `90-119` or `161-180`, `fail` otherwise.

## Content Score (12 checks)
- `content-h1-present`: `pass` if at least one H1, else `fail`.
- `content-h1-keyword`: `pass` if keyword in H1, else `fail`.
- `content-text-present`: `pass` if word count `> 0`, else `fail`.
- `content-word-count`: `pass` if `wordCount >= min(recommendedWordCount, 1200)`, `warn` if `>= 300`, else `fail`.
- `content-first-paragraph-keyword`: `pass` if keyword in first paragraph, else `fail`.
- `content-keyword-density`: `pass` if `0.5%-3%`, `warn` if `0.3%-0.49%` or `3.01%-4%`, else `fail`.
- `content-image-present`: `pass` if at least one image, else `fail`.
- `content-image-name-keyword`: `pass` if keyword appears in any image filename, else `fail`.
- `content-image-alt-keyword`: `pass` if keyword appears in any image alt text, else `fail`.
- `content-internal-links`: `pass` if internal links `> 0`, else `fail`.
- `content-subheading-sections`: `pass` if subheadings exist and all sections under H2/H3 are `<= 300` words, `warn` if no subheadings, `fail` if any section `> 300` words.
- `content-h2-keyword`: `pass` if keyword in any H2, else `warn` (never `fail`).

## Prompt Template: Create/Improve Page Content

```text
Create or improve the content for the page at {{path}}.

Main keyword: {{main keyword}}

Requirements:
- Keep the page focused on {{main keyword}}.
- Optimize for SEO title, meta description, H1, first paragraph keyword usage, readability, and internal links.
- Keep valid page structure.
- Use natural language and avoid keyword stuffing.
- Ensure the content aligns with the scoring logic in this document.
```

## Raw Placeholder Variant (if your tool requires literal braces)

```text
Create or improve the content for the page at {{path}} and using {{{{main keyword}} keywords }}.
```
