// The Turn sheet route (`/chats/[id]/turn`, MModelPicker; MD-03): MB-02 over the chat, closed with Back.
import React from 'react';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';

import { chatHref } from '../../blocks/shell/hrefs';
import { TurnSheet } from '../../blocks/TurnSheet';

export default function TurnSheetScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const close = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace(chatHref(id ?? '') as never);
  };
  return <TurnSheet chatId={id ?? ''} onClose={close} navigation={navigation as never} />;
}
