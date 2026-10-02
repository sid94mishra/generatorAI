// MP-51 DiffStat contract (03 MP-51; D-36: unknown is "—", never 0).
export interface DiffStatProps {
  additions?: number;
  deletions?: number;
  files?: number;
  testID?: string;
}
