// The one-line composer layout. Adapted from Taut's SlimMessageBox (MIT,
// github.com/jeremy46231/taut). A container query, so a narrow composer stacks
// instead of overlapping the send button.

const SCOPE = '.p-message_input__input_container_unstyled';

/** The editor claims this much; the buttons sit beside it only if they fit. */
const MIN_EDITOR_WIDTH = 450;

// A container query can't measure the buttons, so estimate Slack's ~340px row
// minus hidden ones. Being wrong only shifts when one-line kicks in.
const CONTAINER = 'slick-composer';
const SLACK_BUTTON_ROW = 340;
const BUTTON_WIDTH = 32;
const oneLineWidth = (hidden: number) => `${MIN_EDITOR_WIDTH + SLACK_BUTTON_ROW - hidden * BUTTON_WIDTH}px`;

/** Attachments get Slack's stacked layout back, since they need full width. */
const ONE_LINE = `${SCOPE}:not(:has(.c-wysiwyg_container__attachments, .p-message_input__attachments, .c-pending_files, .c-message__editor__composer_attachments))`;

export const COMPACT_CSS = `
  ${SCOPE} .c-wysiwyg_container__footer_divider { display: none !important; }
`;

export const NO_BROADCAST_CSS = `
  .p-threads_footer__input_container { min-height: 0; }
`;

export const layoutCss = (hiddenButtons: number): string => `
  ${SCOPE} { container: ${CONTAINER} / inline-size; }

  ${ONE_LINE} .c-basic_container__body {
    display: flex !important;
    flex-direction: row !important;
    flex-wrap: wrap;
    align-items: flex-end !important;
    column-gap: 6px;
  }

  /* Everything Slack stacks above the editor (alerts, the formatting bar)
     keeps a full-width row, in the order its grid-template-areas gives them. */
  ${ONE_LINE} .c-basic_container__body > * { order: 0; flex: 1 0 100%; }
  ${ONE_LINE} .c-basic_container__body > :empty { display: none; }
  ${ONE_LINE} .c-wysiwyg_container__formatting { order: 1; }
  ${ONE_LINE} .c-wysiwyg_container__message_suggestions { order: 2; }
  ${ONE_LINE} .c-texty_input_unstyled__container {
    order: 3;
    flex: 100 1 0% !important;
    min-width: min(${MIN_EDITOR_WIDTH}px, 100%);
  }
  ${ONE_LINE} .c-wysiwyg_container__draft { order: 4; }
  ${ONE_LINE} .p-threads_footer__input_container__broadcast_controls {
    order: 5;
    flex: 1 0 100%;
  }

  /* Whole and last, so attach, buttons and send wrap as a unit with send in
     the corner. On its own line below the query, where the contained row
     measures ~0. */
  ${ONE_LINE} .c-wysiwyg_container__footer {
    display: flex !important;
    order: 6;
    flex: 1 0 100% !important;
    flex-wrap: wrap;
    min-width: 0;
  }
  ${ONE_LINE} .c-wysiwyg_container__suffix {
    margin-left: auto !important;
    flex: 0 0 auto !important;
  }

  @container ${CONTAINER} (min-width: ${oneLineWidth(hiddenButtons)}) {
    ${ONE_LINE} .c-wysiwyg_container__footer { flex: 1 1 auto !important; }

    /* With no floor to wrap against, the toolbar always fits beside the
       message, so the checkbox stays under it. Capping it instead strands the
       send button on a row of its own. */
    ${ONE_LINE}:has(.p-threads_footer__input_container__broadcast_controls) .c-texty_input_unstyled__container {
      min-width: 0 !important;
    }

    /* Slack leaves this no bottom padding, having always had the buttons
       below it. */
    ${ONE_LINE} .p-threads_footer__input_container__broadcast_controls {
      order: 7;
      padding-bottom: 8px;
    }

    /* Slack sizes this row from the OUTSIDE (container-type: inline-size), so
       beside the message it comes out 0 wide and the buttons spill over send.
       Dropping the box also reads as nothing-to-do to the overflow menu's
       test, which starts at an offsetWidth &&. */
    ${ONE_LINE} .c-wysiwyg_container__toolbar_buttons {
      flex: 0 1 auto !important;
      min-width: 0 !important;
    }
    ${ONE_LINE} .c-texty_buttons { display: contents !important; }
  }
`;
