import { Connect } from '@/components/Connect';
import { SkillsStagger } from '@/components/lab/SkillsStagger';
import { PhoneShowcase } from '@/components/phone/PhoneShowcase';
import { SectionTab } from '@/components/SectionTab';

export default function Home() {
  return (
    <>
      <SectionTab />
      <PhoneShowcase />
      <main className="relative z-10 bg-[var(--bg)]">
        <div className="mx-auto grid max-w-[1100px] gap-16 px-6 py-20 md:grid-cols-2 md:gap-12 md:px-10 md:py-28">
          <SkillsStagger />
          <Connect />
        </div>
        <footer className="mx-auto max-w-[1100px] px-6 md:px-10">
          <div className="flex items-center justify-between gap-4 border-t border-[var(--border)] py-6 text-[13px] text-[var(--sub)]">
            <span>Sohan Gottipati</span>
            <span>UC Riverside · Computer Science</span>
          </div>
        </footer>
      </main>
    </>
  );
}
