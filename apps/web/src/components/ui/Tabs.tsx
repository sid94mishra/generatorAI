// ────────────────────────────────────────────────────────────────
// Tabs — canonical underline tab bar. Replaces the hand-rolled tab
// rows in ProjectDetail, CodebaseDetail, Settings, WorkflowRun.
// Built on Radix Tabs (keyboard nav, roving tabindex, ARIA) while
// keeping the simple items/value/onChange API.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { TabsRoot, TabsList, TabsTrigger } from './primitives/tabs.js';
import { cn } from '@/lib/utils.js';

export interface TabItem<T extends string = string> {
  id: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
}

export interface TabsProps<T extends string = string> {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}

export function Tabs<T extends string = string>({ items, value, onChange, className }: TabsProps<T>) {
  return (
    <TabsRoot value={value} onValueChange={(v) => onChange(v as T)} activationMode="automatic">
      <TabsList className={cn(className)}>
        {items.map((item) => (
          <TabsTrigger key={item.id} value={item.id}>
            {item.icon}
            {item.label}
            {item.badge}
          </TabsTrigger>
        ))}
      </TabsList>
    </TabsRoot>
  );
}
