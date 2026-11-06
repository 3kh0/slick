const paidPromotion = /(?:Upsell|Upgrade|Trial|Promo|DiscountOffer)/;
const promotionSurface =
  /(?:Banner|Cta|CTA|Button|MenuItem|MenuHeader|SidebarLink|SidebarHeader|Badge|Coachmark|Tooltip|Peek|PromoContent|DiscountPromo|Modal|ModalNew|BadgeWithImpression|TrialTag|TrialUpgrade)$/;
const aiPromotion =
  /^(?:Base)?(?:Slackbot|OmniswitcherSlackbot).*?(?:Nux|Coachmark|Awareness|SuggestedPrompts|FeaturedSkill|WelcomeMat|Onboarding|NoLimitBanner)/;
const aiShortcuts = new Set([
  'SlackbotAiButton',
  'SlackbotButton',
  'SlackbotEntryPoint',
  'SlackbotSidebarLinkWrapper',
  'BaseSlackbotTabContent',
  'SlackbotForeword',
  'BaseSlackbotSummarizeButton',
  'CanvasAskSlackbotButton',
  'ListAskSlackbotButton',
  'WorkObjectAskSlackbotButton',
  'BaseSuggestionAskSlackbot',
  'SuggestionSlackbotStarterPrompt',
  'OmniswitcherSlackbotModeSwitchHint',
  'SlackbotSamplingAwarenessFooterBanner',
  'SlackbotAiDmUpgradeBanner',
  'SlackbotAiSamplePaywallFooter',
  'SlackbotAiSampleWrapper',
  'SlackbotSkillsAnnouncementAlternateSkillBanner',
  'SlackbotWritingCoachBanner',
  'MeetSlackbotModal',
  'SlackbotBigModeNuxModal',
]);

export function promotionKind(name: string): 'paid' | 'ai' | null {
  name = name.replace(/^Connect\((.*)\)$/, '$1');
  if (aiShortcuts.has(name) || aiPromotion.test(name)) return 'ai';
  if (paidPromotion.test(name) && promotionSurface.test(name)) return 'paid';
  return null;
}

export function componentName(component: unknown): string {
  if (typeof component === 'function') {
    return (component as { displayName?: string }).displayName || component.name;
  }
  if (!component || typeof component !== 'object') return '';
  const value = component as { displayName?: string; $$typeof?: symbol; type?: unknown; render?: unknown };
  if (value.displayName) return value.displayName;
  if (value.$$typeof === Symbol.for('react.memo')) return componentName(value.type);
  if (value.$$typeof === Symbol.for('react.forward_ref')) return componentName(value.render);
  return '';
}

export function preservesChildren(name: string): boolean {
  return /Coachmark|Tooltip|SampleWrapper/.test(name);
}
