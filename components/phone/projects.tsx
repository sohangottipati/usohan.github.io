import type { ReactNode } from 'react';

export type PhoneProject =
  | { id: string; name: string; tagline: string; meta: string; demo: string; icon: ReactNode; soon?: false }
  | { id: string; name: string; tagline: string; soon: true };

/**
 * Apps shown on the phone screen. To add a project, replace one of the
 * "Coming soon" entries with an object that has a `demo` URL — tapping it
 * loads that URL inside the phone.
 */
export const PHONE_PROJECTS: PhoneProject[] = [
  {
    id: 'studispot',
    name: 'Studispot',
    tagline: 'Rank study spots head-to-head. Elo-style scores surface the best place to focus.',
    meta: 'React Native · Expo',
    demo: 'https://demo.sohan.website',
    icon: (
      <svg width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden>
        <path d="M15 27s9-8.2 9-15A9 9 0 0 0 6 12c0 6.8 9 15 9 15Z" fill="#fff" />
        <path
          d="M10.5 11.2c1.6-.9 3.1-.9 4.5 0 1.4-.9 2.9-.9 4.5 0v5.6c-1.6-.9-3.1-.9-4.5 0-1.4-.9-2.9-.9-4.5 0v-5.6Z"
          fill="#1877ae"
        />
        <path d="M15 11.2v5.6" stroke="#fff" strokeWidth="1" />
      </svg>
    ),
  },
  { id: 'soon-1', soon: true, name: 'Coming soon', tagline: 'Next project in the works.' },
  { id: 'soon-2', soon: true, name: 'Coming soon', tagline: 'Another one on the way.' },
];
