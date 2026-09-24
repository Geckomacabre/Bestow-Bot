import {
  ApplicationIntegrationType, ChatInputCommandInteraction, InteractionContextType,
  SlashCommandBuilder, SlashCommandOptionsOnlyBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command';
import { getImageBuffer, imageReply } from './index.js';
import { cv2Text } from '../components.js';
import type { NativeResult } from './native.js';

export const FONTS = ['futura', 'impact', 'helvetica', 'arial', 'roboto', 'noto', 'times', 'comic sans ms', 'ubuntu'] as const;
export const fontChoices = FONTS.map(f => ({ name: f, value: f }));

type EffectFn = (buffer: Buffer, ...args: any[]) => Promise<NativeResult>;

interface ImageCommandOptions {
  name: string;
  description: string;
  effect: EffectFn;
  extraOptions?: (builder: SlashCommandBuilder) => SlashCommandOptionsOnlyBuilder | SlashCommandBuilder;
  getArgs?: (interaction: ChatInputCommandInteraction) => any[];
}

export function makeImageCommand(opts: ImageCommandOptions): Command {
  let builder: any = new SlashCommandBuilder()
    .setName(opts.name)
    .setDescription(opts.description)
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild]);
  if (opts.extraOptions) builder = opts.extraOptions(builder);
  builder = builder
    .addAttachmentOption((o: any) => o.setName('image').setDescription('Image to process (upload)'))
    .addStringOption((o: any) => o.setName('url').setDescription('Image URL (right-click any image → Copy Link)'));

  return {
    data: builder,
    async run(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();
      try {
        const buf = await getImageBuffer(interaction);
        const args = opts.getArgs ? opts.getArgs(interaction) : [];
        const result = await opts.effect(buf, ...args);
        await interaction.editReply(imageReply(result.data, result.type));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await interaction.editReply(cv2Text(`❌ ${msg}`));
      }
    },
  };
}

export function makeNoImageCommand(opts: {
  name: string;
  description: string;
  buildOptions?: (builder: SlashCommandBuilder) => any;
  run: (interaction: ChatInputCommandInteraction) => Promise<NativeResult>;
}): Command {
  let builder: any = new SlashCommandBuilder()
    .setName(opts.name)
    .setDescription(opts.description)
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild]);
  if (opts.buildOptions) builder = opts.buildOptions(builder);

  return {
    data: builder,
    async run(interaction: ChatInputCommandInteraction) {
      await interaction.deferReply();
      try {
        const result = await opts.run(interaction);
        await interaction.editReply(imageReply(result.data, result.type));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await interaction.editReply(cv2Text(`❌ ${msg}`));
      }
    },
  };
}
