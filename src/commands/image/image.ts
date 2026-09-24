import {
  ApplicationIntegrationType, AutocompleteInteraction, ChatInputCommandInteraction,
  InteractionContextType, SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../../interfaces/command.js';
import * as fx from '../../utils/image/effects.js';
import { getImageBuffer, imageReply } from '../../utils/image/index.js';
import { cv2Text } from '../../utils/components.js';
import { FONTS } from '../../utils/image/command.js';

const EFFECTS = [
  { name: 'blur', value: 'blur' },
  { name: 'sharpen', value: 'sharpen' },
  { name: 'invert', value: 'invert' },
  { name: 'deepfry', value: 'deepfry' },
  { name: 'grayscale', value: 'grayscale' },
  { name: 'sepia', value: 'sepia' },
  { name: 'flip (vertical)', value: 'flip' },
  { name: 'flop (horizontal)', value: 'flop' },
  { name: 'wide', value: 'wide' },
  { name: 'stretch', value: 'stretch' },
  { name: 'swirl', value: 'swirl' },
  { name: 'magik', value: 'magik' },
  { name: 'circle', value: 'circle' },
  { name: 'crop', value: 'crop' },
  { name: 'tile', value: 'tile' },
  { name: 'wall', value: 'wall' },
  { name: 'bounce', value: 'bounce' },
  { name: 'reverse', value: 'reverse' },
  { name: 'speed (fast GIF)', value: 'speed' },
  { name: 'slow (slow GIF)', value: 'slow' },
  { name: 'freeze (stop GIF)', value: 'freeze' },
  { name: 'unfreeze (loop GIF)', value: 'unfreeze' },
  { name: 'spin', value: 'spin' },
  { name: 'slide', value: 'slide' },
  { name: 'fade', value: 'fade' },
  { name: 'haah (mirror left half)', value: 'haah' },
  { name: 'hooh (mirror right half)', value: 'hooh' },
  { name: 'waaw (mirror top half)', value: 'waaw' },
  { name: 'woow (mirror bottom half)', value: 'woow' },
  { name: 'explode', value: 'explode' },
  { name: 'implode', value: 'implode' },
  { name: 'vignette', value: 'vignette' },
  { name: 'squish', value: 'squish' },
  { name: 'globe', value: 'globe' },
  { name: 'scott (Scott The Woz)', value: 'scott' },
  { name: 'gamexplain', value: 'gamexplain' },
  { name: 'togif (convert to GIF)', value: 'togif' },
  { name: 'uncaption (remove caption bar)', value: 'uncaption' },
  { name: 'hue (shift hue, use number 0-360)', value: 'hue' },
  { name: 'pixelate (use number for pixel size)', value: 'pixelate' },
  { name: 'rotate (use number for degrees)', value: 'rotate' },
  { name: 'jpeg (compress quality)', value: 'jpeg' },
  { name: 'caption (text above image)', value: 'caption' },
  { name: 'caption2 (text below image)', value: 'caption2' },
  { name: 'meme (impact text — "top, bottom")', value: 'meme' },
  { name: 'motivate (poster text — "top, bottom")', value: 'motivate' },
  { name: 'whisper (subtitle text)', value: 'whisper' },
  { name: 'spotify (fake Now Playing card)', value: 'spotify' },
  { name: 'reddit (fake Reddit post)', value: 'reddit' },
  { name: 'snapchat (snap caption, number = position)', value: 'snapchat' },
  { name: 'uncanny (Mr. Incredible — "left, right")', value: 'uncanny' },
  { name: 'flag (overlay a flag — pick with choice)', value: 'flag' },
  { name: 'watermark (brand watermark — pick with choice)', value: 'watermark' },
  { name: 'sonic (Sonic Says text bubble)', value: 'sonic' },
  { name: 'homebrew (fake Homebrew install)', value: 'homebrew' },
] as const;

const BRANDS = [
  { name: '9GAG',          value: 'assets/images/9gag.png' },
  { name: 'AVS4YOU',       value: 'assets/images/avs4you.png' },
  { name: 'Bandicam',      value: 'assets/images/bandicam.png' },
  { name: 'DeviantArt',    value: 'assets/images/deviantart.png' },
  { name: 'HBC',           value: 'assets/images/hbc.png' },
  { name: 'HyperCam',      value: 'assets/images/hypercam.png' },
  { name: 'iFunny',        value: 'assets/images/ifunny.png' },
  { name: 'KineMaster',    value: 'assets/images/kinemaster.png' },
  { name: 'MemeCenter',    value: 'assets/images/memecenter.png' },
  { name: 'PowerDirector', value: 'assets/images/powerdirector.png' },
  { name: 'Shutterstock',  value: 'assets/images/shutterstock.png' },
];

const FLAGS = [
  { name: 'Checkered',       value: 'assets/images/checkeredflag.png' },
  { name: 'Pirate',          value: 'assets/images/pirateflag.png' },
  { name: 'Rainbow (Pride)', value: 'assets/images/rainbowflag.png' },
  { name: 'Trans Pride',     value: 'assets/images/transflag.png' },
];

const UNCANNY_PHASES = [
  'baby','canny','canny2','canny3','canny4','canny5','canny6','canny7','canny8',
  'goated','nerd','normal','uncanny','uncanny2','uncanny3','uncanny4','uncanny5',
  'uncanny6','uncanny7','uncanny8','uncle','young',
];

const FONT_CHOICES = FONTS.map(f => ({ name: f, value: f }));

const ImageCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('image')
    .setDescription('Apply an image effect')
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addStringOption(o => o.setName('effect').setDescription('Which effect to apply').setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName('text').setDescription('Text for caption, meme, sonic, whisper, etc.'))
    .addIntegerOption(o => o.setName('number').setDescription('Number for hue (0-360), pixelate, rotate, snapchat position'))
    .addStringOption(o => o.setName('font').setDescription('Font for caption/meme/motivate/uncanny').addChoices(...FONT_CHOICES))
    .addStringOption(o => o.setName('choice').setDescription('Brand/flag/phase for watermark, flag, or uncanny').setAutocomplete(true))
    .addAttachmentOption(o => o.setName('image').setDescription('Image to process (upload)'))
    .addStringOption(o => o.setName('url').setDescription('Image URL (right-click any image → Copy Link)')),

  async autocomplete(interaction: AutocompleteInteraction) {
    const focused = interaction.options.getFocused(true);
    const value = focused.value.toLowerCase();

    if (focused.name === 'effect') {
      const results = (EFFECTS as readonly { name: string; value: string }[])
        .filter(e => e.name.toLowerCase().includes(value) || e.value.includes(value))
        .slice(0, 25);
      await interaction.respond(results);
    } else if (focused.name === 'choice') {
      const effect = interaction.options.getString('effect') ?? '';
      let choices: { name: string; value: string }[] = [];
      if (effect === 'watermark') choices = BRANDS;
      else if (effect === 'flag') choices = FLAGS;
      else if (effect === 'uncanny') choices = UNCANNY_PHASES.map(p => ({ name: p, value: p }));
      await interaction.respond(choices.filter(c => c.name.toLowerCase().includes(value)).slice(0, 25));
    }
  },

  async run(interaction: ChatInputCommandInteraction) {
    const effect = interaction.options.getString('effect', true);
    const text   = interaction.options.getString('text') ?? '';
    const number = interaction.options.getInteger('number') ?? undefined;
    const font   = interaction.options.getString('font') ?? undefined;
    const choice = interaction.options.getString('choice') ?? '';

    await interaction.deferReply();

    try {
      let result;

      if (effect === 'sonic') {
        if (!text) { await interaction.editReply(cv2Text('❌ `text` is required for sonic.')); return; }
        result = await fx.sonic(text);

      } else if (effect === 'homebrew') {
        if (!text) { await interaction.editReply(cv2Text('❌ `text` is required for homebrew.')); return; }
        result = await fx.homebrew(text);

      } else {
        const buf = await getImageBuffer(interaction);

        switch (effect) {
          case 'blur':        result = await fx.blur(buf); break;
          case 'sharpen':     result = await fx.sharpen(buf); break;
          case 'invert':      result = await fx.invert(buf); break;
          case 'deepfry':     result = await fx.deepfry(buf); break;
          case 'grayscale':   result = await fx.grayscale(buf); break;
          case 'sepia':       result = await fx.sepia(buf); break;
          case 'flip':        result = await fx.flip(buf); break;
          case 'flop':        result = await fx.flop(buf); break;
          case 'wide':        result = await fx.wide(buf); break;
          case 'stretch':     result = await fx.stretch(buf); break;
          case 'swirl':       result = await fx.swirl(buf); break;
          case 'magik':       result = await fx.magik(buf); break;
          case 'circle':      result = await fx.circle(buf); break;
          case 'crop':        result = await fx.crop(buf); break;
          case 'tile':        result = await fx.tile(buf); break;
          case 'wall':        result = await fx.wall(buf); break;
          case 'bounce':      result = await fx.bounce(buf); break;
          case 'reverse':     result = await fx.reverse(buf); break;
          case 'speed':       result = await fx.speed(buf); break;
          case 'slow':        result = await fx.slow(buf); break;
          case 'freeze':      result = await fx.freeze(buf); break;
          case 'unfreeze':    result = await fx.unfreeze(buf); break;
          case 'spin':        result = await fx.spin(buf); break;
          case 'slide':       result = await fx.slide(buf); break;
          case 'fade':        result = await fx.fade(buf); break;
          case 'haah':        result = await fx.haah(buf); break;
          case 'hooh':        result = await fx.hooh(buf); break;
          case 'waaw':        result = await fx.waaw(buf); break;
          case 'woow':        result = await fx.woow(buf); break;
          case 'explode':     result = await fx.explode(buf); break;
          case 'implode':     result = await fx.implode(buf); break;
          case 'vignette':    result = await fx.vignette(buf); break;
          case 'squish':      result = await fx.squish(buf); break;
          case 'globe':       result = await fx.globe(buf); break;
          case 'scott':       result = await fx.scott(buf); break;
          case 'gamexplain':  result = await fx.gamexplain(buf); break;
          case 'togif':       result = await fx.makeGif(buf); break;
          case 'uncaption':   result = await fx.uncaption(buf); break;
          case 'hue':         result = await fx.hue(buf, number ?? 180); break;
          case 'pixelate':    result = await fx.pixelate(buf, number ?? 16); break;
          case 'rotate':      result = await fx.rotate(buf, number ?? 90); break;
          case 'jpeg':        result = await fx.jpeg(buf, number ?? 1); break;

          case 'caption':
            if (!text) { await interaction.editReply(cv2Text('❌ `text` is required for caption.')); return; }
            result = await fx.caption(buf, text, font); break;

          case 'caption2':
            if (!text) { await interaction.editReply(cv2Text('❌ `text` is required for caption2.')); return; }
            result = await fx.caption2(buf, text, false, font); break;

          case 'meme': {
            if (!text) { await interaction.editReply(cv2Text('❌ `text` is required for meme (e.g. "top, bottom").')); return; }
            const [top = '', bot = ''] = text.split(/(?<!\\),/).map(s => s.trim().toUpperCase());
            result = await fx.meme(buf, top, bot, font); break;
          }
          case 'motivate': {
            if (!text) { await interaction.editReply(cv2Text('❌ `text` is required for motivate (e.g. "top, bottom").')); return; }
            const [top = '', bot = ''] = text.split(/(?<!\\),/).map(s => s.trim());
            result = await fx.motivate(buf, top, bot, font); break;
          }
          case 'whisper':
            if (!text) { await interaction.editReply(cv2Text('❌ `text` is required for whisper.')); return; }
            result = await fx.whisper(buf, text); break;

          case 'spotify':
            if (!text) { await interaction.editReply(cv2Text('❌ `text` is required for spotify (song name).')); return; }
            result = await fx.spotify(buf, text); break;

          case 'reddit':
            if (!text) { await interaction.editReply(cv2Text('❌ `text` is required for reddit.')); return; }
            result = await fx.reddit(buf, text); break;

          case 'snapchat':
            if (!text) { await interaction.editReply(cv2Text('❌ `text` is required for snapchat.')); return; }
            result = await fx.snapchat(buf, text, number ?? undefined); break;

          case 'uncanny': {
            if (!text) { await interaction.editReply(cv2Text('❌ `text` is required for uncanny (e.g. "left, right").')); return; }
            const [cap1 = '', cap2 = ''] = text.split(/(?<!\\),/).map(s => s.trim());
            const phase = choice || UNCANNY_PHASES[Math.floor(Math.random() * UNCANNY_PHASES.length)];
            result = await fx.uncanny(buf, cap1, cap2, `assets/images/uncanny/${phase}.png`, font); break;
          }
          case 'flag': {
            const flagPath = choice || FLAGS[0].value;
            result = await fx.flag(buf, flagPath); break;
          }
          case 'watermark': {
            const brand = choice || BRANDS[0].value;
            result = await fx.watermark(buf, brand); break;
          }
          default:
            await interaction.editReply(cv2Text(`❌ Unknown effect \`${effect}\`. Use the autocomplete to pick one.`));
            return;
        }
      }

      await interaction.editReply(imageReply(result.data, result.type));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await interaction.editReply(cv2Text(`❌ ${msg}`));
    }
  },
};

export default ImageCommand;
