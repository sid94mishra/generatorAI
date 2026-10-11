// lucide glyphs for the lucideOnly concepts (Android and iOS).
// Static map so Metro bundles only these files (mobile 02 §5.2); `lucide.test.ts` keeps it in step with the registry.
import LAgents from 'lucide-react-native/icons/bot';
import LChanges from 'lucide-react-native/icons/git-compare';
import LBranch from 'lucide-react-native/icons/git-branch';
import LCommit from 'lucide-react-native/icons/git-commit-horizontal';
import LPr from 'lucide-react-native/icons/git-pull-request';
import LMerge from 'lucide-react-native/icons/git-merge';
import LIssue from 'lucide-react-native/icons/circle-dot';
import LDiff from 'lucide-react-native/icons/file-diff';
import LHook from 'lucide-react-native/icons/anchor';
import LVariable from 'lucide-react-native/icons/variable';
import LWebhook from 'lucide-react-native/icons/webhook';

export const LUCIDE_ONLY = {
  'agents': LAgents,
  'changes': LChanges,
  'branch': LBranch,
  'commit': LCommit,
  'pr': LPr,
  'merge': LMerge,
  'issue': LIssue,
  'diff': LDiff,
  'hook': LHook,
  'variable': LVariable,
  'webhook': LWebhook,
} as const;
