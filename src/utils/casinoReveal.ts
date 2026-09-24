import {
  AttachmentBuilder, ButtonBuilder, ContainerBuilder,
  MediaGalleryBuilder, MediaGalleryItemBuilder, TextDisplayBuilder,
} from 'discord.js';
import { IS_CV2 } from './components.js';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Small cushion on top of each animation's own length, so the result lands just
// after the motion resolves rather than exactly on it.
const REVEAL_PAD_MS = 250;

/** Builds the standard casino panel: text + media + optional button. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mediaPanel(content: string, accentColor: number, mediaUrl: string, button?: ButtonBuilder): any {
  return panel(content, accentColor, mediaUrl, button);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function panel(content: string, accentColor: number, mediaUrl: string, button?: ButtonBuilder): any {
  const c = new ContainerBuilder()
    .setAccentColor(accentColor)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder().setURL(mediaUrl),
    ));
  if (button) c.addActionRowComponents(row => row.addComponents(button));
  return c;
}

export interface RevealParams {
  /** interaction.editReply / btn.editReply — must resolve to the sent Message. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  edit: (payload: any) => Promise<any>;
  gif: Buffer;
  name: string;
  /** How long the animation runs before the outcome is on screen. */
  revealMs: number;
  suspense: { content: string; color: number };
  result: { content: string; color: number };
  /** Rebuilt per phase so the button can be disabled while the animation runs. */
  button?: (disabled: boolean) => ButtonBuilder;
}

/**
 * Posts the animation first with neutral text, then edits the real result in
 * once the animation has played — otherwise the outcome is readable before the
 * GIF has even started.
 *
 * The second edit deliberately reuses the uploaded attachment's CDN URL and
 * sends no `files`, because re-attaching the buffer would re-upload it and
 * restart the animation from frame 0.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function postWithReveal(p: RevealParams): Promise<{ msg: any; mediaUrl: string }> {
  const attachRef = `attachment://${p.name}`;
  const msg = await p.edit({
    flags: IS_CV2,
    components: [panel(p.suspense.content, p.suspense.color, attachRef, p.button?.(true))],
    files: [new AttachmentBuilder(p.gif, { name: p.name })],
  });

  // Prefer the CDN URL so the follow-up edit doesn't re-upload the GIF.
  const cdnUrl: string | undefined = msg?.attachments?.first?.()?.url;

  await sleep(p.revealMs + REVEAL_PAD_MS);

  if (cdnUrl) {
    await p.edit({
      flags: IS_CV2,
      components: [panel(p.result.content, p.result.color, cdnUrl, p.button?.(false))],
    }).catch(() => {});
  } else {
    // Fallback: no CDN URL available, so re-send the file (animation restarts).
    await p.edit({
      flags: IS_CV2,
      components: [panel(p.result.content, p.result.color, attachRef, p.button?.(false))],
      files: [new AttachmentBuilder(p.gif, { name: p.name })],
    }).catch(() => {});
  }
  return { msg, mediaUrl: cdnUrl ?? attachRef };
}
