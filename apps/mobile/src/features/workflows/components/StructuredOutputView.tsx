// StructuredOutputView (03 §6.7; MWorkflowRunPane, MRunApproval): a stage's structured output — a table for an array of
// flat objects (mono cells, the first seven rows, "Show n more"), else a key / value tree, else the text. Values are
// neutral (MD-25: a "Risk: Medium" cell is text, never a status colour).
import React, { useState } from 'react';
import { View } from 'react-native';

import { Link } from '../../../ui/primitives/Link';
import { Text } from '../../../ui/primitives/Text';
import { humanKey, outputView } from '../model/outputView';

const FIRST_ROWS = 7;

export function StructuredOutputView({ value, testID = 'structured-output' }: { value: unknown; testID?: string }): React.ReactElement {
  const view = outputView(value);
  const [all, setAll] = useState(false);
  if (view.kind === 'text') {
    return (
      <Text role="footnote" selectable testID={testID}>
        {view.text}
      </Text>
    );
  }
  if (view.kind === 'tree') {
    return (
      <View className="gap-1" testID={testID}>
        {view.rows.map((r, i) => (
          <View key={i} className="flex-row gap-2" style={{ paddingStart: r.depth * 12 }}>
            <Text role="monoSm" tone="fg-3" numberOfLines={1} className="shrink">
              {r.key}
            </Text>
            {r.value !== null ? (
              <Text role="monoSm" selectable className="flex-1" numberOfLines={4}>
                {r.value}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
    );
  }
  const rows = all ? view.rows : view.rows.slice(0, FIRST_ROWS);
  return (
    <View className="gap-1" testID={testID}>
      {view.title ? (
        <View className="flex-row items-baseline gap-2">
          <Text role="subhead" weight={600}>
            {view.title}
          </Text>
          <Text role="monoSm" tone="fg-3">
            {view.total}
          </Text>
        </View>
      ) : null}
      <View className="flex-row gap-2 border-b border-line-soft py-1.5">
        {view.columns.map((c, i) => (
          <Text key={c} role="caption" tone="fg-3" numberOfLines={1} align={i === view.columns.length - 1 && view.columns.length > 1 ? 'end' : 'start'} className="flex-1">
            {humanKey(c)}
          </Text>
        ))}
      </View>
      {rows.map((row, r) => (
        <View key={r} className="flex-row gap-2 border-b border-line-soft py-2" accessible accessibilityLabel={view.columns.map((c, i) => `${humanKey(c)} ${row[i]}`).join(', ')}>
          {row.map((v, i) => (
            <Text key={i} role="monoSm" tone={i === 0 ? 'fg' : 'fg-2'} numberOfLines={2} selectable align={i === row.length - 1 && row.length > 1 ? 'end' : 'start'} className="flex-1">
              {v}
            </Text>
          ))}
        </View>
      ))}
      {view.rows.length > FIRST_ROWS ? <Link label={all ? 'Show fewer' : `Show ${view.rows.length - FIRST_ROWS} more`} onPress={() => setAll((v) => !v)} standalone /> : null}
    </View>
  );
}
