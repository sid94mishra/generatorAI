// MP-40 PairingCodeInput contract (03 MP-40; MD-34, MD-35).
export interface PairingCodeInputProps {
  /** Normalised: uppercase, no spaces or dashes. */
  value: string;
  onChangeText: (v: string) => void;
  /** Always 12 (MD-35); typed for the contract. */
  length?: 12;
  /** Always 3 groups of 4. */
  groups?: 3;
  /** The server's message ("That code expired — ask for a new one"); every cell turns err. */
  error?: string;
  disabled?: boolean;
  /** Display form (Settings › Pair a device): the same cells, no keyboard. */
  readOnly?: boolean;
  /** Fires once when the 12th character arrives: focus Connect; never submits (MD-34). */
  onComplete?: (v: string) => void;
  autoFocus?: boolean;
  testID?: string;
}
