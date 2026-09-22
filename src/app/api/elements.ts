// The elements registry: Slack's own React components, by name.
//
// Every entry is a `lazyComponent`, so referencing one costs nothing until it
// renders and a component whose chunk has not loaded yet simply renders
// nothing rather than throwing. Only Button, Tooltip, Label, MenuTrigger and
// ConnectedBaseAvatar have been observed rendering. The other names, and all
// prop shapes declared here, are unverified Slack-private contracts and must
// not carry UI whose silent loss breaks a feature.
//
// Names live here and in docs/slack-internals.md; a Slack rename is a one-file
// fix.

import { lazyComponent, reactReady } from '../slack/react.tsx';

export type SvgIconProps = {
  name: string;
  size?: number;
  inline?: boolean;
};

export type MrkdwnElementProps = {
  text: string;
};

export type ButtonProps = {
  type?: 'primary' | 'ghost' | 'outline' | 'danger';
  size?: 'small' | 'medium' | 'large';
  icon?: string;
  href?: string;
  htmlType?: 'button' | 'submit' | 'reset';
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'size'>;

export type TooltipProps = {
  tip: React.ReactNode;
  position?: string;
  offsetY?: number;
  delay?: number;
  zIndex?: string;
  children?: React.ReactNode;
};

export type IconButtonBaseProps = {
  size?: string;
  className?: string;
  'aria-pressed'?: string;
  'aria-label'?: string;
  'data-qa'?: string;
  onClick?: () => void;
  tabIndex?: number;
  children?: React.ReactNode;
};

export type ConfirmationModalProps = {
  title?: React.ReactNode;
  children?: React.ReactNode;
  onSubmit?: () => void;
  onCancel?: () => void;
  onClose?: () => void;
  submitButtonText?: string;
  cancelButtonText?: string;
  submitButtonType?: 'primary' | 'danger';
  showCancelButton?: boolean;
  showSubmitButton?: boolean;
  disableSubmitButton?: boolean;
};

/** The error line under a form field, warning icon included. */
export type InlineAlertProps = {
  children?: React.ReactNode;
  className?: string;
  id?: string;
};

export type LabelProps = {
  text: React.ReactNode;
  htmlFor?: string;
  subtext?: React.ReactNode;
  optional?: boolean;
  type?: 'block' | 'inline';
  isDisabled?: boolean;
  className?: string;
  id?: string;
};

/** One row of a Slack menu. */
export type MenuTemplateItem = {
  key: string;
  label?: React.ReactNode;
  description?: React.ReactNode;
  type?: 'submenu' | 'separator' | 'header' | 'custom';
  /** The rows of a `submenu` item. */
  template?: MenuTemplateItem[];
  /** An `SvgIcon` name. */
  icon?: string;
  click?: (event?: unknown) => void;
  disabled?: boolean;
  danger?: boolean;
};

/** Slack's section wrapper: a FieldSet holding a Legend and its controls. */
export type FieldSetProps = {
  id?: string;
  'data-qa'?: string;
  'data-qa-section'?: string;
  children?: React.ReactNode;
};

export type LegendProps = {
  className?: string;
  children?: React.ReactNode;
};

/** The secondary line under a control. */
export type HintProps = {
  children?: React.ReactNode;
  className?: string;
};

export type SelectOption = { label: string; value: string };

export type BasicSelectProps = {
  selectId: string;
  options: SelectOption[];
  selectedOption?: SelectOption;
  onSelectionChange: (option: SelectOption) => void;
  width?: number;
  ariaLabel?: string;
  selectDataQa?: string;
  isDisabled?: boolean;
};

export type BlocksProps = {
  msg: { blocks?: unknown[]; [key: string]: unknown };
  blocksContainerContext?: 'message' | string;
  streaming?: boolean;
};

/** Slack's avatar, for either a member (`userId`) or a bot (`botId`). */
export type AvatarProps = {
  userId?: string;
  botId?: string;
  /** The bot as the message recorded it, used until the store has its own copy. */
  botProfile?: object;
  /** An image set to draw instead of the member's or bot's own. */
  icons?: object;
  /** Side length in pixels; also picks which stored image size is used. */
  size?: number;
  className?: string;
  isInteractive?: boolean;
  showCard?: boolean;
  showTooltip?: boolean;
  messageTs?: string;
  ariaHidden?: string;
  tabIndex?: number;
  'data-qa'?: string;
};

/** Wraps a trigger so hovering it opens Slack's profile card. */
export type ProfileHoverTriggerProps = {
  memberId?: string;
  /** The bot (`B…`) whose app profile to show. */
  serviceId?: string;
  botProfile?: object;
  messageTs?: string;
  position?: string;
  /** Leave off the wrapper's own class. */
  noStyling?: boolean;
  children?: React.ReactNode;
};

export type MenuFromTemplateProps = { template?: MenuTemplateItem[] };

export type MenuTriggerProps = {
  position?: 'top' | 'bottom' | 'left' | 'right';
  isDisabled?: boolean;
  renderMenu: (menuProps: object) => React.ReactNode;
  children?: React.ReactNode;
};

export type FormTextInputProps = {
  id?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
  onFocus?: React.FocusEventHandler<HTMLInputElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  placeholder?: string;
  hintText?: string | null;
  errorText?: string | null;
  isDisabled?: boolean;
  isInvalid?: boolean;
  isRequired?: boolean;
  size?: 'small' | 'medium' | 'large';
  autoFocus?: boolean;
  autoComplete?: string;
  maxCharacterLimit?: number | null;
  className?: string;
};

export const elementsReady = (async () => {
  await reactReady;

  return {
    SvgIcon: lazyComponent<SvgIconProps>('SvgIcon'),
    Avatar: lazyComponent<AvatarProps>('ConnectedBaseAvatar'),
    ProfileHoverTrigger: lazyComponent<ProfileHoverTriggerProps>('ProfileHoverTrigger'),
    MrkdwnElement: lazyComponent<MrkdwnElementProps>('MrkdwnElement'),
    Button: lazyComponent<ButtonProps>('Button'),
    Tooltip: lazyComponent<TooltipProps>('Tooltip'),
    IconButtonBase: lazyComponent<IconButtonBaseProps>('IconButtonBase'),
    ConfirmationModal: lazyComponent<ConfirmationModalProps>('ConfirmationModal'),
    InlineAlert: lazyComponent<InlineAlertProps>('InlineAlert'),
    Label: lazyComponent<LabelProps>('Label'),
    FormTextInput: lazyComponent<FormTextInputProps>('FormTextInput'),
    FieldSet: lazyComponent<FieldSetProps>('FieldSet'),
    Legend: lazyComponent<LegendProps>('Legend'),
    Hint: lazyComponent<HintProps>('Hint'),
    BasicSelect: lazyComponent<BasicSelectProps>('BasicSelect'),
    Blocks: lazyComponent<BlocksProps>('Blocks'),
    MenuTrigger: lazyComponent<MenuTriggerProps>('MenuTrigger'),
    MenuFromTemplate: lazyComponent<MenuFromTemplateProps>('MenuFromTemplate'),
  };
})();

export type ElementsAPI = Awaited<typeof elementsReady>;
