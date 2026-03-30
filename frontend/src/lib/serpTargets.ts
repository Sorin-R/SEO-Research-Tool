import type { SerpDomain, SerpEngine } from './buildSerpPrompt';

export type SerpTargetOption = {
  value: string;
  label: string;
  engine: SerpEngine;
  domain: SerpDomain;
};

export const SERP_TARGET_OPTIONS: SerpTargetOption[] = [
  { value: 'google.com', label: 'Google.com', engine: 'google', domain: 'com' },
  { value: 'google.co.uk', label: 'Google.co.uk', engine: 'google', domain: 'co.uk' },
  { value: 'bing.com', label: 'Bing.com', engine: 'bing', domain: 'com' },
  { value: 'bing.co.uk', label: 'Bing.co.uk', engine: 'bing', domain: 'co.uk' },
];

export function parseSerpTarget(value: string): { engine: SerpEngine; domain: SerpDomain } {
  const match = SERP_TARGET_OPTIONS.find((option) => option.value === value);
  if (match) {
    return {
      engine: match.engine,
      domain: match.domain,
    };
  }

  return {
    engine: 'google',
    domain: 'com',
  };
}
