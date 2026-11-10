import { Connect } from '@/components/Connect';
import { SkillsStagger } from '@/components/lab/SkillsStagger';
import { PhoneShowcase } from '@/components/phone/PhoneShowcase';
import { SectionTab } from '@/components/SectionTab';

export default function Home() {
  return (
    <>
      <SectionTab />
      <PhoneShowcase />
      <main className="relative z-10 m-3 rounded-[20px] bg-[var(--bg)]">
        <SkillsStagger />
        <Connect />
      </main>
    </>
  );
}
