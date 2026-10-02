// MP-18 Textarea contract (03 MP-18).
import type { ReactNode } from 'react';

export interface TextareaMeter {
  used: number;
  max: number;
  unit: 'bytes' | 'chars';
}

export interface TextareaProps {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  /** Grows from minRows (default 3) to maxRows (default 8), then scrolls. */
  minRows?: number;
  maxRows?: number;
  mono?: boolean;
  /** iOS: 'row' inside a ListSection group or 'standalone' (default). Android is always outlined. */
  presentation?: 'row' | 'standalone';
  /** Inline toolbar under the text ("@ Files", "/ Skills", paperclip). */
  footer?: ReactNode;
  /** Size meter: "2.1 KB of 32 KB". */
  meter?: TextareaMeter;
  error?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  testID?: string;
}
