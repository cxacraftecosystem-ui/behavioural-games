import {
  ArrowRightIcon,
  FlaskConicalIcon,
  Gamepad2Icon,
  MicroscopeIcon,
  ShieldIcon,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DEMO_BANNER_TITLE, DEMO_MODE, DEMO_READ_ONLY_MESSAGE } from '@/lib/demo';

export const metadata: Metadata = { title: { absolute: 'SHRIII Behavioural Games' } };

const SECTIONS = [
  {
    href: '/kiosk',
    title: 'Kiosk game',
    icon: Gamepad2Icon,
    cta: 'Play the kiosk',
    text: 'The full-screen public kiosk: a golden-hour village market fair with spoken guidance, touch-only play and two pathways (story episodes or a carousel of micro-games). No scores are shown during play.',
  },
  {
    href: '/research',
    title: 'Research console',
    icon: MicroscopeIcon,
    cta: 'Open research',
    text: 'Studies, participants, criterion instruments, indicators and the Trait Validation Workbench: reliability, convergent validity, fairness and the release gates.',
  },
  {
    href: '/admin',
    title: 'Admin console',
    icon: ShieldIcon,
    cta: 'Open admin',
    text: 'Kiosk fleet health, game configurations with two-person approval, content and voice-line coverage, deployment policy and audit.',
  },
] as const;

/** `/`: project landing page linking the three surfaces. */
export default function HomePage() {
  return (
    <div className="min-h-dvh bg-background">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-12 sm:py-16">
        <header className="space-y-4">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground"
            >
              S
            </span>
            <span className="text-sm font-semibold">SHRIII</span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Kiosk Behavioural Games
          </h1>
          <p className="max-w-3xl text-base text-pretty text-muted-foreground">
            A research-grade behavioural assessment platform. Adults play short, voice-guided games
            on a public kiosk; every tap is logged as a raw event, turned into behavioural
            indicators by a versioned scoring dictionary, and validated against criterion
            instruments before any trait estimate or participant report is released. Touch is always
            enough, nothing needs reading, and reports stay off until the validation gates pass.
          </p>
        </header>

        {DEMO_MODE && (
          <div
            role="note"
            data-testid="demo-banner"
            className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-100 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
          >
            <FlaskConicalIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>
              <strong className="font-semibold">Public demo · {DEMO_BANNER_TITLE}.</strong> The
              consoles use a demo sign-in (pick a role, no credentials) and synthetic fixtures; the
              kiosk plays fully offline and uploads nothing. {DEMO_READ_ONLY_MESSAGE}
            </p>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          {SECTIONS.map(({ href, title, icon: Icon, cta, text }) => (
            <Card key={href} className="flex flex-col">
              <CardHeader>
                <Icon className="mb-1 size-5 text-primary" aria-hidden="true" />
                <CardTitle className="text-lg">{title}</CardTitle>
                <CardDescription>{text}</CardDescription>
              </CardHeader>
              <CardContent className="mt-auto">
                <Button asChild className="w-full">
                  <Link href={href}>
                    {cta}
                    <ArrowRightIcon />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        <footer className="text-xs text-muted-foreground">
          Nothing here is validated on real participants yet; every scientific output is
          research-only.
        </footer>
      </main>
    </div>
  );
}
