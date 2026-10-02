// MP-42 CodeText contract (03 MP-42): InlineCode and CodeBlock.
export interface CodeTextProps {
  code: string;
  form: 'inline' | 'block';
  /** Fence language; drives the header label and token colouring. */
  language?: string;
  /** Controlled soft wrap (block). Uncontrolled when omitted. */
  wrap?: boolean;
  onToggleWrap?: () => void;
  /** Block header Copy button. */
  copyable?: boolean;
  /** 'err' = an inline failure excerpt in text-err, never coloured. */
  tone?: 'fg' | 'err';
  /** Show at most this many lines (block). */
  maxLines?: number;
  testID?: string;
}
