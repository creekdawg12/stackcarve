/**
 * The words that go to ChatGPT. StackCarve cannot draw, so it writes the request: a recipe that
 * makes a picture the depth model reads cleanly and the slicer can cut (one subject, matte clay,
 * soft light, bold forms, plain white behind it), then the follow-up that asks for changes.
 */

export type Takes = 'four' | 'one';

const RECIPE = `Material: smooth matte medium-gray clay in one even color. No paint, no gloss, no surface pattern.
Form: deep, rounded, sculptural volume with a strong, simple outline. Turn fine detail such as fur, hair and wrinkles into a few large carved shapes. No thin or fragile parts, no holes through the piece, no separate floating pieces.
Lighting: soft, even studio light from the front and slightly above. No hard shadows.
Background: flat pure white and nothing else. No floor, no cast shadow, no props, no dividing lines, no labels, no text.`;

const SCULPTURE = 'a clay sculpture made to hang flat on a wall, like a mask: the front of the subject in deep relief, with no backing board, plaque or frame behind it. The camera is straight on and level, like a long-lens product photo with no perspective distortion.';

/** Four takes on one sheet: one generation, one paste, four candidates. */
export const SHEET_TEMPLATE = `Make one square image: a 2 by 2 sheet showing four different sculpture designs of the same subject.

Subject: {idea}

Each design is ${SCULPTURE} Show each design whole, centered in its own quarter, with empty white space all around it. The four designs must not touch or overlap.

Top left: true to life.
Top right: simplified into a few big, bold forms.
Bottom left: exaggerated, with more character.
Bottom right: stylized and geometric.

${RECIPE}`;

/** One design filling the frame: for a final, or when four on a sheet come out too small. */
export const SINGLE_TEMPLATE = `Make one square image of a sculpture design.

Subject: {idea}

The design is ${SCULPTURE} Show it whole, centered and filling most of the frame, with empty white space all around it.

${RECIPE}`;

export const DEFAULT_TEMPLATES: Record<Takes, string> = { four: SHEET_TEMPLATE, one: SINGLE_TEMPLATE };

/** Tidy what was typed: one line, no trailing full stop, so it reads as the subject of a sentence. */
export function cleanIdea(idea: string) {
  return idea.replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
}

export function buildPrompt(idea: string, takes: Takes, template?: string | null): string {
  const text = (template && template.trim()) || DEFAULT_TEMPLATES[takes];
  const subject = cleanIdea(idea) || 'describe the subject here';
  // A template that lost its placeholder still gets the subject, up front where the model weighs it most.
  return text.includes('{idea}') ? text.split('{idea}').join(subject) : `Subject: ${subject}\n\n${text}`;
}

/** Where a picture sat on the sheet it was cut from, in words ChatGPT can follow. */
export type SheetPosition = string;

export interface FollowUpInput {
  /** Set when the picture was split from a sheet made in the same chat. */
  position?: SheetPosition | null;
  changes: string[];
}

/** The second message: one design on its own, with only the listed changes. */
export function buildFollowUp({ position, changes }: FollowUpInput): string {
  const list = changes.map(c => c.trim().replace(/[.\s]+$/, '')).filter(Boolean);
  const which = position
    ? `Make one new square image of only the ${position} design from that sheet, on its own.`
    : 'Make one new square image of the sculpture in the attached picture, on its own.';
  const keep = 'Keep the same sculpture, the same matte gray clay, the same soft lighting and the same flat pure white background. Center it and let it fill most of the frame, with white space all around it.';
  const change = list.length
    ? `Change only this:\n${list.map(c => `- ${c}.`).join('\n')}\n\nDo not change anything else.`
    : 'Do not change the design itself.';
  return `${which} ${keep}\n\n${change}`;
}

/** Longer than this and the link is opened bare; the prompt is on the clipboard either way. */
export const LINK_LIMIT = 6000;

/** A ChatGPT address that opens with the prompt already in the box. */
export function chatGptLink(prompt: string): string {
  const url = `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`;
  return url.length <= LINK_LIMIT ? url : 'https://chatgpt.com/';
}

/** What Claude is asked when it is handed the contact sheet: a blind read first, then a pick. */
export const CRITIC_PROMPT = `The picture I am pasting shows numbered previews of one wall sculpture idea, each as it would look cut from thin wood and hung on a wall.

Judge only what you can see. For each numbered preview:
1. Say what it shows in five words or fewer.
2. Score how clearly it reads from across a room, 1 to 5.
3. Name the one change that would help it most.

Then say which preview you would cut, and why, in two sentences.`;

export function claudeLink(prompt: string = CRITIC_PROMPT): string {
  return `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
}
