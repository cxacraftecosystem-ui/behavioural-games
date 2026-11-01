'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, useTheme } from 'next-themes';
import { type ReactNode, useState } from 'react';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider } from '@/lib/auth/auth-context';
import { createQueryClient } from '@/lib/query';

/** One toast queue for the whole console, drawn in the active theme. */
function ConsoleToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      closeButton
      position="bottom-right"
      // Clear of the bottom island below lg (sonner's own mobile breakpoint is 600px, ours is 1024).
      offset={{ bottom: 96, right: 24 }}
      mobileOffset={{ bottom: 96 }}
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      toastOptions={{ className: 'font-sans' }}
    />
  );
}

/**
 * Client providers for the whole console, mounted ONCE (a nested copy shadows the real one): theme,
 * server-state cache, auth, tooltips, toasts. next-themes writes data-theme on <html>.
 */
export function Providers({ children }: { readonly children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider>
            {children}
            <ConsoleToaster />
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
