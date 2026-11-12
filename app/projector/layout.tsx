import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'wall',
  robots: { index: false, follow: false },
};

export default function ProjectorLayout({ children }: { children: React.ReactNode }) {
  return children;
}
