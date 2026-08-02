// ────────────────────────────────────────────────────────────────
// sonner — vendored shadcn/ui part (sonner toaster)
// Mount <Toaster /> once at the app root; fire toasts via
// `toast(...)` from '@/components/ui'. Styled with semantic tokens
// and theme-aware via ThemeProvider.
// ────────────────────────────────────────────────────────────────

import { Toaster as Sonner, toast } from 'sonner';
import { useTheme } from '@/providers/ThemeProvider.js';

type ToasterProps = React.ComponentProps<typeof Sonner>;

function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme();

  return (
    <Sonner
      theme={resolvedTheme}
      className="toaster group"
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:rounded-lg',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton: 'group-[.toast]:bg-primary-emphasis group-[.toast]:text-primary-foreground',
          cancelButton: 'group-[.toast]:bg-subtle group-[.toast]:text-muted-foreground',
          success: 'group-[.toast]:[&_svg]:text-success',
          error: 'group-[.toast]:[&_svg]:text-danger',
          warning: 'group-[.toast]:[&_svg]:text-warning',
          info: 'group-[.toast]:[&_svg]:text-info',
        },
      }}
      {...props}
    />
  );
}

export { Toaster, toast };
