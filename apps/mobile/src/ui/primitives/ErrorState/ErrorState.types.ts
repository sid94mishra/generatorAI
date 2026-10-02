// MP-33 ErrorState contract (03 MP-33; MD-25; MDF-136 R-ERROR).
export interface ErrorStateProps {
  /** "Couldn't load chats". */
  title: string;
  /** Described by errorText() (ui/lib/format): the message's first line, never a stack. */
  error: unknown;
  onRetry?: () => void;
  /** A one-line row inside a list (icon + text + Retry), role alert. */
  inline?: boolean;
  testID?: string;
}
