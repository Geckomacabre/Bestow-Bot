import { ChatInputCommandInteraction } from 'discord.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { cv2File } from '../components.js';
import { selectedImages } from '../imageSelection.js';
import { getBufferPublic } from '../../framework/http.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ASSETS_DIR = path.join(__dirname, '../../assets');
export const FONTS_DIR = path.join(ASSETS_DIR, 'fonts');
export const IMAGES_DIR = path.join(ASSETS_DIR, 'images');

const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']);

export function sniffType(buf: Buffer): string {
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'gif';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return 'webp';
  return 'png';
}

// Every image command funnels through here, so this is where user-supplied URLs get vetted:
// public http(s) only (no localhost / private ranges) and a hard size cap.
async function fetchUrl(url: string): Promise<Buffer> {
  return getBufferPublic(url, { maxBytes: 25 * 1024 * 1024, timeoutMs: 20_000 });
}

export async function getImageBuffer(interaction: ChatInputCommandInteraction): Promise<Buffer> {
  const attachment = interaction.options.getAttachment('image');
  if (attachment) {
    if (!IMAGE_MIME.has(attachment.contentType ?? '')) throw new Error('Attachment must be an image.');
    return fetchUrl(attachment.url);
  }

  const url = (interaction.options as any).getString?.('url') as string | null;
  if (url) return fetchUrl(url);

  const selected = selectedImages.get(interaction.user.id);
  if (selected) return fetchUrl(selected);

  if (interaction.channel && 'messages' in interaction.channel) {
    const messages = await interaction.channel.messages.fetch({ limit: 20 });
    for (const [, msg] of messages) {
      for (const att of msg.attachments.values()) {
        if (IMAGE_MIME.has(att.contentType ?? '')) return fetchUrl(att.url);
      }
      for (const embed of msg.embeds) {
        const imgUrl = embed.image?.url ?? embed.thumbnail?.url;
        if (imgUrl) return fetchUrl(imgUrl);
      }
    }
  }

  throw new Error('No image found. Attach an image, paste a URL, or run the command near a recent image.');
}

export function imageReply(buffer: Buffer, ext: string) {
  return cv2File(buffer, ext);
}
