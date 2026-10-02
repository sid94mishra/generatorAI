// LargeTitle contract (ML-02 companion; MD-153).
export interface LargeTitleProps {
  title: string;
  /** Mono `fg-3` count after the title ("Chats 48"). */
  /** `null` while loading (the title alone). */
  count?: number | null;
  testID?: string;
}
