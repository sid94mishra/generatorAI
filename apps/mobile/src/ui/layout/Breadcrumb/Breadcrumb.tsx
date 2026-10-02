// ML-03 Breadcrumb (03 ML-03): caption 12 fg-3 segments with chevron-right 12 separators, gap 4, one line. Every
// real ancestor is a link (the caller pops to it); a non-ancestor segment is plain text; more than three levels
// collapse the middle to "…", which opens a menu of the hidden levels. BreadcrumbTitle is the iOS header title view.
import React from 'react';
import { View } from 'react-native';

import { cn } from '../../lib/cn';
import { Menu } from '../../native/Menu';
import { Icon } from '../../primitives/Icon';
import { Pressable } from '../../primitives/Pressable';
import { Text } from '../../primitives/Text';
import type { BreadcrumbProps, BreadcrumbSegment, BreadcrumbTitleProps } from './Breadcrumb.types';
import { collapseCrumbs, crumbActions, titleViewLabel } from './breadcrumbModel';

export type { BreadcrumbProps, BreadcrumbSegment, BreadcrumbTitleProps } from './Breadcrumb.types';

function Crumb({ segment }: { segment: BreadcrumbSegment }): React.ReactElement {
  const label = (
    <Text role="caption" tone="fg-3" chrome numberOfLines={1}>
      {segment.label}
    </Text>
  );
  if (!segment.onPress) return <View className="shrink">{label}</View>;
  return (
    <Pressable onPress={segment.onPress} frame="none" feedback="none" accessibilityRole="link" accessibilityLabel={segment.accessibilityLabel ?? segment.label} className="shrink">
      {label}
    </Pressable>
  );
}

function Ellipsis({ hidden }: { hidden: BreadcrumbSegment[] }): React.ReactElement {
  return (
    <Menu
      items={hidden.map((s, i) => ({ id: String(i), label: s.label, disabled: !s.onPress }))}
      onSelect={(id) => hidden[Number(id)]?.onPress?.()}
      trigger={
        <Pressable frame="none" feedback="none" accessibilityRole="button" accessibilityLabel={`${hidden.length} more levels`}>
          <Text role="caption" tone="fg-3" chrome>
            …
          </Text>
        </Pressable>
      }
    />
  );
}

export function Breadcrumb({ segments, align = 'start', testID }: BreadcrumbProps): React.ReactElement {
  const { shown, hidden, ellipsisAt } = collapseCrumbs(segments);
  const items: React.ReactNode[] = [];
  shown.forEach((s, i) => {
    if (ellipsisAt === i) {
      items.push(<Ellipsis key="…" hidden={hidden} />);
      items.push(<Icon key="…sep" concept="chevron-right" size={12} tone="fg-3" />);
    }
    items.push(<Crumb key={`c${i}`} segment={s} />);
    if (i < shown.length - 1) items.push(<Icon key={`s${i}`} concept="chevron-right" size={12} tone="fg-3" />);
  });
  return (
    <View testID={testID} className={cn('flex-row items-center gap-1', align === 'center' ? 'justify-center' : 'justify-start')}>
      {items}
    </View>
  );
}

export function BreadcrumbTitle({ breadcrumb, title, align = 'center', testID }: BreadcrumbTitleProps): React.ReactElement {
  const actions = crumbActions(breadcrumb);
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="header"
      accessibilityLabel={titleViewLabel(breadcrumb, title)}
      accessibilityActions={actions.length ? actions : undefined}
      onAccessibilityAction={(e) => breadcrumb?.[Number(e.nativeEvent.actionName.replace('crumb-', ''))]?.onPress?.()}
      className={cn('max-w-full', align === 'center' ? 'items-center' : 'items-start')}
    >
      {breadcrumb?.length ? <Breadcrumb segments={breadcrumb} align={align} /> : null}
      <Text role="detailTitle" align={align} numberOfLines={1}>
        {title}
      </Text>
    </View>
  );
}
