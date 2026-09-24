import { AttachmentBuilder, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags, TextDisplayBuilder } from 'discord.js';

export const IS_CV2 = MessageFlags.IsComponentsV2;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function cv2Text(content: string, accentColor?: number): any {
  const c = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
  if (accentColor !== undefined) c.setAccentColor(accentColor);
  return { flags: IS_CV2, components: [c] };
}

// Ephemeral Components-V2 text — handy for permission/validation errors.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function cv2Err(content: string): any {
  return { flags: IS_CV2 | MessageFlags.Ephemeral, components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(content))] };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function cv2File(buffer: Buffer, ext: string, caption?: string): any {
  const name = `result.${ext}`;
  const c = new ContainerBuilder();
  if (caption) c.addTextDisplayComponents(new TextDisplayBuilder().setContent(caption));
  c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${name}`)));
  return { flags: IS_CV2, files: [new AttachmentBuilder(buffer, { name })], components: [c] };
}
