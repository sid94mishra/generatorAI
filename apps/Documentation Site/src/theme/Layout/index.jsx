import React from 'react';
import OriginalLayout from '@theme-original/Layout';
import {useLocation} from '@docusaurus/router';

// The local-search plugin renders its content in a div. Supply its missing
// main landmark while leaving the docs and homepage's existing landmarks alone.
export default function Layout(props) {
  const {pathname} = useLocation();
  const isSearchPage = /\/search\/?$/.test(pathname);
  return <OriginalLayout {...props}>
    {isSearchPage ? <main>{props.children}</main> : props.children}
  </OriginalLayout>;
}
