import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="display-title text-3xl">Page not found</h1>
      <p className="max-w-md text-sm text-muted-foreground">Check the link.</p>
      <Link
        href="/"
        className="text-sm font-medium text-accent-foreground underline-offset-4 hover:underline"
      >
        Go to the start page
      </Link>
    </main>
  );
}
