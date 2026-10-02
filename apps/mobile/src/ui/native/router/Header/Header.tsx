// ML-02 Header — web preview: the JS top app bar (no native stack header there).
import React from 'react';

import { TopAppBar } from '../../../layout/TopAppBar';
import type { HeaderProps } from './Header.types';

export type { HeaderAction, HeaderProps, HeaderRole } from './Header.types';

export function Header(props: HeaderProps): React.ReactElement {
  return <TopAppBar {...props} />;
}
