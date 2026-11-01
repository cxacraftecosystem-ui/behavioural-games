import {
  ArrowRightIcon,
  FlaskConicalIcon,
  Gamepad2Icon,
  MicroscopeIcon,
  ShieldIcon,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionGroup } from '@/components/ui/action-group';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DEMO_BANNER_TITLE, DEMO_MODE } from '@/lib/demo';

export const metadata: Metadata = { title: { absolute: 'SHRIII Behavioural Games' } };

const SECTIONS = [
  {
    href: '/kiosk',
    title: 'Kiosk game',
    icon: Gamepad2Icon,
    cta: 'Play the kiosk',
    text: 'Voice-guided village-fair games. Touch only, no reading, no scores.',
  },
  {
    href: '/research',
    title: 'Research console',
    icon: MicroscopeIcon,
    cta: 'Open research',
    text: 'Studies, participants, instruments and trait validation.',
  },
  {
    href: '/admin',
    title: 'Admin console',
    icon: ShieldIcon,
    cta: 'Open admin',
    text: 'Kiosk fleet, game approvals, content and policy.',
  },
] as const;

/** `/`: project landing page linking the three surfaces. */
export default function HomePage() {
  return (
    <div className="min-h-dvh bg-background">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-12 sm:py-20">
        <header className="space-y-5">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="grad-brand grid size-9 place-items-center rounded-full font-display text-sm font-bold text-white"
            >
              S
            </span>
            <span className="font-display text-sm font-semibold tracking-tight">SHRIII</span>
          </div>
          <p className="eyebrow">Behavioural assessment</p>
          <h1 className="display-title text-4xl text-balance sm:text-5xl">
            Kiosk Behavioural Games
          </h1>
          <p className="max-w-2xl text-base leading-7 text-pretty text-muted-foreground">
            Short, voice-guided games on a public kiosk, validated against criterion instruments
            before any result is released.
          </p>
        </header>

        {DEMO_MODE && (
          <div
            role="note"
            data-testid="demo-banner"
            className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground"
          >
            <FlaskConicalIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            <p>
              <strong className="font-semibold">Demo</strong> · {DEMO_BANNER_TITLE}. Read-only; the
              kiosk runs offline.
            </p>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          {SECTIONS.map(({ href, title, icon: Icon, cta, text }) => (
            <Card key={href} className="flex flex-col">
              <CardHeader>
                <span
                  aria-hidden="true"
                  className="mb-2 grid size-10 place-items-center rounded-xl bg-accent text-accent-foreground"
                >
                  <Icon className="size-5" />
                </span>
                <CardTitle className="text-lg">{title}</CardTitle>
                <CardDescription>{text}</CardDescription>
              </CardHeader>
              <CardContent className="mt-auto">
                <ActionGroup fill>
                  <Button asChild>
                    <Link href={href}>
                      {cta}
                      <ArrowRightIcon aria-hidden="true" />
                    </Link>
                  </Button>
                </ActionGroup>
              </CardContent>
            </Card>
          ))}
        </div>

        <footer className="text-xs text-muted-foreground">
          Research use only. Not yet validated on real participants.
        </footer>
      </main>
    </div>
  );
}
