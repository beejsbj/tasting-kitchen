import * as Popover from '@radix-ui/react-popover';
import type { ComponentProps, ReactNode } from 'react';

export function IconButton({ className = '', ...props }: ComponentProps<'button'>) {
  return <button type="button" className={`inline-flex size-10 min-h-10 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-40 aria-pressed:bg-blue-50 aria-pressed:text-blue-700 ${className}`} {...props} />;
}

export function ControlPopover({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  return <Popover.Root><Popover.Trigger asChild><IconButton aria-label={label} title={label}>{icon}</IconButton></Popover.Trigger><Popover.Portal><Popover.Content side="left" align="start" sideOffset={12} collisionPadding={12} aria-label={label} className="z-40 max-h-[85dvh] w-80 max-w-[calc(100vw-5rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 text-slate-800 shadow-xl focus:outline-none" onEscapeKeyDown={(event) => event.stopPropagation()}>{children}<Popover.Arrow className="fill-white" /></Popover.Content></Popover.Portal></Popover.Root>;
}
