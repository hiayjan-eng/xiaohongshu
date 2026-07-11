# Mobile Share Entry Technical Spec

Current status: `apps/mobile` is a typed skeleton and route map, not a complete native app. This document records how the future iOS and Android share entries should map into the existing ImportBatch pipeline without changing the Web MVP.

## iOS Share Extension

The first iOS validation should use a Share Extension that receives `NSExtensionItem` payloads from the system share sheet.

Expected fields:

- URL: the original shared URL when the source app provides it.
- Text: share title or share copy when available.
- User note: collected inside the app after the share is received.

The extension should normalize the payload into:

```ts
{
  sourceUrl: string;
  title: string;
  rawShareText: string;
  userNote: string;
}
```

After normalization, it should enter the same ImportBatch pipeline used by `/import`, `/old-import`, and `/real-test`.

## Android Send Intent

Android should validate `ACTION_SEND` first, then `ACTION_SEND_MULTIPLE` later.

Expected inputs:

- `text/plain` for links and share text.
- Optional image MIME types only if the source app provides them. Phase 4 should not store, copy, or republish images.

Android should use the same normalized shape as iOS and Web.

## What We Can And Cannot Get

Likely available:

- Shared URL.
- User-visible share text.
- Optional title or selected text.
- The user’s own note after landing in the app.

Not guaranteed:

- Full original post body.
- All images or videos.
- Comments.
- Author profile data.
- The user’s whole Xiaohongshu favorite folder.

## Sync Prerequisite

The app and Web can only share data across devices after login and cloud storage exist. Until Phase 3 is unblocked with Supabase credentials and RLS policies, mobile should use local demo data or isolated local storage.

## Blockers

Real share-entry validation needs physical iOS and Android devices. Publishing needs Apple Developer Program and Google Play Console accounts. Without those accounts, this remains a skeleton and technical validation plan.
