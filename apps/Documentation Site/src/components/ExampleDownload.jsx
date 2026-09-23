import React from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';

export default function ExampleDownload({file}) {
  const href = useBaseUrl(`/examples/${file}`);
  return <p><a href={href} download={file}>Download this JSON</a></p>;
}
