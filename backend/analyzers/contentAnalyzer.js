const axios = require('axios');
const cheerio = require('cheerio');
const { countWords, clamp, extractDomain } = require('../utils/helpers');
const { throttle } = require('../utils/rateLimiter');

const RECOMMENDED_TITLE_LENGTH = 60;
const RECOMMENDED_META_LENGTH = 160;
const MIN_WORD_COUNT = 300;
const MAX_PARAGRAPH_WORDS = 150;
const MAX_SECTION_WORDS = 300;
const LONG_SENTENCE_WORDS = 20;
const MAX_LONG_SENTENCE_PERCENTAGE = 25;
const MIN_TRANSITION_PERCENTAGE = 30;
const MAX_PASSIVE_VOICE_PERCENTAGE = 10;

const TRANSITION_WORDS = [
  'above all',
  'accordingly',
  'additionally',
  'after all',
  'afterward',
  'also',
  'alternatively',
  'as a result',
  'at the same time',
  'because',
  'besides',
  'briefly',
  'by comparison',
  'certainly',
  'consequently',
  'conversely',
  'earlier',
  'even so',
  'finally',
  'first',
  'for example',
  'for instance',
  'further',
  'furthermore',
  'hence',
  'however',
  'in addition',
  'in conclusion',
  'in contrast',
  'in fact',
  'in other words',
  'in short',
  'indeed',
  'instead',
  'likewise',
  'meanwhile',
  'moreover',
  'nevertheless',
  'next',
  'nonetheless',
  'now',
  'on the other hand',
  'otherwise',
  'overall',
  'rather',
  'second',
  'similarly',
  'since',
  'so',
  'still',
  'subsequently',
  'then',
  'therefore',
  'third',
  'thus',
  'ultimately',
  'while',
];

const TRANSITION_REGEX = new RegExp(
  `\\b(?:${TRANSITION_WORDS.map(escapeRegex).sort((left, right) => right.length - left.length).join('|')})\\b`,
  'i'
);
const PASSIVE_VOICE_REGEX = /\b(am|is|are|was|were|be|been|being|get|gets|got|gotten)\b(?:\s+\w+){0,2}\s+\w+(ed|en|wn|nt)\b/i;

async function analyzeContent({ text, url, keyword, competitorData, title, metaDescription }) {
  const seedKeyword = String(keyword || '').trim();
  const keywordLower = normalizeText(seedKeyword);
  const pageData = url && !text
    ? await fetchAndParse(url, { title, metaDescription })
    : parseSubmittedContent({
        text: text || '',
        url,
        title,
        metaDescription,
      });

  const wordCount = countWords(pageData.text);
  const keywordCount = countOccurrences(normalizeText(pageData.text), keywordLower);
  const keywordDensity = wordCount > 0 ? (keywordCount / wordCount) * 100 : 0;
  const titleLength = pageData.title.length;
  const metaDescriptionLength = pageData.metaDescription.length;
  const keywordInTitle = containsKeyword(pageData.title, seedKeyword);
  const keywordAtTitleStart = startsWithKeyword(pageData.title, seedKeyword);
  const keywordInMetaDescription = containsKeyword(pageData.metaDescription, seedKeyword);
  const keywordInH1 = pageData.headings.h1.some((heading) => containsKeyword(heading, seedKeyword));
  const keywordInH2 = pageData.headings.h2.some((heading) => containsKeyword(heading, seedKeyword));
  const firstParagraph = pageData.firstParagraph || pageData.paragraphs[0] || '';
  const keywordInFirstParagraph = containsKeyword(firstParagraph, seedKeyword);
  const internalLinkCount = pageData.links.filter((link) => link.isInternal).length;
  const externalLinkCount = pageData.links.filter((link) => !link.isInternal).length;
  const keywordInImageName = pageData.images.some((image) => containsKeyword(image.fileName, seedKeyword));
  const keywordInImageAlt = pageData.images.some((image) => containsKeyword(image.alt, seedKeyword));

  const readabilityMetrics = getReadabilityMetrics(pageData.text, pageData.paragraphs, pageData.subheadingSections);
  const recommendedWordCount = competitorData?.avgWordCount
    ? Math.max(MIN_WORD_COUNT, Math.round(competitorData.avgWordCount * 1.1))
    : 1500;

  const pageTitleChecks = buildPageTitleChecks({
    keyword: seedKeyword,
    title: pageData.title,
    titleLength,
    keywordInTitle,
    keywordAtTitleStart,
  });
  const metaDescriptionChecks = buildMetaDescriptionChecks({
    keyword: seedKeyword,
    metaDescription: pageData.metaDescription,
    metaDescriptionLength,
    keywordInMetaDescription,
  });
  const contentChecks = buildContentChecks({
    keyword: seedKeyword,
    wordCount,
    recommendedWordCount,
    headings: pageData.headings,
    keywordInH1,
    keywordInH2,
    keywordInFirstParagraph,
    keywordDensity,
    imageCount: pageData.images.length,
    keywordInImageName,
    keywordInImageAlt,
    internalLinkCount,
    subheadingSections: pageData.subheadingSections,
  });
  const readabilityChecks = buildReadabilityChecks(readabilityMetrics);

  const pageTitleScore = calculateSectionScore(pageTitleChecks);
  const metaDescriptionScore = calculateSectionScore(metaDescriptionChecks);
  const contentScore = calculateSectionScore(contentChecks);
  const readabilityScore = calculateSectionScore(readabilityChecks);
  const seoScore = clamp(
    Math.round(
      (pageTitleScore * 0.2) +
      (metaDescriptionScore * 0.15) +
      (contentScore * 0.4) +
      (readabilityScore * 0.25)
    ),
    0,
    100
  );

  const missingTopics = competitorData?.commonTopics
    ? findMissingTopics(pageData.text, competitorData.commonTopics)
    : [];
  const suggestions = buildSuggestions([
    ...pageTitleChecks,
    ...metaDescriptionChecks,
    ...contentChecks,
    ...readabilityChecks,
  ], missingTopics);

  return {
    url: url || null,
    keyword: seedKeyword,
    pageTitle: pageData.title || null,
    metaDescription: pageData.metaDescription || null,
    seoScore,
    readabilityScore,
    pageTitleScore,
    metaDescriptionScore,
    contentScore,
    wordCount,
    recommendedWordCount,
    keywordDensity: roundTo(keywordDensity, 2),
    keywordCount,
    headings: {
      h1: pageData.headings.h1.length,
      h2: pageData.headings.h2.length,
      h3: pageData.headings.h3.length,
      keywordInH1,
      keywordInH2,
    },
    imageCount: pageData.images.length,
    internalLinkCount,
    externalLinkCount,
    firstParagraph,
    keywordInFirstParagraph,
    pageTitleLength: titleLength,
    metaDescriptionLength,
    keywordInTitle,
    keywordAtTitleStart,
    keywordInMetaDescription,
    keywordInImageName,
    keywordInImageAlt,
    readability: {
      score: readabilityScore,
      fleschReadingEase: readabilityMetrics.fleschReadingEase,
      label: readabilityMetrics.label,
      sentenceCount: readabilityMetrics.sentenceCount,
      paragraphCount: readabilityMetrics.paragraphCount,
      paragraphsTooLong: readabilityMetrics.longParagraphCount,
      longSentencePercentage: readabilityMetrics.longSentencePercentage,
      transitionWordPercentage: readabilityMetrics.transitionWordPercentage,
      passiveVoicePercentage: readabilityMetrics.passiveVoicePercentage,
      subheadingSectionsOverLimit: readabilityMetrics.sectionsOverLimit.length,
      subheadingSections: readabilityMetrics.subheadingSections,
    },
    audit: {
      pageTitle: {
        score: pageTitleScore,
        checks: pageTitleChecks,
      },
      metaDescription: {
        score: metaDescriptionScore,
        checks: metaDescriptionChecks,
      },
      content: {
        score: contentScore,
        checks: contentChecks,
      },
      readability: {
        score: readabilityScore,
        checks: readabilityChecks,
      },
    },
    missingTopics,
    suggestions,
  };
}

async function fetchAndParse(url, overrides = {}) {
  await throttle();

  const { data: html } = await axios.get(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
    timeout: 15000,
  });

  return parseHtmlDocument(html, {
    url,
    title: overrides.title,
    metaDescription: overrides.metaDescription,
  });
}

function parseSubmittedContent({ text, url, title, metaDescription }) {
  if (looksLikeHtml(text)) {
    return parseHtmlDocument(text, { url, title, metaDescription });
  }

  return parsePlainTextDocument(text, { url, title, metaDescription });
}

function parseHtmlDocument(html, { url, title, metaDescription } = {}) {
  const $ = cheerio.load(html);
  $('script, style, nav, footer, header, aside, .sidebar, .menu, [role="navigation"]').remove();

  const headings = { h1: [], h2: [], h3: [] };
  $('h1, h2, h3').each((_, element) => {
    const tag = String(element.tagName || element.name || '').toLowerCase();
    const text = cleanInlineText($(element).text());

    if (text && headings[tag]) {
      headings[tag].push(text);
    }
  });

  const paragraphs = $('p')
    .map((_, element) => cleanInlineText($(element).text()))
    .get()
    .filter(Boolean);

  const images = $('img')
    .map((_, element) => {
      const src = String($(element).attr('src') || '').trim();
      const alt = cleanInlineText($(element).attr('alt') || '');
      return {
        src,
        alt,
        fileName: extractFileName(src),
      };
    })
    .get();

  const baseDomain = url ? extractDomain(url) : '';
  const links = $('a[href]')
    .map((_, element) => {
      const href = String($(element).attr('href') || '').trim();
      return {
        href,
        isInternal: isInternalLink(href, baseDomain),
      };
    })
    .get()
    .filter((link) => link.href);

  const text = paragraphs.length > 0
    ? paragraphs.join(' ')
    : cleanInlineText($('body').text());

  return {
    text,
    paragraphs: paragraphs.length > 0 ? paragraphs : splitParagraphs(text),
    firstParagraph: paragraphs[0] || '',
    headings,
    title: cleanInlineText(title || $('title').text() || ''),
    metaDescription: cleanInlineText(
      metaDescription ||
      $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') ||
      ''
    ),
    images,
    links,
    subheadingSections: extractHtmlSubheadingSections($),
  };
}

function parsePlainTextDocument(text, { url, title, metaDescription } = {}) {
  const normalizedText = String(text || '').replace(/\r\n/g, '\n');
  const headings = { h1: [], h2: [], h3: [] };
  const paragraphs = [];
  const subheadingSections = [];
  const currentParagraphLines = [];
  let currentSection = null;
  let currentSectionLines = [];

  function flushParagraph() {
    const paragraph = cleanInlineText(currentParagraphLines.join(' '));
    if (paragraph) {
      paragraphs.push(paragraph);
    }
    currentParagraphLines.length = 0;
  }

  function flushSection() {
    if (!currentSection) {
      return;
    }

    subheadingSections.push({
      heading: currentSection.heading,
      level: currentSection.level,
      wordCount: countWords(currentSectionLines.join(' ')),
    });

    currentSection = null;
    currentSectionLines = [];
  }

  for (const line of normalizedText.split('\n')) {
    const trimmed = line.trim();
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.*)$/);

    if (headingMatch) {
      flushParagraph();
      flushSection();

      const level = headingMatch[1].length;
      const headingText = cleanInlineText(headingMatch[2]);
      const headingKey = `h${level}`;
      if (headings[headingKey] && headingText) {
        headings[headingKey].push(headingText);
      }

      if (level === 2 || level === 3) {
        currentSection = {
          heading: headingText,
          level: headingKey,
        };
      }

      continue;
    }

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    currentParagraphLines.push(trimmed);
    if (currentSection) {
      currentSectionLines.push(trimmed);
    }
  }

  flushParagraph();
  flushSection();

  const htmlLinkMatches = extractHtmlLinks(normalizedText, url ? extractDomain(url) : '');
  const markdownLinkMatches = extractMarkdownLinks(normalizedText, url ? extractDomain(url) : '');
  const htmlImageMatches = extractHtmlImages(normalizedText);
  const markdownImageMatches = extractMarkdownImages(normalizedText);
  const cleanedText = cleanInlineText(stripMarkdownArtifacts(normalizedText));

  return {
    text: paragraphs.length > 0 ? paragraphs.join(' ') : cleanedText,
    paragraphs: paragraphs.length > 0 ? paragraphs : splitParagraphs(cleanedText),
    firstParagraph: paragraphs[0] || '',
    headings,
    title: cleanInlineText(title || ''),
    metaDescription: cleanInlineText(metaDescription || ''),
    images: [...markdownImageMatches, ...htmlImageMatches],
    links: [...markdownLinkMatches, ...htmlLinkMatches],
    subheadingSections,
  };
}

function buildPageTitleChecks({ keyword, title, titleLength, keywordInTitle, keywordAtTitleStart }) {
  return [
    createCheck({
      id: 'page-title-present',
      label: 'Page Title',
      status: title ? 'pass' : 'fail',
      message: title ? 'Page Title is present.' : 'You should add a Page Title.',
      suggestion: 'Add a Page Title.',
      weight: 30,
    }),
    createCheck({
      id: 'page-title-keyword',
      label: 'Focus keyword in Page Title',
      status: keywordInTitle ? 'pass' : 'fail',
      message: keywordInTitle
        ? `The focus keyword "${keyword}" appears in the Page Title.`
        : `The focus keyword "${keyword}" doesn't appear in the Page Title.`,
      suggestion: `Include the focus keyword "${keyword}" in the Page Title.`,
      weight: 25,
    }),
    createCheck({
      id: 'page-title-keyword-position',
      label: 'Focus keyword near start of Page Title',
      status: keywordAtTitleStart ? 'pass' : 'fail',
      message: keywordAtTitleStart
        ? 'The focus keyword appears at the beginning of the Page Title.'
        : 'Put the focus keyword at the beginning of the Page Title.',
      suggestion: 'Move the focus keyword closer to the start of the Page Title.',
      weight: 20,
    }),
    createCheck({
      id: 'page-title-length',
      label: 'Page Title length',
      status: getTitleLengthStatus(titleLength),
      message: buildLengthMessage('Page Title', titleLength, RECOMMENDED_TITLE_LENGTH),
      suggestion: `Keep the Page Title close to ${RECOMMENDED_TITLE_LENGTH} characters.`,
      weight: 25,
    }),
  ];
}

function buildMetaDescriptionChecks({
  keyword,
  metaDescription,
  metaDescriptionLength,
  keywordInMetaDescription,
}) {
  return [
    createCheck({
      id: 'meta-description-present',
      label: 'Meta description',
      status: metaDescription ? 'pass' : 'fail',
      message: metaDescription ? 'Meta description is present.' : 'You should add a Meta description.',
      suggestion: 'Add a Meta description.',
      weight: 35,
    }),
    createCheck({
      id: 'meta-description-keyword',
      label: 'Focus keyword in Meta description',
      status: keywordInMetaDescription ? 'pass' : 'fail',
      message: keywordInMetaDescription
        ? `The focus keyword "${keyword}" appears in the Meta description.`
        : `The focus keyword "${keyword}" doesn't appear in the Meta description.`,
      suggestion: `Include the focus keyword "${keyword}" in the Meta description.`,
      weight: 30,
    }),
    createCheck({
      id: 'meta-description-length',
      label: 'Meta description length',
      status: getMetaLengthStatus(metaDescriptionLength),
      message: buildLengthMessage('Meta description', metaDescriptionLength, RECOMMENDED_META_LENGTH),
      suggestion: `Keep the Meta description close to ${RECOMMENDED_META_LENGTH} characters.`,
      weight: 35,
    }),
  ];
}

function buildContentChecks({
  keyword,
  wordCount,
  recommendedWordCount,
  headings,
  keywordInH1,
  keywordInH2,
  keywordInFirstParagraph,
  keywordDensity,
  imageCount,
  keywordInImageName,
  keywordInImageAlt,
  internalLinkCount,
  subheadingSections,
}) {
  const sectionsOverLimit = subheadingSections.filter((section) => section.wordCount > MAX_SECTION_WORDS);

  return [
    createCheck({
      id: 'content-h1-present',
      label: 'H1 present',
      status: headings.h1.length > 0 ? 'pass' : 'fail',
      message: headings.h1.length > 0 ? 'A H1 is present.' : 'You should add a H1.',
      suggestion: 'Add a clear H1 heading.',
      weight: 10,
    }),
    createCheck({
      id: 'content-h1-keyword',
      label: 'Focus keyword in H1',
      status: keywordInH1 ? 'pass' : 'fail',
      message: keywordInH1
        ? `The focus keyword "${keyword}" appears in the H1.`
        : `The focus keyword "${keyword}" doesn't appear in the H1.`,
      suggestion: 'Include the focus keyword in the H1.',
      weight: 10,
    }),
    createCheck({
      id: 'content-text-present',
      label: 'Text present',
      status: wordCount > 0 ? 'pass' : 'fail',
      message: wordCount > 0 ? 'Text content is present.' : 'You should add text.',
      suggestion: 'Add body content to the page.',
      weight: 8,
    }),
    createCheck({
      id: 'content-word-count',
      label: 'Word count',
      status: getWordCountStatus(wordCount, recommendedWordCount),
      message: wordCount >= MIN_WORD_COUNT
        ? `Your text contains ${wordCount} words.`
        : `Your text doesn't contain enough words, a minimum of ${MIN_WORD_COUNT} words is recommended.`,
      suggestion: `Expand the content to at least ${Math.max(MIN_WORD_COUNT, Math.min(recommendedWordCount, 1200))} words.`,
      weight: 14,
    }),
    createCheck({
      id: 'content-first-paragraph-keyword',
      label: 'Focus keyword in first paragraph',
      status: keywordInFirstParagraph ? 'pass' : 'fail',
      message: keywordInFirstParagraph
        ? `The focus keyword "${keyword}" appears in the first paragraph of the text.`
        : `The focus keyword "${keyword}" doesn't appear in the first paragraph of the text.`,
      suggestion: 'Mention the focus keyword naturally in the first paragraph.',
      weight: 10,
    }),
    createCheck({
      id: 'content-keyword-density',
      label: 'Keyword density',
      status: getKeywordDensityStatus(keywordDensity),
      message: buildKeywordDensityMessage(keyword, keywordDensity),
      suggestion: buildKeywordDensitySuggestion(keywordDensity),
      weight: 12,
    }),
    createCheck({
      id: 'content-image-present',
      label: 'Image present',
      status: imageCount > 0 ? 'pass' : 'fail',
      message: imageCount > 0 ? 'At least one image is present.' : 'You should add an image.',
      suggestion: 'Add at least one relevant image.',
      weight: 8,
    }),
    createCheck({
      id: 'content-image-name-keyword',
      label: 'Focus keyword in image name',
      status: keywordInImageName ? 'pass' : 'fail',
      message: keywordInImageName
        ? `The focus keyword "${keyword}" appears in an image file name.`
        : `The focus keyword "${keyword}" doesn't appear in the image name.`,
      suggestion: 'Use the focus keyword in a relevant image file name.',
      weight: 8,
    }),
    createCheck({
      id: 'content-image-alt-keyword',
      label: 'Focus keyword in image alt text',
      status: keywordInImageAlt ? 'pass' : 'fail',
      message: keywordInImageAlt
        ? `The focus keyword "${keyword}" appears in an image Alt tag.`
        : `The focus keyword "${keyword}" doesn't appear in the image Alt tag.`,
      suggestion: 'Use the focus keyword in a relevant image alt tag.',
      weight: 8,
    }),
    createCheck({
      id: 'content-internal-links',
      label: 'Internal links',
      status: internalLinkCount > 0 ? 'pass' : 'fail',
      message: internalLinkCount > 0
        ? `${internalLinkCount} internal link${internalLinkCount === 1 ? '' : 's'} appear on this page.`
        : 'No internal links appear on this page.',
      suggestion: 'Add relevant links to improve user experience and internal link structure.',
      weight: 8,
    }),
    createCheck({
      id: 'content-subheading-sections',
      label: 'Words after subheadings',
      status: getSubheadingSectionStatus(subheadingSections, sectionsOverLimit),
      message: buildSubheadingSectionMessage(subheadingSections, sectionsOverLimit),
      suggestion: `Keep each section under a subheading below ${MAX_SECTION_WORDS} words.`,
      weight: 4,
    }),
    createCheck({
      id: 'content-h2-keyword',
      label: 'Focus keyword in H2',
      status: keywordInH2 ? 'pass' : 'warn',
      message: keywordInH2
        ? `The focus keyword "${keyword}" appears in a H2.`
        : `The focus keyword "${keyword}" doesn't appear in any H2 yet.`,
      suggestion: 'Consider using the focus keyword in a H2 where it fits naturally.',
      weight: 4,
    }),
  ];
}

function buildReadabilityChecks(metrics) {
  return [
    createCheck({
      id: 'readability-score',
      label: 'Readability score',
      status: getReadabilityEaseStatus(metrics.fleschReadingEase),
      message: `Readability score is ${metrics.fleschReadingEase} (${metrics.label}).`,
      suggestion: 'Simplify sentence structure and vocabulary to improve readability.',
      weight: 20,
    }),
    createCheck({
      id: 'readability-paragraph-length',
      label: 'Paragraph length',
      status: getParagraphLengthStatus(metrics.longParagraphCount),
      message: metrics.longParagraphCount === 0
        ? 'None of the paragraphs are too long, which is great.'
        : `${metrics.longParagraphCount} paragraph${metrics.longParagraphCount === 1 ? ' is' : 's are'} longer than ${MAX_PARAGRAPH_WORDS} words.`,
      suggestion: `Keep paragraphs below ${MAX_PARAGRAPH_WORDS} words.`,
      weight: 20,
    }),
    createCheck({
      id: 'readability-long-sentences',
      label: 'Long sentences',
      status: getLongSentenceStatus(metrics.longSentencePercentage),
      message: `${metrics.longSentencePercentage}% of the sentences contain more than ${LONG_SENTENCE_WORDS} words, which is ${metrics.longSentencePercentage <= MAX_LONG_SENTENCE_PERCENTAGE ? 'less than or equal to' : 'above'} the recommended maximum of ${MAX_LONG_SENTENCE_PERCENTAGE}%.`,
      suggestion: `Keep the percentage of sentences over ${LONG_SENTENCE_WORDS} words below ${MAX_LONG_SENTENCE_PERCENTAGE}%.`,
      weight: 20,
    }),
    createCheck({
      id: 'readability-transition-words',
      label: 'Transition words',
      status: getTransitionStatus(metrics.transitionWordPercentage),
      message: `${metrics.transitionWordPercentage}% of the sentences contain a transition word or phrase${metrics.transitionWordPercentage >= MIN_TRANSITION_PERCENTAGE ? ', which is great.' : '.'}`,
      suggestion: 'Use more transition words and phrases to improve flow.',
      weight: 20,
    }),
    createCheck({
      id: 'readability-passive-voice',
      label: 'Passive voice',
      status: getPassiveVoiceStatus(metrics.passiveVoicePercentage),
      message: `${metrics.passiveVoicePercentage}% of the sentences contain passive voice, which is ${metrics.passiveVoicePercentage <= MAX_PASSIVE_VOICE_PERCENTAGE ? 'less than or equal to' : 'above'} the recommended maximum of ${MAX_PASSIVE_VOICE_PERCENTAGE}%.`,
      suggestion: `Keep passive voice below ${MAX_PASSIVE_VOICE_PERCENTAGE}%.`,
      weight: 20,
    }),
  ];
}

function createCheck({ id, label, status, message, suggestion, weight }) {
  return {
    id,
    label,
    status,
    message,
    suggestion,
    weight,
  };
}

function calculateSectionScore(checks) {
  const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0);
  const earnedWeight = checks.reduce((sum, check) => sum + getWeightedPoints(check), 0);
  return totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 100) : 0;
}

function getWeightedPoints(check) {
  if (check.status === 'pass') {
    return check.weight;
  }

  if (check.status === 'warn') {
    return check.weight * 0.5;
  }

  return 0;
}

function getReadabilityMetrics(text, paragraphs, subheadingSections) {
  const sentences = splitSentences(text);
  const paragraphList = paragraphs.filter(Boolean);
  const longParagraphCount = paragraphList.filter((paragraph) => countWords(paragraph) > MAX_PARAGRAPH_WORDS).length;
  const longSentenceCount = sentences.filter((sentence) => countWords(sentence) > LONG_SENTENCE_WORDS).length;
  const transitionSentenceCount = sentences.filter((sentence) => TRANSITION_REGEX.test(sentence)).length;
  const passiveVoiceCount = sentences.filter((sentence) => PASSIVE_VOICE_REGEX.test(sentence)).length;
  const totalWords = countWords(text);
  const totalSyllables = countSyllablesInText(text);
  const fleschReadingEase = sentences.length > 0 && totalWords > 0
    ? clamp(
        Math.round(
          206.835 -
          (1.015 * (totalWords / sentences.length)) -
          (84.6 * (totalSyllables / totalWords))
        ),
        0,
        100
      )
    : 0;

  return {
    sentenceCount: sentences.length,
    paragraphCount: paragraphList.length,
    longParagraphCount,
    longSentencePercentage: percent(longSentenceCount, sentences.length),
    transitionWordPercentage: percent(transitionSentenceCount, sentences.length),
    passiveVoicePercentage: percent(passiveVoiceCount, sentences.length),
    fleschReadingEase,
    label: getReadabilityLabel(fleschReadingEase),
    subheadingSections,
    sectionsOverLimit: subheadingSections.filter((section) => section.wordCount > MAX_SECTION_WORDS),
  };
}

function buildSuggestions(checks, missingTopics) {
  const suggestions = checks
    .filter((check) => check.status !== 'pass' && check.suggestion)
    .map((check) => check.suggestion);

  if (missingTopics.length > 0) {
    suggestions.push(`Cover missing competitor topics such as: ${missingTopics.slice(0, 5).join(', ')}.`);
  }

  return [...new Set(suggestions)].slice(0, 12);
}

function findMissingTopics(content, competitorTopics) {
  const normalizedContent = normalizeText(content);
  return competitorTopics.filter((topic) => !normalizedContent.includes(normalizeText(topic)));
}

function splitSentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((sentence) => sentence.trim()).filter(Boolean) || [];
}

function splitParagraphs(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((paragraph) => cleanInlineText(paragraph))
    .filter(Boolean);
}

function extractMarkdownLinks(text, baseDomain) {
  const links = [];
  const regex = /(?<!!)\[[^\]]+\]\(([^)]+)\)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const href = String(match[1] || '').trim();
    if (!href) continue;
    links.push({
      href,
      isInternal: isInternalLink(href, baseDomain),
    });
  }

  return links;
}

function extractMarkdownImages(text) {
  const images = [];
  const regex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const alt = cleanInlineText(match[1] || '');
    const src = String(match[2] || '').trim();
    images.push({
      src,
      alt,
      fileName: extractFileName(src),
    });
  }

  return images;
}

function extractHtmlLinks(text, baseDomain) {
  if (!looksLikeHtml(text)) {
    return [];
  }

  const $ = cheerio.load(text);
  return $('a[href]')
    .map((_, element) => {
      const href = String($(element).attr('href') || '').trim();
      return {
        href,
        isInternal: isInternalLink(href, baseDomain),
      };
    })
    .get()
    .filter((link) => link.href);
}

function extractHtmlImages(text) {
  if (!looksLikeHtml(text)) {
    return [];
  }

  const $ = cheerio.load(text);
  return $('img')
    .map((_, element) => {
      const src = String($(element).attr('src') || '').trim();
      const alt = cleanInlineText($(element).attr('alt') || '');
      return {
        src,
        alt,
        fileName: extractFileName(src),
      };
    })
    .get();
}

function extractHtmlSubheadingSections($) {
  const sections = [];
  let currentSection = null;

  $('body').find('h2, h3, p, li').each((_, element) => {
    const tag = String(element.tagName || element.name || '').toLowerCase();
    const text = cleanInlineText($(element).text());

    if (!text) {
      return;
    }

    if (tag === 'h2' || tag === 'h3') {
      if (currentSection) {
        sections.push(currentSection);
      }

      currentSection = {
        heading: text,
        level: tag,
        wordCount: 0,
      };
      return;
    }

    if (currentSection) {
      currentSection.wordCount += countWords(text);
    }
  });

  if (currentSection) {
    sections.push(currentSection);
  }

  return sections;
}

function isInternalLink(href, baseDomain) {
  const value = String(href || '').trim();
  if (!value) {
    return false;
  }

  if (value.startsWith('#') || value.startsWith('/') || value.startsWith('./') || value.startsWith('../')) {
    return true;
  }

  try {
    const domain = extractDomain(value);
    return baseDomain ? domain === baseDomain : false;
  } catch {
    return false;
  }
}

function extractFileName(src) {
  if (!src) {
    return '';
  }

  try {
    const pathname = new URL(src, 'https://example.com').pathname;
    const parts = pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
  } catch {
    const parts = String(src).split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
  }
}

function containsKeyword(text, keyword) {
  if (!keyword) {
    return false;
  }

  return normalizeText(text).includes(normalizeText(keyword));
}

function startsWithKeyword(text, keyword) {
  if (!keyword) {
    return false;
  }

  return normalizeText(text).startsWith(normalizeText(keyword));
}

function countOccurrences(text, sub) {
  if (!text || !sub) {
    return 0;
  }

  let count = 0;
  let position = 0;

  while ((position = text.indexOf(sub, position)) !== -1) {
    count += 1;
    position += sub.length;
  }

  return count;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripMarkdownArtifacts(text) {
  return String(text || '')
    .replace(/!\[[^\]]*\]\(([^)]+)\)/g, ' ')
    .replace(/\[[^\]]+\]\(([^)]+)\)/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>~-]/g, ' ');
}

function cleanInlineText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function roundTo(value, decimals) {
  return Number.parseFloat(Number(value || 0).toFixed(decimals));
}

function percent(part, total) {
  if (!total) {
    return 0;
  }

  return roundTo((part / total) * 100, 1);
}

function getTitleLengthStatus(length) {
  if (length >= 30 && length <= RECOMMENDED_TITLE_LENGTH) {
    return 'pass';
  }

  if ((length >= 20 && length < 30) || (length > RECOMMENDED_TITLE_LENGTH && length <= 70)) {
    return 'warn';
  }

  return 'fail';
}

function getMetaLengthStatus(length) {
  if (length >= 120 && length <= RECOMMENDED_META_LENGTH) {
    return 'pass';
  }

  if ((length >= 90 && length < 120) || (length > RECOMMENDED_META_LENGTH && length <= 180)) {
    return 'warn';
  }

  return 'fail';
}

function getWordCountStatus(wordCount, recommendedWordCount) {
  if (wordCount >= Math.min(recommendedWordCount, 1200)) {
    return 'pass';
  }

  if (wordCount >= MIN_WORD_COUNT) {
    return 'warn';
  }

  return 'fail';
}

function getKeywordDensityStatus(keywordDensity) {
  if (keywordDensity >= 0.5 && keywordDensity <= 3) {
    return 'pass';
  }

  if ((keywordDensity >= 0.3 && keywordDensity < 0.5) || (keywordDensity > 3 && keywordDensity <= 4)) {
    return 'warn';
  }

  return 'fail';
}

function getSubheadingSectionStatus(subheadingSections, sectionsOverLimit) {
  if (subheadingSections.length === 0) {
    return 'warn';
  }

  return sectionsOverLimit.length === 0 ? 'pass' : 'fail';
}

function getReadabilityEaseStatus(score) {
  if (score >= 60) {
    return 'pass';
  }

  if (score >= 50) {
    return 'warn';
  }

  return 'fail';
}

function getParagraphLengthStatus(longParagraphCount) {
  if (longParagraphCount === 0) {
    return 'pass';
  }

  if (longParagraphCount === 1) {
    return 'warn';
  }

  return 'fail';
}

function getLongSentenceStatus(value) {
  if (value <= MAX_LONG_SENTENCE_PERCENTAGE) {
    return 'pass';
  }

  if (value <= 35) {
    return 'warn';
  }

  return 'fail';
}

function getTransitionStatus(value) {
  if (value >= MIN_TRANSITION_PERCENTAGE) {
    return 'pass';
  }

  if (value >= 20) {
    return 'warn';
  }

  return 'fail';
}

function getPassiveVoiceStatus(value) {
  if (value <= MAX_PASSIVE_VOICE_PERCENTAGE) {
    return 'pass';
  }

  if (value <= 15) {
    return 'warn';
  }

  return 'fail';
}

function buildLengthMessage(label, length, recommendedLength) {
  if (length === 0) {
    return `You should add a ${label}.`;
  }

  if (length < (label === 'Page Title' ? 30 : 120)) {
    return `The ${label} is too short. ${recommendedLength} characters available. (${length} of ${recommendedLength} characters used)`;
  }

  if (length > recommendedLength) {
    return `The ${label} is too long. (${length} of ${recommendedLength} characters used)`;
  }

  return `The ${label} length looks good. (${length} of ${recommendedLength} characters used)`;
}

function buildKeywordDensityMessage(keyword, density) {
  if (density >= 0.5 && density <= 3) {
    return `The focus keyword "${keyword}" is used naturally with a keyword density of ${roundTo(density, 1)}%.`;
  }

  if (density === 0) {
    return `You should use the focus keyword "${keyword}" more often, to improve the keyword density (0%).`;
  }

  if (density < 0.5) {
    return `You should use the focus keyword "${keyword}" more often, to improve the keyword density (${roundTo(density, 1)}%).`;
  }

  return `The keyword density is high at ${roundTo(density, 1)}%, which may feel over-optimized.`;
}

function buildKeywordDensitySuggestion(density) {
  if (density < 0.5) {
    return 'Use the focus keyword more often in a natural way.';
  }

  if (density > 3) {
    return 'Reduce repeated uses of the focus keyword to avoid over-optimization.';
  }

  return '';
}

function buildSubheadingSectionMessage(subheadingSections, sectionsOverLimit) {
  if (subheadingSections.length === 0) {
    return 'Add subheadings so the content is easier to scan.';
  }

  if (sectionsOverLimit.length === 0) {
    return `The amount of words following each of the subheadings doesn't exceed the recommended maximum of ${MAX_SECTION_WORDS} words, which is great.`;
  }

  return `${sectionsOverLimit.length} section${sectionsOverLimit.length === 1 ? '' : 's'} exceed the recommended maximum of ${MAX_SECTION_WORDS} words after a subheading.`;
}

function getReadabilityLabel(score) {
  if (score >= 80) return 'Very easy to read';
  if (score >= 60) return 'Easy to read';
  if (score >= 50) return 'Fairly easy to read';
  if (score >= 30) return 'Difficult to read';
  return 'Very difficult to read';
}

function countSyllablesInText(text) {
  return String(text || '')
    .toLowerCase()
    .match(/[a-z]+/g)?.reduce((sum, word) => sum + countSyllables(word), 0) || 0;
}

function countSyllables(word) {
  const value = String(word || '').toLowerCase().replace(/[^a-z]/g, '');

  if (!value) {
    return 0;
  }

  if (value.length <= 3) {
    return 1;
  }

  const processed = value
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '')
    .replace(/^y/, '');
  const matches = processed.match(/[aeiouy]{1,2}/g);

  return matches ? matches.length : 1;
}

function looksLikeHtml(value) {
  return /<[a-z][\s\S]*>/i.test(String(value || ''));
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { analyzeContent };
