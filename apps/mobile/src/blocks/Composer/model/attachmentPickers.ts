// ────────────────────────────────────────────────────────────────
// Attachment pickers — the platform half of D2.
//
//   photo      expo-image-picker library, multi-select, JPEG re-encode at
//              `IMAGE_PICKER_QUALITY` (the only size lever without a resizer)
//   camera     expo-image-picker camera
//   file       expo-file-system 57 `File.pickFileAsync` — the system document
//              picker ships inside a module already in the bundle, so
//              `expo-document-picker` is NOT added
//   clipboard  expo-clipboard `getImageAsync` → a `data:` URI
//
// Every picker returns candidates only; the controller applies
// `validateAttachment` so the policy lives in one place.
//
// Bytes are read at SEND time (`readAttachmentBytes`), never at pick time.
// ────────────────────────────────────────────────────────────────

import * as Clipboard from 'expo-clipboard';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

import {
  IMAGE_PICKER_QUALITY,
  attachmentKindFor,
  base64ByteLength,
  decodeBase64,
  guessMimeType,
  parseDataUri,
  pastedImageName,
} from './attachmentPolicy';
import type { AttachmentSource, ComposerAttachment } from './types';

export type PickOutcome =
  | { status: 'picked'; items: ComposerAttachment[] }
  | { status: 'cancelled' }
  | { status: 'denied'; reason: string }
  | { status: 'empty'; reason: string }
  | { status: 'error'; reason: string };

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}:${Date.now()}:${seq}`;
}

function fromImageAsset(asset: ImagePicker.ImagePickerAsset, prefix: string): ComposerAttachment {
  const mimeType = guessMimeType(asset.fileName ?? '', asset.mimeType ?? null) || 'image/jpeg';
  const ext = (mimeType.split('/')[1] ?? 'jpg').replace('jpeg', 'jpg');
  const name = asset.fileName?.trim() || `${prefix}-${Date.now()}.${ext}`;
  return {
    id: nextId(prefix),
    kind: 'image',
    name,
    uri: asset.uri,
    mimeType,
    size: asset.fileSize ?? 0,
    previewUri: asset.uri,
  };
}

async function pickPhotos(): Promise<PickOutcome> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return {
      status: 'denied',
      reason: 'Photo library access is off for GeneratorAI. Turn it on in Settings.',
    };
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: 5,
    quality: IMAGE_PICKER_QUALITY,
  });
  if (result.canceled) return { status: 'cancelled' };
  return { status: 'picked', items: result.assets.map((a) => fromImageAsset(a, 'photo')) };
}

async function takePhoto(): Promise<PickOutcome> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    return { status: 'denied', reason: 'Camera access is off for GeneratorAI. Turn it on in Settings.' };
  }
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: IMAGE_PICKER_QUALITY,
  });
  if (result.canceled) return { status: 'cancelled' };
  const items = result.assets.map((a) => {
    const item = fromImageAsset(a, 'capture');
    return { ...item, kind: 'capture' as const };
  });
  return { status: 'picked', items };
}

async function pickFiles(): Promise<PickOutcome> {
  const result = await File.pickFileAsync({ multipleFiles: true });
  if (result.canceled) return { status: 'cancelled' };
  const items = result.result.map((file) => {
    const name = file.name || 'file';
    const mimeType = guessMimeType(name, file.type);
    let size = 0;
    try {
      size = file.size;
    } catch {
      /* not stat-able; the send-time read will find out */
    }
    return {
      id: nextId('file'),
      kind: attachmentKindFor(mimeType),
      name,
      uri: file.uri,
      mimeType,
      size,
      ...(attachmentKindFor(mimeType) === 'image' ? { previewUri: file.uri } : {}),
    } satisfies ComposerAttachment;
  });
  return { status: 'picked', items };
}

async function pasteImage(): Promise<PickOutcome> {
  const has = await Clipboard.hasImageAsync();
  if (!has) return { status: 'empty', reason: 'There is no image on the clipboard.' };
  const image = await Clipboard.getImageAsync({ format: 'png' });
  if (!image?.data) return { status: 'empty', reason: 'Could not read the clipboard image.' };
  const parsed = parseDataUri(image.data);
  const mimeType = parsed?.mimeType ?? 'image/png';
  const size = parsed ? base64ByteLength(parsed.base64) : 0;
  return {
    status: 'picked',
    items: [
      {
        id: nextId('paste'),
        kind: 'image',
        name: pastedImageName(mimeType),
        uri: image.data,
        mimeType,
        size,
        previewUri: image.data,
      },
    ],
  };
}

export async function pickAttachments(source: AttachmentSource): Promise<PickOutcome> {
  try {
    switch (source) {
      case 'photo':
        return await pickPhotos();
      case 'camera':
        return await takePhoto();
      case 'file':
        return await pickFiles();
      case 'clipboard':
        return await pasteImage();
      default:
        return { status: 'error', reason: 'Unknown attachment source.' };
    }
  } catch (err) {
    return { status: 'error', reason: (err as Error).message || 'Could not open the picker.' };
  }
}

/** The multipart part for one attachment — matches `chats.sendWithAttachments`. */
export interface AttachmentUpload {
  name: string;
  data: Uint8Array;
  mimeType: string;
}

/**
 * Read one attachment's bytes. `data:` URIs (clipboard) decode in memory;
 * inline text (an `@file` mention) is encoded as UTF-8; everything else is
 * read through `expo-file-system`.
 */
export async function readAttachmentBytes(item: ComposerAttachment): Promise<AttachmentUpload> {
  if (item.text !== undefined) {
    return { name: item.name, data: new TextEncoder().encode(item.text), mimeType: item.mimeType };
  }
  const parsed = parseDataUri(item.uri);
  if (parsed) {
    return { name: item.name, data: decodeBase64(parsed.base64), mimeType: item.mimeType };
  }
  const file = new File(item.uri);
  const data = await file.bytes();
  return { name: item.name, data, mimeType: item.mimeType };
}

export async function readAllAttachmentBytes(
  items: readonly ComposerAttachment[],
): Promise<AttachmentUpload[]> {
  return Promise.all(items.map(readAttachmentBytes));
}
